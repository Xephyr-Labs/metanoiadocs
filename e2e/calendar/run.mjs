// Google Calendar connector, end to end against the Google stub. Stack from run.sh.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8095';
const STUB = process.env.STUB || 'http://localhost:8101';
const PW = 'calendar-1';
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

const a = client(); const b = client();

/** A browser signed in as Alice. */
async function aliceBrowser() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, timezoneId: 'UTC' });
  await ctx.addCookies(a.cookie.split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
  return { browser, p: await ctx.newPage() };
}
/** Open `path` and wait for the calendar status the page asks for. */
async function openAndAsk(p, path) {
  const asked = p.waitForResponse((r) => r.url().includes('/api/calendar/status'), { timeout: 20000 });
  await p.goto(`${BASE}${path}`);
  await asked;
  await sleep(300); // let React render what the answer says
}
/** The page's ⋯ menu entries for tasks, with Copy link as proof the menu opened. */
async function pageMenu(p, id) {
  await openAndAsk(p, `/d/${id}`);
  await p.getByRole('button', { name: 'More' }).first().click();
  await p.getByText('Copy link', { exact: true }).waitFor({ timeout: 10000 });
  const has = async (t) => (await p.getByText(t, { exact: true }).count()) > 0;
  const out = { make: await has('Make tasks from to-dos'), suggest: await has('Suggest tasks (Ask AI)') };
  await p.keyboard.press('Escape');
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bobId; let aliceId; let docId; let proj; let plainId;

await step('admin setup', async () => {
  await a.post('/api/setup', { name: 'Alice', username: 'alice', email: 'alice@example.com', password: PW });
  await a.post('/api/auth/login', { username: 'alice', password: PW });
  await a.post('/api/invites', { email: 'bob@example.com' });
  await b.post('/api/auth/register', { name: 'Bob', username: 'bob', email: 'bob@example.com', password: PW });
  await a.call('PATCH', '/api/me', { timezone: 'UTC' });
  aliceId = (await a.get('/api/me')).id;
  bobId = (await b.get('/api/me')).id;

  check('before setup: feature off', (await a.get('/api/calendar/status')).available === false);
  // Ask AI points at the stub's OpenAI-compatible endpoint. Set first, so the off check below proves the calendar gate.
  await a.call('PUT', '/api/settings/ai', { baseUrl: 'http://gstub:8080/v1', apiKey: 'k', model: 'stub', enabled: true });
  plainId = (await a.post('/api/docs', { title: 'Plain page' })).id;
  for (const r of [
    await a.raw('POST', `/api/docs/${plainId}/make-tasks`, { projectId: 'x' }),
    await a.raw('POST', `/api/docs/${plainId}/suggest-tasks`, {}),
    await a.raw('POST', `/api/docs/${plainId}/tasks-from-proposals`, { projectId: 'x', items: [{ title: 't' }] }),
  ]) check('before setup: task routes 404', r.status === 404, String(r.status));
  const { browser, p } = await aliceBrowser();
  try {
    await openAndAsk(p, '/');
    await p.getByRole('button', { name: 'New page' }).first().waitFor({ timeout: 20000 });
    check('before setup: Home has no meetings card', await p.getByText("Today's meetings").count() === 0
      && await p.getByText('Connect your calendar').count() === 0);
    const m = await pageMenu(p, plainId);
    check('before setup: page menu has neither task entry', !m.make && !m.suggest, JSON.stringify(m));
  } finally { await browser.close(); }

  const s = await a.get('/api/settings/calendar');
  check('settings show the redirect URI and the key', s.redirectUri === `${BASE}/api/calendar/google/callback` && s.keySet === true, JSON.stringify(s));
  const denied = await b.raw('PUT', '/api/settings/calendar', { enabled: true });
  check('non-admin cannot configure', denied.status === 403, String(denied.status));
  await a.call('PUT', '/api/settings/calendar', { enabled: true, clientId: 'stub-client', clientSecret: 'stub-secret' });
  check('after setup: feature available, not connected', JSON.stringify(await a.get('/api/calendar/status')) === JSON.stringify({ available: true, connected: false, email: null }));
  check('before connecting: no events', (await a.get('/api/calendar/events')).connected === false);

  proj = await a.post('/api/projects', { name: 'Launch' });
});

await step('connect + Home (browser)', async () => {
  const { browser, p } = await aliceBrowser();
  try {
    // connect -> stub auth -> callback -> token -> back to the app
    await p.goto(`${BASE}/api/calendar/google/connect`);
    await p.waitForURL(/calendar=(connected|error)/, { timeout: 20000 });
    check('authorize redirect lands on ?calendar=connected', p.url().includes('calendar=connected'), p.url());
    const st = await a.get('/api/calendar/status');
    check('status: connected as the Google address', st.connected === true && st.email === 'alice@example.com', JSON.stringify(st));
    check('stub saw one code exchange', (await (await fetch(`${STUB}/stats`)).json()).tokens === 1);

    const ev = await a.get('/api/calendar/events');
    check('events: the stubbed meeting, attendees mapped', ev.events.length === 1 && ev.events[0].title === 'Launch sync'
      && ev.events[0].meetLink === 'https://meet.example.com/abc'
      && ev.events[0].attendees.find((x) => x.email === 'bob@example.com')?.userId === bobId
      && ev.events[0].attendees.find((x) => x.email === 'outsider@elsewhere.org')?.userId === null, JSON.stringify(ev).slice(0, 300));
    check('no token in any response', !JSON.stringify([st, ev]).includes('stub-refresh'));

    await p.goto(`${BASE}/`);
    await p.getByText('Launch sync').first().waitFor({ timeout: 20000 });
    check('Home shows the meeting card with Start notes', await p.getByRole('button', { name: 'Start notes' }).count() === 1);
    const m = await pageMenu(p, plainId);
    check('after setup: page menu has both task entries', m.make && m.suggest, JSON.stringify(m));
  } finally { await browser.close(); }
});

await step('start notes', async () => {
  const r1 = await a.post('/api/calendar/events/evt1/notes');
  docId = r1.docId;
  check('first Start notes creates a page', r1.created === true && !!docId, JSON.stringify(r1));
  const r2 = await a.post('/api/calendar/events/evt1/notes');
  check('second Start notes opens the same page', r2.created === false && r2.docId === docId, JSON.stringify(r2));
  const md = await a.get(`/api/docs/${docId}/markdown`);
  check('page names the meeting and the teammate', /Launch sync/.test(JSON.stringify(md)) && /Bob/.test(JSON.stringify(md)));
  const other = await b.raw('GET', `/api/docs/${docId}/markdown`);
  check("another person can't open the private notes page", other.status === 403 || other.status === 404, String(other.status));
  const bobEvents = await b.get('/api/calendar/events');
  check("another person sees none of Alice's events", bobEvents.connected === false && bobEvents.events.length === 0);
  const home = await a.get('/api/calendar/events');
  check('the event now points at its notes page', home.events[0].notesDocId === docId);
});

await step('make tasks', async () => {
  await a.post(`/api/docs/${docId}/content`, { markdown: '- [ ] @bob send deck by friday\n- [ ] @alice check numbers tomorrow', mode: 'append' });
  const r = await a.post(`/api/docs/${docId}/make-tasks`, { projectId: proj.id });
  check('make-tasks created 2', r.created?.length === 2, JSON.stringify(r));
  const tasks = await a.get(`/api/projects/${proj.id}/tasks`);
  const send = tasks.find((t) => /send deck/.test(t.title));
  const check2 = tasks.find((t) => /check numbers/.test(t.title));
  check('tasks carry assignee and date', tasks.length === 2
    && send?.assignees?.some((x) => x.id === bobId || x.user_id === bobId || x.userId === bobId) && !!send?.due_at
    && check2?.assignees?.some((x) => x.id === aliceId || x.user_id === aliceId || x.userId === aliceId) && !!check2?.due_at,
  JSON.stringify(tasks.map((t) => [t.title, t.due_at, t.assignees])).slice(0, 400));
  const md = JSON.stringify(await a.get(`/api/docs/${docId}/markdown`));
  check('lines are linked to their tasks', md.includes(`/db/${proj.id}`) || md.includes(send.id), md.slice(0, 300));
  const again = await a.post(`/api/docs/${docId}/make-tasks`, { projectId: proj.id });
  check('re-run creates 0', again.created?.length === 0, JSON.stringify(again));
  check('still 2 tasks', (await a.get(`/api/projects/${proj.id}/tasks`)).length === 2);
});

await step('suggest tasks', async () => {
  const before = (await a.get(`/api/projects/${proj.id}/tasks`)).length;
  const r = await a.post(`/api/docs/${docId}/suggest-tasks`, {});
  check('suggest returns proposals', r.proposals?.length === 2 && r.proposals[0].assignee === 'bob', JSON.stringify(r));
  check('suggest creates nothing', (await a.get(`/api/projects/${proj.id}/tasks`)).length === before);
  const made = await a.post(`/api/docs/${docId}/tasks-from-proposals`, {
    projectId: proj.id, items: [{ title: r.proposals[0].title, dueAt: r.proposals[0].dueAt, assigneeIds: [bobId] }],
  });
  check('accepting one creates exactly one task', made.created?.length === 1, JSON.stringify(made));
  const tasks = await a.get(`/api/projects/${proj.id}/tasks`);
  check('project now has before+1 tasks', tasks.length === before + 1);
  const md = JSON.stringify(await a.get(`/api/docs/${docId}/markdown`));
  check('notes page has the "Tasks from this meeting" link', md.includes('Tasks from this meeting') && md.includes('Share the Q3 numbers'), md.slice(-300));
});

await step('disconnect', async () => {
  const r = await a.raw('DELETE', '/api/calendar/google');
  check('disconnect 204', r.status === 204, String(r.status));
  const ev = await a.get('/api/calendar/events');
  check('events: connected false, none', ev.connected === false && ev.events.length === 0, JSON.stringify(ev));
  check('status: not connected', (await a.get('/api/calendar/status')).connected === false);
  check('Google was asked to revoke', (await (await fetch(`${STUB}/stats`)).json()).revokes >= 1);
});

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
