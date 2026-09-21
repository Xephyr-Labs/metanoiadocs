import test from 'node:test';
import assert from 'node:assert/strict';
import { isRepeatRule, nextDate, nextOccurrence } from './repeat.js';

test('the simple intervals are simple', () => {
  assert.equal(nextDate('daily', '2026-09-21'), '2026-09-22');
  assert.equal(nextDate('weekly', '2026-09-21'), '2026-09-28');
  assert.equal(nextDate('biweekly', '2026-09-21'), '2026-10-05');
});

test('weekdays steps over the weekend', () => {
  // 2026-09-25 is a Friday.
  assert.equal(nextDate('weekdays', '2026-09-25'), '2026-09-28', 'Friday goes to Monday');
  assert.equal(nextDate('weekdays', '2026-09-26'), '2026-09-28', 'Saturday goes to Monday');
  assert.equal(nextDate('weekdays', '2026-09-21'), '2026-09-22', 'Monday goes to Tuesday');
});

// The one every calendar gets wrong. The 31st does not become the 3rd.
test('monthly clamps to the end of a short month', () => {
  assert.equal(nextDate('monthly', '2026-01-31'), '2026-02-28');
  assert.equal(nextDate('monthly', '2024-01-31'), '2024-02-29', 'a leap year has one more');
  assert.equal(nextDate('monthly', '2026-01-15'), '2026-02-15');
  assert.equal(nextDate('monthly', '2026-12-15'), '2027-01-15', 'and over the year boundary');
});

test('a rule it does not know moves nothing', () => {
  assert.equal(nextDate('fortnightly', '2026-09-21'), null);
  assert.equal(nextDate('daily', 'not a date'), null);
  assert.equal(isRepeatRule('daily'), true);
  assert.equal(isRepeatRule('yearly'), false);
  assert.equal(isRepeatRule(null), false);
});

test('the span between start and due survives the move', () => {
  assert.deepEqual(
    nextOccurrence('weekly', { startAt: '2026-09-21', dueAt: '2026-09-23' }, '2026-09-23'),
    { startAt: '2026-09-28', dueAt: '2026-09-30' },
  );
});

test('a task with only a start date moves that', () => {
  assert.deepEqual(
    nextOccurrence('daily', { startAt: '2026-09-21', dueAt: null }, '2026-09-21'),
    { startAt: '2026-09-22', dueAt: null },
  );
});

test('a task with no dates repeats without gaining any', () => {
  assert.deepEqual(
    nextOccurrence('weekly', { startAt: null, dueAt: null }, '2026-09-21'),
    { startAt: null, dueAt: null },
  );
});

// Finishing a long-overdue weekly task should not create one that is already
// late — walk forward until the next occurrence is actually ahead.
test('a late finish lands in the future, not in the past', () => {
  assert.deepEqual(
    nextOccurrence('weekly', { startAt: null, dueAt: '2026-08-03' }, '2026-09-21'),
    { startAt: null, dueAt: '2026-09-28' },
  );
  assert.deepEqual(
    nextOccurrence('monthly', { startAt: null, dueAt: '2026-05-10' }, '2026-09-21'),
    { startAt: null, dueAt: '2026-10-10' },
  );
});

test('with no idea what today is, one step is taken and no more', () => {
  assert.deepEqual(
    nextOccurrence('weekly', { startAt: null, dueAt: '2026-08-03' }, null),
    { startAt: null, dueAt: '2026-08-10' },
  );
});
