import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDocState } from './blocks.js';
import * as encoding from 'lib0/encoding';
import { checkSuggesterUpdate, syncUpdateOf } from './suggest-guard.js';

const ME = 'me';
const S = (id, kind, by = ME, extra = {}) => ({ id, kind, by, at: 1, ...extra });

/** Server doc from markdown, plus a client replica that edits it. */
function setup(md = 'hello world\n\n- [ ] task\n\n```js\nx\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |') {
  const server = new Y.Doc();
  Y.applyUpdate(server, new Uint8Array(buildDocState('Title', md)));
  return replica({ server });
}

/** A fresh client from the server's state (as a refused client reloads). */
function replica(s) {
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(s.server));
  const blocks = client.getMap('blocks');
  const by = (flavour) => [...blocks.entries()].find(([, b]) => b.get('sys:flavour') === flavour);
  const [pid, para] = by('affine:paragraph');
  const [lid, list] = by('affine:list');
  const [nid, note] = by('affine:note');
  return Object.assign(s, { client, blocks, pid, para, lid, list, nid, note, by });
}

/** The update `fn` makes on the client, checked against the server (applied there if ok, else the client resyncs). */
function edit(s, fn, user = ME) {
  const ups = [];
  const h = (u) => ups.push(u);
  s.client.on('update', h);
  s.client.transact(() => fn(s));
  s.client.off('update', h);
  const update = Y.mergeUpdates(ups.length ? ups : [new Uint8Array([0, 0])]);
  const r = checkSuggesterUpdate(s.server, update, user);
  if (r.ok) Y.applyUpdate(s.server, update);
  else replica(s);
  return r;
}
const ok = (r) => assert.deepEqual(r, { ok: true });
const no = (r) => { assert.equal(r.ok, false); assert.equal(typeof r.reason, 'string'); };
const txt = (b) => b.get('prop:text');

/** A new block, as Suggesting mode adds one after `afterId` (Task 6 shape 4). */
function addBlock(s, afterId, mark = S('a1', 'add'), flavour = 'affine:paragraph', parentId = s.nid) {
  const id = 'new' + Math.random().toString(36).slice(2, 8);
  const b = new Y.Map();
  s.blocks.set(id, b);
  b.set('sys:id', id);
  b.set('sys:flavour', flavour);
  b.set('sys:version', 1);
  b.set('sys:children', new Y.Array());
  b.set('prop:type', 'text');
  b.set('prop:text', new Y.Text());
  b.set('prop:collapsed', false);
  b.set('prop:mnSugg', mark);
  const kids = s.blocks.get(parentId).get('sys:children');
  kids.insert(kids.toArray().indexOf(afterId) + 1, [id]);
  return id;
}

// ── allowed ──────────────────────────────────────────────────────────────

test('an empty or already-known update is fine', () => {
  const s = setup();
  ok(edit(s, () => {}));
  ok(checkSuggesterUpdate(s.server, Y.encodeStateAsUpdate(s.server), ME));
});

test('inserting text marked as my ins (with copied formatting and newlines)', () => {
  const s = setup();
  ok(edit(s, () => txt(s.para).insert(5, ' there\nnow', { mnSugg: S('i1', 'ins'), bold: true })));
  ok(edit(s, () => txt(s.list).insert(0, 'x', { mnSugg: S('i2', 'ins') })));
});

test('typing my ins inside someone else\'s ins run keeps their run theirs', () => {
  const s = setup();
  edit(s, () => txt(s.para).insert(0, 'abcd', { mnSugg: S('o1', 'ins', 'other') }), 'other');
  ok(edit(s, () => txt(s.para).insert(2, 'X', { mnSugg: S('i1', 'ins') })));
});

test('marking existing plain text deleted with my del, and undoing it', () => {
  const s = setup();
  ok(edit(s, () => txt(s.para).format(0, 5, { mnSugg: S('d1', 'del') })));
  ok(edit(s, () => txt(s.para).format(0, 5, { mnSugg: null })));
});

