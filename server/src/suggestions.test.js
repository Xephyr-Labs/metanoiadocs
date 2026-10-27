import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDocState, extractText } from './blocks.js';
import { applyTextSuggestion, applyChange, computeChanges, docFromState, parseDraftName, draftName, registerSuggestionRoutes, syncText } from './suggestions.js';
import { findQuote } from './text-match.js';

const state = (doc) => Y.encodeStateAsUpdate(doc);
const textBlock = (doc, s) => {
  for (const [id, b] of doc.getMap('blocks')) {
    const t = b.get('prop:text');
    if (t instanceof Y.Text && t.toString() === s) return { id, block: b, text: t };
  }
  return null;
};
/** A page, a draft forked from it, and the live page — all sharing history. */
function fork(md) {
  const base = buildDocState('Plan', md);
  return { base, draft: docFromState(base), main: docFromState(base) };
}

test('findQuote matches across collapsed whitespace and maps back to raw offsets', () => {
  assert.deepEqual(findQuote('one  two three', 'two three'), { index: 5, length: 9 });
  assert.equal(findQuote('abc', 'zzz'), null);
  assert.deepEqual(findQuote('ab ab', 'ab', 1), { index: 3, length: 2 });
});

test('a suggestion card replaces exactly the quoted text', () => {
  const doc = docFromState(buildDocState('T', 'The quick brown fox.\n'));
  const { id } = textBlock(doc, 'The quick brown fox.');
  assert.equal(applyTextSuggestion(doc, id, 'quick  brown', 'slow red'), true);
  assert.ok(textBlock(doc, 'The slow red fox.'));
  assert.equal(applyTextSuggestion(doc, id, 'not there', 'x'), false);
});

test('draft edits show up as changes, the owner\'s own edits do not', () => {
  const { base, draft, main } = fork('First line.\n\nSecond line.\n\nThird line.\n');
  // Suggester rewrites the first line, deletes the third, adds a new one.
  textBlock(draft, 'First line.').text.insert(0, 'Brand new ');
  const third = textBlock(draft, 'Third line.');
  const blocks = draft.getMap('blocks');
  for (const [, b] of blocks) {
    const kids = b.get('sys:children');
    if (kids instanceof Y.Array && kids.toArray().includes(third.id)) {
      kids.delete(kids.toArray().indexOf(third.id), 1);
      const added = new Y.Map();
      added.set('sys:id', 'new-block');
      added.set('sys:flavour', 'affine:paragraph');
      added.set('sys:children', new Y.Array());
      const t = new Y.Text(); t.insert(0, 'Added by suggester.');
      added.set('prop:text', t);
      added.set('prop:type', 'text');
      blocks.set('new-block', added);
      kids.push(['new-block']);
    }
  }
  blocks.delete(third.id);
  // Meanwhile the owner edits the second line on the live page.
  textBlock(main, 'Second line.').text.insert(0, 'Owner: ');

  const changes = computeChanges(docFromState(base), draft, main);
  assert.deepEqual(changes.map((c) => c.kind).sort(), ['added', 'modified', 'removed']);
  const mod = changes.find((c) => c.kind === 'modified');
  assert.equal(mod.before, 'First line.');
  assert.equal(mod.after, 'Brand new First line.');
  assert.equal(mod.mainChanged, false);

  // Accept all of it onto the live page.
  const baseDoc = docFromState(base);
  for (const c of changes) assert.equal(applyChange(main, draft, baseDoc, c), true);
  const text = extractText(state(main)).text;
  assert.match(text, /Brand new First line\./);
  assert.match(text, /Owner: Second line\./); // the owner's edit survives
  assert.match(text, /Added by suggester\./);
  assert.doesNotMatch(text, /Third line/);
  // Nothing left to suggest once it's all on the page.
  assert.equal(computeChanges(baseDoc, draft, main).filter((c) => c.kind !== 'modified').length, 0);
});

