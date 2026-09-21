import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendar, escapeText, fold } from './ics.js';

const NOW = new Date('2026-09-21T14:30:00Z');
const task = (over = {}) => ({
  id: 't1', title: 'MD-14: Fix login', status: 'todo',
  start_at: null, due_at: '2026-09-21', project_id: 'p1', project_name: 'Website', ...over,
});

test('the four characters that mean something else are escaped', () => {
  assert.equal(escapeText('a,b'), 'a\\,b');
  assert.equal(escapeText('a;b'), 'a\;b');
  assert.equal(escapeText('a\\b'), 'a\\\\b');
  assert.equal(escapeText('a\nb'), 'a\\nb');
  assert.equal(escapeText(null), '');
});

test('a long line folds at 75 octets and continues with a space', () => {
  const line = `SUMMARY:${'x'.repeat(200)}`;
  const parts = fold(line).split('\r\n');
  assert.ok(parts.length > 1);
  assert.equal(Buffer.byteLength(parts[0], 'utf8'), 75);
  for (const p of parts.slice(1)) {
    assert.equal(p[0], ' ', 'a continuation begins with a space');
    assert.ok(Buffer.byteLength(p, 'utf8') <= 75);
  }
  // Unfolding — drop each continuation's leading space — gives back the original.
  assert.equal(parts.map((x, i) => (i ? x.slice(1) : x)).join(''), line);
});

// The bug this guards: folding by character length splits a multi-byte name
// past the limit, and some clients drop the whole event over it.
test('folding counts octets, and never cuts a character in half', () => {
  const line = `SUMMARY:${'é'.repeat(80)}`;
  for (const p of fold(line).split('\r\n')) {
    assert.ok(Buffer.byteLength(p, 'utf8') <= 75, `too long: ${Buffer.byteLength(p, 'utf8')}`);
    assert.ok(!p.includes('�'), 'no character was split');
  }
});

test('a short line is left exactly as it was', () => {
  assert.equal(fold('VERSION:2.0'), 'VERSION:2.0');
});

test('a calendar has the envelope every client looks for', () => {
  const ics = buildCalendar([task()], { now: NOW, name: 'Maya' });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /VERSION:2\.0/);
  assert.match(ics, /X-WR-CALNAME:Maya/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.ok(!ics.includes('\n\n'));
});

// DTEND is exclusive. Without the extra day a one-day task is zero days long,
// and several clients draw nothing at all.
test('a one-day task ends on the following day', () => {
  const ics = buildCalendar([task({ due_at: '2026-09-21' })], { now: NOW });
  assert.match(ics, /DTSTART;VALUE=DATE:20260921/);
  assert.match(ics, /DTEND;VALUE=DATE:20260922/);
});

test('a task with both dates is the span between them', () => {
  const ics = buildCalendar([task({ start_at: '2026-09-21', due_at: '2026-09-25' })], { now: NOW });
  assert.match(ics, /DTSTART;VALUE=DATE:20260921/);
  assert.match(ics, /DTEND;VALUE=DATE:20260926/);
});

test('a task with no date at all is not in a calendar', () => {
  const ics = buildCalendar([task({ start_at: null, due_at: null })], { now: NOW });
  assert.ok(!ics.includes('BEGIN:VEVENT'));
});

// Dropping it would leave it behind forever in every calendar already synced.
test('a finished task is cancelled rather than removed', () => {
  const ics = buildCalendar([task({ status: 'done' })], { now: NOW });
  assert.match(ics, /STATUS:CANCELLED/);
});

test('the uid is the task, so an edit moves the event people already have', () => {
  const a = buildCalendar([task({ title: 'One' })], { now: NOW });
  const b = buildCalendar([task({ title: 'Two' })], { now: NOW });
  assert.match(a, /UID:t1@metanoiadocs/);
  assert.match(b, /UID:t1@metanoiadocs/);
});

// The shape these actually arrive in. node-postgres parses a DATE column into
// a Date object, and the first version of this sliced it as a string.
test('a date column that arrives as a Date is read, not mangled', () => {
  const ics = buildCalendar([task({ start_at: new Date(2026, 8, 21), due_at: new Date(2026, 8, 25) })], { now: NOW });
  assert.match(ics, /DTSTART;VALUE=DATE:20260921/);
  assert.match(ics, /DTEND;VALUE=DATE:20260926/);
});

test('a link back is written when there is a base url to write', () => {
  assert.match(buildCalendar([task()], { now: NOW, baseUrl: 'https://x.test' }), /URL:https:\/\/x\.test\/db\/p1/);
  assert.ok(!buildCalendar([task()], { now: NOW }).includes('URL:'));
});