test('deleting my own pending insertion', () => {
  const s = setup();
  ok(edit(s, () => txt(s.para).insert(5, 'abc', { mnSugg: S('i1', 'ins') })));
  ok(edit(s, () => txt(s.para).delete(6, 2)));
});

test('a new block marked as my add, typing in it, and deleting it again', () => {
  const s = setup();
  let id;
  ok(edit(s, () => { id = addBlock(s, s.pid); }));
  ok(edit(s, () => txt(s.blocks.get(id)).insert(0, 'new', { mnSugg: S('i9', 'ins') })));
  ok(edit(s, () => {
    const kids = s.note.get('sys:children');
    kids.delete(kids.toArray().indexOf(id), 1);
    s.blocks.delete(id);
  }));
});

test('setting and withdrawing my remove mark on a block', () => {
  const s = setup();
  ok(edit(s, () => s.para.set('prop:mnSugg', S('r1', 'remove'))));
  ok(edit(s, () => s.para.delete('prop:mnSugg')));
});

test('a type mark: retype and tick in place with `from` (R13b), then withdraw', () => {
  const s = setup();
  ok(edit(s, () => {
    s.list.set('prop:mnSugg', S('t1', 'type', ME, { from: { flavour: 'affine:list', type: 'todo', checked: false } }));
    s.list.set('prop:checked', true);
  }));
  ok(edit(s, () => { s.list.delete('prop:mnSugg'); s.list.set('prop:checked', false); }));
  ok(edit(s, () => {
    s.para.set('prop:mnSugg', S('t2', 'type', ME, { from: { flavour: 'affine:paragraph', type: 'text' } }));
    s.para.set('prop:type', 'h1');
  }));
});

test('undo shapes (Y.UndoManager) of the allowed edits', () => {
  const s = setup();
  const um = new Y.UndoManager(s.blocks, { captureTimeout: 0 });
  const step = (fn) => {
    const ups = [];
    const h = (u) => ups.push(u);
    s.client.on('update', h);
    fn();
    s.client.off('update', h);
    const u = Y.mergeUpdates(ups);
    const r = checkSuggesterUpdate(s.server, u, ME);
    if (r.ok) Y.applyUpdate(s.server, u);
    return r;
  };
  ok(step(() => txt(s.para).format(0, 5, { mnSugg: S('d1', 'del') })));
  ok(step(() => um.undo())); // undo of a del mark
  ok(step(() => txt(s.para).insert(0, 'abc', { mnSugg: S('i1', 'ins') })));
  ok(step(() => txt(s.para).delete(0, 3)));
  ok(step(() => um.undo())); // re-inserts my ins
  let id;
  ok(step(() => s.client.transact(() => { id = addBlock(s, s.pid); })));
  ok(step(() => s.client.transact(() => {
    const kids = s.note.get('sys:children');
    kids.delete(kids.toArray().indexOf(id), 1);
    s.blocks.delete(id);
  })));
  ok(step(() => um.undo())); // re-adds my added block
  ok(step(() => um.redo()));
});

// ── refused ──────────────────────────────────────────────────────────────

test('plain insert, and insert marked as someone else (forged by)', () => {
  const s = setup();
  no(edit(s, () => txt(s.para).insert(0, 'x')));
  no(edit(setup(), (t) => txt(t.para).insert(0, 'x', { mnSugg: S('i1', 'ins', 'other') })));
  no(edit(setup(), (t) => txt(t.para).insert(0, 'x', { mnSugg: S('i1', 'ins', ME, { via: 'ai' }) })));
  no(edit(setup(), (t) => txt(t.para).insert(0, 'x', { mnSugg: { id: 'i1', kind: 'ins', by: ME } })));
  no(edit(setup(), (t) => txt(t.para).insert(0, 'x', { mnSugg: S('i1', 'del') })));
});

