import { describe, expect, it } from 'vitest';
import { splitOptionLabels } from './PropsDialog';

describe('splitOptionLabels', () => {
  it('takes one label, as before', () => {
    expect(splitOptionLabels('High')).toEqual(['High']);
  });

  it('takes several, on commas or line breaks, trimmed', () => {
    expect(splitOptionLabels(' High, Medium ,Low\nBlocked ')).toEqual(['High', 'Medium', 'Low', 'Blocked']);
  });

  it('drops empties, repeats, and what the property already has', () => {
    expect(splitOptionLabels('High,, high, Low, ', ['Low'])).toEqual(['High']);
  });
});
