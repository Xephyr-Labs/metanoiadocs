import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROP_TYPES, propKey, canChangeType, normalizeOptions, coercePropValue, propsPatch } from './props.js';

test('propKey slugs a label and never collides', () => {
  assert.equal(propKey('Story Points'), 'story-points');
  assert.equal(propKey('  Owner!  '), 'owner');
  assert.equal(propKey('Owner', ['owner']), 'owner-2');
  assert.equal(propKey('📌', ['prop']), 'prop-2');
});

test('canChangeType allows only lossless pairs', () => {
  assert.equal(canChangeType('text', 'url'), true);
  assert.equal(canChangeType('url', 'text'), true);
  assert.equal(canChangeType('select', 'multi_select'), true);
  assert.equal(canChangeType('multi_select', 'select'), true);
  assert.equal(canChangeType('text', 'text'), true);
  assert.equal(canChangeType('number', 'text'), false);
  assert.equal(canChangeType('relation', 'text'), false);
});

test('normalizeOptions keeps id/label/color and drops junk', () => {
  const out = normalizeOptions([
    { id: 'a', label: 'High', color: 'red' },
    { label: 'Low' },
    'nope',
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { id: 'a', label: 'High', color: 'red' });
  assert.equal(out[1].label, 'Low');
  assert.equal(out[1].color, 'gray');
  assert.ok(out[1].id.length > 0);
});

test('coercePropValue stores what the type says and rejects the rest', () => {
  assert.equal(coercePropValue('text', ' hi '), 'hi');
  assert.equal(coercePropValue('number', '12.5'), 12.5);
  assert.equal(coercePropValue('number', 'abc'), undefined);
  assert.equal(coercePropValue('checkbox', 'yes'), true);
  assert.equal(coercePropValue('date', '2026-08-29'), '2026-08-29');
  assert.equal(coercePropValue('date', '29/08/2026'), undefined);
  assert.deepEqual(coercePropValue('multi_select', ['a', 'b', 'a']), ['a', 'b']);
  assert.equal(coercePropValue('url', 'javascript:alert(1)'), undefined);
  assert.equal(coercePropValue('url', 'https://x.dev'), 'https://x.dev');
  assert.equal(coercePropValue('text', null), null);
});

test('every type in PROP_TYPES round-trips a null clear', () => {
  for (const type of PROP_TYPES) assert.equal(coercePropValue(type, null), null);
});

test('propsPatch coerces per type and drops unknown property ids', () => {
  const defs = [
    { id: 'p1', type: 'number' },
    { id: 'p2', type: 'multi_select' },
  ];
  assert.deepEqual(propsPatch(defs, { p1: '3', p2: ['a'], nope: 'x' }), {
    ok: true,
    value: { p1: 3, p2: ['a'] },
  });
});

test('propsPatch reports the first invalid value instead of storing it', () => {
  const defs = [{ id: 'p1', type: 'date' }];
  assert.deepEqual(propsPatch(defs, { p1: 'yesterday' }), {
    ok: false,
    error: 'p1 is not a valid date',
  });
});

test('propsPatch keeps an explicit null so a value can be cleared', () => {
  const defs = [{ id: 'p1', type: 'text' }];
  assert.deepEqual(propsPatch(defs, { p1: null }), { ok: true, value: { p1: null } });
});
