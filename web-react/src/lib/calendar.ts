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

export const calendarApi = {
  settings: (): Promise<CalendarSettings> => req('/settings/calendar'),
  saveSettings: (body: { enabled: boolean; clientId: string; clientSecret?: string }): Promise<{ ok: true }> =>
    req('/settings/calendar', { method: 'PUT', body: JSON.stringify(body) }),
  status: (): Promise<CalendarStatus> => req('/calendar/status'),
};
