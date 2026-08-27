import test from 'node:test';
import assert from 'node:assert/strict';
import { fileToMarkdown, stripFrontMatter, titleFromMarkdown, MAX_IMPORT_BYTES } from './import.js';
import { docxFromMarkdown } from './docx.js';
import { buildDocState, docToMarkdown } from './blocks.js';

const utf8 = (s) => Buffer.from(s, 'utf8');

test('markdown passes through', async () => {
  const out = await fileToMarkdown({ name: 'notes.md', bytes: utf8('# Title\n\nBody.\n') });
  assert.equal(out.title, 'Title');
  assert.match(out.markdown, /^# Title$/m);
});

test('a .txt file is imported as markdown', async () => {
  const out = await fileToMarkdown({ name: 'plain.txt', bytes: utf8('Just some text.\n') });
  assert.equal(out.title, 'plain');
  assert.match(out.markdown, /Just some text\./);
});

test('a .docx goes through the Word reader', async () => {
  const buf = await docxFromMarkdown({ title: 'T', markdown: '# From Word\n\nBody copy.\n', meta: '' });
  const out = await fileToMarkdown({ name: 'report.docx', bytes: buf });
  assert.equal(out.title, 'From Word');
  assert.match(out.markdown, /Body copy\./);
});

test('extension matching is case-insensitive', async () => {
  const out = await fileToMarkdown({ name: 'SHOUTY.MD', bytes: utf8('# Yes\n') });
  assert.equal(out.title, 'Yes');
});

test('front matter is stripped', async () => {
  const out = await fileToMarkdown({
    name: 'post.md',
    bytes: utf8('---\ntitle: Meta\ntags: [a]\n---\n\n# Real Title\n\nBody.\n'),
  });
  assert.doesNotMatch(out.markdown, /tags:/);
  assert.equal(out.title, 'Real Title');
});

// These cases came from web-react/src/lib/docFiles.test.ts; the functions moved
// here when import became a server round trip, and their coverage moved with them.
test('stripFrontMatter drops a leading YAML block and the blank line after it', () => {
  assert.equal(
    stripFrontMatter('---\ntitle: Notes\ntags: [a, b]\n---\n\n# Notes\n\nBody.'),
    '# Notes\n\nBody.',
  );
});

test('stripFrontMatter leaves a document that merely opens with a divider alone', () => {
  const md = '----\n\n# Notes';
  assert.equal(stripFrontMatter(md), md);
});

test('stripFrontMatter leaves an unterminated block alone rather than eating the document', () => {
  const md = '---\ntitle: Notes\n\n# Notes\n\nBody.';
  assert.equal(stripFrontMatter(md), md);
});

test('titleFromMarkdown prefers the first H1, not an H2 above it', () => {
  assert.equal(titleFromMarkdown('## Sub\n\n# Real title\n\ntext', 'notes.md'), 'Real title');
});

test('titleFromMarkdown falls back to the filename without its extension', () => {
  assert.equal(titleFromMarkdown('no heading here', 'Meeting Notes.markdown'), 'Meeting Notes');
  assert.equal(titleFromMarkdown('No heading here.\n', 'Quarterly Report.docx'), 'Quarterly Report');
});

test('titleFromMarkdown never returns an empty title', () => {
  assert.equal(titleFromMarkdown('', '.md'), 'Untitled');
  assert.equal(titleFromMarkdown('', ''), 'Untitled');
});

test('CRLF line endings are normalised', async () => {
  const out = await fileToMarkdown({ name: 'windows.md', bytes: utf8('# A\r\n\r\nB\r\n') });
  assert.doesNotMatch(out.markdown, /\r/);
});

test('.doc gets its own message rather than "unsupported"', async () => {
  await assert.rejects(
    () => fileToMarkdown({ name: 'old.doc', bytes: utf8('anything') }),
    /older \.doc format.*Save As.*docx/s,
  );
});

test('an unknown extension names what is accepted', async () => {
  await assert.rejects(
    () => fileToMarkdown({ name: 'sheet.xlsx', bytes: utf8('x') }),
    /Cannot import \.xlsx.*\.md.*\.docx.*\.pdf/s,
  );
});

test('an empty file is refused', async () => {
  await assert.rejects(() => fileToMarkdown({ name: 'empty.md', bytes: Buffer.alloc(0) }), /is empty/);
});

test('a file with only whitespace is refused, not imported blank', async () => {
  await assert.rejects(
    () => fileToMarkdown({ name: 'blank.md', bytes: utf8('   \n\n  \n') }),
    /no text in it/,
  );
});

test('an oversized file is refused before it is parsed', async () => {
  await assert.rejects(
    () => fileToMarkdown({ name: 'huge.pdf', bytes: Buffer.alloc(MAX_IMPORT_BYTES + 1, 0x41) }),
    /larger than 25 MB/,
  );
});

test('a mislabelled file fails with the format reader\'s message', async () => {
  // A .docx that is not a ZIP. The error has to describe the file, not an
  // internal record, so the person who picked it knows what to do.
  await assert.rejects(
    () => fileToMarkdown({ name: 'fake.docx', bytes: utf8('this is plain text, not a docx') }),
    /Not a ZIP archive/,
  );
});

// ── the whole chain ─────────────────────────────────────────────────────────

/** Read a Yjs state back the way the export routes do (see docAsMarkdown). */
const stateToMarkdown = (state) => docToMarkdown(state).markdown;

test('an imported .docx becomes a real doc state, not just a string', async () => {
  // The endpoint hands fileToMarkdown's output straight to buildDocState. If
  // the markdown the Word reader emits is not the dialect blocks.js parses,
  // every unit test above still passes and the imported document opens empty.
  const source = [
    '# Quarterly Report',
    '',
    'Revenue grew, with **bold** and *italic* and a [link](https://example.com).',
    '',
    '## Detail',
    '',
    '- first',
    '- second',
    '',
    '1. step one',
    '2. step two',
    '',
    '> A quotation.',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '```',
    'const x = 1;',
    '```',
    '',
  ].join('\n');

  const docx = await docxFromMarkdown({ title: 'T', markdown: source, meta: '' });
  const { title, markdown } = await fileToMarkdown({ name: 'report.docx', bytes: docx });
  assert.equal(title, 'Quarterly Report');

  const out = stateToMarkdown(Buffer.from(buildDocState(title, markdown)));
  assert.match(out, /Revenue grew/);
  assert.match(out, /\*\*bold\*\*/);
  assert.match(out, /\[link\]\(https:\/\/example\.com\)/);
  assert.match(out, /^## Detail$/m);
  assert.match(out, /^- first$/m);
  assert.match(out, /^1\. step one$/m);
  assert.match(out, /^> A quotation\.$/m);
  assert.match(out, /\| A \| B \|/);
  assert.match(out, /const x = 1;/);
});

test('an imported .txt becomes a doc state with its text intact', async () => {
  const { title, markdown } = await fileToMarkdown({
    name: 'notes.txt',
    bytes: utf8('Just a plain note.\n\nSecond paragraph.\n'),
  });
  const out = stateToMarkdown(Buffer.from(buildDocState(title, markdown)));
  assert.match(out, /Just a plain note\./);
  assert.match(out, /Second paragraph\./);
});
