import test from 'node:test';
import assert from 'node:assert/strict';
import { parentProblem } from './task-parent.js';

const kinds = [
  { key: 'epic', label: 'Epic', is_group: true },
  { key: 'story', label: 'Story', is_group: false },
];
const epic = { id: 'e1', project_id: 'p1', kind: 'epic', deleted_at: null };
const ok = (over) => parentProblem({ childId: 's1', projectId: 'p1', parent: epic, ref: 'DE-1', kinds, chain: ['e1'], ...over });

test('an epic in the same project can hold a task', () => {
  assert.equal(ok(), null);
  // A task being created has no id yet, and nothing can be above it.
  assert.equal(ok({ childId: null }), null);
});

test('a parent that is missing or in the trash is named in the refusal', () => {
  assert.match(ok({ parent: null }), /no task "DE-1"/);
  assert.match(ok({ parent: { ...epic, deleted_at: new Date() } }), /no task "DE-1"/);
});

test('a parent from another project is refused', () => {
  assert.match(ok({ parent: { ...epic, project_id: 'p2' } }), /same project/);
});

test('only a type that can hold tasks may be a parent, and the refusal names the ones that can', () => {
  const msg = ok({ parent: { ...epic, kind: 'story' } });
  assert.match(msg, /is a Story, which cannot hold other tasks; only Epic can/);
  assert.match(
    ok({ parent: { ...epic, kind: 'story' }, kinds: kinds.map((k) => ({ ...k, is_group: false })) }),
    /no type in this project can/,
  );
});

test('a task cannot be its own parent or sit under its own descendant', () => {
  assert.match(ok({ childId: 'e1' }), /own parent/);
  assert.match(ok({ childId: 'top', chain: ['e1', 'mid', 'top'] }), /loop/);
});
