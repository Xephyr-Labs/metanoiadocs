import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dayOf, daysUntil, digestLine, dueLabel, isUrgent, reminderFor, reminderText,
} from './reminder-rules.js';

const TODAY = '2026-09-18';

test('dayOf reads the printed day, not the UTC instant', () => {
  // A `date` column comes back as a Date at LOCAL midnight. toISOString() on it
  // returns the previous day for anyone west of UTC, which would make "due
  // today" fire a day early for half the world.
  assert.equal(dayOf(new Date(2026, 8, 18)), '2026-09-18');
  assert.equal(dayOf('2026-09-18T00:00:00.000Z'), '2026-09-18');
  assert.equal(dayOf(null), null);
  assert.equal(dayOf('not a date'), null);
});

test('daysUntil counts whole days in both directions', () => {
  assert.equal(daysUntil('2026-09-19', TODAY), 1);
  assert.equal(daysUntil('2026-09-18', TODAY), 0);
  assert.equal(daysUntil('2026-09-15', TODAY), -3);
  // Across a DST boundary the hours are not 24, but the days are still days.
  assert.equal(daysUntil('2026-11-02', '2026-10-31'), 2);
});

test('an assignee hears a day out, on the day, and every day after', () => {
  const at = (dueIso) => reminderFor({ dueIso, todayIso: TODAY, role: 'assignee' });
  assert.equal(at('2026-09-20'), null);
  assert.equal(at('2026-09-19'), 'due_soon');
  assert.equal(at('2026-09-18'), 'due_today');
  assert.equal(at('2026-09-17'), 'overdue');
  assert.equal(at(null), null);
});

test('an assignor hears only about today and about late', () => {
  const at = (dueIso) => reminderFor({ dueIso, todayIso: TODAY, role: 'owner' });
  assert.equal(at('2026-09-19'), null, 'not a day out — the work is not theirs to do');
  assert.equal(at('2026-09-18'), 'due_today');
  assert.equal(at('2026-09-17'), 'overdue');
});

test('urgent is late or today, and priority tightens the window in front', () => {
  assert.equal(isUrgent({ dueIso: '2026-09-17' }, TODAY), true);
  assert.equal(isUrgent({ dueIso: TODAY }, TODAY), true);
  assert.equal(isUrgent({ dueIso: '2026-09-20', priority: 0 }, TODAY), false);
  assert.equal(isUrgent({ dueIso: '2026-09-20', priority: 2 }, TODAY), true);
  assert.equal(isUrgent({ dueIso: '2026-09-21', priority: 2 }, TODAY), false);
  assert.equal(isUrgent({ dueIso: null, priority: 9 }, TODAY), false);
});

test('a reminder names the task and its date, and the overdue one counts days', () => {
  assert.equal(
    reminderText('due_soon', { title: 'Write the spec', dueIso: '2026-09-19', todayIso: TODAY }),
    'Due tomorrow — Write the spec (19 Sep)',
  );
  assert.equal(
    reminderText('due_today', { title: 'Write the spec', dueIso: TODAY, todayIso: TODAY }),
    'Due today — Write the spec (18 Sep)',
  );
  assert.equal(
    reminderText('overdue', { title: 'Write the spec', dueIso: '2026-09-17', todayIso: TODAY }),
    '1 day overdue — Write the spec (due 17 Sep)',
  );
  assert.equal(
    reminderText('overdue', { title: 'Write the spec', dueIso: '2026-09-15', todayIso: TODAY }),
    '3 days overdue — Write the spec (due 15 Sep)',
  );
});

test("an assignor's reminder says who is carrying it", () => {
  assert.equal(
    reminderText('due_today', { title: 'Ship it', dueIso: TODAY, todayIso: TODAY, who: 'Maya, Sam' }),
    'Due today — Ship it (18 Sep), with Maya, Sam',
  );
});

test('a date in another year says which', () => {
  assert.equal(dueLabel('2026-09-18', TODAY), '18 Sep');
  assert.equal(dueLabel('2025-12-19', TODAY), '19 Dec 2025');
});

test('the summary is one line, and silence when there is nothing pending', () => {
  assert.equal(digestLine(0, 0), null);
  assert.equal(digestLine(1, 0), '1 task pending · nothing urgent');
  assert.equal(digestLine(7, 1), '7 tasks pending · 1 needs attention now');
  assert.equal(digestLine(7, 3), '7 tasks pending · 3 need attention now');
});
