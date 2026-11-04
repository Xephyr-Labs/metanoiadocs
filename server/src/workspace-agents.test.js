import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chainProblem, cleanSchedule, cleanTrigger, createDebouncer, mintRunCredential, nextRunAt,
  revokeRunCredential, runCredential, runToolLoop, ownerProblem, skillCommand, skillName,
} from './workspace-agents.js';

const iso = (ms) => new Date(ms).toISOString();

// ── schedule ─────────────────────────────────────────────────────────────────

test('a schedule is HH:MM and a set of weekdays; anything else is refused', () => {
  assert.deepEqual(cleanSchedule({ time: '9:05', days: [1, 1, 3, 9, 'x'] }), { time: '09:05', days: [1, 3] });
  assert.deepEqual(cleanSchedule({ time: '23:59' }), { time: '23:59', days: [] });
  assert.equal(cleanSchedule({ time: '24:00' }), null);
  assert.equal(cleanSchedule({ time: 'nine' }), null);
  assert.equal(cleanSchedule(null), null);
});

test('daily: today if the time is still ahead, tomorrow if it has passed', () => {
  const s = { time: '09:00', days: [] };
  assert.equal(iso(nextRunAt(s, 'UTC', Date.parse('2026-11-04T08:59:00Z'))), '2026-11-04T09:00:00.000Z');
  assert.equal(iso(nextRunAt(s, 'UTC', Date.parse('2026-11-04T09:00:00Z'))), '2026-11-05T09:00:00.000Z');
});

test('the time is read in the owner’s zone, not the server’s', () => {
  const s = { time: '09:00', days: [] };
  // 09:00 in Dhaka (UTC+6) is 03:00 UTC.
  assert.equal(iso(nextRunAt(s, 'Asia/Dhaka', Date.parse('2026-11-04T02:00:00Z'))), '2026-11-04T03:00:00.000Z');
  // Already 10:00 in Dhaka: tomorrow's.
  assert.equal(iso(nextRunAt(s, 'Asia/Dhaka', Date.parse('2026-11-04T04:00:00Z'))), '2026-11-05T03:00:00.000Z');
  // Auckland is a day ahead of UTC here: 09:00 on its 5th is 20:00 UTC on the 4th.
  assert.equal(iso(nextRunAt(s, 'Pacific/Auckland', Date.parse('2026-11-04T12:00:00Z'))), '2026-11-04T20:00:00.000Z');
});

test('weekly picks the next chosen weekday, in the owner’s calendar', () => {
  // 2026-11-04 is a Wednesday. Mondays only:
  const mon = { time: '09:00', days: [1] };
  assert.equal(iso(nextRunAt(mon, 'UTC', Date.parse('2026-11-04T12:00:00Z'))), '2026-11-09T09:00:00.000Z');
  // Monday at 08:00 → that Monday.
  assert.equal(iso(nextRunAt(mon, 'UTC', Date.parse('2026-11-09T08:00:00Z'))), '2026-11-09T09:00:00.000Z');
  // Monday after the time → next Monday.
  assert.equal(iso(nextRunAt(mon, 'UTC', Date.parse('2026-11-09T09:30:00Z'))), '2026-11-16T09:00:00.000Z');
  // Mon + Fri from a Wednesday → Friday.
  assert.equal(iso(nextRunAt({ time: '09:00', days: [1, 5] }, 'UTC', Date.parse('2026-11-04T12:00:00Z'))), '2026-11-06T09:00:00.000Z');
  // Sunday 23:00 UTC is already Monday in Dhaka, so Monday 09:00 Dhaka is 10h later.
  assert.equal(iso(nextRunAt(mon, 'Asia/Dhaka', Date.parse('2026-11-08T23:00:00Z'))), '2026-11-09T03:00:00.000Z');
});

