import { describe, expect, it } from 'vitest';
import { formatPropValue, selectedOptions, emptyValue } from './props';
import type { PropRow } from './tasksApi';

const prop = (over: Partial<PropRow>): PropRow => ({
  id: 'p1', project_id: 'A', key: 'k', label: 'L', type: 'text',
  options: [], target_project_id: null, position: 0, ...over,
});

describe('formatPropValue', () => {
  it('renders each type in a table cell', () => {
    expect(formatPropValue(prop({}), 'hi')).toBe('hi');
    expect(formatPropValue(prop({ type: 'number' }), 3)).toBe('3');
    expect(formatPropValue(prop({ type: 'checkbox' }), true)).toBe('Yes');
    expect(formatPropValue(prop({ type: 'checkbox' }), false)).toBe('No');
    expect(formatPropValue(prop({ type: 'date' }), '2026-08-29')).toBe('2026-08-29');
  });

  it('resolves a person to a name and falls back to the raw id', () => {
    const p = prop({ type: 'person' });
    expect(formatPropValue(p, 'u1', [{ id: 'u1', name: 'Ada' }])).toBe('Ada');
    expect(formatPropValue(p, 'u9', [{ id: 'u1', name: 'Ada' }])).toBe('u9');
  });

  it('shows an empty string for a missing value', () => {
    expect(formatPropValue(prop({}), null)).toBe('');
    expect(formatPropValue(prop({ type: 'multi_select' }), undefined)).toBe('');
  });
});

describe('selectedOptions', () => {
  const p = prop({
    type: 'multi_select',
    options: [
      { id: 'o1', label: 'High', color: 'red' },
      { id: 'o2', label: 'Low', color: 'gray' },
    ],
  });

  it('maps stored ids to option rows', () => {
    expect(selectedOptions(p, ['o2', 'o1']).map((o) => o.label)).toEqual(['Low', 'High']);
  });

  it('drops an id whose option was deleted instead of throwing', () => {
    expect(selectedOptions(p, ['o1', 'gone']).map((o) => o.id)).toEqual(['o1']);
  });

  it('accepts a single select value as well as an array', () => {
    expect(selectedOptions(prop({ type: 'select', options: p.options }), 'o1')).toHaveLength(1);
  });
});

describe('emptyValue', () => {
  it('gives each type the value that means "not set"', () => {
    expect(emptyValue('checkbox')).toBe(false);
    expect(emptyValue('multi_select')).toEqual([]);
    expect(emptyValue('text')).toBe(null);
  });
});
