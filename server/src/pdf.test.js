import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfToMarkdown } from './pdf.js';

/**
 * Build a small but genuinely valid PDF — real objects, real xref, real
 * offsets. A canned fixture file would test the same thing while hiding what it
 * contains; this way each test states the page it is about to read back.
 *
 * @param {{size: number, x: number, y: number, text: string}[]} runs
 */
function makePdf(runs, { encrypted = false } = {}) {
  const content = runs
    .map((r) => `BT /F1 ${r.size} Tf ${r.x} ${r.y} Td (${r.text.replace(/([()])/g, '\\$1')}) Tj ET`)
    .join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  // /Encrypt makes pdfjs demand a password without needing real encryption —
  // enough to prove the error path reports it as password-protected.
  const key = '<' + '31'.repeat(32) + '>';
  const encrypt = encrypted
    ? ` /Encrypt << /Filter /Standard /V 1 /R 2 /O ${key} /U ${key} /P -1 >>` +
      ` /ID [<${'a'.repeat(32)}> <${'a'.repeat(32)}>]`
    : '';
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encrypt} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

test('extracts text', async () => {
  const { markdown } = await pdfToMarkdown(
    makePdf([{ size: 12, x: 72, y: 700, text: 'Hello from a PDF.' }]),
  );
  assert.match(markdown, /Hello from a PDF\./);
});

test('larger type becomes a heading, body text does not', async () => {
  const { markdown } = await pdfToMarkdown(
    makePdf([
      { size: 24, x: 72, y: 720, text: 'The Title' },
      { size: 12, x: 72, y: 680, text: 'Body text that carries most of the document.' },
      { size: 12, x: 72, y: 660, text: 'More body text, still the same size as the rest.' },
    ]),
  );
  assert.match(markdown, /^# The Title$/m);
  assert.doesNotMatch(markdown, /^#+ Body text/m);
});

test('two heading sizes become two levels', async () => {
  const { markdown } = await pdfToMarkdown(
    makePdf([
      { size: 24, x: 72, y: 730, text: 'Chapter' },
      { size: 17, x: 72, y: 700, text: 'Section' },
      { size: 11, x: 72, y: 670, text: 'Ordinary body copy making up the bulk of the page.' },
      { size: 11, x: 72, y: 650, text: 'Still ordinary body copy, so 11pt is the body size.' },
    ]),
  );
  assert.match(markdown, /^# Chapter$/m);
  assert.match(markdown, /^## Section$/m);
});

test('wrapped lines rejoin into one paragraph', async () => {
  // Consecutive lines a normal leading apart are one paragraph in the source
  // document; importing them as separate blocks makes the doc unusable.
  const { markdown } = await pdfToMarkdown(
    makePdf([
      { size: 12, x: 72, y: 700, text: 'This sentence began on one line' },
      { size: 12, x: 72, y: 686, text: 'and finished on the next one.' },
    ]),
  );
  assert.match(markdown, /This sentence began on one line and finished on the next one\./);
});

test('a wide gap starts a new paragraph', async () => {
  const { markdown } = await pdfToMarkdown(
    makePdf([
      { size: 12, x: 72, y: 700, text: 'First paragraph.' },
      { size: 12, x: 72, y: 600, text: 'Second paragraph.' },
    ]),
  );
  assert.match(markdown, /First paragraph\.\n\nSecond paragraph\./);
});

test('a word hyphenated across a line break is rejoined', async () => {
  const { markdown } = await pdfToMarkdown(
    makePdf([
      { size: 12, x: 72, y: 700, text: 'An extraordi-' },
      { size: 12, x: 72, y: 686, text: 'nary result.' },
    ]),
  );
  assert.match(markdown, /extraordinary result/);
});

test('bulleted and numbered lines become markdown lists', async () => {
  const { markdown } = await pdfToMarkdown(
    makePdf([
      { size: 12, x: 72, y: 700, text: '\\225 first item' },
      { size: 12, x: 72, y: 686, text: '\\225 second item' },
      { size: 12, x: 72, y: 660, text: '1. step one' },
      { size: 12, x: 72, y: 646, text: '2. step two' },
    ]),
  );
  assert.match(markdown, /^- first item$/m);
  assert.match(markdown, /^- second item$/m);
  assert.match(markdown, /^1\. step one$/m);
  assert.match(markdown, /^2\. step two$/m);
});

test('runs on the same baseline join into one line', async () => {
  // pdfjs splits a line at every font or kern change; the pieces have to come
  // back as one line, in reading order, without words glued together.
  const { markdown } = await pdfToMarkdown(
    makePdf([
      { size: 12, x: 72, y: 700, text: 'left ' },
      { size: 12, x: 140, y: 700, text: 'middle ' },
      { size: 12, x: 210, y: 700, text: 'right' },
    ]),
  );
  assert.match(markdown, /left middle right/);
});

test('a PDF with no text layer is refused, not imported empty', async () => {
  // The scanned-document case. An empty doc created silently is the worst
  // outcome here, so this must throw and say what is wrong.
  await assert.rejects(
    () => pdfToMarkdown(makePdf([])),
    /No text found.*scan|OCR/s,
  );
});

test('a password-protected PDF says so', async () => {
  await assert.rejects(
    () => pdfToMarkdown(makePdf([{ size: 12, x: 72, y: 700, text: 'secret' }], { encrypted: true })),
    /password-protected/,
  );
});

test('a file that is not a PDF is refused', async () => {
  await assert.rejects(() => pdfToMarkdown(Buffer.from('this is plain text')), /not a readable PDF|could not be read/);
});
