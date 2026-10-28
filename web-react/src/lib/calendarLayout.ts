// Where meetings sit on the Calendar page. Pure, so the day boundaries (which
// move with DST and with the person's profile zone, not the browser's) are
// tested rather than eyeballed.
//
// Days are YYYY-MM-DD strings; instants are ms. Positions are wall-clock
// minutes from midnight in the person's zone, so a 10:00 meeting sits on the
// 10:00 line even on a 23- or 25-hour day.

import { addDays, daysBetween, toUTC } from './gantt';
import type { CalendarEvent } from './calendarEvents';

export type CalendarView = 'day' | 'week' | 'month';

const DAY_MIN = 24 * 60;
const parts = new Map<string, Intl.DateTimeFormat>();
function fmt(zone: string) {
  let f = parts.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    parts.set(zone, f);
  }
  return f;
}
function wall(ms: number, zone: string) {
  const p = Object.fromEntries(fmt(zone).formatToParts(ms).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/** The calendar day an instant falls on, in `zone`. */
export const dayIn = (ms: number, zone: string): string => wall(ms, zone).day;

/** The instant `day` begins in `zone`. */
export function startOfDay(day: string, zone: string): number {
  const guess = toUTC(day);
  // Wall clock read as if it were UTC, minus the instant: the zone's offset then.
  const offset = (ms: number) => { const w = wall(ms, zone); return toUTC(w.day) + w.minutes * 60_000 - Math.floor(ms / 60_000) * 60_000; };
  const first = guess - offset(guess);
  const r = guess - offset(first);
  // Where midnight never happens (a spring-forward at 00:00), that lands an hour early, on the
  // day before: move on by the jump to the first instant the day has.
  return dayIn(r, zone) < day ? r + offset(r + 6 * 3600_000) - offset(r) : r;
}

const weekStart = (day: string, weekStartsOn: number) =>
  addDays(day, -((new Date(toUTC(day)).getUTCDay() - weekStartsOn + 7) % 7));

/** 42 days (six weeks) covering the month `anchor` is in. */
export function monthCells(anchor: string, weekStartsOn = 1): string[] {
  const first = weekStart(`${anchor.slice(0, 8)}01`, weekStartsOn);
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/** The visible range, `to` exclusive. */
export function rangeFor(view: CalendarView, anchor: string, weekStartsOn = 1): { from: string; to: string } {
  if (view === 'day') return { from: anchor, to: addDays(anchor, 1) };
  if (view === 'week') { const from = weekStart(anchor, weekStartsOn); return { from, to: addDays(from, 7) }; }
  const cells = monthCells(anchor, weekStartsOn);
  return { from: cells[0], to: addDays(cells[41], 1) };
}

export const daysIn = (from: string, to: string): string[] =>
  Array.from({ length: Math.max(0, daysBetween(from, to)) }, (_, i) => addDays(from, i));

export interface Placed { event: CalendarEvent; top: number; height: number; col: number; cols: number }

/** Timed events on `day`, clipped to it, overlaps split into equal columns. */
export function positionTimed(events: CalendarEvent[], day: string, zone: string): Placed[] {
  const dayStart = startOfDay(day, zone);
  const dayEnd = startOfDay(addDays(day, 1), zone);
  const items = events
    .filter((e) => !e.allDay && e.start && e.end)
    .map((e) => ({ e, s: Date.parse(e.start!), t: Date.parse(e.end!) }))
    .filter(({ s, t }) => s < dayEnd && t > dayStart && t >= s)
    .sort((a, b) => a.s - b.s || b.t - a.t);
  const out: Placed[] = [];
  // Clusters: runs of events chained by overlap. Each takes the columns its widest moment needs.
  let cluster: { p: Placed; t: number }[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.p.col + 1));
    for (const c of cluster) out.push({ ...c.p, cols });
    cluster = [];
  };
  for (const { e, s, t } of items) {
    if (s >= clusterEnd) flush();
    const top = s <= dayStart ? 0 : wall(s, zone).minutes;
    const bottom = t >= dayEnd ? DAY_MIN : wall(t, zone).minutes;
    // First column whose last event has ended.
    let col = 0;
    while (cluster.some((c) => c.p.col === col && c.t > s)) col++;
    cluster.push({ p: { event: e, top, height: Math.max(0, bottom - top), col, cols: 1 }, t });
    clusterEnd = Math.max(clusterEnd, t);
  }
  flush();
  return out;
}

export interface Lane { event: CalendarEvent; col: number; span: number; lane: number }

/** All-day events as bars over `days` (consecutive), stacked into lanes. */
export function allDayLanes(events: CalendarEvent[], days: string[]): Lane[] {
  if (!days.length) return [];
  const first = days[0];
  const last = days[days.length - 1];
  const items = events
    .filter((e) => e.allDay && e.start)
    .map((e) => {
      const from = e.start!.slice(0, 10);
      const end = e.end ? e.end.slice(0, 10) : addDays(from, 1);
      return { e, from, to: end > from ? addDays(end, -1) : from }; // inclusive last day
    })
    .filter(({ from, to }) => to >= first && from <= last)
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : daysBetween(b.from, b.to) - daysBetween(a.from, a.to)));
  const lanes: number[][] = []; // per lane, occupied columns
  return items.map(({ e, from, to }) => {
    const col = from < first ? 0 : daysBetween(first, from);
    const span = daysBetween(from < first ? first : from, to > last ? last : to) + 1;
    let lane = 0;
    while (lanes[lane]?.some((c) => c >= col && c < col + span)) lane++;
    (lanes[lane] ??= []).push(...Array.from({ length: span }, (_, i) => col + i));
    return { event: e, col, span, lane };
  });
}

/** Where the current-time line sits: wall-clock minutes in the person's zone. */
export const nowLineTop = (nowMs: number, zone: string): number => wall(nowMs, zone).minutes;
