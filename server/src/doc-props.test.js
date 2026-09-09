import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOC_PROP_TYPES } from './doc-props.js';
import { PROP_TYPES, propsPatch } from './props.js';

test('a page property can be anything a database property can, except a relation', () => {
  assert.ok(!DOC_PROP_TYPES.includes('relation'));
  assert.deepEqual(DOC_PROP_TYPES, PROP_TYPES.filter((t) => t !== 'relation'));
});

test('an empty value is stored rather than rejected, so the page keeps the row', () => {
  const defs = [{ id: 'p1', type: 'date' }];
  assert.deepEqual(propsPatch(defs, { p1: null }), { ok: true, value: { p1: null } });
  assert.deepEqual(propsPatch(defs, { p1: '' }), { ok: true, value: { p1: null } });
});

test('a value that does not fit its type is refused, not silently dropped', () => {
  const defs = [{ id: 'p1', type: 'date' }];
  assert.equal(propsPatch(defs, { p1: 'last thursday' }).ok, false);
});

test('a value for an unknown property is ignored', () => {
  assert.deepEqual(propsPatch([{ id: 'p1', type: 'text' }], { gone: 'x' }), { ok: true, value: {} });
});
