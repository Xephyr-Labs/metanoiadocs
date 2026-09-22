import { describe, expect, it } from 'vitest';
import { buildLinkIndex, buildTaskTree, flattenTree, subtreeIndex, subtreeProgress } from './taskTree';
import type { TaskRow } from './tasksApi';

const task = (over: Partial<TaskRow>): TaskRow => ({
  id: 't1', project_id: 'A', num: 1, title: 'Task', status: 'todo',
  assignee_id: null, assignee_name: null, assignees: [], start_at: null, due_at: null,
  priority: 0, progress: 0, points: null, milestone: false,
  repeat_rule: null, estimate_h: null, doc_id: null,
  parent_id: null, kind: 'task', sprint_id: null, position: 0, done_at: null,
  deps: [], props: {}, preview: null, ...over,
});

describe('buildTaskTree', () => {
  it('nests a story under its epic and a task under its story', () => {
    const rows = [
      task({ id: 'epic', kind: 'epic' }),
      task({ id: 'story', kind: 'story', parent_id: 'epic' }),
      task({ id: 'task', parent_id: 'story' }),
    ];
    const tree = buildTaskTree(rows);
    expect(tree.map((n) => n.task.id)).toEqual(['epic']);
    expect(tree[0].children[0].task.id).toBe('story');
    expect(tree[0].children[0].children[0].task.id).toBe('task');
    expect(tree[0].children[0].children[0].depth).toBe(2);
  });

  it('keeps a row whose parent is not in this list, at the top', () => {
    // The sprint holds the story; the epic is in the backlog. Hiding the story
    // because its parent was filtered out would hide committed work.
    const tree = buildTaskTree([task({ id: 'story', parent_id: 'epic-elsewhere' })]);
    expect(tree.map((n) => n.task.id)).toEqual(['story']);
    expect(tree[0].depth).toBe(0);
  });

  it('keeps the order it was given, at every level', () => {
    const rows = [
      task({ id: 'e', kind: 'epic' }),
      task({ id: 'b', parent_id: 'e' }),
      task({ id: 'a', parent_id: 'e' }),
    ];
    expect(buildTaskTree(rows)[0].children.map((n) => n.task.id)).toEqual(['b', 'a']);
  });

  it('does not recurse forever on a parent loop', () => {
    const rows = [
      task({ id: 'a', parent_id: 'b' }),
      task({ id: 'b', parent_id: 'a' }),
    ];
    const tree = buildTaskTree(rows);
    expect(flattenTree(tree)).toHaveLength(2);
  });
});

describe('subtreeProgress', () => {
  it('counts the whole subtree, not only the children', () => {
    const rows = [
      task({ id: 'epic', kind: 'epic' }),
      task({ id: 'story', parent_id: 'epic' }),
      task({ id: 'one', parent_id: 'story', status: 'done' }),
      task({ id: 'two', parent_id: 'story' }),
    ];
    expect(subtreeProgress(buildTaskTree(rows)[0])).toEqual({ done: 1, total: 3 });
  });
});

describe('subtreeIndex', () => {
  it('counts an epic over the whole project, not over one sprint', () => {
    const rows = [
      task({ id: 'epic', kind: 'epic' }),
      task({ id: 'in-sprint', parent_id: 'epic', sprint_id: 's1', status: 'done' }),
      task({ id: 'in-backlog', parent_id: 'epic' }),
      task({ id: 'deep', parent_id: 'in-backlog' }),
    ];
    expect(subtreeIndex(rows).get('epic')).toEqual({ done: 1, total: 3 });
    expect(subtreeIndex(rows).get('in-backlog')).toEqual({ done: 0, total: 1 });
  });

  it('gives a leaf row nothing to show', () => {
    expect(subtreeIndex([task({ id: 'a' })]).get('a')).toEqual({ done: 0, total: 0 });
  });
});

describe('buildLinkIndex', () => {
  it('separates what blocks a row from what it has already met', () => {
    const rows = [
      task({ id: 'a', deps: ['done', 'open'] }),
      task({ id: 'done', status: 'done' }),
      task({ id: 'open' }),
    ];
    const links = buildLinkIndex(rows).get('a')!;
    expect(links.blockedBy.map((t) => t.id)).toEqual(['open']);
    expect(links.met).toBe(1);
    expect(links.unknown).toBe(0);
  });

  it('records the other half of the edge on the row being waited on', () => {
    const rows = [
      task({ id: 'a', deps: ['b'] }),
      task({ id: 'c', deps: ['b'] }),
      task({ id: 'b' }),
    ];
    expect(buildLinkIndex(rows).get('b')!.blocking.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('counts a dependency this list cannot see rather than calling it met', () => {
    // A filtered board must not report "all clear" for a row it cannot check.
    const links = buildLinkIndex([task({ id: 'a', deps: ['gone'] })]).get('a')!;
    expect(links.unknown).toBe(1);
    expect(links.met).toBe(0);
    expect(links.blockedBy).toEqual([]);
  });

  it('gives a row with no edges nothing to draw', () => {
    expect(buildLinkIndex([task({ id: 'a' })]).get('a')).toEqual({
      blockedBy: [], met: 0, unknown: 0, blocking: [],
    });
  });
});
