import { describe, expect, it } from 'vitest';
import { epicField, epicOf, epicsOf, groupsFor, isGroupLine, movedValue, withGroupLines } from './grouping';
import type { FilterField } from './taskFilter';
import type { TaskRow } from './tasksApi';

const reviewer: FilterField = { key: 'prop:rev', label: 'Reviewer', kind: 'person' };
const task = (props: Record<string, unknown>) => ({ id: 't', props }) as unknown as TaskRow;

describe('movedValue', () => {
  it('swaps the column the card came from and keeps the other reviewers', () => {
    expect(movedValue(reviewer, task({ rev: ['amy', 'cal'] }), 'dan')).toEqual(['dan', 'cal']);
  });
  it('does not duplicate a reviewer the card already has', () => {
    expect(movedValue(reviewer, task({ rev: ['amy', 'cal'] }), 'cal')).toEqual(['cal']);
  });
  it('reads a legacy single id', () => {
    expect(movedValue(reviewer, task({ rev: 'amy' }), 'dan')).toEqual(['dan']);
  });
  it('clears the field when dropped in the empty column', () => {
    expect(movedValue(reviewer, task({ rev: ['amy'] }), '')).toBeNull();
  });
  it('leaves single-value fields alone', () => {
    expect(movedValue({ key: 'prop:s', label: 'S', kind: 'select' }, task({}), 'x')).toBe('x');
  });
});

describe('grouping by epic', () => {
  const row = (over: Partial<TaskRow>) => ({ id: 'x', kind: 'task', parent_id: null, position: 0, num: 0, ...over }) as TaskRow;
  const isGroup = (t: TaskRow) => t.kind === 'epic';
  const rows = [
    row({ id: 'e2', kind: 'epic', position: 2, num: 9, title: 'Billing' }),
    row({ id: 'e1', kind: 'epic', position: 1, num: 4, title: 'Onboarding' }),
    row({ id: 's', kind: 'story', parent_id: 'e1' }),
    row({ id: 't', parent_id: 's' }),
    row({ id: 'loose' }),
    row({ id: 'gone', parent_id: 'deleted' }),
  ];
  const byId = new Map(rows.map((r) => [r.id, r]));

  it('orders the epics by position, then key, and ends on "No epic"', () => {
    const groups = groupsFor(epicField(epicsOf(rows, isGroup)), { e1: 'purple' });
    expect(groups.map((g) => g.label)).toEqual(['Onboarding', 'Billing', 'No epic']);
    expect(groups[2].value).toBe('');
  });

  it('files a row under its nearest epic, however deep', () => {
    expect(epicOf(byId.get('s')!, byId, isGroup)).toBe('e1');
    expect(epicOf(byId.get('t')!, byId, isGroup)).toBe('e1');
    expect(epicOf(byId.get('e2')!, byId, isGroup)).toBe('e2');
  });

  it('files loose rows, and rows whose parent is gone, under "No epic"', () => {
    expect(epicOf(byId.get('loose')!, byId, isGroup)).toBe('');
    expect(epicOf(byId.get('gone')!, byId, isGroup)).toBe('');
  });

  it('survives a parent cycle', () => {
    const a = row({ id: 'a', parent_id: 'b' });
    const b = row({ id: 'b', parent_id: 'a' });
    expect(epicOf(a, new Map([['a', a], ['b', b]]), isGroup)).toBe('');
  });
});

describe('withGroupLines', () => {
  it('heads each non-empty group and keeps row order inside it', () => {
    const groups = [
      { value: 'a', label: 'A', dot: '' },
      { value: 'b', label: 'B', dot: '' },
      { value: '', label: 'None', dot: '' },
    ];
    const rows = [{ id: 1, g: '' }, { id: 2, g: 'a' }, { id: 3, g: 'a' }];
    const lines = withGroupLines(rows, groups, (r) => r.g);
    expect(lines.map((l) => (isGroupLine(l) ? `#${l.group.label}:${l.count}` : l.id))).toEqual(['#A:2', 2, 3, '#None:1', 1]);
  });
});
