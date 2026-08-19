/** Day-grouping for the version-history rail. A flat list of forty snapshots is
 *  unreadable; the same list under collapsible "Aug 4" / "Jul 30" headings is a
 *  timeline. Pure and local-time — the labels have to match the user's clock,
 *  not the server's. */

export interface VersionGroup<T> {
  /** Stable key for React and for the collapsed set: the local day, `YYYY-MM-DD`. */
  key: string;
  label: string;
  rows: T[];
}

export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * A day heading: `Aug 4`, or `Aug 4, 2025` once the year stops being obvious.
 *
 * Deliberately not "Today"/"Yesterday": a version list is read as a sequence of
 * dated points, and mixing relative and absolute labels makes two entries a day
 * apart look like different kinds of thing.
 */
export function dayLabel(when: Date, now = new Date()): string {
  const sameYear = when.getFullYear() === now.getFullYear();
  return when.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export const timeLabel = (when: Date) =>
  when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** Group newest-first rows into consecutive day runs, preserving their order.
 *  Unparseable timestamps are dropped rather than thrown away into an
 *  "Invalid Date" heading. */
export function groupByDay<T extends { created_at: string }>(rows: T[], now = new Date()): VersionGroup<T>[] {
  const groups: VersionGroup<T>[] = [];
  for (const row of rows) {
    const when = new Date(row.created_at);
    if (Number.isNaN(when.getTime())) continue;
    const key = dayKey(when);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else groups.push({ key, label: dayLabel(when, now), rows: [row] });
  }
  return groups;
}
