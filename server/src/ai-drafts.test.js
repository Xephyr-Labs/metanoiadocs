import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDocState, docToMarkdown } from './blocks.js';
import { docFromState, parseDraftName } from './suggestions.js';
import { writeToDraft, openDraftFor } from './ai-drafts.js';

/** One page `d1` plus a fake pool holding doc_suggestions rows, and a fake
 *  Hocuspocus that loads a draft from its row and saves it back on disconnect. */
function world(md = 'Intro line.\n') {
  const page = docFromState(buildDocState('Plan', md));
  const rows = [];
  const pool = {
    async query(sql, p) {
      if (/^\s*SELECT/.test(sql)) {
        if (/WHERE id = \$1/.test(sql)) return { rows: rows.filter((r) => r.id === p[0]) };
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
