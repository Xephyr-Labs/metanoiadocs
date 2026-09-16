import { describe, expect, it } from 'vitest';
import { aggregatesFor, reduceColumn } from './gridPrefs';

describe('column aggregates', () => {
  it('offers arithmetic only where arithmetic means something', () => {
    expect(aggregatesFor('number')).toContain('sum');
    expect(aggregatesFor('rollup')).toContain('avg');
    // Summing a column of names would print 0 and look like an answer.
    expect(aggregatesFor('text')).not.toContain('sum');
    expect(aggregatesFor('person')).not.toContain('avg');
  });

  it('always offers the counting reducers', () => {
    for (const type of ['text', 'number', 'date', 'person', 'select']) {
      expect(aggregatesFor(type)).toContain('count');
      expect(aggregatesFor(type)).toContain('filled');
    }
  });
});

describe('reduceColumn', () => {
  it('counts rows, filled cells and empty cells separately', () => {
    const col = [1, null, 3, '', 5];
    expect(reduceColumn(col, 'count')).toBe('5');
    expect(reduceColumn(col, 'filled')).toBe('3');
    expect(reduceColumn(col, 'empty')).toBe('2');
  });

  it('does the arithmetic on the numbers it can find', () => {
    const col = [10, 20, null, 30];
    expect(reduceColumn(col, 'sum')).toBe('60');
    expect(reduceColumn(col, 'avg')).toBe('20');
    expect(reduceColumn(col, 'min')).toBe('10');
    expect(reduceColumn(col, 'max')).toBe('30');
  });

  it('rounds to two places rather than printing float noise', () => {
    expect(reduceColumn([1, 2], 'avg')).toBe('1.5');
    expect(reduceColumn([1, 1, 1], 'avg')).toBe('1');
    expect(reduceColumn([10, 3], 'avg')).toBe('6.5');
  });

  it('says nothing rather than zero when there is nothing to average', () => {
    // A column of names has no average. Printing 0 would be a claim about the
    // data that is not true.
    expect(reduceColumn(['ada', 'grace'], 'avg')).toBe('');
    expect(reduceColumn([], 'sum')).toBe('');
    expect(reduceColumn([null, ''], 'max')).toBe('');
  });

  it('treats checkboxes as 1 and 0 so a column of them can be summed', () => {
    expect(reduceColumn([true, false, true], 'sum')).toBe('2');
  });

  it('none reduces to nothing at all', () => {
    expect(reduceColumn([1, 2, 3], 'none')).toBe('');
  });
});
