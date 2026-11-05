import test from 'node:test';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { zipSync } from './zip.js';
import { unzipSync } from './unzip.js';
import { planArchive, summaryLines, cleanEntries } from './archive-import.js';
import { parseHtml } from './confluence-import.js';
import { buildDocState, parseMarkdown, pageLinksOf } from './blocks.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const entries = (obj) => unzipSync(zipSync(Object.entries(obj).map(([name, data]) => ({ name, data }))));

// Stands in for the blob table: content-addressed, so repeats collapse.
const saved = new Map();
const saveFile = async (bytes, name) => { const k = `k${bytes.length}-${name}`; saved.set(k, bytes); return `/api/blob/${k}`; };
let n = 0;
const plan = (kind, files, rootName = 'Root') => { n = 0; return planArchive(kind, files, { saveFile, rootName, newId: () => `id${++n}` }); };
const byTitle = (p, t) => p.pages.find((x) => x.title === t);

// ── Confluence ──────────────────────────────────────────────────────────────

const page = (title, body, crumbs = '', extra = '') => `<html><head><title>DOCS : ${title}</title></head><body>
<div id="main"><div id="main-header"><ol id="breadcrumbs"><li><a href="index.html">DOCS</a></li>${crumbs}</ol>
<h1 id="title-heading"><span id="title-text">DOCS : ${title}</span></h1></div>
<div id="content"><div id="main-content" class="wiki-content">${body}</div>${extra}</div></div></body></html>`;

const confluence = () => entries({
  'index.html': `<html><body><div class="pageSection"><h2>Pages</h2><ul>
    <li><a href="Home_1.html">Home</a><ul>
      <li><a href="Child_A_2.html">Child A</a><ul><li><a href="Grandchild_4.html">Grandchild</a></li></ul></li>
      <li><a href="Child_B_3.html">Child B</a></li></ul></li></ul></div></body></html>`,
  'Home_1.html': page('Home', `
    <h1>Welcome</h1><p>See <a href="Child_A_2.html#intro">Child A</a>, <a href="Gone_99.html">a gone page</a> and <a href="https://example.com/x">the web</a>. Use *stars* &amp; snake_case.</p>
    <div class="confluence-information-macro confluence-information-macro-information"><span class="aui-icon"></span><div class="confluence-information-macro-body"><p>Heads up</p></div></div>
    <div class="confluence-information-macro confluence-information-macro-warning conf-macro output-block" data-macro-name="warning"><div class="confluence-information-macro-body"><p>Careful</p></div></div>
    <div class="expand-container"><div class="expand-control"><span class="expand-control-text">More detail</span></div><div class="expand-content"><p>Hidden text</p></div></div>
    <div class="code panel pdl conf-macro output-block" data-macro-name="code"><div class="codeContent panelContent pdl"><pre class="syntaxhighlighter-pre" data-syntaxhighlighter-params="brush: java; gutter: false" data-theme="Confluence">int x = 1 &lt; 2;
\`\`\`</pre></div></div>
    <table class="confluenceTable"><thead><tr><th>Name</th><th>Qty</th></tr></thead><tbody><tr><td>a | b</td><td>2</td></tr></tbody></table>
    <ul class="inline-task-list"><li class="checked">done</li><li>todo</li></ul>
    <ol><li>one<ul><li>nested</li></ul></li><li>two</li></ol>
    <div class="conf-macro output-block" data-macro-name="jira"><p>PROJ-123 is open</p></div>
    <p><img class="confluence-embedded-image" src="attachments/1/10.png?version=1&amp;api=v2" alt="diagram"> <img src="attachments/1/404.png"></p>`,
  '', `<div class="pageSection group"><h2 id="attachments">Attachments:</h2><div class="greybox"><a href="attachments/1/10.png">10.png</a><br><a href="attachments/1/spec.pdf">spec.pdf</a></div></div>`),
  'Child_A_2.html': page('Child A', '<p>child a</p>', '<li><a href="Home_1.html">Home</a></li>'),
  'Child_B_3.html': page('Child B', '<p>child b</p>', '<li><a href="Home_1.html">Home</a></li>'),
  'Grandchild_4.html': page('Grandchild', '<p>deep</p>', '<li><a href="Home_1.html">Home</a></li><li><a href="Child_A_2.html">Child A</a></li>'),
  'attachments/1/10.png': PNG,
  'attachments/1/spec.pdf': Buffer.from('%PDF-1.4 fake'),
  'styles/site.css': 'body{}',
});

