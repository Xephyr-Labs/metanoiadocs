import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wouldFolderCycle } from './folders.js';

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
