/** Send a workspace invite email via the server. Same-origin, cookie-authed. */
export async function sendInvite(email: string): Promise<{ ok: boolean; error?: string }> {
  const clean = email.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { ok: false, error: 'Enter a valid email address.' };
  try {
    const res = await fetch('/api/invites', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: clean }),
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => null);
    if (res.status === 401) return { ok: false, error: 'Sign in to send invites.' };
    return { ok: false, error: data?.error ?? 'Could not send the invite.' };
  } catch {
    return { ok: false, error: 'Network error — is the server running?' };
  }
}
