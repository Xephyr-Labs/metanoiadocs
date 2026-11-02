import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfToMarkdown } from './pdf.js';

/**
 * Build a small but genuinely valid PDF — real objects, real xref, real
 * offsets. A canned fixture file would test the same thing while hiding what it
 * contains; this way each test states the page it is about to read back.
 *
 * @param {{size: number, x: number, y: number, text: string, font?: string}[] | object[][]} runs
 *   one page of runs, or an array of pages; `font` is a standard-14 BaseFont
 * @param {{encrypted?: boolean, links?: {rect: number[], url: string}[], toUnicode?: string}} opts
 *   links go on the first page; toUnicode is a "<src> <dst>" bfchar pair given
 *   to every font, to fake the private-use glyphs a Symbol font extracts as
 */
function makePdf(runs, { encrypted = false, links = [], toUnicode } = {}) {
  const pages = Array.isArray(runs[0]) ? runs : [runs];
  const fonts = [...new Set(['Helvetica', ...pages.flat().map((r) => r.font ?? 'Helvetica')])];
  const fontRes = fonts.map((f, i) => `/F${i + 1} ${3 + i} 0 R`).join(' ');
  const firstPage = 3 + fonts.length;
  const annots = links.map((l) =>
    `<< /Type /Annot /Subtype /Link /Rect [${l.rect.join(' ')}] /Border [0 0 0] /A << /S /URI /URI (${l.url}) >> >>`);
  const firstAnnot = firstPage + pages.length * 2;
  const cmapObj = firstAnnot + annots.length;
  const cmap = toUnicode &&
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /T def /CMapType 2 def ' +
    `1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar ${toUnicode} endbfchar ` +
    'endcmap CMapName currentdict /CMap defineresource pop end end';

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${firstPage + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    ...fonts.map((f) => `<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding` +
      `${cmap ? ` /ToUnicode ${cmapObj} 0 R` : ''} >>`),
  ];
  pages.forEach((page, p) => {
    const content = page
      .map((r) => `BT /F${fonts.indexOf(r.font ?? 'Helvetica') + 1} ${r.size} Tf ${r.x} ${r.y} Td (${r.text.replace(/([()])/g, '\\$1')}) Tj ET`)
      .join('\n');
    const pageAnnots = p === 0 && annots.length
      ? ` /Annots [${annots.map((_, i) => `${firstAnnot + i} 0 R`).join(' ')}]`
      : '';
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << ${fontRes} >> >> /Contents ${firstPage + p * 2 + 1} 0 R${pageAnnots} >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    );
  });
  objects.push(...annots);
  if (cmap) objects.push(`<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`);

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

