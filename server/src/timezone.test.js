import test from 'node:test';
import assert from 'node:assert/strict';
import { dayIn, hourIn, isZone, isoDate, zoneOf } from './timezone.js';

// 2026-09-18T19:30:00Z — evening in London, already tomorrow in Auckland,
// still afternoon in Los Angeles. One instant, three days.
const AT = new Date('2026-09-18T19:30:00.000Z');

test('the day depends on where you are standing', () => {
  assert.equal(dayIn('UTC', AT), '2026-09-18');
  assert.equal(dayIn('America/Los_Angeles', AT), '2026-09-18');
  assert.equal(dayIn('Asia/Dhaka', AT), '2026-09-19');
  assert.equal(dayIn('Pacific/Auckland', AT), '2026-09-19');
});

test('so does the hour, which is what decides whether 8am has arrived', () => {
  assert.equal(hourIn('UTC', AT), 19);
  assert.equal(hourIn('America/Los_Angeles', AT), 12);
  assert.equal(hourIn('Asia/Dhaka', AT), 1);
  assert.equal(hourIn('Pacific/Auckland', AT), 7);
});

test('midnight is hour 0, not hour 24', () => {
  // ICU has formatted this as "24" in some versions, which would put midnight
  // past every REMINDER_HOUR instead of before it.
  assert.equal(hourIn('UTC', new Date('2026-09-18T00:00:00.000Z')), 0);
  assert.equal(hourIn('UTC', new Date('2026-09-18T00:59:00.000Z')), 0);
});

test('a zone is only a zone if the platform knows it', () => {
  assert.equal(isZone('Asia/Dhaka'), true);
  assert.equal(isZone('UTC'), true);
  assert.equal(isZone('Mars/Olympus'), false);
  assert.equal(isZone(''), false);
  assert.equal(isZone(null), false);
  assert.equal(isZone(42), false);
  // A browser cannot make the server format with a 300kB "zone".
  assert.equal(isZone('A'.repeat(200)), false);
});

test('an unknown zone reads as the server\'s own rather than throwing', () => {
  assert.equal(zoneOf({ timezone: 'Asia/Dhaka' }), 'Asia/Dhaka');
  assert.equal(typeof zoneOf({ timezone: 'Mars/Olympus' }), 'string');
  assert.equal(zoneOf({}), zoneOf({ timezone: null }));
  assert.equal(zoneOf(null), zoneOf(undefined));
});

// node-postgres hands a DATE column back as a Date, not a string, and the
// obvious String().slice(0,10) on one gives "Mon Sep 2".
test('a date column reads as YYYY-MM-DD whichever shape it arrives in', () => {
  assert.equal(isoDate('2026-09-21'), '2026-09-21');
  assert.equal(isoDate('2026-09-21T00:00:00.000Z'), '2026-09-21');
  assert.equal(isoDate(new Date(2026, 8, 21)), '2026-09-21');
  // Local midnight west of Greenwich is the previous day in UTC. Reading the
  // local parts is what keeps the task on the day it is actually due.
  assert.equal(isoDate(new Date(2026, 0, 1)), '2026-01-01');
});

test('nothing in gives nothing out, rather than a wrong day', () => {
  assert.equal(isoDate(null), null);
  assert.equal(isoDate(undefined), null);
  assert.equal(isoDate('not a date'), null);
  assert.equal(isoDate(new Date('nonsense')), null);
});

// ── chart buckets ─────────────────────────────────────────────────────────
import { bucketOf, nextBucket } from './timezone.js';

test('a week is the Monday it starts on, even across a month or a year', () => {
  assert.equal(bucketOf('2026-11-04', 'week'), '2026-11-02'); // Wednesday
  assert.equal(bucketOf('2026-11-02', 'week'), '2026-11-02'); // Monday is its own start
  assert.equal(bucketOf('2026-11-08', 'week'), '2026-11-02'); // Sunday belongs to the week before
  assert.equal(bucketOf('2026-10-01', 'week'), '2026-09-28'); // the week starts in September
  assert.equal(bucketOf('2027-01-01', 'week'), '2026-12-28'); // and in the previous year
});

test('a month is its first day, a day is itself', () => {
  assert.equal(bucketOf('2026-02-28', 'month'), '2026-02-01');
  assert.equal(bucketOf('2026-12-31', 'month'), '2026-12-01');
  assert.equal(bucketOf('2026-12-31', 'day'), '2026-12-31');
  assert.equal(bucketOf('2026-12-31T23:00:00Z', 'day'), '2026-12-31'); // a timestamp string reads its date part
  assert.equal(bucketOf('', 'week'), '');
  assert.equal(bucketOf(null, 'week'), '');
});

test('an instant buckets by the day it is where the reader lives', () => {
  // 19:00 UTC on the last day of September is already October in Dhaka.
  const at = new Date('2026-09-30T19:00:00Z');
  assert.equal(bucketOf(at, 'month', 'UTC'), '2026-09-01');
  assert.equal(bucketOf(at, 'month', 'Asia/Dhaka'), '2026-10-01');
});

test('daylight saving changes do not move a row into the wrong day or week', () => {
  // US clocks spring forward on Sunday 2026-03-08 and fall back on 2026-11-01.
  // 04:30 UTC on the 8th is still 23:30 on Saturday the 7th in New York (EST),
  // and 05:30 on November 2nd is 00:30 Monday (EST again, after the fall back).
  assert.equal(bucketOf(new Date('2026-03-08T04:30:00Z'), 'day', 'America/New_York'), '2026-03-07');
  assert.equal(bucketOf(new Date('2026-03-08T04:30:00Z'), 'week', 'America/New_York'), '2026-03-02');
  assert.equal(bucketOf(new Date('2026-03-09T03:30:00Z'), 'day', 'America/New_York'), '2026-03-08'); // 23:30 EDT
  assert.equal(bucketOf(new Date('2026-11-02T04:30:00Z'), 'week', 'America/New_York'), '2026-10-26'); // 23:30 Sunday
  assert.equal(bucketOf(new Date('2026-11-02T05:30:00Z'), 'week', 'America/New_York'), '2026-11-02'); // 00:30 Monday
});

test('stepping to the next bucket crosses months, years and short Februaries', () => {
  assert.equal(nextBucket('2026-10-26', 'week'), '2026-11-02');
  assert.equal(nextBucket('2026-12-28', 'week'), '2027-01-04');
  assert.equal(nextBucket('2026-12-01', 'month'), '2027-01-01');
  assert.equal(nextBucket('2026-02-28', 'day'), '2026-03-01');
  assert.equal(nextBucket('2028-02-28', 'day'), '2028-02-29');
  // The spring-forward day is 23 hours long; it is still one step.
  assert.equal(nextBucket('2026-03-08', 'day'), '2026-03-09');
});
