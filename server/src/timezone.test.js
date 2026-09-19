import test from 'node:test';
import assert from 'node:assert/strict';
import { dayIn, hourIn, isZone, zoneOf } from './timezone.js';

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
