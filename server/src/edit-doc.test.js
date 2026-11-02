// edit_doc: targeted { find, replace } edits, written only where they match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDocState, docToMarkdown, lossyBlocks } from './blocks.js';
import { decide, listSuggestions } from './inline-suggest.js';
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

test('a trusted writer\'s edit that would cut through someone\'s pending del or ins is skipped, and nothing is written', () => {
  const doc = page('Alpha beta gamma delta.\n\nOther line.\n');
  const t = textOf(doc, /Alpha/);
  t.format(6, 10, { mnSugg: { id: 'u2-del', kind: 'del', by: 'u2', at: 1 } }); // "beta gamma"
  t.insert(22, ' new', { mnSugg: { id: 'u3-ins', kind: 'ins', by: 'u3', at: 1 } }); // after "delta"
  const theirs = cards(doc);
  let out;
  assert.equal(updates(doc, () => {
    out = edit(doc, [{ find: 'Other', replace: 'Another' }, { find: 'a gam', replace: 'X' }], { by: 'owner', direct: true });
  }), 0);
  assert.equal(out.applied, 0);
  assert.equal(out.skipped.length, 1);
  assert.deepEqual(out.skipped[0], { edit: 1, find: 'a gam', blockId: out.skipped[0].blockId, reason: 'overlaps a pending suggestion by u2' });
  const pastIns = edit(doc, [{ find: 'delta.', replace: 'end' }], { by: 'owner', direct: true });
  assert.equal(pastIns.skipped[0].reason, 'overlaps a pending suggestion by u3');
  assert.deepEqual(cards(doc), theirs);
  // Both are still theirs to decide, and an edit clear of them still lands.
  assert.equal(edit(doc, [{ find: 'Alpha', replace: 'Aleph' }], { by: 'owner', direct: true }).applied, 1);
  assert.equal(decide(doc, 'u2-del', 'accept'), true);
  assert.equal(decide(doc, 'u3-ins', 'accept'), true);
  assert.equal(read(doc), 'Aleph  delta new.\n\nOther line.');
});

test('R16: a trusted writer matches the page with nothing pending accepted, so their own pending insertion is not findable', () => {
  const doc = page('Alpha beta.\n');
  edit(doc, [{ find: 'beta', replace: 'beta mine' }], { by: 'owner' }); // owner suggested " mine" earlier
  assert.match(read(doc, 'owner'), /beta mine/);
  assert.deepEqual(edit(doc, [{ find: 'mine', replace: 'x' }], { by: 'owner', direct: true }).notFound, [{ edit: 0, find: 'mine' }]);
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
  assert.deepEqual(out.body, {
    ok: true, suggested: true, changes: 1, link: `/d/d1?sugg=${c.id}`, approverName: 'Olive',
    applied: 1, notFound: [], ambiguous: [], skipped: [],
  });
});

