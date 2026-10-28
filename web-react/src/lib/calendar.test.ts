import { describe, expect, it } from 'vitest';
import { calendarReturn } from './calendar';

describe('calendarReturn', () => {
  it('reads ?calendar= and gives the address without it', () => {
    const r = calendarReturn('https://x.test/d/abc?calendar=connected&x=1#b');
    expect(r?.message).toMatch(/connected/);
    expect(r?.clean).toBe('/d/abc?x=1#b');
  });

  it('explains a reconsent failure and a generic one', () => {
    const r = calendarReturn('https://x.test/?calendar=error&reason=reconsent');
    expect(r?.message).toMatch(/connect again/);
    expect(r?.clean).toBe('/');
    expect(calendarReturn('https://x.test/?calendar=error')?.message).toMatch(/Could not connect/);
  });

  it('is null when there is nothing to report', () => {
    expect(calendarReturn('https://x.test/d/abc?review=1')).toBeNull();
  });
});
