// edit_doc: targeted { find, replace } edits, written only where they match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDocState, docToMarkdown, lossyBlocks } from './blocks.js';
import { listSuggestions } from './inline-suggest.js';
import { suggestEdits } from './suggest-writer.js';
import { docFromState } from './suggestions.js';
import { draftEdit, writeToDraft } from './ai-drafts.js';
import { createMetanoiaMcpServer } from './mcp-tools.js';

const page = (md) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, buildDocState('T', md));
  return doc;
};
const read = (doc, by = null) => docToMarkdown(Y.encodeStateAsUpdate(doc), { escape: true, withPendingFor: by }).markdown;
const edit = (doc, edits, over = {}) => suggestEdits({ doc, edits, by: 'andy', ...over });
const cards = (doc) => listSuggestions(doc).map(({ kind, by, before, after }) => ({ kind, by, before, after }));
const texts = (doc) => [...doc.getMap('blocks').values()].map((b) => b.get('prop:text')).filter((t) => t instanceof Y.Text);
const textOf = (doc, re) => texts(doc).find((t) => re.test(t.toString()));
/** Every block as JSON, keyed by id: what "byte-identical" compares. */
const snapshot = (doc) => Object.fromEntries([...doc.getMap('blocks').entries()].map(([id, b]) => [id, JSON.stringify(b.toJSON())]));
const updates = (doc, fn) => {
  let n = 0;
  const on = () => { n++; };
  doc.on('update', on);
  try { fn(); } finally { doc.off('update', on); }
  return n;
};

const LONG = [
  '## Plan', '', 'The **quick** brown fox jumps over the lazy dog.', '', 'Second paragraph stays as it is.', '',
  '- one', '- two', '', '> quoted', '',
].join('\n');

test('one find that occurs once is one suggestion on that passage; the rest of the page is byte-identical', () => {
  const doc = page(LONG);
  const before = snapshot(doc);
  const md = read(doc);
  const out = edit(doc, [{ find: 'lazy dog', replace: 'sleepy cat' }]);
  assert.deepEqual(cards(doc), [{ kind: 'replace', by: 'andy', before: 'lazy dog', after: 'sleepy cat' }]);
  assert.equal(out.changes, 1);
  assert.deepEqual(out.ids, [listSuggestions(doc)[0].id]);
  assert.deepEqual(out.notFound, []);
  assert.deepEqual(out.ambiguous, []);
  const after = snapshot(doc);
  const changed = Object.keys(before).filter((id) => before[id] !== after[id]);
  assert.equal(changed.length, 1, 'only the matched block changed');
  assert.match(before[changed[0]], /lazy dog/);
  assert.equal(read(doc), md, 'everyone else still reads the page as it was');
  assert.equal(read(doc, 'andy'), md.replace('lazy dog', 'sleepy cat'));
});

test('a find occurring twice without occurrence is ambiguous and nothing is written', () => {
  const doc = page('Alpha beta.\n\nGamma beta.\n');
  let out;
  assert.equal(updates(doc, () => { out = edit(doc, [{ find: 'Alpha', replace: 'A' }, { find: 'beta', replace: 'B' }]); }), 0);
  assert.deepEqual(out.ambiguous, [{ edit: 1, find: 'beta', matches: 2 }]);
  assert.equal(out.changes, 0);
  assert.deepEqual(listSuggestions(doc), []);
});

test('occurrence picks one of several matches, counted in page order', () => {
  const doc = page('Alpha beta.\n\nGamma beta.\n');
  edit(doc, [{ find: 'beta', replace: 'delta', occurrence: 2 }]);
  assert.equal(read(doc, 'andy'), 'Alpha beta.\n\nGamma delta.');
});

test('a find that is not there is notFound and nothing is written', () => {
  const doc = page('Alpha beta.\n');
  let out;
  assert.equal(updates(doc, () => { out = edit(doc, [{ find: 'Alpha', replace: 'A' }, { find: 'zeta', replace: 'z' }]); }), 0);
  assert.deepEqual(out.notFound, [{ edit: 1, find: 'zeta' }]);
  const past = edit(doc, [{ find: 'beta', replace: 'b', occurrence: 2 }]);
  assert.deepEqual(past.notFound, [{ edit: 0, find: 'beta' }]);
});