test('draftEdit with edits: a miss is a 409 naming it, and nothing is written', async () => {
  const w = world('Alpha beta.\n\nGamma beta.\n');
  const out = await w.run({ edits: [{ find: 'beta', replace: 'x' }, { find: 'zeta', replace: 'y' }] });
  assert.equal(out.status, 409);
  assert.equal(out.body.suggested, false);
  assert.equal(out.body.applied, 0);
  assert.deepEqual(out.body.skipped, []);
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
  assert.deepEqual([out.body.applied, out.body.notFound, out.body.ambiguous, out.body.skipped], [1, [], [], []]);
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

test('edit_doc: a direct edit is Done, and a 409 lists every miss for the agent', async () => {
  const none = { notFound: [], ambiguous: [], skipped: [] };
  assert.equal((await call({ id: 'd1', edits: [{ find: 'a', replace: 'b' }] }, { ok: true, suggested: false, applied: 1, ...none })).text, 'Done: 1 edit applied.');
  const miss = await call({ id: 'd1', edits: [{ find: 'a', replace: 'b' }] }, {
    error: 'Nothing was changed.', suggested: false, applied: 0,
    notFound: [{ edit: 0, find: 'a', under: 'Goals' }],
    ambiguous: [{ edit: 1, find: 'the', matches: 3 }],
    skipped: [{ edit: 2, find: 'beta', blockId: 'b1', reason: 'overlaps a pending suggestion by u2' }],
  }, 409);
  assert.equal(miss.isError, true);
  assert.equal(miss.text, [
    'Nothing was changed: fix these edits and send them all again.',
    '- edits[0] not found: "a" under "Goals"',
    '- edits[1] found 3 times (add surrounding text, occurrence or under): "the"',
    '- edits[2] not applied: "beta" (overlaps a pending suggestion by u2)',
  ].join('\n'));
});

// ── the route, with a fake app (the doc-opens.test.js pattern) ──────────────

async function route(body, { grant = true, drafted = null, md = 'Alpha beta.\n' } = {}) {
  const { registerDocEditRoutes } = await import('./doc-edits.js');
  const live = page(md);
  const routes = {};
  const calls = { draft: null, sql: [], links: null };
  registerDocEditRoutes({ post: (path, ...h) => { routes[path] = h[h.length - 1]; } }, {
    requireUser: () => {}, wrap: (fn) => fn,
    editGrant: async () => grant,
    pool: { async query(sql, p) { calls.sql.push(sql); return { rows: /SELECT/.test(sql) ? [{ title: 'T', kind: 'doc' }] : [] }; } },
    getHocuspocus: () => ({ async openDirectConnection() { return { document: live, async transact(fn) { live.transact(() => fn(live)); }, async disconnect() {} }; } }),
    draftWrite: async (req, docId, doc, write) => { calls.draft = write; return drafted; },
    storeLinks: async (id, links) => { calls.links = links; },
  });
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await routes['/api/docs/:id/edits']({ params: { id: 'd1' }, user: { id: 'owner' }, via: 'human', body }, res);
  return { res, live, calls };
}

test('route: a trusted writer\'s edits land directly, with the R15 body', async () => {
  const { res, live, calls } = await route({ edits: [{ find: 'beta', replace: 'gamma', occurrence: 1, junk: 1 }] });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ok: true, suggested: false, applied: 1, notFound: [], ambiguous: [], skipped: [] });
  assert.deepEqual(calls.draft, { edits: [{ find: 'beta', replace: 'gamma', occurrence: 1 }] });
  assert.equal(read(live), 'Alpha gamma.');
  assert.ok(calls.sql.some((q) => /search_text/.test(q)));
  assert.ok(calls.links);
});

test('route: a miss is a 409 with the R15 body; bad input is a 400; no grant is a 403', async () => {
  const miss = await route({ edits: [{ find: 'zeta', replace: 'x' }] });
  assert.equal(miss.res.code, 409);
  assert.deepEqual({ ...miss.res.body, error: undefined },
    { error: undefined, suggested: false, applied: 0, notFound: [{ edit: 0, find: 'zeta' }], ambiguous: [], skipped: [] });
  assert.equal(read(miss.live), 'Alpha beta.');
  assert.equal((await route({ edits: [] })).res.code, 400);
  assert.equal((await route({ edits: [{ find: '', replace: 'x' }] })).res.code, 400);
  assert.equal((await route({ edits: [{ find: 'a', replace: 'b' }] }, { grant: false })).res.code, 403);
});

test('route: a reviewed writer gets draftEdit\'s answer as it is', async () => {
  const body = { ok: true, suggested: true, changes: 1, link: '/d/d1?sugg=s', approverName: null, applied: 1, notFound: [], ambiguous: [], skipped: [] };
  const { res, live } = await route({ edits: [{ find: 'beta', replace: 'x' }] }, { drafted: { status: 200, body } });
  assert.deepEqual(res.body, body);
  assert.equal(read(live), 'Alpha beta.');
});