test('a change the owner also made shows as overlapping', () => {
  const { base, draft, main } = fork('Shared line.\n');
  textBlock(draft, 'Shared line.').text.insert(0, 'Draft ');
  textBlock(main, 'Shared line.').text.insert(0, 'Live ');
  const [c] = computeChanges(docFromState(base), draft, main);
  assert.equal(c.mainChanged, true);
});

test('syncText edits only the differing middle and keeps formatting', () => {
  const d = new Y.Doc();
  const a = d.getText('a');
  const b = d.getText('b');
  a.insert(0, 'hello world');
  b.insert(0, 'hello brave world');
  b.format(0, 5, { bold: true });
  syncText(a, b);
  assert.deepEqual(a.toDelta(), b.toDelta());
});

test('draft names round-trip', () => {
  assert.deepEqual(parseDraftName(draftName('doc-1', 's-2')), { docId: 'doc-1', sid: 's-2' });
  assert.equal(parseDraftName('doc-1'), null);
});

test('a suggestion card changes the occurrence that was selected', () => {
  const doc = docFromState(buildDocState('T', 'the cat and the dog\n'));
  const { id } = textBlock(doc, 'the cat and the dog');
  assert.equal(applyTextSuggestion(doc, id, 'the', 'a', 1), true);
  assert.ok(textBlock(doc, 'the cat and a dog'));
});

test('accepting a removed block keeps the children the page still has', () => {
  const base = buildDocState('T', 'Parent line\n\nChild line\n');
  const draft = docFromState(base);
  const main = docFromState(base);
  // On the page, nest Child under Parent (as an editor might after the fork).
  const nest = (doc) => {
    const p = textBlock(doc, 'Parent line');
    const c = textBlock(doc, 'Child line');
    doc.transact(() => {
      for (const [, b] of doc.getMap('blocks')) {
        const kids = b.get('sys:children');
        if (kids instanceof Y.Array && kids.toArray().includes(c.id)) kids.delete(kids.toArray().indexOf(c.id), 1);
      }
      p.block.get('sys:children').push([c.id]);
    });
    return { p, c };
  };
  const { p } = nest(main);
  // The draft deletes Parent only.
  draft.transact(() => {
    const dp = textBlock(draft, 'Parent line');
    for (const [, b] of draft.getMap('blocks')) {
      const kids = b.get('sys:children');
      if (kids instanceof Y.Array && kids.toArray().includes(dp.id)) kids.delete(kids.toArray().indexOf(dp.id), 1);
    }
    draft.getMap('blocks').delete(dp.id);
  });
  const baseDoc = docFromState(base);
  const changes = computeChanges(baseDoc, draft, main);
  const removed = changes.find((c) => c.kind === 'removed' && c.id === p.id);
  assert.ok(removed);
  applyChange(main, draft, baseDoc, removed);
  const text = extractText(state(main)).text;
  assert.doesNotMatch(text, /Parent line/);
  assert.match(text, /Child line/);
});