test('under scopes a find to one heading\'s section', () => {
  const doc = page('## Goals\n\nShip it.\n\n### Detail\n\nShip it.\n\n## Risks\n\nShip it.\n');
  const out = edit(doc, [{ find: 'Ship it', replace: 'Hold it', under: 'Risks' }]);
  assert.equal(out.changes, 1);
  assert.equal(read(doc, 'andy'), '## Goals\n\nShip it.\n\n### Detail\n\nShip it.\n\n## Risks\n\nHold it.');
  // A section runs to the next heading of the same or a higher level, subsections included.
  assert.deepEqual(edit(doc, [{ find: 'Ship it', replace: 'x', under: '## Goals' }]).ambiguous, [{ edit: 0, find: 'Ship it', matches: 2 }]);
  assert.deepEqual(edit(doc, [{ find: 'Ship it', replace: 'x', under: 'Nope' }]).notFound, [{ edit: 0, find: 'Ship it', under: 'Nope' }]);
});

test('edits apply in order, each to the text the earlier ones left', () => {
  const doc = page('One two three.\n');
  edit(doc, [{ find: 'two', replace: '2' }, { find: 'One 2', replace: 'Uno 2' }]);
  assert.equal(read(doc, 'andy'), 'Uno 2 three.');
});

test('a find matches the writer\'s view: their own pending text counts, someone else\'s does not', () => {
  const doc = page('Alpha beta gamma.\n');
  const t = textOf(doc, /Alpha/);
  t.insert(5, ' theirs', { mnSugg: { id: 'u2-ins', kind: 'ins', by: 'u2', at: 1 } });
  assert.deepEqual(edit(doc, [{ find: 'theirs', replace: 'x' }]).notFound, [{ edit: 0, find: 'theirs' }]);
  edit(doc, [{ find: 'gamma', replace: 'mine' }]);
  edit(doc, [{ find: 'mine', replace: 'ours' }]);
  assert.deepEqual(cards(doc).filter((c) => c.by === 'andy'), [{ kind: 'replace', by: 'andy', before: 'gamma', after: 'ours' }]);
  assert.deepEqual(cards(doc).filter((c) => c.by === 'u2'), [{ kind: 'insert', by: 'u2', before: '', after: ' theirs' }]);
  // A find across their insertion still lands around it, not inside it.
  edit(doc, [{ find: 'Alpha beta', replace: 'Alef beta' }]);
  assert.equal(t.toDelta().find((op) => op.attributes?.mnSugg?.id === 'u2-ins').insert, ' theirs');
});

test('formatting of the replaced text is kept, so only the words change', () => {
  const doc = page('The **quick** fox.\n');
  edit(doc, [{ find: 'quick', replace: 'slow' }]);
  assert.deepEqual(cards(doc), [{ kind: 'replace', by: 'andy', before: 'quick', after: 'slow' }]);
  const ins = textOf(doc, /slow/).toDelta().find((op) => op.attributes?.mnSugg?.kind === 'ins');
  assert.equal(ins.attributes.bold, true);
});

test('curly quotes and markdown escapes in find still match', () => {
  const doc = page('It’s a “test” of snake_case.\n');
  assert.equal(edit(doc, [{ find: 'It\'s a "test"', replace: 'It is a "trial"' }]).changes, 1);
  edit(doc, [{ find: 'snake\\_case', replace: 'camelCase' }]);
  assert.match(read(doc, 'andy'), /It is a "trial["”] of camelCase\./, "a quote style alone is no change (round-trip noise)");
});

