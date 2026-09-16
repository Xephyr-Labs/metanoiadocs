import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanActions, cleanCondition, matchesCondition } from './automations.js';

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

/* ── conditions: which tasks a rule is allowed to touch ────────────────── */

const task = {
  status: 'doing', kind: 'bug', title: 'Fix the date picker',
  priority: 5, points: 3, progress: 40, milestone: false,
  sprint_id: 'sp1', assignee_id: 'u1', due_at: '2026-10-06', start_at: null,
};

test('an empty condition means every task — what every rule meant before', () => {
  assert.equal(matchesCondition(task, []), true);
  assert.equal(matchesCondition(task, null), true);
  assert.equal(matchesCondition(task, 'nonsense'), true);
});

test('clauses are ANDed — every one has to hold', () => {
  const holds = [{ field: 'status', op: 'is', value: 'doing' }, { field: 'kind', op: 'is', value: 'bug' }];
  assert.equal(matchesCondition(task, holds), true);
  const oneFails = [...holds, { field: 'priority', op: 'lt', value: '2' }];
  assert.equal(matchesCondition(task, oneFails), false);
});

test('the operators behave', () => {
  const m = (field, op, value) => matchesCondition(task, [{ field, op, value }]);
  assert.equal(m('status', 'is_not', 'done'), true);
  assert.equal(m('kind', 'is_any_of', 'bug, story'), true);
  assert.equal(m('kind', 'is_none_of', 'bug, story'), false);
  assert.equal(m('title', 'contains', 'DATE'), true);       // case-insensitive
  assert.equal(m('priority', 'gt', '3'), true);
  assert.equal(m('priority', 'lt', '3'), false);
  assert.equal(m('start_at', 'is_empty', ''), true);
  assert.equal(m('due_at', 'is_not_empty', ''), true);
  assert.equal(m('due_at', 'before', '2026-11-01'), true);
  assert.equal(m('due_at', 'after', '2026-11-01'), false);
  assert.equal(m('due_at', 'on', '2026-10-06'), true);
});

test('an unknown field fails closed — a typo disables the rule, never widens it', () => {
  assert.equal(matchesCondition(task, [{ field: 'nope', op: 'is', value: 'x' }]), false);
  // …and an unknown operator is dropped by the cleaner, so it cannot sneak past.
  assert.deepEqual(cleanCondition([{ field: 'status', op: 'regex', value: '.*' }]), []);
});

test('a condition round-trips as strings and is bounded', () => {
  const [c] = cleanCondition([{ field: 'priority', op: 'gt', value: 3 }]);
  assert.equal(c.value, '3');
  assert.ok(c.id);
  assert.equal(cleanCondition(Array.from({ length: 50 }, () => ({ field: 'status', op: 'is', value: 'x' }))).length, 10);
});
