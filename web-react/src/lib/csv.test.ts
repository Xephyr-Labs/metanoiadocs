import { describe, expect, it } from 'vitest';
import { cellText, csvCell, tasksToRows, toCsv } from './csv';
import type { PropRow, TaskRow } from './tasksApi';
import type { UserRow } from './docsApi';

const users: UserRow[] = [
  { id: 'u1', name: 'Sam Tan', email: 'sam@example.com' } as UserRow,
  { id: 'u2', name: 'Ravi Menon', email: 'ravi@example.com' } as UserRow,
];

const prop = (over: Partial<PropRow>): PropRow => ({
  id: 'p1', key: 'p1', label: 'Owner', type: 'text', options: [], position: 0,
  ...over,
} as PropRow);

const task = (over: Partial<TaskRow>): TaskRow => ({
  id: 't1', project_id: 'pr', num: 1, title: 'WR-1: Fix the header',
  status: 'todo', priority: 0, progress: 0, points: null, milestone: false,
  kind: 'task', props: {}, assignees: [], tags: [], attachments: [],
  start_at: null, due_at: null, estimate_h: null, repeat_rule: null,
  ...over,
} as unknown as TaskRow);

describe('writing cells', () => {
  it('quotes only what needs it', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('has,comma')).toBe('"has,comma"');
    expect(csvCell('say "no"')).toBe('"say ""no"""');
    expect(csvCell(null)).toBe('');
  });

  it('writes CRLF and a byte-order mark, because Excel reads this next', () => {
    expect(toCsv([['a'], ['b']])).toBe('﻿a\r\nb\r\n');
  });

  it('writes nothing at all for no rows', () => {
    expect(toCsv([])).toBe('');
  });
});

describe('values become text a person can read', () => {
  it('a checkbox is a word, not true', () => {
    expect(cellText(true, 'checkbox', users)).toBe('Yes');
    expect(cellText(false, 'checkbox', users)).toBe('No');
  });

  it('people held as ids are looked up', () => {
    expect(cellText(['u1', 'u2'], 'person', users)).toBe('Sam Tan, Ravi Menon');
  });

  it('people handed over as rows keep their names without a lookup', () => {
    expect(cellText([{ id: 'x', name: 'Elena Rossi' }], 'person', [])).toBe('Elena Rossi');
  });

  it('a select shows its label, never its id', () => {
    const options = [{ id: 'o1', label: 'High', color: 'red' }];
    expect(cellText('o1', 'select', users, options as PropRow['options'])).toBe('High');
    expect(cellText(['o1'], 'multi_select', users, options as PropRow['options'])).toBe('High');
  });

  it('an unknown select id falls back to the id rather than vanishing', () => {
    expect(cellText('missing', 'select', users, [])).toBe('missing');
  });

  it('files list their names', () => {
    expect(cellText([{ key: 'k', name: 'shot.png' }], 'file', users)).toBe('shot.png');
  });

  it('a date is a day, not an instant', () => {
    expect(cellText('2026-09-14T07:00:00.000Z', 'date', users)).toBe('2026-09-14');
    expect(cellText('2026-09-14', 'date', users)).toBe('2026-09-14');
  });

  it('nothing is empty, not the word null', () => {
    expect(cellText(null, 'text', users)).toBe('');
    expect(cellText(undefined, 'number', users)).toBe('');
  });
});

describe('a table of tasks', () => {
  const props = [
    prop({ id: 'sys:status', label: 'Status', type: 'select', options: [{ id: 'todo', label: 'To do', color: 'grey' }] as PropRow['options'] }),
    prop({ id: 'sys:assignees', label: 'Assignees', type: 'person' }),
    prop({ id: 'p9', label: 'Severity', type: 'text' }),
  ];

  it('leads with the title, then the columns on screen in their order', () => {
    const rows = tasksToRows([task({ props: { p9: 'High' }, assignees: [{ id: 'u1', name: 'Sam Tan' }] })], props, users);
    expect(rows[0]).toEqual(['Title', 'Status', 'Assignees', 'Severity']);
    expect(rows[1]).toEqual(['WR-1: Fix the header', 'To do', 'Sam Tan', 'High']);
  });

  it('a repeat rule reads as the sentence the UI shows', () => {
    const rows = tasksToRows(
      [task({ repeat_rule: 'weekdays' })],
      [prop({ id: 'sys:repeat', label: 'Repeats', type: 'select' })],
      users,
    );
    expect(rows[1][1]).toBe('Every weekday');
  });

  it('an empty database still writes its header, so the file opens', () => {
    expect(tasksToRows([], props, users)).toEqual([['Title', 'Status', 'Assignees', 'Severity']]);
  });

  it('round-trips through the same escaping the server parses', () => {
    const rows = tasksToRows([task({ title: 'WR-2: Fix, badly', props: { p9: 'say "no"' } })], props, users);
    const text = toCsv(rows);
    expect(text).toContain('"WR-2: Fix, badly"');
    expect(text).toContain('"say ""no"""');
  });
});
