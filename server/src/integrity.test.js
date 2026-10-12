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