test('confluence: page tree, nesting references, titles', async () => {
  const p = await plan('confluence', confluence(), 'zipname');
  assert.equal(p.pages.length, 4);
  assert.equal(p.folders.length, 1);
  assert.equal(p.folders[0].name, 'DOCS');
  const home = byTitle(p, 'Home');
  const a = byTitle(p, 'Child A');
  assert.equal(home.parentId, null);
  assert.equal(a.parentId, home.id);
  assert.equal(byTitle(p, 'Grandchild').parentId, a.id);
  assert.equal(byTitle(p, 'Child B').parentId, home.id);
  // The parent's body references its children — that is what nests them in the sidebar.
  assert.match(home.markdown, new RegExp(`\\[\\[${a.id}\\]\\]\\n\\n\\[\\[${byTitle(p, 'Child B').id}\\]\\]$`));
  assert.ok(p.pages.every((x) => x.folderId === p.folders[0].id));
});

test('confluence: content converts to blocks the editor has', async () => {
  const p = await plan('confluence', confluence());
  const home = byTitle(p, 'Home');
  const md = home.markdown;
  const a = byTitle(p, 'Child A');
  assert.match(md, /^# Welcome$/m);
  assert.ok(md.includes(`See [[${a.id}]], a gone page and [the web](https://example.com/x).`));
  assert.match(md, /\\\*stars\\\* & snake\\_case/);
  assert.match(md, /^> \[!INFO\]\n> Heads up$/m);
  assert.match(md, /^> \[!WARNING\]\n> Careful$/m);
  assert.match(md, /^\*\*More detail\*\*\n\nHidden text$/m);
  assert.match(md, /^```java\nint x = 1 < 2;\n ```\n```$/m);
  assert.match(md, /\| Name \| Qty \|\n\| --- \| --- \|\n\| a \\\| b \| 2 \|/);
  assert.match(md, /^- \[x\] done\n- \[ \] todo$/m);
  assert.match(md, /^1\. one\n  - nested\n2\. two$/m);
  assert.match(md, /PROJ-123 is open/); // unknown macro keeps its text
  assert.match(md, /^!\[diagram\]\(\/api\/blob\/k\d+-10\.png\)$/m);
  assert.match(md, /\*\*Attachments\*\*\n\n- \[spec\.pdf]\(\/api\/blob\/k\d+-spec\.pdf\?name=spec\.pdf\)/);

  // The markdown must survive the real parser: callouts, table, code, image, references.
  const blocks = parseMarkdown(md).map((d) => d.flavour);
  for (const f of ['affine:callout', 'affine:table', 'affine:code', 'affine:image', 'affine:list']) assert.ok(blocks.includes(f), f);
  const ids = new Set(p.pages.map((x) => x.id));
  const state = buildDocState('Home', md, (k) => (ids.has(k) ? k : null));
  assert.deepEqual(pageLinksOf(Buffer.from(state)).sort(), p.pages.filter((x) => x.parentId === home.id).map((x) => x.id).sort());
});

test('confluence: summary counts pages, folders, attachments, unresolved links, unknown macros', async () => {
  const { summary } = await plan('confluence', confluence());
  assert.equal(summary.pages, 4);
  assert.equal(summary.folders, 1);
  assert.equal(summary.attachments, 2); // the png (once) and the pdf
  assert.deepEqual(summary.unknownMacros, { jira: 1 });
  assert.deepEqual(summary.unresolved.sort(), ['Gone_99.html', 'attachments/1/404.png']);
  assert.equal(summary.unresolvedLinks, 2);
  assert.match(summaryLines(summary).join('\n'), /Imported 4 pages, 1 folder, 2 attachments\.[\s\S]*jira ×1/);
});

test('confluence: falls back to breadcrumbs when index.html omits a page', async () => {
  const files = confluence();
  files.set('Orphan_7.html', Buffer.from(page('Orphan', '<p>x</p>', '<li><a href="Child_B_3.html">Child B</a></li>')));
  const p = await plan('confluence', files);
  assert.equal(byTitle(p, 'Orphan').parentId, byTitle(p, 'Child B').id);
});

test('confluence: not an export', async () => {
  await assert.rejects(plan('confluence', entries({ 'a.html': '<p>x</p>' })), /index\.html/);
});

test('parseHtml tolerates unclosed li/p and void tags', () => {
  const root = parseHtml('<ul><li>a<li>b<br><p>c<p>d</ul>');
  const ul = root.children[0];
  assert.equal(ul.children.length, 2);
});

// ── Obsidian ────────────────────────────────────────────────────────────────

const vault = () => entries({
  'My Vault/Home.md': '---\ntags: [index]\naliases: [start]\n---\n# Home\n\nSee [[Deep Note]], [[Deep Note|the deep one]], [[Projects/Plan#Goals]], [[Nowhere]], [[#Local]].\n\n![[pic.png]]\n![[Plan]]\nInline `[[Deep Note]]` stays.\n\n```\n[[Deep Note]]\n```\n\n> [!question]- Why\n> because\n\n==hot== %%secret%%\n',
  'My Vault/Projects/Plan.md': 'Goals here. Back to [[Home]] and [[Projects/Deep Note]].',
  'My Vault/Projects/Deep Note.md': 'deep one\n\n![[assets/pic.png|200]]',
  'My Vault/Other/Deep Note.md': 'a different deep note',
  'My Vault/assets/pic.png': PNG,
  'My Vault/.obsidian/workspace.json': '{}',
  'My Vault/.trash/Old.md': 'trashed [[Home]]',
  'My Vault/unused.png': PNG,
});

test('obsidian: folders, titles, wiki links, embeds, ignored dirs', async () => {
  const p = await plan('obsidian', vault());
  assert.deepEqual(p.folders.map((f) => f.name).sort(), ['My Vault', 'Other', 'Projects']);
  assert.equal(p.pages.length, 4);
  assert.ok(!p.pages.some((x) => x.title === 'Old'));
  const home = byTitle(p, 'Home');
  const plans = byTitle(p, 'Plan');
  const deepProj = p.pages.find((x) => x.title === 'Deep Note' && x.markdown.startsWith('deep one'));
  const deepOther = p.pages.find((x) => x.title === 'Deep Note' && x.markdown.startsWith('a different'));
  // Bare name with two candidates: the shorter path wins (both depth 2 → alphabetical "Other" first).
  assert.equal(home.markdown.match(/See \[\[(\w+)\]\], \[\[(\w+)\]\]/).slice(1).every((i) => i === deepOther.id), true);
  assert.ok(home.markdown.includes(`[[${plans.id}]]`));
  assert.ok(plans.markdown.includes(`[[${home.id}]]`) && plans.markdown.includes(`[[${deepProj.id}]]`)); // explicit path beats the bare name
  assert.ok(home.markdown.includes('[[Nowhere]]') && home.markdown.includes('[[#Local]]'));
  assert.ok(home.markdown.includes('Inline `[[Deep Note]]` stays.'));
  assert.ok(home.markdown.includes('```\n[[Deep Note]]\n```'));
  assert.match(home.markdown, /^!\[\]\(\/api\/blob\/k\d+-pic\.png\)$/m);
  assert.match(deepProj.markdown, /^!\[\]\(\/api\/blob\/k\d+-pic\.png\)$/m);
  assert.match(home.markdown, /^> \[!NOTE\]- ?Why|^> \[!NOTE\] ?Why/m);
  assert.match(home.markdown, /<mark>hot<\/mark> $/m);
  assert.doesNotMatch(home.markdown, /secret/);
  // Front matter is kept readable at the top.
  assert.match(home.markdown, /^```yaml\ntags: \[index\]\naliases: \[start]\n```\n\n# Home/);
  assert.equal(home.title, 'Home');
  assert.equal(p.pages.find((x) => x === deepProj).folderId, p.folders.find((f) => f.name === 'Projects').id);
  assert.equal(p.summary.attachments, 1); // unused.png is left behind
  assert.deepEqual(p.summary.unresolved, ['Nowhere']);
});

// ── generic Markdown folder (Slab-shaped) ───────────────────────────────────

test('markdown: nested folders, relative links and images resolve; title from H1', async () => {
  const p = await plan('markdown', entries({
    'Acme Handbook/Engineering/Onboarding.md': '# Onboarding Guide\n\nRead [Deploys](../Ops/Deploys.md#rollback) and [the guide](Setup%20Steps.md).\n\n![logo](../img/logo.png)\n\n[external](https://x.test/a.md) [missing](Missing.md)',
    'Acme Handbook/Engineering/Setup Steps.md': 'no heading here',
    'Acme Handbook/Ops/Deploys.md': '# Deploys\n\nBack to [onboarding](../Engineering/Onboarding.md).',
    'Acme Handbook/img/logo.png': PNG,
    'Acme Handbook/README.md': '# Start\n\n- [Onboarding](Engineering/Onboarding.md)',
  }));
  assert.deepEqual(p.folders.map((f) => f.name).sort(), ['Acme Handbook', 'Engineering', 'Ops']);
  const on = byTitle(p, 'Onboarding Guide');
  const dep = byTitle(p, 'Deploys');
  const setup = byTitle(p, 'Setup Steps');
  assert.ok(on.markdown.includes(`[[${dep.id}]]`) && on.markdown.includes(`[[${setup.id}]]`));
  assert.ok(dep.markdown.includes(`[[${on.id}]]`));
  assert.match(on.markdown, /^!\[logo\]\(\/api\/blob\/k\d+-logo\.png\)$/m);
  assert.ok(on.markdown.includes('[external](https://x.test/a.md)') && on.markdown.includes('[missing](Missing.md)'));
  assert.ok(byTitle(p, 'Start').markdown.includes(`[[${on.id}]]`));
  assert.equal(p.summary.unresolvedLinks, 1);
  assert.equal(p.folders[0].name, 'Acme Handbook');
});

test('markdown: a zip without a wrapping folder is named after the zip', async () => {
  const p = await plan('markdown', entries({ 'a.md': '# A', 'b/c.md': '# C' }), 'export-2026');
  assert.equal(p.folders[0].name, 'export-2026');
});

// ── safety ──────────────────────────────────────────────────────────────────

test('cleanEntries drops hidden dirs and resource forks, fixes Windows separators', () => {
  const out = cleanEntries(new Map([['a\\b.md', 1], ['.obsidian/x', 1], ['__MACOSX/a', 1], ['d/.DS_Store', 1], ['d/Thumbs.db', 1]]));
  assert.deepEqual([...out.keys()], ['a/b.md']);
});

test('zip-slip: an entry that climbs out of the archive refuses the whole archive', () => {
  for (const name of ['../evil.md', 'a/../../evil.md', '/etc/passwd', 'C:\\x.md', '..\\evil.md']) {
    assert.throws(() => unzipSync(zipSync([{ name: 'ok.md', data: 'x' }, { name, data: 'x' }])), /unsafe path/, name);
  }
});

test('zip bomb: declared and real expansion are both capped', () => {
  const big = Buffer.alloc(2 * 1024 * 1024, 0);
  const zip = zipSync([{ name: 'a.md', data: big }]);
  assert.throws(() => unzipSync(zip, { maxEntries: 10, maxEntryBytes: 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 }), /expands past/);
  assert.throws(() => unzipSync(zipSync([{ name: 'a', data: big }, { name: 'b', data: big }]), { maxEntries: 10, maxEntryBytes: 3 * 1024 * 1024, maxTotalBytes: 3 * 1024 * 1024 }), /expands past/);
  // A lying central directory (declared 10 bytes, really 2 MB) is stopped by the capped inflate.
  const lie = Buffer.from(zip);
  const cd = lie.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  lie.writeUInt32LE(10, cd + 24);
  assert.throws(() => unzipSync(lie, { maxEntries: 10, maxEntryBytes: 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 }), /expands past/);
  assert.throws(() => unzipSync(zipSync(Array.from({ length: 5 }, (_, i) => ({ name: `f${i}`, data: 'x' }))), { maxEntries: 3, maxEntryBytes: 1e6, maxTotalBytes: 1e7 }), /5 files/);
});

test('an archive with no pages is refused', async () => {
  await assert.rejects(plan('obsidian', entries({ 'x.png': PNG })), /no Markdown/);
  await assert.rejects(plan('nope', entries({ 'x.md': 'x' })), /Unknown import source/);
});

test('stored entries are checked at their real length, and inconsistent sizes are refused', () => {
  const lim = { maxEntries: 10, maxEntryBytes: 1024, maxTotalBytes: 4096 };
  const zip = zipSync([{ name: 'a.bin', data: randomBytes(2000) }]);
  // Lie in the central directory: declared uncompressed size 1.
  const lie = Buffer.from(zip);
  const cd = lie.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.equal(lie.readUInt16LE(cd + 10), 0, 'fixture must be stored');
  lie.writeUInt32LE(1, cd + 24);
  assert.throws(() => unzipSync(lie, lim), /expands past/);
  // Local and central compressed sizes disagree.
  const split = Buffer.from(zip);
  split.writeUInt32LE(5, 18);
  assert.throws(() => unzipSync(split, { ...lim, maxEntryBytes: 1e6 }), /inconsistent sizes/);
});

test('many entries pointing at one stored blob hit the total cap', () => {
  const blob = randomBytes(1000);
  const zip = zipSync([{ name: 'a', data: blob }]);
  const cdAt = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const cd = zip.subarray(cdAt, eocd);
  const copies = [0, 1, 2, 3, 4].map((i) => { const c = Buffer.from(cd); c.write(String(i), 46); return c; });
  const head = zip.subarray(0, cdAt);
  const end = Buffer.from(zip.subarray(eocd));
  end.writeUInt16LE(5, 8); end.writeUInt16LE(5, 10);
  end.writeUInt32LE(copies.reduce((n, c) => n + c.length, 0), 12);
  end.writeUInt32LE(head.length, 16);
  const evil = Buffer.concat([head, ...copies, end]);
  assert.equal(unzipSync(evil, { maxEntries: 9, maxEntryBytes: 1e6, maxTotalBytes: 1e7 }).size, 5);
  assert.throws(() => unzipSync(evil, { maxEntries: 9, maxEntryBytes: 1e6, maxTotalBytes: 3500 }), /expands past/);
});