test('accepting a new bullet that the draft indented an existing bullet under moves it, not copies it', () => {
  const { base, draft, main } = fork('- first\n- second\n');
  // Suggester adds bullet N after "first" and indents "second" under it.
  const x = textBlock(draft, 'second');
  draft.transact(() => {
    const blocks = draft.getMap('blocks');
    let noteKids;
    for (const [, b] of blocks) {
      const kids = b.get('sys:children');
      if (kids instanceof Y.Array && kids.toArray().includes(x.id)) noteKids = kids;
    }
    noteKids.delete(noteKids.toArray().indexOf(x.id), 1);
    const n = new Y.Map();
    n.set('sys:id', 'bullet-n');
    n.set('sys:flavour', 'affine:list');
    n.set('prop:type', 'bulleted');
    const t = new Y.Text(); t.insert(0, 'new'); n.set('prop:text', t);
    const kids = new Y.Array(); kids.push([x.id]); n.set('sys:children', kids);
    blocks.set('bullet-n', n);
    noteKids.push(['bullet-n']);
  });
  const baseDoc = docFromState(base);
  const added = computeChanges(baseDoc, draft, main).find((c) => c.kind === 'added');
  assert.equal(applyChange(main, draft, baseDoc, added), true);

  const parents = [...main.getMap('blocks')]
    .filter(([, b]) => b.get('sys:children')?.toArray().includes(x.id))
    .map(([id]) => id);
  assert.deepEqual(parents, ['bullet-n'], 'one parent, the new bullet');
  assert.equal(extractText(state(main)).text, 'first\nnew\nsecond');
});
test('accepting a suggestion keeps the line breaks it did not change', () => {
  const doc = docFromState(buildDocState('T', 'placeholder\n'));
  const { id, text } = textBlock(doc, 'placeholder');
  text.delete(0, text.length);
  text.insert(0, 'line one\nline two');
  assert.equal(applyTextSuggestion(doc, id, 'one line two', 'one line 2'), true);
  assert.equal(text.toString(), 'line one\nline 2');
  assert.equal(applyTextSuggestion(doc, id, 'line one line 2', 'line one\nline 3'), true);
  assert.equal(text.toString(), 'line one\nline 3');
  // A blank line between, typed over as one space, is still a blank line.
  text.insert(8, '\n');
  assert.equal(applyTextSuggestion(doc, id, 'one line 3', 'one line three'), true);
  assert.equal(text.toString(), 'line one\n\nline three');
});

test('accepting a suggestion leaves formatting where it was', () => {
  const doc = docFromState(buildDocState('T', 'Bold and plain\n'));
  const { id, text } = textBlock(doc, 'Bold and plain');
  text.format(0, 4, { bold: true });
  assert.equal(applyTextSuggestion(doc, id, 'Bold and plain', 'Bold and simple'), true);
  assert.deepEqual(text.toDelta(), [{ insert: 'Bold', attributes: { bold: true } }, { insert: ' and simple' }]);
  assert.equal(applyTextSuggestion(doc, id, 'Bold and', 'Strong and'), true);
  assert.deepEqual(text.toDelta(), [{ insert: 'Strong', attributes: { bold: true } }, { insert: ' and simple' }]);
});

test('a suggestion with anchors changes its own copy, or nothing', () => {
  const at = (text, i, assoc) => Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, i, assoc))).toString('base64');
  const doc = docFromState(buildDocState('T', 'the cat and the dog\n'));
  const { id, text } = textBlock(doc, 'the cat and the dog');
  const anchors = { start: at(text, 12, 0), end: at(text, 15, -1) }; // the second "the"
  text.insert(0, 'the ');
  assert.equal(applyTextSuggestion(doc, id, 'the', 'a', 1, anchors), true);
  assert.equal(text.toString(), 'the the cat and a dog');

  const doc2 = docFromState(buildDocState('T', 'the cat and the dog\n'));
  const b = textBlock(doc2, 'the cat and the dog');
  const anchors2 = { start: at(b.text, 12, 0), end: at(b.text, 15, -1) };
  b.text.delete(12, 4);
  assert.equal(applyTextSuggestion(doc2, b.id, 'the', 'a', 1, anchors2), false);
  assert.equal(b.text.toString(), 'the cat and dog');
});

