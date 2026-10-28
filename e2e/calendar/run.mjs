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
const stub = async (path, body) => (await fetch(STUB + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})).json();
const lastWrite = async () => (await stub('/stats')).writes.at(-1);
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const calendarItem = (p) => p.getByRole('button', { name: 'Calendar', exact: true });
/** Connect (again) through the stub's consent screen. */
async function connect(p) {
  await p.goto(`${BASE}/api/calendar/google/connect`);
  await p.waitForURL(/calendar=(connected|error)/, { timeout: 20000 });
  return p.url();
}
/** Home, then the Calendar page from the side menu (week view at this width). */
async function openCalendarPage(p) {
  await openAndAsk(p, '/');
  const loaded = p.waitForResponse((r) => r.url().includes('/api/calendar/events?from='), { timeout: 20000 });
  await calendarItem(p).first().click();
  await loaded;
  await sleep(500);
}
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
    check('before setup: no Calendar menu item', await calendarItem(p).count() === 0);
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
  check('after setup: feature available, not connected', JSON.stringify(await a.get('/api/calendar/status')) === JSON.stringify({ available: true, connected: false, email: null, canWrite: false }));
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
    check('after connecting: Calendar menu item', await calendarItem(p).count() === 1);
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

await step('read-only grant', async () => {
  await stub('/control', { scope: 'readonly' });
  const { browser, p } = await aliceBrowser();
  try {
    check('read-only consent connects', (await connect(p)).includes('calendar=connected'), p.url());
    const st = await a.get('/api/calendar/status');
    check('status: connected, cannot write', st.connected === true && st.canWrite === false, JSON.stringify(st));
    await openCalendarPage(p);
    check('Calendar page shows the meetings', await p.getByText('Launch sync').count() > 0);
    check('Calendar page has the reconnect line', await p.getByText('Reconnect your calendar to send and answer invites').count() === 1);
    check('New meeting is disabled', await p.getByRole('button', { name: 'New meeting' }).first().isDisabled());
  } finally { await browser.close(); }
  const writes = [
    await a.raw('POST', '/api/calendar/events', { title: 'Nope', start: `${day(2)}T10:00:00Z`, end: `${day(2)}T10:30:00Z`, attendees: [] }),
    await a.raw('PATCH', '/api/calendar/events/own1', { title: 'Nope' }),
    await a.raw('POST', '/api/calendar/events/evt1/respond', { response: 'declined' }),
    await a.raw('DELETE', '/api/calendar/events/own1'),
  ];
  check('every write route says 409 needsWrite', writes.every((r) => r.status === 409 && r.json.needsWrite === true), JSON.stringify(writes.map((r) => [r.status, r.json])));
  check('Google changed nothing', (await stub('/stats')).writes.length === 0);
  check('status still cannot write', (await a.get('/api/calendar/status')).canWrite === false);
});