test('09:00 stays 09:00 local across a DST change', () => {
  const s = { time: '09:00', days: [] };
  // New York leaves DST on 2026-11-01: 09:00 EDT = 13:00Z before, 09:00 EST = 14:00Z after.
  assert.equal(iso(nextRunAt(s, 'America/New_York', Date.parse('2026-10-31T14:00:00Z'))), '2026-11-01T14:00:00.000Z');
  assert.equal(iso(nextRunAt(s, 'America/New_York', Date.parse('2026-10-30T12:00:00Z'))), '2026-10-30T13:00:00.000Z');
  // And into DST on 2026-03-08: 09:00 EST = 14:00Z before, 09:00 EDT = 13:00Z on the day.
  assert.equal(iso(nextRunAt(s, 'America/New_York', Date.parse('2026-03-07T15:00:00Z'))), '2026-03-08T13:00:00.000Z');
  // A time inside the spring-forward gap (02:30 does not exist) still runs that day, not never.
  const gap = nextRunAt({ time: '02:30', days: [] }, 'America/New_York', Date.parse('2026-03-08T05:00:00Z'));
  assert.ok(gap > Date.parse('2026-03-08T05:00:00Z') && gap < Date.parse('2026-03-08T09:00:00Z'), iso(gap));
});

// ── triggers ─────────────────────────────────────────────────────────────────

test('a trigger keeps only what its kind reads', () => {
  assert.deepEqual(cleanTrigger({ kind: 'manual', time: '09:00', folderId: 'f' }), { kind: 'manual' });
  assert.deepEqual(cleanTrigger({ kind: 'schedule', time: '7:30', days: [1] }), { kind: 'schedule', time: '07:30', days: [1] });
  assert.equal(cleanTrigger({ kind: 'schedule', time: 'soon' }), null);
  assert.deepEqual(cleanTrigger({ kind: 'page_changed', folderId: 'f1', spaceId: 's' }), { kind: 'page_changed', folderId: 'f1' });
  assert.deepEqual(cleanTrigger({ kind: 'page_changed', spaceId: 's1' }), { kind: 'page_changed', spaceId: 's1' });
  assert.equal(cleanTrigger({ kind: 'page_changed' }), null, 'a page_changed trigger needs a place to watch');
  assert.equal(cleanTrigger({ kind: 'cron', expr: '* * * * *' }), null);
});

// ── debounce ─────────────────────────────────────────────────────────────────

test('a typing session fires once, after the quiet period, with the pages it touched', () => {
  const d = createDebouncer(10 * 60_000);
  const t0 = Date.parse('2026-11-04T09:00:00Z');
  d.note('agent1', 'docA', t0);
  d.note('agent1', 'docA', t0 + 4 * 60_000);
  d.note('agent1', 'docB', t0 + 8 * 60_000);
  assert.deepEqual(d.due(t0 + 15 * 60_000), [], 'still inside 10 quiet minutes of the last edit');
  const fired = d.due(t0 + 18 * 60_000);
  assert.deepEqual(fired, [{ key: 'agent1', docs: ['docA', 'docB'] }]);
  assert.deepEqual(d.due(t0 + 60 * 60_000), [], 'and only once');
});

test('each agent keeps its own quiet clock', () => {
  const d = createDebouncer(1000);
  d.note('a', 'x', 0);
  d.note('b', 'x', 900);
  assert.deepEqual(d.due(1000).map((f) => f.key), ['a']);
  assert.deepEqual(d.due(1900).map((f) => f.key), ['b']);
});

// ── agents calling agents ────────────────────────────────────────────────────

test('agents may call agents two deep, never in a loop', () => {
  assert.equal(chainProblem([], 'a'), null, 'Ask AI or a person runs an agent');
  assert.equal(chainProblem(['a'], 'b'), null, 'that agent runs another');
  assert.match(chainProblem(['a', 'b'], 'c'), /depth/);
  assert.match(chainProblem(['a'], 'a'), /itself|cycle/);
  assert.match(chainProblem(['a', 'b'], 'a'), /cycle|depth/);
});