test('accepting the removal of a column\'s only block takes the empty column and row with it', () => {
  const base = docFromState(buildDocState('T', 'Above\n\nLeft\n'));
  const blocks = base.getMap('blocks');
  const left = textBlock(base, 'Left');
  const above = textBlock(base, 'Above');
  const box = (id, flavour, kids) => {
    const m = new Y.Map();
    m.set('sys:id', id);
    m.set('sys:flavour', flavour);
    const arr = new Y.Array(); arr.push(kids); m.set('sys:children', arr);
    blocks.set(id, m);
  };
  base.transact(() => {
    for (const [, b] of blocks) {
      const kids = b.get('sys:children');
      if (kids instanceof Y.Array && kids.toArray().includes(left.id)) {
        kids.delete(kids.toArray().indexOf(left.id), 1);
        box('col', 'metanoia:column', [left.id]);
        box('row', 'metanoia:columns', ['col']);
        kids.push(['row']);
      }
    }
  });
  const draft = docFromState(state(base));
  const main = docFromState(state(base));
  draft.transact(() => {
    draft.getMap('blocks').get('col').get('sys:children').delete(0, 1);
    draft.getMap('blocks').delete(left.id);
  });
  const baseDoc = docFromState(state(base));
  const removed = computeChanges(baseDoc, draft, main).find((c) => c.kind === 'removed' && c.id === left.id);
  assert.equal(applyChange(main, draft, baseDoc, removed), true);
  const mb = main.getMap('blocks');
  assert.equal(mb.has('col'), false);
  assert.equal(mb.has('row'), false);
  assert.ok(mb.has(above.id));
  assert.ok(![...mb.values()].some((b) => b.get('sys:children')?.toArray().includes('row')));
});

test('a review decision does not overwrite an edit made to the page after the review was listed', async () => {
  const { base, draft, main } = fork('Shared line.\n');
  textBlock(draft, 'Shared line.').text.insert(0, 'Draft ');
  const [c] = computeChanges(docFromState(base), draft, main);
  textBlock(main, 'Shared line.').text.insert(0, 'Owner ');

  const routes = {};
  const app = { get() {}, delete() {}, post: (path, ...h) => { routes[path] = h[h.length - 1]; } };
  const row = {
    id: 's1', doc_id: 'd1', author_id: 'u2', status: 'submitted', decisions: {},
    base_state: Buffer.from(base), state: Buffer.from(state(draft)),
  };
  registerSuggestionRoutes(app, {
    requireUser: () => {}, wrap: (fn) => fn,
    pool: { query: async (sql) => ({ rows: /^\s*SELECT/.test(sql) ? [row] : [], rowCount: 1 }) },
    grantOn: async () => 'owner', canEdit: () => true, canSuggest: () => true,
    getHocuspocus: () => ({
      documents: new Map(),
      openDirectConnection: async () => ({ transact: async (fn) => fn(main), disconnect: async () => {} }),
    }),
    notifyUser: async () => {}, recordDocEditors: async () => {},
  });
  let out;
  await routes['/api/suggestions/:sid/decide'](
    { params: { sid: 's1' }, user: { id: 'u1' }, body: { accept: [{ id: c.id, sig: c.sig, mainSig: c.mainSig }] } },
    { status() { return this; }, json(v) { out = v; } },
  );
  assert.equal(out.applied, 0);
  assert.equal(out.stale, 1);
  assert.ok(textBlock(main, 'Owner Shared line.'), 'the owner\'s edit is still there');
});

test('anchored suggestions still apply after a version restore rewrote the page', async () => {
  const { rewriteDoc } = await import('./restore.js');
  const at = (text, i, assoc) => Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, i, assoc))).toString('base64');
  const doc = docFromState(buildDocState('T', 'the cat and the dog\n'));
  const { text } = textBlock(doc, 'the cat and the dog');
  const anchors = { start: at(text, 12, 0), end: at(text, 15, -1) }; // the second "the"
  // Restore the very same state: every block is rewritten into new text.
  rewriteDoc(doc, Y.encodeStateAsUpdate(doc));
  const now = textBlock(doc, 'the cat and the dog');
  assert.notEqual(now.text, text);
  assert.equal(applyTextSuggestion(doc, now.id, 'the', 'a', 1, anchors), true);
  assert.equal(now.text.toString(), 'the cat and a dog');
});

test('anchors into another block that still exists are refused', () => {
  const at = (text, i, assoc) => Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, i, assoc))).toString('base64');
  const doc = docFromState(buildDocState('T', 'first the\n\nsecond the\n'));
  const one = textBlock(doc, 'first the');
  const two = textBlock(doc, 'second the');
  const anchors = { start: at(one.text, 6, 0), end: at(one.text, 9, -1) };
  assert.equal(applyTextSuggestion(doc, two.id, 'the', 'a', 0, anchors), false);
  assert.equal(two.text.toString(), 'second the');
});