test('deleting plain text, or text of my own del run', () => {
  const s = setup();
  no(edit(s, () => txt(s.para).delete(0, 1)));
  const t = setup();
  ok(edit(t, () => txt(t.para).format(0, 5, { mnSugg: S('d1', 'del') })));
  no(edit(t, () => txt(t.para).delete(0, 5)));
});

test('formatting changes (bold on plain text, bold with a del mark, bold on my own ins)', () => {
  no(edit(setup(), (s) => txt(s.para).format(0, 5, { bold: true })));
  no(edit(setup(), (s) => txt(s.para).format(0, 5, { bold: true, mnSugg: S('d1', 'del') })));
  const s = setup();
  ok(edit(s, () => txt(s.para).insert(0, 'ab', { mnSugg: S('i1', 'ins') })));
  no(edit(s, () => txt(s.para).format(0, 2, { bold: true })));
});

test('del mark forged as someone else, or over someone else\'s pending run', () => {
  no(edit(setup(), (s) => txt(s.para).format(0, 5, { mnSugg: S('d1', 'del', 'other') })));
  const s = setup();
  edit(s, () => txt(s.para).insert(0, 'abcd', { mnSugg: S('o1', 'ins', 'other') }), 'other');
  no(edit(s, () => txt(s.para).format(0, 4, { mnSugg: S('d1', 'del') })));
});

test('accepting or rejecting someone else\'s suggestion (dropping their mark or text)', () => {
  const s = setup();
  edit(s, () => txt(s.para).insert(0, 'abcd', { mnSugg: S('o1', 'ins', 'other') }), 'other');
  edit(s, () => txt(s.para).format(4, 5, { mnSugg: S('o2', 'del', 'other') }), 'other');
  no(edit(s, () => txt(s.para).format(0, 4, { mnSugg: null }))); // accept their ins
  no(edit(s, () => txt(s.para).delete(0, 4))); // reject their ins
  no(edit(s, () => txt(s.para).format(4, 5, { mnSugg: null }))); // reject their del
  no(edit(s, () => txt(s.para).delete(4, 5))); // accept their del
  no(edit(s, () => s.para.set('prop:mnSugg', S('r1', 'remove', 'other'))));
});

test('reusing someone else\'s suggestion id for my own mark', () => {
  const s = setup();
  edit(s, () => txt(s.para).insert(0, 'abcd', { mnSugg: S('o1', 'ins', 'other') }), 'other');
  no(edit(s, () => txt(s.para).insert(6, 'x', { mnSugg: S('o1', 'ins') })));
});

test('title, props, meta and other root types', () => {
  no(edit(setup(), (s) => s.by('affine:page')[1].get('prop:title').insert(0, 'x', { mnSugg: S('i1', 'ins') })));
  no(edit(setup(), (s) => s.para.set('prop:type', 'h1')));
  no(edit(setup(), (s) => s.list.set('prop:checked', true)));
  no(edit(setup(), (s) => s.note.set('prop:hidden', true)));
  no(edit(setup(), (s) => s.client.getMap('meta').set('x', 1)));
  no(edit(setup(), (s) => s.client.getMap('spaces').set('x', 1)));
});

test('code blocks (R7) and table cells (R12)', () => {
  no(edit(setup(), (s) => txt(s.by('affine:code')[1]).insert(0, 'y', { mnSugg: S('i1', 'ins') })));
  no(edit(setup(), (s) => txt(s.by('affine:code')[1]).format(0, 1, { mnSugg: S('d1', 'del') })));
  no(edit(setup(), (s) => {
    const t = s.by('affine:table')[1];
    const key = [...t.keys()].find((k) => k.startsWith('prop:cells.'));
    t.get(key).insert(0, 'y', { mnSugg: S('i1', 'ins') });
  }));
});