let newId;
await step('reconnect with write: create, edit, respond', async () => {
  await stub('/control', { scope: 'write' });
  const { browser, p } = await aliceBrowser();
  try {
    check('write consent connects', (await connect(p)).includes('calendar=connected'), p.url());
  } finally { await browser.close(); }
  check('status: can write', (await a.get('/api/calendar/status')).canWrite === true);

  const made = await a.raw('POST', '/api/calendar/events', {
    title: 'Roadmap review', start: `${day(1)}T15:00:00Z`, end: `${day(1)}T15:30:00Z`,
    attendees: ['Bob@Example.com', 'guest@partner.org'], meet: true, description: 'Agenda',
  });
  newId = made.json.id;
  check('create 201 with the Google id', made.status === 201 && !!newId, JSON.stringify(made));
  let w = await lastWrite();
  check('Google got an insert with sendUpdates=all, Meet and the attendee emails', w?.method === 'POST' && w.query.sendUpdates === 'all'
    && w.query.conferenceDataVersion === '1' && JSON.stringify(w.body.attendees) === JSON.stringify([{ email: 'bob@example.com' }, { email: 'guest@partner.org' }])
    && !!w.body.conferenceData?.createRequest, JSON.stringify(w));

  const week = async (extra = '') => (await a.get(`/api/calendar/events?from=${day(0)}&to=${day(7)}${extra}`)).events;
  let ev = await week();
  const ids = ev.map((e) => e.id);
  check('range lists every page (stub pages by 3)', ['evt1', 'own1', newId].every((x) => ids.includes(x)) && ids.some((x) => x.startsWith('standup_'))
    && (await stub('/stats')).lists >= 2, JSON.stringify(ids));
  check('range hides declined unless asked', !ids.includes('declined1')
    && (await week('&declined=1')).find((e) => e.id === 'declined1')?.myResponse === 'declined');
  const mine = ev.find((e) => e.id === newId);
  check('the new meeting is Alice\'s, with a Meet link', mine?.organizerSelf === true && mine.hasMeet === true && /^https:/.test(mine.meetLink || ''), JSON.stringify(mine));
  check('a recurring instance carries its series', ev.find((e) => e.id.startsWith('standup_'))?.recurringEventId === 'standup');

  const edited = await a.raw('PATCH', `/api/calendar/events/${newId}`, { title: 'Roadmap review (moved)', start: `${day(1)}T16:00:00Z`, end: `${day(1)}T16:45:00Z` });
  w = await lastWrite();
  check('edit 200, sent with sendUpdates=all', edited.status === 200 && w?.method === 'PATCH' && w.path.endsWith(`/${newId}`)
    && w.query.sendUpdates === 'all' && w.body.summary === 'Roadmap review (moved)', JSON.stringify([edited, w]));
  check('the edit shows in the range', (await week()).find((e) => e.id === newId)?.title === 'Roadmap review (moved)');

  const ans = await a.raw('POST', '/api/calendar/events/evt1/respond', { response: 'tentative' });
  w = await lastWrite();
  check('respond 200: only your own answer, attendeesOmitted', ans.status === 200 && w?.method === 'PATCH' && w.path.endsWith('/evt1') && w.query.sendUpdates === 'all'
    && JSON.stringify(w.body) === JSON.stringify({ attendeesOmitted: true, attendees: [{ email: 'alice@example.com', responseStatus: 'tentative' }] }), JSON.stringify([ans, w]));
  const evt1 = (await week()).find((e) => e.id === 'evt1');
  check('only Alice\'s response changed', evt1?.myResponse === 'tentative'
    && JSON.stringify(evt1.attendees.map((x) => x.response)) === JSON.stringify(['tentative', 'accepted', 'needsAction']), JSON.stringify(evt1?.attendees));
  const standup = ev.find((e) => e.id.startsWith('standup_')).id;
  check('respond works on a recurring instance', (await a.raw('POST', `/api/calendar/events/${standup}/respond`, { response: 'accepted' })).status === 200);

  const before = (await stub('/stats')).writes.length;
  const hijack = [await a.raw('PATCH', '/api/calendar/events/evt1', { title: 'Mine now' }), await a.raw('DELETE', '/api/calendar/events/evt1')];
  check("non-organiser edit and cancel: 403", hijack.every((r) => r.status === 403), JSON.stringify(hijack.map((r) => r.status)));
  check('Google got no write for them', (await stub('/stats')).writes.length === before);
});

await step('Calendar page and Home with write access (browser)', async () => {
  const { browser, p } = await aliceBrowser();
  try {
    await openCalendarPage(p);
    check('no reconnect line', await p.getByText('Reconnect your calendar to send and answer invites').count() === 0);
    check('New meeting is enabled', !(await p.getByRole('button', { name: 'New meeting' }).first().isDisabled()));
    const declined = p.getByText('Budget review').first();
    await declined.waitFor({ timeout: 10000 });
    check('declined meeting is on the Calendar page, struck through', await declined.evaluate((el) => {
      for (let n = el; n; n = n.parentElement) if (getComputedStyle(n).textDecorationLine.includes('line-through')) return true;
      return false;
    }));

    await openAndAsk(p, '/');
    await p.getByText('Launch sync').first().waitFor({ timeout: 20000 });
    check('declined meeting is not on the Home card', await p.getByText('Budget review').count() === 0);
    await p.getByRole('heading', { name: 'Activity' }).waitFor({ timeout: 20000 });
    const order = await p.evaluate(() => {
      const overview = [...document.querySelectorAll('p')].find((x) => /^(You have|You're all caught up)/.test(x.textContent.trim()));
      const nodes = [...document.querySelectorAll('h2')].concat(overview ? [overview] : [])
        .sort((x, y) => (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      return nodes.map((x) => (x === overview ? 'Overview' : x.textContent.trim()));
    });
    const want = ['Overview', "Today's meetings", 'Jump back in', 'My tasks', 'My documents', 'Activity'];
    check('Home order: Overview, meetings, Jump back in, tasks | documents, Activity', JSON.stringify(order.filter((x) => want.includes(x))) === JSON.stringify(want), JSON.stringify(order));
    check('Home has no Projects heading', !order.includes('Projects'), JSON.stringify(order));
    const [t, d] = await Promise.all(['My tasks', 'My documents'].map(async (n) => p.getByRole('heading', { name: n }).boundingBox()));
    check('My tasks and My documents side by side', !!t && !!d && Math.abs(t.y - d.y) < 4 && d.x > t.x, JSON.stringify([t, d]));
  } finally { await browser.close(); }
});

await step('cancel', async () => {
  const r = await a.raw('DELETE', `/api/calendar/events/${newId}`);
  const w = await lastWrite();
  check('cancel 204, sent with sendUpdates=all', r.status === 204 && w?.method === 'DELETE' && w.path.endsWith(`/${newId}`) && w.query.sendUpdates === 'all', JSON.stringify([r.status, w]));
  check('the cancelled meeting is gone from the range', !(await a.get(`/api/calendar/events?from=${day(0)}&to=${day(7)}`)).events.some((e) => e.id === newId));
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
