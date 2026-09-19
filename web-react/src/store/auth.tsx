import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  email: string;
  role?: string;
  /** The IANA zone the server has on file, or null before a browser has said.
   *  See reportZone: the server needs its own copy for the work it does when
   *  nobody's browser is open. */
  timezone?: string | null;
  /** Whether mentions, comments, assignments and the morning digest are also
   *  mailed. True for every account that predates the switch. */
  emailNotify?: boolean;
}

interface Result {
  ok: boolean;
  error?: string;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean; // initial session check
  /** No account exists yet: this instance still has to be claimed. */
  needsSetup: boolean;
  login: (username: string, password: string) => Promise<Result>;
  /** Mail a sign-in link. Resolves ok even for an address with no account —
   *  the server refuses to say which addresses exist, and so does this. */
  requestLink: (email: string) => Promise<Result>;
  signup: (name: string, username: string, email: string, password: string) => Promise<Result>;
  setup: (name: string, username: string, email: string, password: string) => Promise<Result>;
  logout: () => Promise<void>;
  updateName: (name: string) => Promise<Result>;
  /** Turn notification email on or off for this account. Resolves false if the
   *  server refused, so the switch can go back to where it was. */
  setEmailNotify: (on: boolean) => Promise<boolean>;
  /** Resolves with how many other sessions the change signed out. */
  changePassword: (current: string, next: string) => Promise<Result & { signedOut?: number }>;
}

const Ctx = createContext<AuthState | null>(null);

// Same-origin API (vite dev/preview proxies /api -> the Express server), so the
// httpOnly session cookie rides every request automatically.
async function api(path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, data };
}

/**
 * Tell the server which zone this person is reading in, when it does not
 * already know or the answer has changed.
 *
 * The browser is the only thing that knows, and the server is the only thing
 * awake at 8am to act on it — the reminder sweep and the mail it sends run with
 * no tab open anywhere. So the answer is stored rather than asked for, and
 * re-sent whenever it moves, which is what makes it survive a flight.
 *
 * Fire-and-forget: getting this wrong costs a reminder an hour early, not a
 * failed sign-in, and there is nothing useful to say to somebody about it.
 */
function reportZone(user: AuthUser): void {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!zone || zone === user.timezone) return;
  fetch('/api/me', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timezone: zone }),
  }).catch(() => {});
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  // Restore the session from the cookie on load. Signed out, ask one more
  // question before showing sign-in: has anybody claimed this instance yet?
  useEffect(() => {
    let alive = true;
    api('/me')
      .then(async ({ status, data }) => {
        if (!alive) return;
        if (status === 200 && data?.id) {
          const me = data as AuthUser;
          setUser(me);
          reportZone(me);
          return;
        }
        const { data: s } = await api('/setup');
        if (alive) setNeedsSetup(!!s?.needed);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<Result> => {
    const { status, data } = await api('/auth/login', { username, password });
    if (status === 200 && data?.user) {
      setUser(data.user);
      reportZone(data.user);
      return { ok: true };
    }
    return { ok: false, error: data?.error ?? 'Sign in failed. Try again.' };
  }, []);

  const requestLink = useCallback(async (email: string): Promise<Result> => {
    const { status } = await api('/auth/request', { email });
    return status === 200 ? { ok: true } : { ok: false, error: 'Could not send the link. Try again.' };
  }, []);

  const signup = useCallback(
    async (name: string, username: string, email: string, password: string): Promise<Result> => {
      const { status, data } = await api('/auth/register', { name, username, email, password });
      if (status === 200 && data?.user) {
        setUser(data.user);
        reportZone(data.user);
        return { ok: true };
      }
      return { ok: false, error: data?.error ?? 'Could not create account.' };
    },
    [],
  );

  const setup = useCallback(
    async (name: string, username: string, email: string, password: string): Promise<Result> => {
      const { status, data } = await api('/setup', { name, username, email, password });
      if (status === 200 && data?.user) {
        setUser(data.user);
        reportZone(data.user);
        setNeedsSetup(false);
        return { ok: true };
      }
      // 409 means someone claimed it first — fall through to the sign-in screen
      // rather than leaving a setup form that can never succeed.
      if (status === 409) setNeedsSetup(false);
      return { ok: false, error: data?.error ?? 'Could not create the admin account.' };
    },
    [],
  );

  const logout = useCallback(async () => {
    await api('/auth/logout', {});
    setUser(null);
  }, []);

  const updateName = useCallback(async (name: string): Promise<Result> => {
    const res = await fetch('/api/me', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return { ok: false, error: 'Could not update your name.' };
    setUser((u) => (u ? { ...u, name } : u));
    return { ok: true };
  }, []);

  const setEmailNotify = useCallback(async (on: boolean): Promise<boolean> => {
    const res = await fetch('/api/me', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailNotify: on }),
    });
    if (!res.ok) return false;
    setUser((u) => (u ? { ...u, emailNotify: on } : u));
    return true;
  }, []);

  const changePassword = useCallback(async (current: string, next: string) => {
    const { status, data } = await api('/auth/password', { current, next });
    if (status === 200 && data?.ok) return { ok: true as const, signedOut: Number(data.signedOut) || 0 };
    return { ok: false as const, error: data?.error ?? 'Could not change your password.' };
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, needsSetup, login, requestLink, signup, setup, logout, updateName, setEmailNotify, changePassword }),
    [user, loading, needsSetup, login, requestLink, signup, setup, logout, updateName, setEmailNotify, changePassword],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
