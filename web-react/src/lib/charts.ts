/**
 * The arithmetic behind the dashboard, kept out of the drawing.
 *
 * Pure and separately tested for the same reason `gantt.ts` is: a chart cannot
 * look wrong. A bar that is 12% too short renders perfectly, and the only thing
 * that catches it is a test on the numbers that produced it.
 *
 * Every date here is a YYYY-MM-DD string handled as UTC (see `gantt.ts`), so a
 * sprint does not gain or lose a day for a reader east of Greenwich.
 *
 * What is deliberately missing: a cumulative flow diagram. It needs the status
 * of every task on every past day, and nothing here records a status change —
 * only `done_at`. It would have to be drawn from today's statuses projected
 * backwards, which is a picture of a history that did not happen. Burndown,
 * velocity and throughput all reduce to `done_at`, which is a fact we hold.
 */

import { addDays, daysBetween, todayISO } from './gantt';
import { STATUSES, type SprintRow, type TaskRow, type TaskStatus } from './tasksApi';

/** A task counts as its points, or as 1 when the team does not size work.
 *  Zero would make an unsized backlog burn down to nothing on day one. */
const weigh = (t: TaskRow) => (t.points == null ? 1 : t.points);

export interface Burndown {
  /** One entry per day of the sprint, inclusive of both ends. */
  days: string[];
  /** The straight line from the whole scope to zero — what "on schedule" is. */
  ideal: number[];
  /** Work still open at the end of each day. Stops at today: the future is not
   *  a flat line, it is unknown, and drawing it as one reads as "no progress". */
  actual: number[];
  /** Scope, in the same unit the two lines use. */
  total: number;
  /** True when the team sizes work, which is what the axis should say. */
  pointed: boolean;
}

/**
 * Remaining work, day by day, against the line it would follow if it were
 * spread evenly.
 *
 * Returns null when the sprint has no dates — a burndown with no horizontal
 * axis is a pair of numbers, and two numbers belong in a stat, not a chart.
 */
export function burndown(tasks: TaskRow[], sprint: SprintRow | null, today = todayISO()): Burndown | null {
  if (!sprint?.start_at || !sprint.end_at) return null;
  const start = sprint.start_at.slice(0, 10);
  const end = sprint.end_at.slice(0, 10);
  const span = daysBetween(start, end);
  if (span < 0) return null;

  const days = Array.from({ length: span + 1 }, (_, i) => addDays(start, i));
  const total = tasks.reduce((sum, t) => sum + weigh(t), 0);
  const ideal = days.map((_, i) => round(total - (total * i) / Math.max(1, span)));

  // A task burns down on the day it was finished. One finished before the
  // sprint began still counts as done on day one rather than never.
  const doneOn = new Map<string, number>();
  for (const t of tasks) {
    if (!t.done_at) continue;
    const d = t.done_at.slice(0, 10);
    doneOn.set(d, (doneOn.get(d) ?? 0) + weigh(t));
  }

  let burned = 0;
  for (const [d, w] of doneOn) if (d < start) burned += w;

  const actual: number[] = [];
  for (const d of days) {
    if (d > today) break;
    burned += doneOn.get(d) ?? 0;
    actual.push(round(total - burned));
  }

  return { days, ideal, actual, total, pointed: tasks.some((t) => t.points != null) };
}

export interface VelocityBar {
  id: string;
  name: string;
  /** Points finished. Falls back to the task count when nothing is sized. */
  done: number;
}

/**
 * What the team actually finished, sprint by sprint.
 *
 * Planned and in-flight sprints are left out: a sprint two days in has finished
 * almost nothing, and a short bar beside finished ones reads as a collapse in
 * output rather than as a sprint that is still running.
 *
 * Finished, not committed: closing a sprint moves its unfinished tasks back to
 * the backlog (see the sprint PATCH in server/src/tasks.js), so a completed
 * sprint's scope and its output are the same number. A bar drawn as "18 of 20"
 * would read as 18 of 18 every time, which says nothing while looking like it
 * says something.
 */
