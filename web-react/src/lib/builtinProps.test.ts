import { describe, expect, it } from 'vitest';
import { builtinProps, defaultCardProps, defaultPropIds, isBuiltinProp, isSystemProp, readBuiltin, visibleProps, DEFAULT_CARD_PROPS } from './builtinProps';
import type { PropRow, TaskKindRow, TaskRow } from './tasksApi';

const task = (over: Partial<TaskRow> = {}): TaskRow => ({
  id: 't1', project_id: 'p', num: 1, title: 'A task', status: 'doing',
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

describe('defaultCardProps', () => {
  it('gives a toolbar-less board the metadata its cards used to hard-code', () => {
    // The regression this exists to stop: a database embedded in a page has
    // no visibility setting, and once the card's footer became properties,
    // "no setting" rendered as a card with nothing but a title on it.
    const ids = defaultCardProps('board', 'tasks', kinds).map((p) => p.id);
    expect(ids).toContain('sys:kind');
    expect(ids).toContain('sys:due');
    expect(ids).toContain('sys:assignees');
  });

  it('returns them in the default order, not the registry order', () => {
    // Assignees come second in builtinProps() and last on a card.
    const ids = defaultCardProps('board', 'tasks', kinds).map((p) => p.id);
    expect(ids.indexOf('sys:assignees')).toBeGreaterThan(ids.indexOf('sys:kind'));
  });

  it('drops built-ins the mode does not have', () => {
    // A data database has no status or people, so a board default naming them
    // must come back without them rather than with undefined holes.
    const rows = defaultCardProps('board', 'data');
    expect(rows.every((p) => p !== undefined)).toBe(true);
    expect(rows.map((p) => p.id)).toEqual(['sys:attachments']);
  });

  it('is empty for a view with no default, rather than throwing', () => {
    expect(defaultCardProps('table', 'tasks', kinds)).toEqual([]);
  });

  it("carries the project's own properties too, capped", () => {
    // An embedded board has nowhere to store a choice, so it gets the same
    // default a fresh board does — built-ins plus the first few of the
    // database's own, not one or the other.
    const own = (id: string) => ({ ...builtinProps('tasks')[0], id, key: id, label: id });
    const ids = defaultCardProps('board', 'tasks', kinds, [], ['c1', 'c2', 'c3', 'c4'].map(own))
      .map((p) => p.id);
    expect(ids).toContain('sys:due');
    expect(ids.filter((id) => !id.startsWith('sys:'))).toEqual(['c1', 'c2', 'c3']);
  });
});

describe('defaultPropIds', () => {
  const custom = (id: string): PropRow => ({
    id, project_id: 'p', key: id, label: id, type: 'text',
    options: [], target_project_id: null, position: 0,
  });
  const mine = [custom('a'), custom('b'), custom('c'), custom('d')];

  it("keeps a project's own properties on an unconfigured board", () => {
    // The regression: naming only built-ins in DEFAULT_CARD_PROPS took the
    // first three custom properties OFF every card that had never been
    // configured — they were what the old props.slice(0, 3) default showed.
    const ids = defaultPropIds('board', builtinProps('tasks', kinds), mine);
    expect(ids).toContain('sys:due');
    expect(ids.filter((id) => !id.startsWith('sys:'))).toEqual(['a', 'b', 'c']);
  });

  it('keeps a calendar cell to the built-ins — it is 45px wide', () => {
    const ids = defaultPropIds('calendar', builtinProps('tasks', kinds), mine);
    expect(ids.some((id) => !id.startsWith('sys:'))).toBe(false);
  });

  it("gives a data database its own properties even in a tight view", () => {
    // 'data' has no status, people or schedule. Its own properties are not
    // extra detail on top of the built-ins — they are all the card has to
    // say, so a narrow calendar still gets them.
    const ids = defaultPropIds('calendar', builtinProps('data'), mine, 'data');
    expect(ids.filter((id) => !id.startsWith('sys:'))).toEqual(['a', 'b', 'c']);
  });

  it('does not mistake Files & media for a full default in data mode', () => {
    // The trap: `sys:attachments` exists in both modes, so "did the built-in
    // set resolve to nothing?" is never true for a calendar, and a data card
    // would have shown one paperclip and none of its own columns.
    expect(defaultPropIds('calendar', builtinProps('data'), mine, 'data'))
      .not.toEqual(['sys:attachments']);
  });

  it('never names a built-in the mode does not have', () => {
    const has = new Set(builtinProps('data').map((b) => b.id));
    for (const id of defaultPropIds('gallery', builtinProps('data'), mine)) {
      if (id.startsWith('sys:')) expect(has.has(id)).toBe(true);
    }
  });

  it('is stable when the project has no properties of its own', () => {
    expect(defaultPropIds('board', builtinProps('tasks', kinds), []))
      .toEqual(DEFAULT_CARD_PROPS.board);
  });
});

describe('system properties', () => {
  const p = (key: string) => ({ key, label: key });

  it('treats a leading underscore as the app\'s own', () => {
    expect(isSystemProp(p('_agent_source'))).toBe(true);
    expect(isSystemProp(p('_pinned'))).toBe(true);
    expect(isSystemProp(p('owner'))).toBe(false);
    // Not a prefix match anywhere but the front: a human may well want a
    // property called "spend_usd".
    expect(isSystemProp(p('spend_usd'))).toBe(false);
    expect(isSystemProp({})).toBe(false);
  });

  it('keeps the readable ones in their given order', () => {
    const list = [p('owner'), p('_agent_source'), p('due'), p('_confidence')];
    expect(visibleProps(list).map((x) => x.key)).toEqual(['owner', 'due']);
  });
});
