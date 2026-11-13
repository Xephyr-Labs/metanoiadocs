import { describe, it, expect } from 'vitest';
import { inboxShortcut } from './inboxActions';
describe('inbox navigation', () => {
  it('moves within the visible feed and opens only from a row surface', () => {
    expect(inboxShortcut('j', false, 0, 3)).toBe(1);
    expect(inboxShortcut('k', false, 0, 3)).toBe(0);
    expect(inboxShortcut('j', false, 2, 3)).toBe(2);
    expect(inboxShortcut('Enter', false, 1, 3)).toBe('open');
  });
  it('leaves editable controls and modified keys alone', () => {
    expect(inboxShortcut('j', true, 0, 3)).toBe(null);
    expect(inboxShortcut('Enter', true, 0, 3)).toBe(null);
    expect(inboxShortcut('j', false, 0, 0)).toBe(null);
  });
});

import { vi, afterEach } from 'vitest';
import { triageInbox } from './inboxActions';
afterEach(() => vi.unstubAllGlobals());
it('reports API failures instead of hiding an item locally', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Notification not found.' }) }));
  await expect(triageInbox('n1', 'archive')).rejects.toThrow('Notification not found.');
});
it('sends triage to the authenticated same-origin API', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetch);
  await triageInbox('n/1', 'snooze', '2026-12-01T00:00:00Z');
  expect(fetch).toHaveBeenCalledWith('/api/inbox/n%2F1/action', expect.objectContaining({
    credentials: 'include', method: 'POST', body: JSON.stringify({ action: 'snooze', until: '2026-12-01T00:00:00Z' }),
  }));
});
