import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  email: string;
  role?: string;
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
  signup: (name: string, username: string, email: string, password: string) => Promise<Result>;
  setup: (name: string, username: string, email: string, password: string) => Promise<Result>;
  logout: () => Promise<void>;
  updateName: (name: string) => Promise<Result>;
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
          setUser(data as AuthUser);
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
      return { ok: true };
    }
    return { ok: false, error: data?.error ?? 'Sign in failed. Try again.' };
  }, []);

  const signup = useCallback(
    async (name: string, username: string, email: string, password: string): Promise<Result> => {
      const { status, data } = await api('/auth/register', { name, username, email, password });
      if (status === 200 && data?.user) {
        setUser(data.user);
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

  const changePassword = useCallback(async (current: string, next: string) => {
    const { status, data } = await api('/auth/password', { current, next });
    if (status === 200 && data?.ok) return { ok: true as const, signedOut: Number(data.signedOut) || 0 };
    return { ok: false as const, error: data?.error ?? 'Could not change your password.' };
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, needsSetup, login, signup, setup, logout, updateName, changePassword }),
    [user, loading, needsSetup, login, signup, setup, logout, updateName, changePassword],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