test('a paragraph inside a database (a row) is not suggestable (R12)', () => {
  const s = setup();
  // A server-side direct write builds the database; the suggester then types in its row.
  let rowId;
  const db = new Y.Map();
  const up = [];
  const h = (u) => up.push(u);
  s.client.on('update', h);
  s.client.transact(() => {
    s.blocks.set('db1', db);
    db.set('sys:id', 'db1');
    db.set('sys:flavour', 'affine:database');
    const kids = new Y.Array();
    db.set('sys:children', kids);
    s.note.get('sys:children').push(['db1']);
    const row = new Y.Map();
    rowId = 'row1';
    s.blocks.set(rowId, row);
    row.set('sys:id', rowId);
    row.set('sys:flavour', 'affine:paragraph');
    row.set('sys:children', new Y.Array());
    row.set('prop:text', new Y.Text('r'));
    kids.push([rowId]);
  });
  s.client.off('update', h);
  Y.applyUpdate(s.server, Y.mergeUpdates(up));
  no(edit(s, () => txt(s.blocks.get(rowId)).insert(0, 'y', { mnSugg: S('i1', 'ins') })));
  no(edit(s, () => { addBlock(s, rowId, S('a1', 'add'), 'affine:paragraph', 'db1'); }));
});

test('blocks: add without my add mark, code flavour, nested children; deleting others\' or plain blocks; moving', () => {
  no(edit(setup(), (s) => { addBlock(s, s.pid, null); }));
  no(edit(setup(), (s) => { addBlock(s, s.pid, S('a1', 'add', 'other')); }));
  no(edit(setup(), (s) => { addBlock(s, s.pid, S('a1', 'add'), 'affine:code'); }));
  no(edit(setup(), (s) => { const id = addBlock(s, s.pid); s.blocks.get(id).get('sys:children').push([s.lid]); }));
  no(edit(setup(), (s) => { const id = addBlock(s, s.pid); s.blocks.get(id).set('prop:text', new Y.Text('plain')); }));
  no(edit(setup(), (s) => {
    const kids = s.note.get('sys:children');
    kids.delete(kids.toArray().indexOf(s.pid), 1);
    s.blocks.delete(s.pid);
  }));
  no(edit(setup(), (s) => { const kids = s.note.get('sys:children'); kids.push([s.pid]); }));
  let id;
  const theirs = () => {
    const s = setup();
    edit(s, () => { id = addBlock(s, s.pid, S('o1', 'add', 'other')); }, 'other');
    return s;
  };
  no(edit(theirs(), (s) => {
    const kids = s.note.get('sys:children');
    kids.delete(kids.toArray().indexOf(id), 1);
    s.blocks.delete(id);
  }));
  no(edit(theirs(), (s) => s.blocks.get(id).delete('prop:mnSugg'))); // accepting their add
  const t = setup();
  ok(edit(t, () => { id = addBlock(t, t.pid); }));
  no(edit(t, () => t.blocks.get(id).delete('prop:mnSugg'))); // accepting my own add
});

test('type mark that lies about `from`, retypes to code, or overwrites someone else\'s mark', () => {
  no(edit(setup(), (s) => {
    s.list.set('prop:mnSugg', S('t1', 'type', ME, { from: { flavour: 'affine:list', type: 'todo', checked: true } }));
    s.list.set('prop:checked', true);
  }));
  no(edit(setup(), (s) => {
    s.para.set('prop:mnSugg', S('t1', 'type', ME, { from: { flavour: 'affine:paragraph', type: 'text' } }));
    s.para.set('sys:flavour', 'affine:code');
  }));
  const s = setup();
  edit(s, () => s.para.set('prop:mnSugg', S('o1', 'remove', 'other')), 'other');
  no(edit(s, () => s.para.set('prop:mnSugg', S('r1', 'remove'))));
  no(edit(s, () => s.para.delete('prop:mnSugg')));
});

