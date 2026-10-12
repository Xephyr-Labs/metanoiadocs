import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { scanDocState } from './integrity.js';

function build(fn) {
  const doc = new Y.Doc();
  const blocks = doc.getMap('blocks');
  const add = (id, flavour, children = [], props = {}) => {
    const b = new Y.Map();
    blocks.set(id, b);
    b.set('sys:id', id);
    b.set('sys:flavour', flavour);
    const kids = new Y.Array();
    kids.push(children);
    b.set('sys:children', kids);
    for (const [k, v] of Object.entries(props)) b.set(k, v);
    return b;
  };
  fn(add, blocks);
  return Y.encodeStateAsUpdate(doc);
}
const kinds = (issues) => issues.map((i) => i.kind).sort();

test('a healthy page has no problems', () => {
  const s = build((add) => {
    add('page', 'affine:page', ['note']);
    add('note', 'affine:note', ['p1', 'card']);
    add('p1', 'affine:paragraph');
    add('card', 'affine:embed-linked-doc', [], { 'prop:pageId': 'real' });
  });
  assert.deepEqual(scanDocState(s, (id) => id === 'real'), []);
});

test('finds each kind of damage', () => {
  const s = build((add) => {
    add('page', 'affine:page', ['note']);
    add('page2', 'affine:page', []);
    add('note', 'affine:note', ['p1', 'p2', 'ghost', 'card', 't']);
    add('p1', 'affine:paragraph', ['p2']);
    add('p2', 'affine:paragraph');
    add('lost', 'affine:paragraph');
    add('card', 'affine:embed-linked-doc', [], { 'prop:pageId': 'BPQhVCtf2C' });
    add('t', 'affine:table', [], { 'prop:rows.r.order': 'a000000' });
  });
  assert.deepEqual(kinds(scanDocState(s, () => false)),
    ['dead-link-card', 'missing-child', 'page-roots', 'table-keys', 'two-parents']);
});

test('reports blocks cut off from the page', () => {
  const s = build((add) => {
    add('page', 'affine:page', ['note']);
    add('note', 'affine:note', []);
    add('lost', 'affine:paragraph');
  });
  assert.deepEqual(kinds(scanDocState(s, () => true)), ['unreachable']);
});

// A stand-in for pg: just the queries runIntegrityScan makes.
function fakePool(pages) {
  const reports = [];
  const notes = [];
  return {
    reports, notes,
    async query(sql, params = []) {
      if (/^SELECT id FROM docs/.test(sql)) return { rows: pages.map((p) => ({ id: p.id })) };
      if (/SELECT s\.doc_id FROM doc_states/.test(sql)) return { rows: pages.map((p) => ({ doc_id: p.id })) };
      if (/WHERE s\.doc_id = ANY/.test(sql)) return { rows: pages.filter((p) => params[0].includes(p.id)).map((p) => ({ doc_id: p.id, state: p.state, title: p.id })) };
      if (/SELECT issues FROM integrity_reports/.test(sql)) return { rows: reports.length ? [{ issues: reports[reports.length - 1] }] : [] };
      if (/INSERT INTO integrity_reports/.test(sql)) { reports.push(JSON.parse(params[2])); return { rows: [] }; }
      if (/DELETE FROM integrity_reports/.test(sql)) return { rows: [] };
      if (/SELECT id FROM users WHERE role = 'admin'/.test(sql)) return { rows: [{ id: 'admin1' }] };
      if (/INSERT INTO notifications/.test(sql)) { notes.push(params[2]); return { rows: [] }; }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test('the first scan is a baseline; later ones notify only what is new, once', async () => {
  const { runIntegrityScan } = await import('./integrity.js');
  const broken = build((add) => { add('page', 'affine:page', ['note']); add('note', 'affine:note', ['ghost']); });
  const healthy = build((add) => { add('page', 'affine:page', ['note']); add('note', 'affine:note', []); });
  // More pages than one batch, to go through the batching.
  const pages = Array.from({ length: 30 }, (_, i) => ({ id: `p${String(i).padStart(2, '0')}`, state: healthy }));
  pages[3].state = broken;
  const pool = fakePool(pages);
  const first = await runIntegrityScan(pool);
  assert.equal(first.scanned, 30);
  assert.equal(first.issues.length, 1);
  assert.equal(pool.notes.length, 0, 'baseline: nobody is told');
  pages[20].state = broken;
  const second = await runIntegrityScan(pool);
  assert.equal(second.fresh, 1);
  assert.deepEqual(pool.notes, ['p20']);
  await runIntegrityScan(pool);
  assert.deepEqual(pool.notes, ['p20'], 'not told twice');
});
