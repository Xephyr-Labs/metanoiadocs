import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPropValue } from './mcp-tools.js';

const people = new Map([
  ['u-farhanaj', 'Farhanaj'],
  ['u-saleh', 'saleh.chowdhury'],
]);

test('a person property is a name, not a uuid', () => {
  const def = { type: 'person', label: 'Reviewer' };
  assert.equal(renderPropValue(def, 'u-farhanaj', people), 'Farhanaj');
  assert.equal(
    renderPropValue(def, ['u-farhanaj', 'u-saleh'], people),
    'Farhanaj, saleh.chowdhury',
  );
});

test('an unknown person falls back to the id rather than vanishing', () => {
  // Silently dropping it would report "no reviewer" for a task that has one.
  assert.equal(renderPropValue({ type: 'person' }, 'u-gone', people), 'u-gone');
});

test('a select is its option label', () => {
  const def = {
    type: 'select',
    label: 'Priority',
    options: [
      { id: 'o-crit', label: 'Critical' },
      { id: 'o-low', label: 'Low' },
    ],
  };
  assert.equal(renderPropValue(def, 'o-crit', people), 'Critical');
  assert.equal(renderPropValue(def, 'o-missing', people), 'o-missing');
});

test('a multi-select keeps every label', () => {
  const def = {
    type: 'multi_select',
    options: [
      { id: 'a', label: 'Marketing' },
      { id: 'b', label: 'Design' },
    ],
  };
  assert.deepEqual(renderPropValue(def, ['a', 'b'], people), ['Marketing', 'Design']);
});

test('empty is null, so a blank field is left off the row entirely', () => {
  for (const raw of [null, undefined, '']) {
    assert.equal(renderPropValue({ type: 'text' }, raw, people), null);
  }
  assert.equal(renderPropValue({ type: 'checkbox' }, false, people), null);
  assert.equal(renderPropValue({ type: 'select', options: [] }, [], people), null);
});

test('plain values pass through', () => {
  assert.equal(renderPropValue({ type: 'number' }, 8, people), 8);
  assert.equal(renderPropValue({ type: 'date' }, '2026-09-23', people), '2026-09-23');
  assert.equal(renderPropValue({ type: 'checkbox' }, true, people), true);
});
