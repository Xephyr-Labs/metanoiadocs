// Home "Needs you", end to end: API counts and contents, then the browser. Stack from run.sh.
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8093';
const PW = 'homeneeds-1';
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: threw`, false, String(e?.message || e).slice(0, 400)); } };

function client() {
  const s = { cookie: '' };
  s.raw = async (method, path, body) => {
    const r = await fetch(BASE + path, {
      method, redirect: 'manual',
      headers: { 'content-type': 'application/json', ...(s.cookie ? { cookie: s.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.getSetCookie?.() ?? [];
    if (set.length) s.cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await r.text();
    let json = text;
    try { json = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
    return { status: r.status, json };
  };
  s.call = async (method, path, body) => {
    const r = await s.raw(method, path, body);
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    return r.json;
  };
  s.get = (p) => s.call('GET', p);
  s.post = (p, b) => s.call('POST', p, b ?? {});
  return s;
}

// Changed ignores saves in a page's first minute (the skeleton seed); age each
// seeded page past that rather than wait it out.
const age = (id) => execFileSync('docker', ['exec', 'mdocs-homeneeds-db-1', 'psql', '-U', 'metanoia', '-d', 'metanoiadocs', '-qc',
  `UPDATE docs SET created_at = created_at - interval '2 minutes' WHERE id = '${id}'`]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const a = client(); const b = client();
const needs = () => a.get('/api/home/needs');
let P; let Q; let R; let t1; let t2; let t3; let thread; let sid; let n0;

await step('seed', async () => {
  await a.post('/api/setup', { name: 'Alice', username: 'alice', email: 'alice@example.com', password: PW });
  await a.post('/api/auth/login', { username: 'alice', password: PW });
  await a.post('/api/invites', { email: 'bob@example.com' });
  await b.post('/api/auth/register', { name: 'Bob', username: 'bob', email: 'bob@example.com', password: PW });
  await a.call('PATCH', '/api/me', { timezone: 'UTC' });

  P = (await a.post('/api/docs', { title: 'Team plan', content: 'First line.' })).id;
  age(P);
  await a.post(`/api/docs/${P}/opened`);                 // A has looked at P ...
  await sleep(1100);
  await b.post(`/api/docs/${P}/content`, { markdown: 'Bob added a line.', mode: 'append' }); // ... then Bob edits it.
  const c = await b.post(`/api/docs/${P}/comments`, { body: '@alice can you check this?' });
  thread = c.id;
  const d = await b.post(`/api/docs/${P}/suggestions`);
  sid = d.id;
  await b.post(`/api/suggestions/${sid}/submit`, { message: 'please review' });

  // R: Bob's page, Bob edits after Alice opened it, then Alice edits it last.
  R = (await b.post('/api/docs', { title: 'Bob notes', content: 'Notes.' })).id;
  age(R);
  await a.post(`/api/docs/${R}/opened`);
  await sleep(1100);
  await b.post(`/api/docs/${R}/content`, { markdown: 'Bob line.', mode: 'append' });
  await sleep(1100);
  await a.post(`/api/docs/${R}/content`, { markdown: 'Alice line.', mode: 'append' });

  const proj = await a.post('/api/projects', { name: 'Launch' });
  const { today } = await needs();
  const me = await a.get('/api/me');
  const mk = (title, dueAt) => a.post('/api/tasks', { projectId: proj.id, title, dueAt, assigneeIds: [me.id] });
  t1 = (await mk('Past one', '2020-01-01')).id;
  t2 = (await mk('Past two', '2020-01-02')).id;
  t3 = (await mk('Due today', today)).id;
});

// Q: Bob's private page, shared with Alice, then taken back.
await step('private page', async () => {
  const me = await a.get('/api/me');
  Q = (await b.post('/api/docs', { title: 'Bob private', content: 'secret', visibility: 'private' })).id;
  age(Q);
  await b.post(`/api/docs/${Q}/share`, { email: 'alice@example.com' });
  await a.call('PUT', `/api/docs/${Q}/favorite`, {});
  await a.post(`/api/docs/${Q}/opened`);
  await sleep(1100);
  await b.post(`/api/docs/${Q}/content`, { markdown: 'Bob again.', mode: 'append' });
  await b.post(`/api/docs/${Q}/comments`, { body: '@alice psst' });
  const shared = await needs();
  check('shared Q: in Mentions and Changed', shared.mentions.some((m) => m.docId === Q) && shared.changed.some((d) => d.docId === Q),
    JSON.stringify({ mentions: shared.mentions, changed: shared.changed }));
  await b.call('DELETE', `/api/docs/${Q}/access/${me.id}`);
  const gone = JSON.stringify(await needs());
  check('unshared Q: gone from Mentions and Changed', !gone.includes(Q) && !gone.includes('psst'), gone.slice(0, 400));
});

await step('api', async () => {
  n0 = await needs();
  const c = n0.counts;
  check('counts: review 1, overdue 2, dueToday 1, mentions 1, changed 1', c.review === 1 && c.overdue === 2 && c.dueToday === 1 && c.mentions === 1 && c.changed === 1, JSON.stringify(c));
  check('review row is Bob\'s draft on P', n0.review[0]?.docId === P && n0.review[0]?.suggestionId === sid, JSON.stringify(n0.review));
  check('overdue lists 3 tasks, only the due-today one flagged today', n0.overdue.length === 3 && n0.overdue.filter((t) => t.today).map((t) => t.taskId).join() === t3, JSON.stringify(n0.overdue));
  check('mention is the thread on P, canResolve', n0.mentions[0]?.threadId === thread && n0.mentions[0]?.docId === P && n0.mentions[0]?.canResolve === true, JSON.stringify(n0.mentions));
  check('changed is P by Bob', n0.changed[0]?.docId === P && /bob/i.test(n0.changed[0]?.changedByName), JSON.stringify(n0.changed));
  check('my own last edit is a look: R not changed', !n0.changed.some((d) => d.docId === R), JSON.stringify(n0.changed));
  check('tomorrow is the day after today', n0.tomorrow > n0.today, `${n0.today} ${n0.tomorrow}`);
});

await step('browser', async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, timezoneId: 'UTC' });
    await ctx.addCookies(a.cookie.split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
    const p = await ctx.newPage();
    await p.goto(BASE + '/');
    const sentence = p.getByText(/^You have /).first();
    await sentence.waitFor({ timeout: 20000 });
    const expected = 'You have 2 overdue tasks, 1 task due today, 1 mention waiting, 1 suggestion to review, and 1 page changed since you looked.';
    check('summary sentence matches the counts', (await sentence.innerText()).replace(/\s+/g, ' ').trim() === expected, await sentence.innerText());
    const chip = (re) => p.getByRole('tab', { name: re });
    check('chips: Overdue 3, To review 1, Mentions 1, Changed pages 1',
      /^3\s*Overdue/.test(await chip(/Overdue/).innerText()) && /^1\s*To review/.test(await chip(/To review/).innerText())
      && /^1\s*Mentions/.test(await chip(/Mentions/).innerText()) && /^1\s*Changed pages/.test(await chip(/Changed pages/).innerText()));

    await chip(/Overdue/).click();
    const panel = p.getByRole('tabpanel');
    check('Today label present', await panel.getByText('Today', { exact: true }).count() === 1);
    await panel.getByRole('button', { name: 'Mark done' }).first().click();
    await p.waitForFunction(() => /^2\s*Overdue/.test([...document.querySelectorAll('[role=tab]')].find((e) => /Overdue/.test(e.textContent))?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
    const afterDone = await needs();
    check('Mark done: task gone, overdue chip 2', afterDone.overdue.length === 2 && !afterDone.overdue.some((t) => t.taskId === t1) && afterDone.counts.overdue === 1, JSON.stringify(afterDone.counts));
    check('Mark done: chip in browser reads 2', /^2\s*Overdue/.test(await chip(/Overdue/).innerText()), await chip(/Overdue/).innerText());

    // Tomorrow on the due-today row.
    await panel.locator('div', { has: p.getByText('Today', { exact: true }) }).last().getByRole('button', { name: 'Tomorrow' }).click();
    await p.waitForTimeout(1500);
    const afterTom = await needs();
    const task3 = await a.get(`/api/tasks/${t3}`).catch(() => null);
    const due3 = task3 ? String(task3.due_at ?? task3.dueAt).slice(0, 10) : null;
    check('Tomorrow: due-today task left the list, dueToday 0', !afterTom.overdue.some((t) => t.taskId === t3) && afterTom.counts.dueToday === 0, JSON.stringify(afterTom.counts));
    check('Tomorrow: due date equals the response tomorrow', due3 === n0.tomorrow, `${due3} vs ${n0.tomorrow}`);

    await chip(/Mentions/).click();
    await panel.getByRole('button', { name: 'Resolve' }).click();
    await p.waitForTimeout(1500);
    const afterRes = await needs();
    check('Resolve removes the mention', afterRes.counts.mentions === 0 && afterRes.mentions.length === 0, JSON.stringify(afterRes.counts));

    await chip(/To review/).click();
    await panel.getByRole('button', { name: 'Review' }).click();
    await p.getByRole('button', { name: /^(Back to the page|Close)$/ }).first().waitFor({ timeout: 15000 });
    check('Review opens the review screen on P', p.url().includes(P), p.url());
  } finally { await browser.close(); }
});

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