test('a whitespace-only suggestion typed over the raw text changes the whitespace', () => {
  const at = (text, i, assoc) => Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, i, assoc))).toString('base64');
  const doc = docFromState(buildDocState('T', 'one\n'));
  const { id, text } = textBlock(doc, 'one');
  text.insert(3, '\ntwo  three');
  const anchors = { start: at(text, 0, 0), end: at(text, text.length, -1) };
  assert.equal(applyTextSuggestion(doc, id, 'one two three', 'one two three', 0, anchors), true);
  assert.equal(text.toString(), 'one two three');
});

test('text added at the start of a passage does not take the link before it', () => {
  const doc = docFromState(buildDocState('T', 'Linkworld\n'));
  const { id, text } = textBlock(doc, 'Linkworld');
  text.format(0, 4, { link: 'https://example.com' });
  assert.equal(applyTextSuggestion(doc, id, 'world', 'big world'), true);
  assert.deepEqual(text.toDelta(), [{ insert: 'Link', attributes: { link: 'https://example.com' } }, { insert: 'big world' }]);
});

function fakeRoutes(rows, { grant = 'editor', main } = {}) {
  const routes = {};
  const reg = (m) => (path, ...h) => { routes[`${m} ${path}`] = h[h.length - 1]; };
  const app = { get: reg('GET'), post: reg('POST'), delete: reg('DELETE') };
  const calls = [];
  const rank = { viewer: 0, commenter: 1, suggester: 2, editor: 3, owner: 4 };
  registerSuggestionRoutes(app, {
    requireUser: () => {}, wrap: (fn) => fn,
    pool: {
      query: async (sql, params) => {
        calls.push(sql);
        if (/FROM doc_suggestions s JOIN users u ON u.id = s.author_id\s+WHERE s.id/.test(sql)) return { rows: rows.filter((r) => r.id === params[0]) };
        if (/WHERE s.doc_id = \$1 AND s.author_id = \$2/.test(sql)) {
          const personOnly = /writer_via IS NULL/.test(sql);
          return { rows: rows.filter((r) => r.doc_id === params[0] && r.author_id === params[1] && r.status !== 'closed' && (!personOnly || !r.writer_via)) };
        }
        if (/^\s*INSERT INTO doc_suggestions/.test(sql)) {
          const row = { id: params[0], doc_id: params[1], author_id: params[2], status: 'draft', writer_via: null, approver_id: null };
          rows.push(row);
          return { rows: [row] };
        }
        if (/FROM users WHERE id/.test(sql)) return { rows: [{ name: 'Approver' }] };
        if (/^\s*SELECT state FROM doc_states/.test(sql)) return { rows: [{ state: Buffer.from('x') }] };
        return { rows: [], rowCount: 1 };
      },
    },
    grantOn: async () => grant, canEdit: (r) => rank[r] >= 3, canSuggest: () => true,
    getHocuspocus: () => ({
      documents: new Map([['d1', new Y.Doc()]]),
      openDirectConnection: async () => ({ transact: async (fn) => fn(main || new Y.Doc()), disconnect: async () => {} }),
    }),
    notifyUser: async () => {}, recordDocEditors: async () => {},
  });
  return { routes, calls };
}
const res = () => { const r = { status() { return r; }, json(v) { r.out = v; } }; return r; };
const aiRow = (over = {}) => {
  const base = buildDocState('T', 'x\n');
  return { id: 's1', doc_id: 'd1', author_id: 'u2', status: 'submitted', decisions: {}, approver_id: 'a1', writer_via: 'ai', base_state: Buffer.from(base), state: Buffer.from(base), ...over };
};

