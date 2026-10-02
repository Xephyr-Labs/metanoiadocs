import { describe, expect, it } from 'vitest';
import { movedValue } from './grouping';
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
