import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wouldFolderCycle, safeFolderOrder } from './folders.js';

test('wouldFolderCycle rejects self and transitive folder moves', () => {
  const parents = new Map([
    ['a', null],
    ['b', 'a'],
    ['c', 'b'],
  ]);

  assert.equal(wouldFolderCycle(parents, 'b', 'b'), true);
  assert.equal(wouldFolderCycle(parents, 'a', 'c'), true);
  assert.equal(wouldFolderCycle(parents, 'c', 'a'), false);
});

test('wouldFolderCycle terminates on an already-cyclic graph', () => {
  const parents = new Map([
    ['x', 'y'],
    ['y', 'x'],
  ]);

  assert.equal(wouldFolderCycle(parents, 'z', 'x'), false);
});

test('safeFolderOrder drops folders that would swallow their own ancestor', () => {
  const parents = new Map([
    ['a', null],
    ['b', 'a'],
    ['c', null],
  ]);

  // Reordering a and c under b: a is b's parent, so that move is a cycle.
  assert.deepEqual(safeFolderOrder(parents, ['a', 'c'], 'b'), ['c']);
  // Same list at the top level is fine — nothing can cycle through NULL.
  assert.deepEqual(safeFolderOrder(parents, ['a', 'c'], null), ['a', 'c']);
  // A folder may not become its own parent.
  assert.deepEqual(safeFolderOrder(parents, ['b', 'c'], 'b'), ['c']);
});