test('an update that depends on something the server never got', () => {
  const s = setup();
  const lost = new Y.Doc();
  Y.applyUpdate(lost, Y.encodeStateAsUpdate(s.server));
  lost.getMap('blocks').get(s.pid).get('prop:text').insert(0, 'a', { mnSugg: S('i1', 'ins') });
  const sv = Y.encodeStateVector(lost);
  lost.getMap('blocks').get(s.pid).get('prop:text').insert(1, 'b', { mnSugg: S('i1', 'ins') });
  no(checkSuggesterUpdate(s.server, Y.encodeStateAsUpdate(lost, sv), ME));
});

test('garbage is refused, not thrown', () => {
  no(checkSuggesterUpdate(setup().server, new Uint8Array([1, 2, 3, 4, 5]), ME));
});

test('syncUpdateOf: the update inside a sync step 2 or update message, nothing else', () => {
  const msg = (...parts) => {
    const e = encoding.createEncoder();
    encoding.writeVarString(e, 'doc1');
    for (const [kind, v] of parts) kind === 'u' ? encoding.writeVarUint(e, v) : encoding.writeVarUint8Array(e, v);
    return encoding.toUint8Array(e);
  };
  const u = new Uint8Array([7, 8, 9]);
  assert.deepEqual(syncUpdateOf(msg(['u', 0], ['u', 2], ['a', u])), u); // Sync, update
  assert.deepEqual(syncUpdateOf(msg(['u', 0], ['u', 1], ['a', u])), u); // Sync, step 2
  assert.deepEqual(syncUpdateOf(msg(['u', 4], ['u', 1], ['a', u])), u); // SyncReply, step 2
  assert.equal(syncUpdateOf(msg(['u', 0], ['u', 0], ['a', u])), null); // step 1: a state vector
  assert.equal(syncUpdateOf(msg(['u', 1], ['a', u])), null); // awareness
  assert.equal(syncUpdateOf(msg(['u', 5])), null); // stateless
});

// ── fix round 1 ──────────────────────────────────────────────────────────

const diffOf = (d, fn) => { const sv = Y.encodeStateVector(d); fn(); return Y.encodeStateAsUpdate(d, sv); };
const paraOf = (d) => [...d.getMap('blocks').values()].find((b) => b.get('sys:flavour') === 'affine:paragraph');
const noteKids = (d) => [...d.getMap('blocks').values()].find((b) => b.get('sys:flavour') === 'affine:note').get('sys:children');

test('a struct Yjs merges into its left neighbour (same client) is still checked: text', () => {
  const server = new Y.Doc();
  Y.applyUpdate(server, new Uint8Array(buildDocState('T', 'hello world')));
  const ed = new Y.Doc(); Y.applyUpdate(ed, Y.encodeStateAsUpdate(server));
  Y.applyUpdate(server, diffOf(ed, () => paraOf(ed).get('prop:text').insert(11, '!!')));
  const atk = new Y.Doc(); Y.applyUpdate(atk, Y.encodeStateAsUpdate(server)); atk.clientID = ed.clientID;
  no(checkSuggesterUpdate(server, diffOf(atk, () => paraOf(atk).get('prop:text').insert(13, ' PLAIN')), ME));
});

test('a merged struct is still checked: children, with a forged or my own client id', () => {
  for (const forged of [true, false]) {
    const server = new Y.Doc();
    Y.applyUpdate(server, new Uint8Array(buildDocState('T', 'hello world\n\nsecond')));
    const ed = new Y.Doc(); Y.applyUpdate(ed, Y.encodeStateAsUpdate(server));
    // The first client appends a block (forged: an editor's; else my own add).
    const up = diffOf(ed, () => {
      const b = new Y.Map(); ed.getMap('blocks').set('nb', b);
      b.set('sys:id', 'nb'); b.set('sys:flavour', 'affine:paragraph'); b.set('sys:children', new Y.Array());
      if (!forged) b.set('prop:mnSugg', S('a1', 'add'));
      noteKids(ed).push(['nb']);
    });
    if (!forged) ok(checkSuggesterUpdate(server, up, ME));
    Y.applyUpdate(server, up);
    const atk = new Y.Doc(); Y.applyUpdate(atk, Y.encodeStateAsUpdate(server)); atk.clientID = ed.clientID;
    const pid = [...atk.getMap('blocks').entries()].find(([, b]) => b.get('sys:flavour') === 'affine:paragraph')[0];
    no(checkSuggesterUpdate(server, diffOf(atk, () => noteKids(atk).push([pid, { evil: 1 }])), ME));
  }
});

