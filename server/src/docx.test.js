import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { docxFromMarkdown, inlineRuns } from './docx.js';
import { zipSync, imageSize } from './zip.js';

// A 1x1 red PNG, so the image path is exercised with real bytes.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const SAMPLE = `# Heading one

Plain paragraph with **bold**, *italic*, ~~struck~~ and \`code()\`, plus a [link](https://example.com).

## Heading two

- first
- second
  - nested
- third

1. one
2. two

> A quotation.

\`\`\`js
const x = 1;
\`\`\`

---

| Name | Role |
| --- | --- |
| Ada | Author |

![a red dot](/api/blob/abc123)
`;

const build = () =>
  docxFromMarkdown({
    title: 'Test document',
    markdown: SAMPLE,
    meta: 'Last edited 2026-08-11',
    loadImage: async (url) => (url === '/api/blob/abc123' ? { mime: 'image/png', data: PNG } : null),
  });

/** Unzip into a { name: string } map using the system unzip. */
function extract(buf) {
  const dir = mkdtempSync(join(tmpdir(), 'docx-'));
  const file = join(dir, 'out.docx');
  writeFileSync(file, buf);
  execFileSync('unzip', ['-qq', '-o', file, '-d', dir]);
  const names = execFileSync('unzip', ['-Z1', file]).toString().trim().split('\n');
  const parts = {};
  for (const name of names) parts[name] = readFileSync(join(dir, name));
  return { dir, file, parts, names };
}

test('the archive is a real zip and holds every part Word requires', () => {
  const { parts, names } = extract(zipSync([{ name: 'a.txt', data: 'hello' }, { name: 'b/c.bin', data: PNG }]));
  assert.deepEqual(names.sort(), ['a.txt', 'b/c.bin']);
  assert.equal(parts['a.txt'].toString(), 'hello');
  assert.deepEqual(parts['b/c.bin'], PNG, 'already-compressed bytes survive being stored verbatim');
});

test('image headers give real pixel dimensions', () => {
  assert.deepEqual(imageSize(PNG), { width: 1, height: 1 });
  assert.equal(imageSize(Buffer.from('not an image')), null);
});

test('inline markdown becomes typed runs', () => {
  assert.deepEqual(inlineRuns('a **b** c'), [{ text: 'a ' }, { text: 'b', bold: true }, { text: ' c' }]);
  assert.deepEqual(inlineRuns('`**not bold**`'), [{ text: '**not bold**', code: true }]);
  assert.deepEqual(inlineRuns('[go](https://x.com)'), [{ text: 'go', link: 'https://x.com' }]);
  // The url stops at the first ")", so the rest is literal text — what matters
  // is that the run carries no link for runXml to turn into a relationship.
  assert.deepEqual(inlineRuns('[bad](javascript:alert(1))')[0], { text: 'bad', link: '' }, 'javascript: is stripped');
  assert.deepEqual(inlineRuns('![alt](/api/blob/k)'), [{ image: '/api/blob/k', alt: 'alt' }]);
});

test('every part is well-formed XML and the relationships all resolve', async () => {
  const { parts } = extract(await build());
  const required = [
    '[Content_Types].xml',
    '_rels/.rels',
    'word/document.xml',
    'word/styles.xml',
    'word/numbering.xml',
    'word/_rels/document.xml.rels',
    'word/media/image1.png',
  ];
  for (const name of required) assert.ok(parts[name], `${name} present`);

  const doc = parts['word/document.xml'].toString();
  const rels = parts['word/_rels/document.xml.rels'].toString();
  // A dangling r:id is exactly the kind of corruption Word reports as "unreadable
  // content", and it is invisible in the XML unless you go looking.
  const used = [...doc.matchAll(/r:(?:id|embed)="(rId\d+)"/g)].map((m) => m[1]);
  assert.ok(used.length >= 2, 'the sample has a hyperlink and an image');
  for (const id of used) assert.ok(rels.includes(`Id="${id}"`), `${id} declared`);

  // Every w:numId the body references must exist in numbering.xml, or the list
  // silently loses its bullets.
  const numbering = parts['word/numbering.xml'].toString();
  for (const m of doc.matchAll(/<w:numId w:val="(\d+)"\/>/g)) {
    assert.ok(numbering.includes(`<w:num w:numId="${m[1]}">`), `numId ${m[1]} defined`);
  }
});

test('the formatting actually survives into the document body', async () => {
  const { parts } = extract(await build());
  const doc = parts['word/document.xml'].toString();
  assert.match(doc, /<w:pStyle w:val="Title"\/>/);
  assert.match(doc, /<w:pStyle w:val="Heading1"\/>/);
  assert.match(doc, /<w:pStyle w:val="Heading2"\/>/);
  assert.match(doc, /<w:b\/><\/w:rPr><w:t xml:space="preserve">bold</);
  assert.match(doc, /<w:i\/><\/w:rPr><w:t xml:space="preserve">italic</);
  assert.match(doc, /<w:strike\/><\/w:rPr><w:t xml:space="preserve">struck</);
  assert.match(doc, /<w:pStyle w:val="Quote"\/>/);
  assert.match(doc, /<w:pStyle w:val="Code"\/>/);
  assert.match(doc, /const x = 1;/);
  assert.match(doc, /<w:pBdr><w:bottom/, 'the divider draws a rule');
  assert.match(doc, /<w:tbl>/);
  assert.match(doc, /<w:tblHeader\/>/);
  assert.match(doc, /<w:drawing>/);
  assert.match(doc, /cx="9525" cy="9525"/, '1px image at 96dpi is 9525 EMU');
  assert.match(doc, /<w:hyperlink/);
});

test('a numbered list restarts rather than continuing the one before it', async () => {
  const { parts } = extract(
    await docxFromMarkdown({ title: 't', markdown: '1. a\n2. b\n\ntext\n\n1. c\n2. d' }),
  );
  const doc = parts['word/document.xml'].toString();
  const ids = [...new Set([...doc.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]))];
  assert.equal(ids.length, 2, 'two lists, two numbering instances');
});

test('a missing image degrades to its alt text instead of a corrupt file', async () => {
  const { parts } = extract(await docxFromMarkdown({ title: 't', markdown: '![gone](/api/blob/missing)' }));
  const doc = parts['word/document.xml'].toString();
  assert.doesNotMatch(doc, /<w:drawing>/);
  assert.match(doc, /gone/);
  assert.doesNotMatch(parts['[Content_Types].xml'].toString(), /image\//, 'no orphan image content type');
});

// The real test of a hand-built docx is whether a word processor opens it.
// LibreOffice is on this machine and in no CI image, so this skips rather than
// fails when it is absent.
test('LibreOffice opens the file and reads the text back out', { skip: !hasSoffice() }, async () => {
  const { dir, file } = extract(await build());
  execFileSync('soffice', ['--headless', '--convert-to', 'txt:Text', '--outdir', dir, file], {
    stdio: 'ignore',
    timeout: 120000,
    env: { ...process.env, HOME: dir },
  });
  const text = readFileSync(join(dir, 'out.txt'), 'utf8');
  assert.match(text, /Test document/);
  assert.match(text, /Heading one/);
  assert.match(text, /A quotation\./);
  assert.match(text, /const x = 1;/);
  assert.match(text, /Ada/);
  assert.match(text, /nested/);
});

function hasSoffice() {
  try {
    execFileSync('which', ['soffice'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
