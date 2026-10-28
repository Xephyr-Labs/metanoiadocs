import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDocState, docToMarkdown } from './blocks.js';
import { docFromState, parseDraftName } from './suggestions.js';
import { writeToDraft, openDraftFor, draftEdit, draftToRead } from './ai-drafts.js';

/** One page `d1` plus a fake pool holding doc_suggestions rows, and a fake
 *  Hocuspocus that loads a draft from its row and saves it back on disconnect. */
function world(md = 'Intro line.\n') {
  const page = docFromState(buildDocState('Plan', md));
  const rows = [];
  const pool = {
    async query(sql, p) {
      if (/^\s*SELECT/.test(sql)) {
        if (/WHERE id = \$1/.test(sql)) return { rows: rows.filter((r) => r.id === p[0]) };
        if (/writer_via IS NOT NULL/.test(sql)) {
          return { rows: rows.filter((r) => r.doc_id === p[0] && r.author_id === p[1] && r.status !== 'closed' && r.writer_via != null) };
        }
        return {
          rows: rows.filter((r) => r.doc_id === p[0] && r.author_id === p[1] && r.status !== 'closed'
            && (r.approver_id ?? null) === (p[2] ?? null) && (r.writer_via ?? null) === (p[3] ?? null)),
        };
      }
      if (/^\s*INSERT/.test(sql)) {
        const [id, doc_id, author_id, approver_id, writer_via, state] = p;
        const row = { id, doc_id, author_id, approver_id, writer_via, base_state: state, state, status: 'submitted', submitted_at: new Date(), message: null, decisions: {} };
        rows.push(row);
        return { rows: [row] };
      }
      if (/^\s*DELETE/.test(sql)) {
        const i = rows.findIndex((r) => r.id === p[0]);
        if (i >= 0) rows.splice(i, 1);
        return { rows: [], rowCount: i >= 0 ? 1 : 0 };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const hocuspocus = {
    failNext: false,
    async openDirectConnection(name) {
      if (this.failNext) { this.failNext = false; throw new Error('sync server down'); }
      const { sid } = parseDraftName(name);
      const row = rows.find((r) => r.id === sid);
      const document = docFromState(row.state);
      return {
        document,
        async transact(fn) { fn(document); },
        async disconnect() { row.state = Buffer.from(Y.encodeStateAsUpdate(document)); },
      };
    },
  };
  const pageState = async () => Buffer.from(Y.encodeStateAsUpdate(page));
  const notes = [];
  const notify = async (n) => { notes.push(n); };
  const write = (over) => writeToDraft({
    pool, hocuspocus, pageState, notify, docId: 'd1', title: 'Plan',
    authorId: 'ai', approverId: 'owner', writerVia: 'agent', mode: 'append', resolve: undefined, ...over,
  });
  return { page, rows, pool, hocuspocus, notes, write };
}

test('the first write makes a submitted draft, notifies the approver once, and leaves the page alone', async () => {
  const w = world();
  const before = docToMarkdown(Y.encodeStateAsUpdate(w.page));
  const out = await w.write({ markdown: 'AI paragraph.\n' });
  assert.equal(out.created, true);
  assert.equal(out.changes, 1);
  assert.equal(w.rows.length, 1);
  assert.equal(w.rows[0].status, 'submitted');
  assert.deepEqual(w.notes, [{ userId: 'owner', kind: 'ai_suggestion', docId: 'd1', suggestionId: out.sid }]);
  assert.deepEqual(docToMarkdown(Y.encodeStateAsUpdate(w.page)), before);
  assert.match(docToMarkdown(w.rows[0].state).markdown, /AI paragraph\./);
});

test('a second write reuses the draft, does not notify again, and builds on the first', async () => {
  const w = world();
  const a = await w.write({ markdown: 'AI paragraph.\n' });
  const idOf = (s) => [...docFromState(w.rows[0].state).getMap('blocks')]
    .find(([, b]) => b.get('prop:text')?.toString() === s)?.[0];
  const first = idOf('AI paragraph.');
  assert.ok(first);
  const b = await w.write({ mode: 'replace', markdown: 'Intro line.\n\nAI paragraph.\n\nAnother one.\n' });
  assert.equal(b.sid, a.sid);
  assert.equal(b.created, false);
  assert.equal(b.changes, 2);
  assert.equal(idOf('AI paragraph.'), first, 'the replace built on the saved first write');
  assert.equal(w.notes.length, 1);
});

test('Ask AI drafts never notify', async () => {
  const w = world();
  await w.write({ writerVia: 'ai', markdown: 'AI paragraph.\n' });
  assert.equal(w.notes.length, 0);
});

test('the owner editing the page between writes is not counted as the AI\'s change', async () => {
  const w = world();
  await w.write({ markdown: 'AI paragraph.\n' });
  for (const [, b] of w.page.getMap('blocks')) {
    const t = b.get('prop:text');
    if (t instanceof Y.Text && t.toString() === 'Intro line.') t.insert(0, 'Owner: ');
  }
  const out = await w.write({ markdown: 'Second AI paragraph.\n' });
  assert.equal(out.changes, 2);
});

test('different approvers get different drafts', async () => {
  const w = world();
  const a = await w.write({ approverId: 'owner', markdown: 'For the owner.\n' });
  const b = await w.write({ approverId: 'other', markdown: 'For the other.\n' });
  assert.notEqual(a.sid, b.sid);
  assert.equal(b.created, true);
  assert.equal((await openDraftFor({ pool: w.pool, docId: 'd1', authorId: 'ai', approverId: 'other', writerVia: 'agent' })).id, b.sid);
  assert.equal(await openDraftFor({ pool: w.pool, docId: 'd1', authorId: 'ai', approverId: 'nobody', writerVia: 'agent' }), null);
});

test('a page with no body is refused', async () => {
  const w = world();
  const empty = new Y.Doc();
  await assert.rejects(
    writeToDraft({ pool: w.pool, hocuspocus: {
      async openDirectConnection() { return { document: empty, async transact(fn) { fn(empty); }, async disconnect() {} }; },
    }, pageState: async () => Buffer.from(Y.encodeStateAsUpdate(empty)), notify: async () => {}, docId: 'd2', title: 'T', authorId: 'ai', approverId: 'owner', writerVia: 'ai', markdown: 'x\n', mode: 'append' }),
    /no body/,
  );
  assert.equal(w.rows.length, 0, 'the empty draft is not left open to refuse every later write');
});

test('a first write that fails leaves no draft behind, so the next one starts fresh and notifies', async () => {
  const w = world();
  w.hocuspocus.failNext = true;
  await assert.rejects(w.write({ markdown: 'AI paragraph.\n' }), /sync server down/);
  assert.equal(w.rows.length, 0);
  assert.equal(w.notes.length, 0);
  const out = await w.write({ markdown: 'AI paragraph.\n' });
  assert.equal(out.created, true);
  assert.equal(out.changes, 1);
  assert.deepEqual(w.notes, [{ userId: 'owner', kind: 'ai_suggestion', docId: 'd1', suggestionId: out.sid }]);
});

test('a notify that throws synchronously does not fail the saved write', async () => {
  const w = world();
  const out = await writeToDraft({
    pool: w.pool, hocuspocus: w.hocuspocus, pageState: async () => Buffer.from(Y.encodeStateAsUpdate(w.page)),
    notify: () => { throw new Error('boom'); }, docId: 'd1', title: 'Plan',
    authorId: 'ai', approverId: 'owner', writerVia: 'agent', mode: 'append', markdown: 'AI paragraph.\n',
  });
  assert.equal(out.created, true);
  assert.equal(w.rows.length, 1);
});

// ── draftEdit: what POST /api/docs/:id/content does with a write ──────────────

const edit = (w, over) => draftEdit({
  policy: 'suggest', kind: 'doc', via: 'human', pool: w.pool, hocuspocus: w.hocuspocus,
  pageState: async () => Buffer.from(Y.encodeStateAsUpdate(w.page)),
  approver: async () => ({ id: 'owner', name: 'Olive' }), notify: async () => {},
  docId: 'd1', title: 'Plan', authorId: 'ai', markdown: 'AI paragraph.\n', mode: 'append', ...over,
});

test('a direct writer, a task page and an empty page all go straight to the page', async () => {
  const w = world();
  assert.equal(await edit(w, { policy: 'direct' }), null);
  assert.equal(await edit(w, { kind: 'task' }), null);
  const empty = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()));
  assert.equal(await edit(w, { pageState: async () => empty }), null);
  assert.equal(await edit(w, { pageState: async () => null }), null);
  assert.equal(w.rows.length, 0);
});

test('a suggested write lands in a draft and answers with its review link', async () => {
  const w = world();
  const out = await edit(w, {});
  assert.equal(out.status, 200);
  assert.equal(out.body.suggested, true);
  assert.equal(out.body.reviewUrl, `/d/d1?review=${out.body.suggestionId}`);
  assert.equal(out.body.approverName, 'Olive');
  assert.equal(out.body.changes, 1);
  assert.equal(w.rows[0].writer_via, 'agent');
  const ai = await edit(w, { via: 'ai' });
  assert.equal(w.rows.find((r) => r.id === ai.body.suggestionId).writer_via, 'ai');
});

test('a lossy replace is refused before an approver is asked or a draft is made', async () => {
  const w = world();
  const page = new Y.Doc();
  Y.applyUpdate(page, Y.encodeStateAsUpdate(w.page));
  const blocks = page.getMap('blocks');
  const db = new Y.Map();
  db.set('sys:id', 'db1'); db.set('sys:flavour', 'affine:database'); db.set('sys:children', new Y.Array());
  blocks.set('db1', db);
  let asked = false;
  const out = await edit(w, {
    mode: 'replace', pageState: async () => Buffer.from(Y.encodeStateAsUpdate(page)),
    approver: async () => { asked = true; return { id: 'owner', name: 'Olive' }; },
  });
  assert.equal(out.status, 409);
  assert.ok(out.body.lossy.length);
  assert.equal(asked, false);
  assert.equal(w.rows.length, 0);
});

test('an agent edit with no approver still lands as a draft, for any editor, and says so', async () => {
  const w = world();
  const notes = [];
  const out = await edit(w, { approver: async () => null, notify: async (n) => { notes.push(n); } });
  assert.equal(out.status, 200);
  assert.equal(out.body.suggested, true);
  assert.equal(out.body.approverName, null);
  assert.equal(w.rows.length, 1);
  assert.equal(w.rows[0].approver_id, null);
  assert.deepEqual(notes, [{ userId: null, kind: 'ai_suggestion', docId: 'd1', suggestionId: out.body.suggestionId }]);
});

test('a page the draft cannot write a body into is refused, not a server error', async () => {
  const w = world();
  const out = await edit(w, { hocuspocus: { async openDirectConnection() { throw new Error('no body'); } } });
  assert.equal(out.status, 409);
});

test('draftToRead: exact draft first; else the single open AI draft by this caller (read only); never a guess between two', async () => {
  const w = world();
  const key = { pool: w.pool, docId: 'd1', authorId: 'ai', writerVia: 'agent' };
  assert.equal(await draftToRead({ ...key, approverId: 'farhanaj' }), null);
  const { sid } = await w.write({ approverId: 'farhanaj' });
  assert.equal((await draftToRead({ ...key, approverId: 'farhanaj' })).id, sid);
  // a draft made for a named approver is still read when the caller now names none
  assert.equal((await draftToRead({ ...key, approverId: 'owner' })).id, sid);
  assert.equal((await draftToRead({ ...key, approverId: null })).id, sid);
  // someone else's draft is never picked
  assert.equal(await draftToRead({ ...key, authorId: 'someone', approverId: 'owner' }), null);
  // a human Suggesting draft (writer_via null) is not an AI draft
  w.rows.push({ id: 'human', doc_id: 'd1', author_id: 'p1', approver_id: null, writer_via: null, status: 'draft' });
  assert.equal(await draftToRead({ ...key, authorId: 'p1', approverId: 'owner' }), null);
  // two open AI drafts and no exact match: ambiguous, read the live page
  const { sid: sid2 } = await w.write({ approverId: 'owner' });
  assert.notEqual(sid2, sid);
  assert.equal((await draftToRead({ ...key, approverId: 'owner' })).id, sid2);
  assert.equal(await draftToRead({ ...key, approverId: 'maya' }), null);
  // writes keep the exact key: a write for 'maya' makes its own draft
  const { sid: sid3, created } = await w.write({ approverId: 'maya' });
  assert.equal(created, true);
  assert.ok(![sid, sid2].includes(sid3));
});
