import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarApi, calendarAvailable, calendarReturn } from './calendar';

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
    expect(calendarReturn('https://x.test/?calendar=error&reason=scope')?.message).toMatch(/keep the calendar box ticked/);
  });

  it('is null when there is nothing to report', () => {
    expect(calendarReturn('https://x.test/d/abc?review=1')).toBeNull();
  });
});

describe('calendarAvailable', () => {
  afterEach(() => vi.unstubAllGlobals());
  const status = (available: boolean) => async (url: string) => ({
    ok: true, json: async () => (url.endsWith('/settings/calendar') ? { ok: true } : { available, connected: false, email: null }),
  });

  it('asks once, again after a failure, and again after settings are saved', async () => {
    const f = vi.fn(status(true));
    vi.stubGlobal('fetch', f);
    expect(await calendarAvailable()).toBe(true);
    expect(await calendarAvailable()).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    await calendarApi.saveSettings({ enabled: false, clientId: 'x' });
    f.mockImplementation(status(false));
    expect(await calendarAvailable()).toBe(false);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('a failed ask is not remembered', async () => {
    await calendarApi.saveSettings({ enabled: false, clientId: 'x' }).catch(() => {});
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    expect(await calendarAvailable()).toBe(false);
    vi.stubGlobal('fetch', status(true));
    expect(await calendarAvailable()).toBe(true);
  });
});
