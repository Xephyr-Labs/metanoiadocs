import test from 'node:test';
import assert from 'node:assert/strict';
import { docxFromMarkdown } from './docx.js';
import { docxToMarkdown, parseXml } from './docx-import.js';
import { zipSync } from './zip.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Export markdown to .docx with the app's own writer, then read it back. Using
 * docx.js as the fixture generator means these tests cover the pair, and a
 * change to either side that breaks the round trip fails here.
 */
async function roundTrip(markdown, opts) {
  const buf = await docxFromMarkdown({
    title: 'T',
    markdown,
    meta: '',
    // docx.js only embeds a picture it can fetch bytes for; without this the
    // image tests would export a document with no images and pass vacuously.
    loadImage: async () => ({ mime: 'image/png', data: PNG }),
  });
  return docxToMarkdown(buf, opts);
}

test('headings survive', async () => {
  const { markdown } = await roundTrip('# One\n\n## Two\n\n### Three\n');
  assert.match(markdown, /^# One$/m);
  assert.match(markdown, /^## Two$/m);
  assert.match(markdown, /^### Three$/m);
});

test('inline marks survive', async () => {
  const { markdown } = await roundTrip(
    'Plain with **bold**, *italic*, ~~struck~~ and `code()` in it.\n',
  );
  assert.match(markdown, /\*\*bold\*\*/);
  assert.match(markdown, /\*italic\*/);
  assert.match(markdown, /~~struck~~/);
  assert.match(markdown, /`code\(\)`/);
});

test('links keep their target', async () => {
  const { markdown } = await roundTrip('See [the site](https://example.com) today.\n');
  assert.match(markdown, /\[the site\]\(https:\/\/example\.com\)/);
});

test('bulleted and nested lists survive', async () => {
  const { markdown } = await roundTrip('- first\n- second\n  - nested\n- third\n');
  assert.match(markdown, /^- first$/m);
  assert.match(markdown, /^ {2}- nested$/m);
});

test('ordered lists come back numbered, and restart', async () => {
  const { markdown } = await roundTrip('1. one\n2. two\n\nBreak.\n\n1. again\n2. more\n');
  assert.match(markdown, /^1\. one$/m);
  assert.match(markdown, /^2\. two$/m);
  // The second list must start at 1 rather than continuing to 3.
  const numbers = [...markdown.matchAll(/^(\d)\. /gm)].map((m) => m[1]);
  assert.deepEqual(numbers, ['1', '2', '1', '2']);
});

test('task lists survive the checkbox glyph docx.js draws', async () => {
  const { markdown } = await roundTrip('- [ ] open\n- [x] done\n');
  assert.match(markdown, /^- \[ \] open$/m);
  assert.match(markdown, /^- \[x\] done$/m);
});

test('code blocks come back fenced, not as paragraphs', async () => {
  const { markdown } = await roundTrip('```\nconst x = 1;\n  indented();\n```\n');
  assert.match(markdown, /```\nconst x = 1;\n {2}indented\(\);\n```/);
});

test('quotes survive', async () => {
  const { markdown } = await roundTrip('> A quotation.\n');
  assert.match(markdown, /^> A quotation\.$/m);
});

test('tables survive with their header', async () => {
  const { markdown } = await roundTrip('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
  assert.match(markdown, /^\| A \| B \|$/m);
  assert.match(markdown, /^\| --- \| --- \|$/m);
  assert.match(markdown, /^\| 1 \| 2 \|$/m);
});

test('dividers survive', async () => {
  const { markdown } = await roundTrip('Above.\n\n---\n\nBelow.\n');
  assert.match(markdown, /^---$/m);
});

test('images go through saveImage and get the returned url', async () => {
  const stored = [];
  const { markdown, warnings } = await roundTrip(
    '![a picture](/api/blob/original)\n',
    {
      saveImage: async (bytes, name) => {
        stored.push({ bytes, name });
        return '/api/blob/abc123';
      },
    },
  );
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].bytes, PNG);
  assert.match(markdown, /!\[a picture\]\(\/api\/blob\/abc123\)/);
  assert.deepEqual(warnings, []);
});

test('without saveImage, pictures degrade to their alt text and are counted', async () => {
  const { markdown, warnings } = await roundTrip(
    '![a picture](/api/blob/original)\n',
  );
  assert.doesNotMatch(markdown, /!\[/);
  assert.match(markdown, /a picture/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /1 image could not be imported/);
});

test('special characters are escaped, not turned into markup', async () => {
  const { markdown } = await roundTrip('A literal \\*not bold\\* and \\[not a link\\].\n');
  // Whatever the escaping, the text must not come back as emphasis.
  assert.doesNotMatch(markdown, /(^|[^\\])\*not bold\*/);
});

test('rejects a file that is not a Word document', async () => {
  await assert.rejects(
    () => docxToMarkdown(zipSync([{ name: 'hello.txt', data: 'hi' }])),
    /not a Word document/,
  );
  await assert.rejects(() => docxToMarkdown(Buffer.from('%PDF-1.4')), /Not a ZIP archive/);
});

// ── the XML parser underneath ────────────────────────────────────────────────

test('parseXml handles attributes, self-closing tags and entities', () => {
  const root = parseXml('<a x="1" y=\'2\'><b/><c>a &amp; b &lt;ok&gt; &#65;</c></a>');
  const a = root.children[0];
  assert.equal(a.name, 'a');
  assert.equal(a.attrs.x, '1');
  assert.equal(a.attrs.y, '2');
  assert.equal(a.children[0].name, 'b');
  assert.equal(a.children[1].children[0], 'a & b <ok> A');
});

test('parseXml skips declarations and comments', () => {
  const root = parseXml('<?xml version="1.0"?><!-- note --><a>text</a>');
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].children[0], 'text');
});

test('parseXml does not unwind the document on a stray close tag', () => {
  const root = parseXml('<a><b>one</stray>two</b></a>');
  const a = root.children[0];
  assert.equal(a.name, 'a');
  assert.equal(a.children[0].name, 'b');
});