test('bold and italic fonts become markdown emphasis, headings stay plain', async () => {
  const { markdown } = await pdfToMarkdown(
    makePdf([
      { size: 24, x: 72, y: 740, text: 'Bold Title', font: 'Helvetica-Bold' },
      { size: 12, x: 72, y: 700, text: 'Plain ' },
      { size: 12, x: 104, y: 700, text: 'strong', font: 'Helvetica-Bold' },
      { size: 12, x: 142, y: 700, text: ' and ' },
      { size: 12, x: 168, y: 700, text: 'slanted', font: 'Helvetica-Oblique' },
      { size: 12, x: 206, y: 700, text: ' text, the rest of the body.' },
    ]),
  );
  assert.match(markdown, /^# Bold Title$/m);
  assert.match(markdown, /Plain \*\*strong\*\* and \*slanted\* text, the rest/);
});

test('runs that touch join without a space, runs with a gap get one', async () => {
  // 'see the docs' in 12pt Helvetica is 68.04pt wide; the font switch keeps
  // the next run a separate item, as after a link or a styled word.
  const { markdown } = await pdfToMarkdown(
    makePdf([
      { size: 12, x: 72, y: 700, text: 'see the docs' },
      { size: 12, x: 140.04, y: 700, text: '. Then', font: 'Times-Roman' },
      { size: 12, x: 180, y: 700, text: 'more' },
    ]),
  );
  assert.match(markdown, /see the docs\. Then more/);
});

test('link annotations become markdown links', async () => {
  // 'Read ' in 12pt Helvetica is 32pt wide. The font switch keeps pdfjs from
  // merging the two runs into one item, as a styled link would in practice.
  const { markdown } = await pdfToMarkdown(
    makePdf(
      [
        { size: 12, x: 72, y: 700, text: 'Read ' },
        { size: 12, x: 104, y: 700, text: 'the guide', font: 'Times-Roman' },
      ],
      { links: [{ rect: [104, 696, 160, 712], url: 'https://example.com/guide' }] },
    ),
  );
  assert.match(markdown, /^Read \[the guide\]\(https:\/\/example\.com\/guide\)$/m);
});

test('Symbol-font bullets, which extract as private-use glyphs, are bullets', async () => {
  const { markdown } = await pdfToMarkdown(
    makePdf(
      [
        { size: 12, x: 72, y: 700, text: '\\225 first item' },
        { size: 12, x: 72, y: 686, text: '\\225 second item' },
      ],
      { toUnicode: '<95> <F0B7>' },
    ),
  );
  assert.match(markdown, /^- first item\n- second item$/m);
});

test('a paragraph after a list is not swallowed into its last item', async () => {
  const { markdown } = await pdfToMarkdown(
    makePdf([
      { size: 12, x: 72, y: 700, text: '1. step one' },
      { size: 12, x: 72, y: 686, text: 'After the list.' },
    ]),
  );
  assert.match(markdown, /^1\. step one\n\nAfter the list\.$/m);
});

test('aligned columns become a markdown table', async () => {
  const { markdown } = await pdfToMarkdown(
    makePdf([
      { size: 12, x: 72, y: 700, text: 'Region' },
      { size: 12, x: 200, y: 700, text: 'Revenue' },
      { size: 12, x: 330, y: 700, text: 'Growth' },
      { size: 12, x: 72, y: 680, text: 'North' },
      { size: 12, x: 200, y: 680, text: '120' },
      { size: 12, x: 330, y: 680, text: '5%' },
      { size: 12, x: 72, y: 660, text: 'South' },
      { size: 12, x: 200, y: 660, text: '98' },
      { size: 12, x: 330, y: 660, text: '-2%' },
    ]),
  );
  assert.match(
    markdown,
    /^\| Region \| Revenue \| Growth \|\n\| --- \| --- \| --- \|\n\| North \| 120 \| 5% \|\n\| South \| 98 \| -2% \|$/m,
  );
});

test('two columns read left column first, not interleaved', async () => {
  const left = ['Left column opens here and', 'keeps going down the page', 'until it ends at the foot.'];
  const right = ['Right column starts later on', 'with its own run of prose', 'and finishes its sentence.'];
  const { markdown } = await pdfToMarkdown(
    makePdf([
      ...left.map((text, i) => ({ size: 12, x: 72, y: 700 - i * 14, text })),
      ...right.map((text, i) => ({ size: 12, x: 320, y: 695 - i * 14, text })),
    ]),
  );
  assert.match(markdown, /^Left column opens here and keeps going down the page until it ends at the foot\.$/m);
  assert.match(markdown, /^Right column starts later on with its own run of prose and finishes its sentence\.$/m);
});

test('running headers, footers and page numbers are dropped', async () => {
  const page = (n, body) => [
    { size: 9, x: 72, y: 760, text: 'ACME Quarterly Report' },
    { size: 12, x: 72, y: 700, text: body },
    { size: 9, x: 300, y: 40, text: String(n) },
  ];
  const { markdown } = await pdfToMarkdown(
    makePdf([page(1, 'Body of the first page.'), page(2, 'Body of the second page.')]),
  );
  assert.equal(markdown, 'Body of the first page.\n\nBody of the second page.\n');
});