test('an update that cannot apply yet is refused even when the doc already waits on another', () => {
  const server = new Y.Doc();
  Y.applyUpdate(server, new Uint8Array(buildDocState('T', 'hello world')));
  const ed = new Y.Doc(); Y.applyUpdate(ed, Y.encodeStateAsUpdate(server));
  diffOf(ed, () => paraOf(ed).get('prop:text').insert(0, 'A'));
  Y.applyUpdate(server, diffOf(ed, () => paraOf(ed).get('prop:text').insert(1, 'B'))); // out of order: pending
  assert.ok(server.store.pendingStructs);
  const atk = new Y.Doc(); Y.applyUpdate(atk, Y.encodeStateAsUpdate(ed));
  no(checkSuggesterUpdate(server, diffOf(atk, () => paraOf(atk).get('prop:text').insert(1, 'PLAIN')), ME));
  // An update that needs nothing missing is still judged on its own.
  const me = new Y.Doc(); Y.applyUpdate(me, Y.encodeStateAsUpdate(server));
  ok(checkSuggesterUpdate(server, diffOf(me, () => paraOf(me).get('prop:text').insert(0, 'x', { mnSugg: S('i1', 'ins') })), ME));
});

test('no remove or type mark on page structure (page, note, surface)', () => {
  for (const f of ['affine:page', 'affine:note', 'affine:surface']) {
    no(edit(setup(), (s) => s.by(f)[1].set('prop:mnSugg', S('r1', 'remove'))));
    no(edit(setup(), (s) => s.by(f)[1].set('prop:mnSugg', S('t1', 'type', ME, { from: { flavour: f } }))));
  }
  ok(edit(setup(), (s) => s.by('affine:code')[1].set('prop:mnSugg', S('r1', 'remove')))); // a whole non-text block
  ok(edit(setup(), (s) => s.by('affine:table')[1].set('prop:mnSugg', S('r2', 'remove'))));
});

test('no type (or remove) mark on a database row (R12)', () => {
  const s = setup();
  const up = [];
  const h = (u) => up.push(u);
  s.client.on('update', h);
  s.client.transact(() => {
    const db = new Y.Map();
    s.blocks.set('db1', db);
    db.set('sys:id', 'db1'); db.set('sys:flavour', 'affine:database');
    const kids = new Y.Array(); db.set('sys:children', kids);
    s.note.get('sys:children').push(['db1']);
    const row = new Y.Map();
    s.blocks.set('row1', row);
    row.set('sys:id', 'row1'); row.set('sys:flavour', 'affine:paragraph'); row.set('prop:type', 'text');
    row.set('sys:children', new Y.Array()); row.set('prop:text', new Y.Text('r'));
    kids.push(['row1']);
  });
  s.client.off('update', h);
  Y.applyUpdate(s.server, Y.mergeUpdates(up));
  no(edit(s, () => {
    const row = s.blocks.get('row1');
    row.set('prop:mnSugg', S('t1', 'type', ME, { from: { flavour: 'affine:paragraph', type: 'text' } }));
    row.set('prop:type', 'h1');
  }));
  no(edit(s, () => s.blocks.get('row1').set('prop:mnSugg', S('r1', 'remove'))));
  ok(edit(s, () => s.blocks.get('db1').set('prop:mnSugg', S('r2', 'remove')))); // the whole database
});
