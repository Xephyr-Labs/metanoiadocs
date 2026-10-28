export interface CalendarSettings {
  enabled: boolean;
  /** Admin-only fields; absent for everyone else. */
  clientId?: string;
  secretSet?: boolean;
  keySet?: boolean;
  redirectUri?: string;
}

export interface CalendarStatus {
  available: boolean;
  connected: boolean;
  email: string | null;
  /** The grant includes write access (calendar.events); false for read-only grants. */
  canWrite?: boolean;
}

async function req(path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

// One ask per session for the menus that only exist with the calendar on; saving the settings
// or disconnecting asks again.
let status: Promise<CalendarStatus | null> | null = null;

export const calendarApi = {
  settings: (): Promise<CalendarSettings> => req('/settings/calendar'),
  saveSettings: (body: { enabled: boolean; clientId: string; clientSecret?: string }): Promise<{ ok: true }> => {
    status = null;
    return req('/settings/calendar', { method: 'PUT', body: JSON.stringify(body) });
  },
  status: (): Promise<CalendarStatus> => req('/calendar/status'),
  disconnect: (): Promise<null> => { status = null; return req('/calendar/google', { method: 'DELETE' }); },
};

const statusOnce = () => (status ??= calendarApi.status().catch(() => { status = null; return null; }));

/** Whether the calendar feature is on, asked once (a failure is not remembered). */
export const calendarAvailable = (): Promise<boolean> => statusOnce().then((s) => !!s?.available);

/** On and connected: whether the Calendar page has a place in the menus. */
export const calendarConnected = (): Promise<boolean> => statusOnce().then((s) => !!(s?.available && s.connected));

/** A top-level navigation, not a fetch: Google's consent screen needs the whole window. */
export const CALENDAR_CONNECT_URL = '/api/calendar/google/connect';

/** What the OAuth callback said (`?calendar=connected|error`) and the address
 *  without it, or null when it said nothing. */
export function calendarReturn(href: string): { message: string; clean: string } | null {
  const url = new URL(href);
  const v = url.searchParams.get('calendar');
  if (!v) return null;
  const reason = url.searchParams.get('reason');
  url.searchParams.delete('calendar');
  url.searchParams.delete('reason');
  const message = v === 'connected'
    ? 'Google Calendar connected.'
    : reason === 'scope'
      ? "Calendar access wasn't granted — try again and keep the calendar box ticked."
      : reason === 'reconsent'
        ? 'Google did not grant offline access. Remove this app in your Google account permissions, then connect again.'
        : 'Could not connect Google Calendar. Try again.';
  return { message, clean: url.pathname + url.search + url.hash };
}

/** Read once on load and strip it, so a reload does not repeat the toast. */
export function takeCalendarReturn(): string | null {
  const r = calendarReturn(location.href);
  if (r) history.replaceState(history.state, '', r.clean);
  return r?.message ?? null;
}

/** Which Settings section to land on the next time the dialog opens (one-shot). */
let wantedSection: string | null = null;
export const wantSettingsSection = (id: string) => { wantedSection = id; };
export const takeSettingsSection = (): string | null => { const s = wantedSection; wantedSection = null; return s; };
