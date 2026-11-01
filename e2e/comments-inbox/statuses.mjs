// Approved and Discarded task statuses: API rules, then the board. Same stack as run.mjs, after it.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8094';
const OUT = process.env.OUT || '/tmp';
const PW = 'comments-inbox-1';
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: threw`, false, String(e?.message || e).slice(0, 400)); } };

let cookie = '';
const call = async (method, path, body) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = r.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  const text = await r.text();
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
};
await call('POST', '/api/auth/login', { username: 'alice', password: PW });

let proj;
await step('statuses via the API', async () => {
  proj = await call('POST', '/api/projects', { name: 'Statuses' });
  const mk = (title) => call('POST', '/api/tasks', { projectId: proj.id, title, dueAt: '2020-01-01' });
  const [a, d, o] = [await mk('Approved one'), await mk('Discarded one'), await mk('Still open')];
  await call('PATCH', `/api/tasks/${a.id}`, { status: 'approved' });
  await call('PATCH', `/api/tasks/${d.id}`, { status: 'discarded' });
  const got = await call('GET', `/api/tasks/${a.id}`);
  const gone = await call('GET', `/api/tasks/${d.id}`);
  check('approved is stamped finished', got.status === 'approved' && !!got.done_at, `${got.status} ${got.done_at}`);
  check('discarded is not stamped finished', gone.status === 'discarded' && !gone.done_at, `${gone.status} ${gone.done_at}`);
  const p = (await call('GET', '/api/projects')).find((x) => x.id === proj.id);
  // Three tasks all overdue by date: only the open one counts; discarded leaves the total.
  check('project counts: total 2, done 1, overdue 1', `${p.total}/${p.done}/${p.overdue}` === '2/1/1', `${p.total}/${p.done}/${p.overdue}`);
  const open = await call('GET', `/api/tasks?projectId=${proj.id}&open=1`).catch(() => null);
  if (Array.isArray(open)) check('open list leaves both out', open.length === 1 && open[0].id === o.id, String(open.length));
  const bad = await fetch(`${BASE}/api/tasks/${o.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ status: 'nope' }) });
  check('unknown status still refused', bad.status === 400, String(bad.status));
});

await step('board', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addCookies(cookie.split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/db/${proj.id}`);
  await page.waitForTimeout(3000);
  for (const label of ['Approved', 'Discarded']) {
    check(`board has a ${label} column`, (await page.getByText(new RegExp(`^${label}\\s*\\d*$`, 'i')).count()) > 0);
  }
  await page.screenshot({ path: `${OUT}/e2e-statuses-board.png` });
  check('no page errors on the board', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
});

process.exit(failed ? 1 : 0);
