// The Home "Needs you" block's wording and tab choice, kept out of the
// component so it can be tested without a DOM.
import type { NeedsCounts } from './tasksApi';

export type { NeedsCounts };
export type NeedsTab = 'review' | 'overdue' | 'mentions' | 'changed';

/** Chip order, which is also the order the default tab is picked in. */
export const NEEDS_TABS: NeedsTab[] = ['review', 'overdue', 'mentions', 'changed'];

/** The Overdue tab lists due-today tasks too, so its chip counts both. */
export function tabCount(c: NeedsCounts, tab: NeedsTab): number {
  return tab === 'overdue' ? c.overdue + c.dueToday : c[tab];
}

/** The first tab with anything in it; null when nothing needs the person. */
export function defaultTab(c: NeedsCounts): NeedsTab | null {
  return NEEDS_TABS.find((t) => tabCount(c, t) > 0) ?? null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The sentence's non-zero parts, each with the tab it selects. */
export function summaryParts(c: NeedsCounts): { tab: NeedsTab; text: string }[] {
  const parts: { tab: NeedsTab; n: number; text: string }[] = [
    { tab: 'overdue', n: c.overdue, text: plural(c.overdue, 'overdue task', 'overdue tasks') },
    { tab: 'overdue', n: c.dueToday, text: plural(c.dueToday, 'task due today', 'tasks due today') },
    { tab: 'mentions', n: c.mentions, text: plural(c.mentions, 'mention waiting', 'mentions waiting') },
    { tab: 'review', n: c.review, text: plural(c.review, 'suggestion to review', 'suggestions to review') },
    { tab: 'changed', n: c.changed, text: plural(c.changed, 'page changed since you looked', 'pages changed since you looked') },
  ];
  return parts.filter((p) => p.n > 0).map(({ tab, text }) => ({ tab, text }));
}

/** What goes between part i and the next one: ", ", " and ", ", and ". */
export function joiner(i: number, total: number): string {
  if (i >= total - 1) return '';
  if (i === total - 2) return total === 2 ? ' and ' : ', and ';
  return ', ';
}

export function summarySentence(c: NeedsCounts): string {
  const parts = summaryParts(c);
  if (!parts.length) return "You're all caught up";
  return `You have ${parts.map((p, i) => p.text + joiner(i, parts.length)).join('')}.`;
}