// ── who it acts as ───────────────────────────────────────────────────────────

test('a run fails closed when its owner is gone or the agent is off', () => {
  assert.match(ownerProblem(null, { enabled: true }), /owner/);
  assert.match(ownerProblem({ id: 'u' }, { enabled: false }), /switched off/);
  assert.equal(ownerProblem({ id: 'u' }, { enabled: true }), null);
});

test('a run credential resolves only while the run lives, and only to its owner', () => {
  const now = Date.now();
  const secret = mintRunCredential({ userId: 'u1', agentId: 'a1', name: 'Weekly', chain: ['a1'] }, 60_000, now);
  assert.match(secret, /^mtr_/);
  assert.equal(runCredential(secret, now).userId, 'u1');
  assert.equal(runCredential(secret + 'x', now), null);
  assert.equal(runCredential(secret, now + 61_000), null, 'expired');
  const again = mintRunCredential({ userId: 'u1', agentId: 'a1', name: 'W', chain: [] }, 60_000, now);
  revokeRunCredential(again);
  assert.equal(runCredential(again, now), null, 'revoked when the run ends');
  assert.equal(runCredential('mtn_not-a-run', now), null);
});

// ── the loop ─────────────────────────────────────────────────────────────────

test('the loop runs tool calls, then returns the answer', async () => {
  const replies = [
    { choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_docs', arguments: '{"query":"risk"}' } }] } }] },
    { choices: [{ message: { content: 'Two open risks.' } }] },
  ];
  const seen = [];
  const out = await runToolLoop({
    create: async (body) => { seen.push(body); return replies.shift(); },
    messages: [{ role: 'user', content: 'go' }],
    specs: [{ type: 'function', function: { name: 'search_docs' } }],
    run: async (name, args) => ({ name, args }),
    maxRounds: 6,
  });
  assert.equal(out.text, 'Two open risks.');
  assert.deepEqual(out.calls, [{ name: 'search_docs', hint: 'risk' }]);
  assert.ok(seen[0].tools, 'tools offered');
  assert.equal(seen[1].messages.at(-1).role, 'tool');
});

test('the last round withholds tools, so a looping model has to answer', async () => {
  let n = 0;
  const out = await runToolLoop({
    create: async (body) => {
      n++;
      if (!body.tools) return { choices: [{ message: { content: 'done' } }] };
      return { choices: [{ message: { content: '', tool_calls: [{ id: `c${n}`, type: 'function', function: { name: 'x', arguments: '{}' } }] } }] };
    },
    messages: [],
    specs: [{ type: 'function', function: { name: 'x' } }],
    run: async () => ({ error: 'nope' }),
    maxRounds: 3,
  });
  assert.equal(out.text, 'done');
  assert.equal(n, 4);
  assert.equal(out.calls.length, 3);
  assert.equal(out.calls[0].error, 'nope');
});

test('an aborted run stops between rounds', async () => {
  const ac = new AbortController();
  await assert.rejects(runToolLoop({
    create: async () => { ac.abort(); return { choices: [{ message: { content: '', tool_calls: [{ id: 'c', type: 'function', function: { name: 'x', arguments: '{}' } }] } }] }; },
    messages: [], specs: [], run: async () => ({}), maxRounds: 6, signal: ac.signal,
  }), /timed out/);
});

// ── skills ───────────────────────────────────────────────────────────────────

test('/skill-name at the start of an Ask AI message picks a skill', () => {
  assert.deepEqual(skillCommand('/weekly-risks summarise Roadmap'), { name: 'weekly-risks', rest: 'summarise Roadmap' });
  assert.deepEqual(skillCommand('/tone'), { name: 'tone', rest: '' });
  assert.equal(skillCommand('use /tone here'), null);
  assert.equal(skillCommand('/Not_A_Skill x'), null);
  assert.equal(skillName('  Weekly Risks!! '), 'weekly-risks');
});
