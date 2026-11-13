export function inboxShortcut(key: string, editing: boolean, index: number, count: number): number | 'open' | null {
  if (editing || !count) return null;
  if (key === 'j') return Math.min(index + 1, count - 1);
  if (key === 'k') return Math.max(index - 1, 0);
  return key === 'Enter' ? 'open' : null;
}
export async function triageInbox(id: string, action: 'archive' | 'snooze' | 'restore', until?: string) {
  const res = await fetch(`/api/inbox/${encodeURIComponent(id)}/action`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, until }),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error || 'Could not update your inbox. Try again.');
  }
}