test('a find inside a code block, from a reviewed writer, is that block removed plus the edited copy added (R7)', () => {
  const doc = page('Intro.\n\n```js\nconst a = 1;\n```\n');
  const out = edit(doc, [{ find: 'a = 1', replace: 'a = 2' }]);
  assert.deepEqual(cards(doc).map((c) => [c.kind, c.before, c.after]), [['remove', 'const a = 1;', ''], ['add', '', 'const a = 2;']]);
  assert.equal(out.changes, 2);
  assert.equal(read(doc, 'andy'), 'Intro.\n\n```javascript\nconst a = 2;\n```');
});

test('a trusted writer edits directly and leaves everyone\'s pending suggestions', () => {
  const doc = page(LONG);
  const t = textOf(doc, /Second/);
  t.insert(0, 'New ', { mnSugg: { id: 'u2-ins', kind: 'ins', by: 'u2', at: 1 } });
  const theirs = cards(doc);
  const out = edit(doc, [{ find: 'lazy dog', replace: 'sleepy cat' }], { by: 'owner', direct: true });
  assert.equal(out.changes, 0);
  assert.equal(out.applied, 1);
  assert.deepEqual(cards(doc), theirs);
  assert.match(read(doc), /sleepy cat/);
  const code = page('```js\nconst a = 1;\n```\n');
  edit(code, [{ find: 'a = 1', replace: 'a = 2' }], { by: 'owner', direct: true });
  assert.deepEqual(listSuggestions(code), []);
  assert.equal(read(code), '```javascript\nconst a = 2;\n```');
});

test('a lossy page takes edits', () => {
  const doc = page('Alpha beta.\n');
  const blocks = doc.getMap('blocks');
  const note = [...blocks.values()].find((b) => b.get('sys:flavour') === 'affine:note');
  const db = new Y.Map();
  blocks.set('db1', db);
  db.set('sys:id', 'db1'); db.set('sys:flavour', 'affine:database'); db.set('sys:children', new Y.Array());
  note.get('sys:children').push(['db1']);
  assert.ok(lossyBlocks(Y.encodeStateAsUpdate(doc)).length);
  assert.equal(edit(doc, [{ find: 'beta', replace: 'gamma' }]).changes, 1);
});

// ── through draftEdit, as the route calls it ────────────────────────────────

