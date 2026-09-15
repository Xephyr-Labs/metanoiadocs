import { describe, expect, it } from 'vitest';
import { builtinProps, isBuiltinProp, readBuiltin, DEFAULT_CARD_PROPS } from './builtinProps';
import type { TaskKindRow, TaskRow } from './tasksApi';

const task = (over: Partial<TaskRow> = {}): TaskRow => ({
  id: 't1', project_id: 'p', title: 'A task', status: 'doing',
  assignee_id: null, assignee_name: null, assignees: [],
  start_at: null, due_at: null, priority: 0, progress: 0, points: null,
  milestone: false, doc_id: null, parent_id: null, kind: 'task',
  sprint_id: null, position: 0, done_at: null, deps: [], props: {},
  preview: null, ...over,
});

const kinds: TaskKindRow[] = [
  { id: 'k1', project_id: 'p', key: 'bug', label: 'Bug', color: 'red', is_group: false, position: 0 },
];

describe('builtinProps', () => {
  it('namespaces every id so one can never collide with a real property', () => {
    for (const p of builtinProps('tasks')) expect(isBuiltinProp(p.id)).toBe(true);
    expect(isBuiltinProp('abc-123')).toBe(false);
  });

  it('sorts ahead of database properties, whatever their position', () => {
    // Custom properties start at 0 and count up, so a built-in has to be
    // negative rather than merely small.
    for (const p of builtinProps('tasks')) expect(p.position).toBeLessThan(0);
  });

  it('offers a data database only what it actually has', () => {
    // No status, no assignee, no schedule — those columns are hidden in this
    // mode, so offering them as card properties would be a control for
    // something that never has a value.
    expect(builtinProps('data').map((p) => p.id)).toEqual(['sys:attachments']);
  });

  it('builds Type options from the project, not a hard-coded list', () => {
    const kind = builtinProps('tasks', kinds).find((p) => p.id === 'sys:kind');
    expect(kind?.options).toEqual([{ id: 'bug', label: 'Bug', color: 'red' }]);
  });

  it('gives Status options ids that match the stored value, so a chip can colour itself', () => {
    const status = builtinProps('tasks').find((p) => p.id === 'sys:status');
    const value = readBuiltin(task({ status: 'review' }), 'sys:status');
    expect(status?.options.some((o) => o.id === value)).toBe(true);
  });
});

describe('readBuiltin', () => {
  it('reads the task column, not the props bag', () => {
    const t = task({ due_at: '2026-09-14', points: 3, milestone: true });
    expect(readBuiltin(t, 'sys:due')).toBe('2026-09-14');
    expect(readBuiltin(t, 'sys:points')).toBe(3);
    expect(readBuiltin(t, 'sys:milestone')).toBe(true);
  });

  it('treats 0% progress as nothing to draw', () => {
    // Every untouched task is at 0. A chip on all of them says nothing, and
    // the card already has a progress bar for the ones that moved.
    expect(readBuiltin(task({ progress: 0 }), 'sys:progress')).toBeNull();
    expect(readBuiltin(task({ progress: 40 }), 'sys:progress')).toBe(40);
  });

  it('answers with an array for the list-valued ones even when the row predates them', () => {
    // `tags` and `attachments` are optional on TaskRow — a cached response
    // from before they existed has neither, and `.length` on undefined is a
    // blank card at best.
    const t = task();
    expect(readBuiltin(t, 'sys:tags')).toEqual([]);
    expect(readBuiltin(t, 'sys:attachments')).toEqual([]);
  });

  it('says undefined for anything that is not a built-in', () => {
    expect(readBuiltin(task(), 'some-custom-prop')).toBeUndefined();
  });
});

describe('DEFAULT_CARD_PROPS', () => {
  it('names only real built-ins', () => {
    const known = new Set(builtinProps('tasks', kinds).map((p) => p.id));
    for (const ids of Object.values(DEFAULT_CARD_PROPS)) {
      for (const id of ids) expect(known.has(id)).toBe(true);
    }
  });

  it('keeps the board card drawing what it always drew', () => {
    // These four were hard-coded into the card before they were properties.
    // Dropping one here would silently strip it from every existing board.
    expect(DEFAULT_CARD_PROPS.board).toEqual(
      expect.arrayContaining(['sys:kind', 'sys:points', 'sys:due', 'sys:assignees']),
    );
  });

  it('does not repeat the gallery cover in the gallery chip row', () => {
    expect(DEFAULT_CARD_PROPS.gallery).not.toContain('sys:attachments');
  });
});