export function velocity(sprints: SprintRow[]): VelocityBar[] {
  return sprints
    .filter((s) => s.state === 'done')
    .map((s) => {
      const pts = Number(s.points) || 0;
      return {
        id: s.id,
        name: s.name,
        // An unsized sprint counts tasks; points of 0 means nobody sized it,
        // not that nothing was done.
        done: pts > 0 ? Number(s.points_done) || 0 : Number(s.done) || 0,
      };
    });
}

export interface ThroughputWeek {
  /** The Monday the week starts on. */
  week: string;
  count: number;
}

/**
 * Tasks finished per week, most recent last.
 *
 * Weeks with nothing in them are kept: the gaps are the point, and a chart that
 * drops them turns a stop-start month into a smooth climb.
 */
export function throughput(tasks: TaskRow[], weeks = 8, today = todayISO()): ThroughputWeek[] {
  const thisMonday = mondayOf(today);
  const buckets = Array.from({ length: weeks }, (_, i) => ({
    week: addDays(thisMonday, (i - weeks + 1) * 7),
    count: 0,
  }));
  const first = buckets[0].week;
  for (const t of tasks) {
    if (!t.done_at) continue;
    const m = mondayOf(t.done_at.slice(0, 10));
    if (m < first || m > thisMonday) continue;
    buckets[daysBetween(first, m) / 7].count += 1;
  }
  return buckets;
}

export interface WorkloadRow {
  id: string;
  name: string;
  /** Hours estimated across their open tasks. */
  hours: number;
  /** How many of those tasks carry no estimate — the honest caveat on the bar. */
  unsized: number;
  count: number;
}

/**
 * Open work per person, in hours.
 *
 * The question points cannot answer. Points size a sprint against the team's
 * own history; hours size a week against the number of hours in one, and
 * "is anyone carrying too much" is a question about the week.
 *
 * Done tasks are out: this is what is still coming, not what happened. A task
 * with several assignees counts once for each of them — it is on all their
 * plates, and splitting the hours would invent a division of labour the
 * database does not know about.
 *
 * `unsized` rides along rather than being hidden, because a person with four
 * unestimated tasks and a 2-hour bar is the case this chart would otherwise
 * quietly get wrong.
 */
export function workload(tasks: TaskRow[]): WorkloadRow[] {
  const by = new Map<string, WorkloadRow>();
  for (const t of tasks) {
    if (t.status === 'done') continue;
    const people = t.assignees?.length
      ? t.assignees.map((a) => ({ id: a.id, name: a.name || 'Someone' }))
      : [{ id: '', name: 'Unassigned' }];
    for (const p of people) {
      const row = by.get(p.id) ?? { id: p.id, name: p.name, hours: 0, unsized: 0, count: 0 };
      row.count += 1;
      if (t.estimate_h == null) row.unsized += 1;
      else row.hours += Number(t.estimate_h) || 0;
      by.set(p.id, row);
    }
  }
  return [...by.values()]
    // Heaviest first: the reason to open this is to find who is buried.
    // Unassigned sinks to the bottom whatever it holds — it is a pile, not a
    // person, and it should not be what the eye lands on.
    .sort((a, b) => (a.id === '' ? 1 : b.id === '' ? -1 : 0)
      || b.hours - a.hours || b.count - a.count || a.name.localeCompare(b.name));
}

/** Counts by status, in the order the board shows them. */
export function statusMix(tasks: TaskRow[]): { status: TaskStatus; count: number }[] {
  return STATUSES.map((status) => ({ status, count: tasks.filter((t) => t.status === status).length }));
}

/** The Monday of the week an ISO date falls in. */
export function mondayOf(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

/**
 * Points for one line of a chart, scaled into a box.
 *
 * `max` is passed in rather than taken from `values` so two lines in the same
 * chart share one scale — computing it per line would draw a burndown whose
 * ideal and actual both end at the bottom regardless of what happened.
 */
export function linePoints(values: number[], max: number, w: number, h: number, steps: number): string {
  const span = Math.max(1, steps - 1);
  const top = Math.max(1, max);
  return values
    .map((v, i) => `${round((i / span) * w)},${round(h - (v / top) * h)}`)
    .join(' ');
}

const round = (n: number) => Math.round(n * 100) / 100;