function world(md) {
  const live = page(md);
  const rows = [];
  const pool = {
    async query(sql, p) {
      if (/^\s*SELECT/.test(sql)) {
        return { rows: rows.filter((r) => r.doc_id === p[0] && r.author_id === p[1] && r.status !== 'closed'
          && (r.approver_id ?? null) === (p[2] ?? null) && (r.writer_via ?? null) === (p[3] ?? null)) };
      }
      if (/^\s*INSERT/.test(sql)) {
        const [id, doc_id, author_id, approver_id, writer_via, state] = p;
        const row = { id, doc_id, author_id, approver_id, writer_via, base_state: state, state, status: 'submitted', decisions: {} };
        rows.push(row);
        return { rows: [row] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const hocuspocus = {
    async openDirectConnection(name) {
      if (name === 'd1') return { document: live, async transact(fn) { live.transact(() => fn(live)); }, async disconnect() {} };
      const row = rows.find((r) => name.includes(r.id));
      const document = docFromState(row.state);
      return { document, async transact(fn) { fn(document); }, async disconnect() { row.state = Buffer.from(Y.encodeStateAsUpdate(document)); } };
    },
  };
  const pageState = async () => Buffer.from(Y.encodeStateAsUpdate(live));
  const run = (over) => draftEdit({
    policy: 'suggest', kind: 'doc', via: 'human', pool, hocuspocus, pageState,
    approver: async () => ({ id: 'owner', name: 'Olive' }), notify: async () => {},
    docId: 'd1', title: 'T', authorId: 'andy', ...over,
  });
  return { live, rows, pool, hocuspocus, pageState, run };
}

test('draftEdit with edits: a reviewed writer\'s edit is a suggestion with a sugg link, even on a lossy page', async () => {
  const w = world('Alpha beta.\n');
  const blocks = w.live.getMap('blocks');
  const db = new Y.Map();
  blocks.set('db1', db);
  db.set('sys:id', 'db1'); db.set('sys:flavour', 'affine:database'); db.set('sys:children', new Y.Array());
  [...blocks.values()].find((b) => b.get('sys:flavour') === 'affine:note').get('sys:children').push(['db1']);
  const out = await w.run({ edits: [{ find: 'beta', replace: 'gamma' }] });
  assert.equal(out.status, 200);
  const [c] = listSuggestions(w.live);
  assert.deepEqual(out.body, { ok: true, suggested: true, changes: 1, link: `/d/d1?sugg=${c.id}`, approverName: 'Olive' });
});

test('draftEdit with edits: a miss is a 409 naming it, and nothing is written', async () => {
  const w = world('Alpha beta.\n\nGamma beta.\n');
  const out = await w.run({ edits: [{ find: 'beta', replace: 'x' }, { find: 'zeta', replace: 'y' }] });
  assert.equal(out.status, 409);
  assert.deepEqual(out.body.ambiguous, [{ edit: 0, find: 'beta', matches: 2 }]);
  assert.deepEqual(out.body.notFound, [{ edit: 1, find: 'zeta' }]);
  assert.match(out.body.error, /Nothing was changed/);
  assert.match(out.body.error, /"zeta"/);
  assert.match(out.body.error, /"beta" \(2 times/);
  assert.deepEqual(listSuggestions(w.live), []);
});

test('draftEdit with edits: a writer with an open legacy draft edits the draft', async () => {
  const w = world('Alpha beta.\n');
  const { sid } = await writeToDraft({
    pool: w.pool, hocuspocus: w.hocuspocus, pageState: w.pageState, notify: async () => {}, docId: 'd1', title: 'T',
    authorId: 'andy', approverId: 'owner', writerVia: 'agent', mode: 'append', markdown: 'Draft para.\n',
  });
  const out = await w.run({ edits: [{ find: 'Draft para', replace: 'Draft paragraph' }] });
  assert.equal(out.status, 200);
  assert.equal(out.body.suggestionId, sid);
  assert.match(docToMarkdown(w.rows[0].state).markdown, /Draft paragraph\./);
  assert.deepEqual(listSuggestions(w.live), [], 'the page is untouched');
  const miss = await w.run({ edits: [{ find: 'nowhere', replace: 'x' }] });
  assert.equal(miss.status, 409);
});

// ── the MCP tool ────────────────────────────────────────────────────────────

async function call(args, data, status = 200) {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method, body: init.body && JSON.parse(init.body) });
    return { ok: status < 400, status, text: async () => JSON.stringify(data) };
  };
  try {
    const server = createMetanoiaMcpServer({ base: 'http://x', headers: { Authorization: 'Bearer t' } });
    const res = await server._registeredTools.edit_doc.handler(args, {});
    return { text: res.content[0].text, isError: res.isError, seen };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('edit_doc posts the edits and reports a suggestion with its link', async () => {
  const edits = [{ find: 'a', replace: 'b' }];
  const w = await call({ id: 'd1', edits }, { ok: true, suggested: true, changes: 1, link: '/d/d1?sugg=s1', approverName: null });
  assert.equal(w.seen[0].url, 'http://x/api/docs/d1/edits');
  assert.equal(w.seen[0].method, 'POST');
  assert.deepEqual(w.seen[0].body, { edits });
  assert.match(w.text, /^Suggested 1 change for anyone who can edit the page to review: .*\/d\/d1\?sugg=s1$/);
});

test('edit_doc: a direct edit is Done, and a miss is an error the agent can read', async () => {
  assert.equal((await call({ id: 'd1', edits: [{ find: 'a', replace: 'b' }] }, { ok: true, applied: 1 })).text, 'Done.');
  const miss = await call({ id: 'd1', edits: [{ find: 'a', replace: 'b' }] }, { error: 'Nothing was changed. Not found: "a".' }, 409);
  assert.equal(miss.isError, true);
  assert.match(miss.text, /Not found: "a"/);
});
