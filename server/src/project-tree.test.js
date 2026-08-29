import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wouldProjectCycle } from './project-tree.js';

test('wouldProjectCycle rejects self and descendant parents', () => {
  const parents = new Map([['a', null], ['b', 'a'], ['c', 'b']]);
  assert.equal(wouldProjectCycle(parents, 'b', 'b'), true);
  assert.equal(wouldProjectCycle(parents, 'a', 'c'), true);
  assert.equal(wouldProjectCycle(parents, 'c', 'a'), false);
  assert.equal(wouldProjectCycle(parents, 'c', null), false);
});

test('wouldProjectCycle terminates on an already-cyclic graph', () => {
  const parents = new Map([['x', 'y'], ['y', 'x']]);
  assert.equal(wouldProjectCycle(parents, 'z', 'x'), false);
});
