// Desktop (browser) notifications for inbox events. The decisions live here,
// away from the hook, so "which rows are new" and "what does it say" can be
// tested without a Notification API or a timer.

import type { InboxRow } from './docsApi';

/** Per-browser, like the theme: a notification is a property of this device. */
export const NOTIFY_PREF = 'mn-desktop-notify';
/** Ids already shown on this device, as JSON. */
export const NOTIFY_SEEN = 'mn-desktop-notify-seen';

/** The inbox returns at most 50 rows, so this only has to outlast one page. */
const SEEN_CAP = 100;

export function notifyEnabled(): boolean {
  try {
    return localStorage.getItem(NOTIFY_PREF) === 'on';
  } catch {
    return false;
  }
}

export function setNotifyEnabled(on: boolean): void {
  try {
    if (!on) {
      localStorage.removeItem(NOTIFY_PREF);
      return;
    }
    localStorage.setItem(NOTIFY_PREF, 'on');
    // Forget what was shown: switching this back on after a month off must not
    // replay a month of mentions. The next poll banks today's inbox silently
    // and starts notifying from there.
    localStorage.removeItem(NOTIFY_SEEN);
  } catch {
    /* private mode — the setting simply does not persist */
  }
}

/**
 * Ids this device has already shown, or null if it has never run.
 *
 * The two are deliberately different: null means "bank the current inbox and
 * say nothing", while an empty list means "this device has seen an empty inbox,
 * so the next row that appears is genuinely new". Tracking ids rather than a
 * timestamp keeps that distinction exact and keeps the client's clock out of
 * it — an inbox that was empty when notifications were switched on has no
 * timestamp to anchor to, and would swallow the first thing to arrive.
 */
export function readSeen(): string[] | null {
  try {
    const raw = localStorage.getItem(NOTIFY_SEEN);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : null;
  } catch {
    return null;
  }
}

export function writeSeen(ids: string[]): void {
  try {
    localStorage.setItem(NOTIFY_SEEN, JSON.stringify(ids.slice(0, SEEN_CAP)));
  } catch {
    /* private mode — every poll will re-notify, which is the safe direction */
  }
}

/** Rows not yet shown on this device, oldest first so a burst reads in order. */
export function unseen(rows: InboxRow[], seen: string[] | null): InboxRow[] {
  if (!seen) return [];
  const known = new Set(seen);
  return rows
    .filter((r) => !known.has(r.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * What to remember after a poll. The ids on screen now, plus the ones already
 * known — a row that scrolled off the end of the inbox cannot come back, but
 * keeping it costs nothing and protects against a short page.
 */
export function nextSeen(rows: InboxRow[], seen: string[] | null): string[] {
  return [...new Set([...rows.map((r) => r.id), ...(seen ?? [])])].slice(0, SEEN_CAP);
}

/**
 * `selfId` is the reader, so a reminder someone left themselves does not arrive
 * announcing them by name in the third person — the inbox already words those
 * that way, and an alert that says "Sajjad mentioned you" to Sajjad reads like
 * it came from someone else.
 */
export function notifyText(row: InboxRow, selfId?: string | null): { title: string; body: string } {
  const self = !!row.actor_id && row.actor_id === selfId;
  const who = row.actor_name || 'Someone';
  const doc = row.doc_title || 'Untitled';
  if (row.kind === 'assigned') {
    return {
      title: self ? 'You took on a task' : `${who} assigned you a task`,
      body: row.task_title || row.body || 'a task',
    };
  }
  if (row.kind === 'mention') {
    return {
      title: self ? `You tagged yourself in ${doc}` : `${who} mentioned you in ${doc}`,
      body: row.body || '',
    };
  }
  return { title: `${who} commented on ${doc}`, body: row.body || '' };
}
