import { describe, expect, it } from 'vitest';
import { defaultTab, shownTab, summarySentence, tabCount, type NeedsCounts } from './needs';

const zero: NeedsCounts = { review: 0, overdue: 0, dueToday: 0, mentions: 0, changed: 0 };

describe('summarySentence', () => {
  it('is caught up when everything is zero', () => {
    expect(summarySentence(zero)).toBe("You're all caught up");
  });

  it('uses singulars', () => {
    expect(summarySentence({ review: 1, overdue: 1, dueToday: 1, mentions: 1, changed: 1 })).toBe(
      'You have 1 overdue task, 1 task due today, 1 mention waiting, 1 suggestion to review, and 1 page changed since you looked.',
    );
  });

  it('uses plurals and leaves zero parts out', () => {
    expect(summarySentence({ ...zero, overdue: 2, mentions: 3, changed: 4 })).toBe(
      'You have 2 overdue tasks, 3 mentions waiting, and 4 pages changed since you looked.',
    );
    expect(summarySentence({ ...zero, dueToday: 2, review: 5 })).toBe(
      'You have 2 tasks due today and 5 suggestions to review.',
    );
    expect(summarySentence({ ...zero, changed: 1 })).toBe('You have 1 page changed since you looked.');
  });
});

describe('defaultTab', () => {
  it('is null when nothing needs you', () => {
    expect(defaultTab(zero)).toBeNull();
  });

  it('picks the first non-empty tab in order', () => {
    expect(defaultTab({ review: 1, overdue: 1, dueToday: 1, mentions: 1, changed: 1 })).toBe('review');
    expect(defaultTab({ ...zero, dueToday: 1, mentions: 1 })).toBe('overdue');
    expect(defaultTab({ ...zero, mentions: 1, changed: 1 })).toBe('mentions');
    expect(defaultTab({ ...zero, changed: 1 })).toBe('changed');
  });
});

describe('tabCount', () => {
  it('counts due-today tasks in the Overdue tab', () => {
    expect(tabCount({ ...zero, overdue: 2, dueToday: 1 }, 'overdue')).toBe(3);
    expect(tabCount({ ...zero, mentions: 4 }, 'mentions')).toBe(4);
  });
});

describe('shownTab', () => {
  it('is caught up once everything is cleared, even with a tab picked', () => {
    expect(shownTab('mentions', zero)).toBeNull();
  });

  it('keeps a picked empty tab while others have items', () => {
    expect(shownTab('changed', { ...zero, review: 2 })).toBe('changed');
  });

  it('falls back to the default tab when nothing is picked', () => {
    expect(shownTab(null, { ...zero, mentions: 1 })).toBe('mentions');
  });
});
