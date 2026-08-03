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
  login: (username: string, password: string) => Promise<Result>;
  signup: (name: string, username: string, email: string, password: string) => Promise<Result>;
  logout: () => Promise<void>;
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

  // Restore the session from the cookie on load.
  useEffect(() => {
    let alive = true;
    api('/me')
      .then(({ status, data }) => {
        if (alive && status === 200 && data?.id) setUser(data as AuthUser);
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

  const logout = useCallback(async () => {
    await api('/auth/logout', {});
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, signup, logout }),
    [user, loading, login, signup, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