test('only the designated approver may decide an AI draft', async () => {
  const { routes } = fakeRoutes([aiRow()]);
  const denied = []; const r1 = { status(c) { denied.push(c); return r1; }, json() {} };
  await routes['POST /api/suggestions/:sid/decide']({ params: { sid: 's1' }, user: { id: 'e1' }, body: { all: 'accept' } }, r1);
  assert.deepEqual(denied, [403]);
  const ok = res();
  await routes['POST /api/suggestions/:sid/decide']({ params: { sid: 's1' }, user: { id: 'a1' }, body: { all: 'accept' } }, ok);
  assert.equal(ok.out.ok, true);
});

test('a non-approver editor can see an AI draft but not review it; a person draft stays reviewable', async () => {
  const { routes } = fakeRoutes([aiRow(), aiRow({ id: 's2', approver_id: null, writer_via: null })]);
  const a = res(); const p = res();
  await routes['GET /api/suggestions/:sid']({ params: { sid: 's1' }, user: { id: 'e1' } }, a);
  await routes['GET /api/suggestions/:sid']({ params: { sid: 's2' }, user: { id: 'e1' } }, p);
  assert.equal(a.out.canReview, false);
  assert.equal(a.out.approverId, 'a1');
  assert.equal(a.out.approverName, 'Approver');
  assert.equal(a.out.writerVia, 'ai');
  assert.equal(p.out.canReview, true);
});

test('an Ask-AI draft does not stand in for the author\'s own draft', async () => {
  const rows = [aiRow({ author_id: 'u2', approver_id: 'u2' })];
  const { routes, calls } = fakeRoutes(rows);
  const r = res();
  await routes['POST /api/docs/:id/suggestions']({ params: { id: 'd1' }, user: { id: 'u2' } }, r);
  assert.notEqual(r.out.id, 's1');
  assert.equal(rows.length, 2, 'a person draft was inserted beside the AI one');
  assert.ok(calls.some((s) => /writer_via IS NULL/.test(s)));
  // And the v2 index lets both exist.
});

test('applying an AI draft stamps the page as AI-edited by the approver', async () => {
  const base = buildDocState('T', 'Hello.\n');
  const draft = docFromState(base);
  textBlock(draft, 'Hello.').text.insert(0, 'Oh ');
  const main = docFromState(base);
  const { routes, calls } = fakeRoutes([aiRow({ base_state: Buffer.from(base), state: Buffer.from(state(draft)) })], { main });
  const r = res();
  await routes['POST /api/suggestions/:sid/decide']({ params: { sid: 's1' }, user: { id: 'a1' }, body: { all: 'accept' } }, r);
  if (r.out.applied) assert.ok(calls.some((s) => /updated_via = 'ai'/.test(s)));
  else assert.fail('nothing applied');
});

test('an AI or untrusted agent cannot decide a draft, even one it may review', async () => {
  const routes = {};
  const app = { get() {}, delete() {}, post: (path, ...h) => { routes[path] = h[h.length - 1]; } };
  let touched = false;
  registerSuggestionRoutes(app, {
    requireUser: () => {}, wrap: (fn) => fn,
    pool: { query: async () => { touched = true; return { rows: [], rowCount: 0 }; } },
    grantOn: async () => 'owner', canEdit: () => true, canSuggest: () => true,
    getHocuspocus: () => ({ documents: new Map(), openDirectConnection: async () => { touched = true; } }),
    notifyUser: async () => {}, recordDocEditors: async () => {},
  });
  for (const caller of [
    { user: { id: 'andy', kind: 'agent' }, via: 'human', token: { id: 't', trusted: false } },
    { user: { id: 'u1', kind: 'person' }, via: 'ai', token: null },
  ]) {
    let code; let out;
    await routes['/api/suggestions/:sid/decide'](
      { params: { sid: 's1' }, body: { all: 'accept' }, ...caller },
      { status(c) { code = c; return this; }, json(v) { out = v; } },
    );
    assert.equal(code, 403);
    assert.equal(out.error, 'Only a person can accept suggestions.');
  }
  assert.equal(touched, false, 'refused before reading or writing anything');
});
