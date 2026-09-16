import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanActions } from './automations.js';

test('an unknown action type is dropped rather than stored', () => {
  assert.deepEqual(cleanActions([{ type: 'launch_missiles' }, { type: 'status', value: 'done' }]),
    [{ type: 'status', value: 'done' }]);
  assert.deepEqual(cleanActions('nonsense'), []);
  assert.deepEqual(cleanActions(null), []);
});

test('assign keeps a de-duplicated list of ids and nothing else', () => {
  assert.deepEqual(
    cleanActions([{ type: 'assign', userIds: ['a', 'a', 'b', 7, null, ''] }]),
    [{ type: 'assign', userIds: ['a', 'b'] }]
  );
  // A malformed assign is still an assign — to nobody, which is a real thing to
  // want (an automation that clears the assignee).
  assert.deepEqual(cleanActions([{ type: 'assign' }]), [{ type: 'assign', userIds: [] }]);
});

test('numeric actions come back as numbers, and null stays null', () => {
  assert.deepEqual(cleanActions([{ type: 'priority', value: '2' }]), [{ type: 'priority', value: 2 }]);
  assert.deepEqual(cleanActions([{ type: 'points', value: null }]), [{ type: 'points', value: null }]);
  assert.deepEqual(cleanActions([{ type: 'progress', value: 'abc' }]), [{ type: 'progress', value: 0 }]);
});

test('a rule cannot carry an unbounded list of actions', () => {
  const many = Array.from({ length: 50 }, () => ({ type: 'priority', value: 1 }));
  assert.equal(cleanActions(many).length, 10);
});

test('string actions are stored as strings and truncated', () => {
  const [a] = cleanActions([{ type: 'kind', value: 'x'.repeat(500) }]);
  assert.equal(a.value.length, 200);
  assert.deepEqual(cleanActions([{ type: 'sprint', value: 'active' }]), [{ type: 'sprint', value: 'active' }]);
});

/**
 * A rule that assigns is an assignment, and an assignment has consequences:
 * the person hears about it, and an agent gets a run queued. The first version
 * of runActions called setAssignees directly and did neither, so an agent was
 * made the owner of work that never reached its queue.
 *
 * Checked structurally rather than against a live database — the bug was a
 * missing call, not a wrong result, and a missing call is visible in the source.
 */
test('every module that changes assignees also tells somebody', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dir = path.dirname(fileURLToPath(import.meta.url));

  const guilty = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.js') || file.endsWith('.test.js')) continue;
    // task-writes.js is where setAssignees lives; it is the primitive, not a caller.
    if (file === 'task-writes.js') continue;
    const src = readFileSync(path.join(dir, file), 'utf8');
    if (!/\bsetAssignees\s*\(/.test(src)) continue;
    if (!/\bnotifyAssignees(ById)?\s*\(/.test(src)) guilty.push(file);
  }
  assert.deepEqual(guilty, [], `calls setAssignees without notifying anyone: ${guilty.join(', ')}`);
});
