/**
 * Whole days from now until `iso`, rounded up so a deadline 20 hours out reads
 * "1 day" rather than "0". Never negative — past deadlines are 0. Null if the
 * date is missing or unparseable.
 */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - Date.now()) / 86_400_000));
}

/** Compact relative time: "just now", "2h ago", "3d ago", or a date. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  // Under a minute is "just now" — the old 45s cut-off left a 15s window
  // where m rounded to 0 and the label read "0m ago".
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** A fixed date: "Oct 4", with the year when it is not this year's. */
export function calendarDate(iso: string | null | undefined): string {
  if (!iso) return '';
  // A bare date is a calendar day, not UTC midnight — parsed as UTC it showed
  // the day before anywhere west of Greenwich.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year });
}

/** Date and time to the minute, for a tooltip: "Oct 4, 2026, 3:26 PM". */
export function fullTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
