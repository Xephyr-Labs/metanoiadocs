// Spaces, end to end: the API and the browser against a fresh stack (run.sh).
// Three people: Maya (first-run setup, admin), Sam (invite + register) and
// Cara (magic link), who joins nothing but General.
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8099';
const PROJECT = process.env.PROJECT || 'mdocs-spaces';
const PW = 'spaces-test-1';
const OWNED = 'Move the database instead';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
// One numbered brief check; a throw inside it is that check's FAIL, not the run's end.
const step = async (name, fn) => {
  try { await fn(); } catch (e) { check(`${name}: threw`, false, String(e?.message || e).slice(0, 300)); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const sql = (q) => execFileSync('docker', ['exec', `${PROJECT}-db-1`, 'psql', '-U', 'metanoia', '-d', 'metanoiadocs', '-At', '-F', '|', '-c', q]).toString().trim();
const spaceOf = (table, id) => sql(`SELECT space_id FROM ${table} WHERE id = '${id}'`);

function session() {
  const s = { cookie: '' };
  // Never throws: answers { status, json }.
  s.raw = async (method, path, body) => {
    const r = await fetch(BASE + path, {
      method,
      redirect: 'manual',
      headers: { 'content-type': 'application/json', ...(s.cookie ? { cookie: s.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.getSetCookie?.() ?? [];
    if (set.length) s.cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await r.text();
    let json = text;
    try { json = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
    return { status: r.status, json, type: r.headers.get('content-type') || '' };
  };
  // Throws on a non-2xx or a non-JSON answer (main's catch-all serves index.html for /api/spaces).
  s.call = async (method, path, body) => {
    const r = await s.raw(method, path, body);
    if (r.status >= 300 || !r.type.includes('json')) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    return r.json;
  };
  s.get = (p) => s.call('GET', p);
  s.post = (p, b) => s.call('POST', p, b ?? {});
  return s;
}

const maya = session();
const sam = session();
const cara = session();
let G; let M; let users = {};
let browser;

async function open(who, path = '/', space = null) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addCookies(who.cookie.split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
  await ctx.addInitScript((sp) => {
    try {
      // The space the switcher starts in, set once per context.
      if (sp && !sessionStorage.getItem('e2e-space')) { localStorage.setItem('mn-space', sp); sessionStorage.setItem('e2e-space', '1'); }
      // No saved Tasks filter (the first visit would narrow to "assigned to me"),
      // and no folded sidebar sections (Templates starts folded).
      if (!localStorage.getItem('mn-filters-all')) localStorage.setItem('mn-filters-all', '[]');
      if (!localStorage.getItem('mn.sidebar.v1')) localStorage.setItem('mn.sidebar.v1', '{"collapsed":[]}');
    } catch { /* fine */ }
  }, space);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + path);
  await page.locator('aside').first().waitFor();
  await page.waitForTimeout(2000);
  const dialogs = [];
  // Resolves with the next window.confirm's text, accepting it.
  const nextDialog = (accept = true) => new Promise((res) => page.once('dialog', async (d) => {
    dialogs.push(d.message()); res(d.message()); await (accept ? d.accept() : d.dismiss());
  }));
  const switcher = () => page.locator('aside').getByRole('button', { name: /^Space: / }).first();
  // The switcher's current space, and the joined spaces its menu lists.
  const current = async () => ((await switcher().getAttribute('aria-label')) || '').replace(/^Space: /, '');
  const listed = async () => {
    await switcher().click();
    await page.waitForTimeout(300);
    const menu = page.getByRole('menu');
    const names = [];
    for (const n of ['General', 'Marketing', 'Archive']) if (await menu.getByText(n, { exact: true }).count()) names.push(n);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    return names;
  };
  const switchTo = async (name) => {
    await switcher().click();
    await page.waitForTimeout(300);
    await page.getByRole('menu').getByText(name, { exact: true }).click();
    await page.waitForTimeout(1500);
  };
  return { ctx, page, side: page.locator('aside'), main: page.locator('main'), errors, nextDialog, current, listed, switchTo };
}
const docsById = async (who) => Object.fromEntries((await who.get('/api/docs')).map((d) => [d.id, d]));

// ── 1. a fresh stack: one General, everything in it, backfill on boot ──────
await step('1', async () => {
  await maya.post('/api/setup', { name: 'Maya', username: 'maya', email: 'maya@example.com', password: PW });
  const spaces = await maya.get('/api/spaces');
  const g = spaces[0];
  check('1 fresh stack has exactly one space, General, joined', spaces.length === 1 && g.name === 'General' && g.is_default && g.joined && g.icon === '🏠', JSON.stringify(spaces));
  G = g.id;
  // An old client creates with no spaceId at all.
  await maya.post('/api/docs', { title: 'First page', content: 'x' });
  await maya.post('/api/folders', { name: 'First folder' });
  await maya.post('/api/projects', { name: 'First board' });
  const off = () => sql(`SELECT (SELECT count(*) FROM docs WHERE space_id IS DISTINCT FROM '${G}')
    + (SELECT count(*) FROM folders WHERE space_id IS DISTINCT FROM '${G}')
    + (SELECT count(*) FROM projects WHERE space_id IS DISTINCT FROM '${G}')`);
  const total = sql('SELECT (SELECT count(*) FROM docs) + (SELECT count(*) FROM folders) + (SELECT count(*) FROM projects)');
  check('1 every doc, folder and project has General\'s space_id', off() === '0' && Number(total) >= 3, `off=${off()} rows=${total}`);
  // Rows written before spaces existed: the boot migration files them in General.
  sql(`INSERT INTO docs (id, title) VALUES ('legacy-doc', 'Legacy page');
       INSERT INTO folders (id, name) VALUES ('legacy-folder', 'Legacy folder');
       INSERT INTO projects (id, name) VALUES ('legacy-project', 'Legacy board');
       DELETE FROM data_migrations WHERE name = '2026-10-spaces-general'`);
  execFileSync('docker', ['restart', `${PROJECT}-server-1`]);
  for (let i = 0; i < 60; i++) { if ((await fetch(`${BASE}/health`).catch(() => null))?.ok) break; await wait(1000); }
  check('1 boot migration backfills rows with no space into General',
    [spaceOf('docs', 'legacy-doc'), spaceOf('folders', 'legacy-folder'), spaceOf('projects', 'legacy-project')].every((s) => s === G) && off() === '0',
    `${spaceOf('docs', 'legacy-doc')} ${spaceOf('folders', 'legacy-folder')} ${spaceOf('projects', 'legacy-project')}`);
  sql("DELETE FROM docs WHERE id = 'legacy-doc'; DELETE FROM folders WHERE id = 'legacy-folder'; DELETE FROM projects WHERE id = 'legacy-project'");
});

// ── 2. every signup path lands in General (Review Focus 3) ─────────────────
await step('2', async () => {
  await maya.post('/api/auth/login', { username: 'maya', password: PW });
  await maya.post('/api/invites', { email: 'sam@example.com' });
  await maya.post('/api/invites', { email: 'cara@example.com' });
  await sam.post('/api/auth/register', { name: 'Sam', username: 'sam', email: 'sam@example.com', password: PW });
  // Magic link: the server writes the token to magic_tokens (and, in dev mode,
  // logs the link); read it from the DB and follow /api/auth/verify.
  await cara.post('/api/auth/request', { email: 'cara@example.com' });
  const token = sql("SELECT token FROM magic_tokens WHERE email = 'cara@example.com' AND used_at IS NULL ORDER BY expires_at DESC LIMIT 1");
  const v = await cara.raw('GET', `/api/auth/verify?token=${token}`);
  check('2 magic link signs Cara in', v.status === 302 && !!cara.cookie, `status=${v.status}`);
  for (const [label, who] of [['setup (Maya)', maya], ['invite-register (Sam)', sam], ['magic link (Cara)', cara]]) {
    const g = (await who.get('/api/spaces')).find((s) => s.is_default);
    check(`2 user from ${label} is a member of General`, g?.joined === true, JSON.stringify(g));
  }
  users = Object.fromEntries((await maya.get('/api/users')).map((u) => [u.email.split('@')[0], u.id]));
  check('2 space_members has all three in General', sql(`SELECT count(*) FROM space_members WHERE space_id = '${G}'`) === '3');
});

browser = await chromium.launch();
let mb; // Maya's browser, reused for 3–7 and the reorder check

// ── 3. Marketing with Sam; sidebars ─────────────────────────────────────────
await step('3', async () => {
  const mk = await maya.post('/api/spaces', { name: 'Marketing', icon: '📣', description: 'Campaigns', memberIds: [users.sam] });
  M = mk.id;
  const samM = (await sam.get('/api/spaces')).find((s) => s.id === M);
  check('3 Marketing created with Sam as a member', samM?.joined === true && samM.member_count === 2, JSON.stringify(samM));
  mb = await open(maya);
  check('3 Maya starts in General (the default space)', (await mb.current()) === 'General', await mb.current());
  check('3 Maya\'s switcher lists General and Marketing', (await mb.listed()).join(',') === 'General,Marketing');
  check('3 no space emoji in the sidebar', !(await mb.side.innerText()).includes('📣') && !(await mb.side.innerText()).includes('🏠'));
  const cb = await open(cara);
  check('3 Cara (joined nothing) is in General', (await cb.current()) === 'General');
  check('3 Cara\'s switcher does not list Marketing', (await cb.listed()).join(',') === 'General');
  await cb.ctx.close();
});

// ── 4. inheritance in Marketing; an old client lands in General (RF5) ───────
let board; let task; let taskPage;
await step('4', async () => {
  const before = new Set(Object.keys(await docsById(maya)));
  await mb.switchTo('Marketing');
  check('4 switching lands on Marketing\'s Home', (await mb.current()) === 'Marketing' && await mb.main.getByText('My tasks').first().isVisible());
  await mb.main.getByRole('button', { name: 'New page' }).first().click();
  await mb.page.waitForTimeout(3000);
  const fresh = Object.values(await docsById(maya)).filter((d) => !before.has(d.id));
  const plus = fresh[0];
  check('4 a new page made while in Marketing is in Marketing', fresh.length === 1 && plus.space_id === M, JSON.stringify(fresh.map((d) => [d.title, d.space_id])));
  const sub = await maya.post(`/api/docs/${plus.id}/children`, { title: 'Plus sub-page' });
  const folder = await maya.post('/api/folders', { name: 'Campaigns', spaceId: M });
  const inFolder = await maya.post('/api/docs', { title: 'Campaign brief', content: 'x', folderId: folder.id });
  board = await maya.post('/api/projects', { name: 'Launch board', spaceId: M });
  task = await maya.post('/api/tasks', { projectId: board.id, title: 'Write launch copy' });
  taskPage = (await maya.post(`/api/tasks/${task.id}/page`)).docId;
  const got = {
    'sub-page': spaceOf('docs', sub.id),
    folder: spaceOf('folders', folder.id),
    'page in folder (no spaceId sent)': spaceOf('docs', inFolder.id),
    database: spaceOf('projects', board.id),
    "task (its database's space)": sql(`SELECT p.space_id FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = '${task.id}'`),
    'task page': spaceOf('docs', taskPage),
  };
  for (const [k, v] of Object.entries(got)) check(`4 ${k} carries Marketing's space_id`, v === M, v);
  const old = await maya.post('/api/docs', { title: 'Old client page', content: 'x' });
  check('4 old-client POST /api/docs with no spaceId lands in General', spaceOf('docs', old.id) === G);
});

// ── 5. Move to space: a page, its sub-page and Sam's private sub-page (RF2) ──
await step('5', async () => {
  const roadmap = await maya.post('/api/docs', { title: 'Roadmap', content: 'x' });
  const q3 = await maya.post(`/api/docs/${roadmap.id}/children`, { title: 'Q3 goals' });
  const secret = await sam.post(`/api/docs/${roadmap.id}/children`, { title: 'Sam secret' });
  await sam.call('PUT', `/api/docs/${secret.id}/visibility`, { visibility: 'private' });
  await mb.page.reload(); await mb.page.waitForTimeout(2500);
  await mb.switchTo('General');
  const row = mb.side.getByRole('treeitem', { name: /Roadmap/ }).first();
  await row.hover();
  await row.getByRole('button', { name: 'Document actions' }).click();
  await mb.page.getByRole('menu').getByText('Move to space', { exact: true }).click();
  await mb.page.waitForTimeout(400);
  const dlg = mb.nextDialog(true);
  await mb.page.getByRole('menu').last().getByText('Marketing', { exact: true }).click();
  const msg = await Promise.race([dlg, wait(5000).then(() => null)]);
  check('5 preview says "and some pages you can\'t see"', !!msg && msg.includes('Moves 2 pages and some pages you can\'t see'), JSON.stringify(msg));
  await mb.page.waitForTimeout(1500);
  const ids = [roadmap.id, q3.id, secret.id];
  check('5 all three pages moved to Marketing', ids.every((id) => spaceOf('docs', id) === M), ids.map((id) => spaceOf('docs', id)).join(' '));
  const shape = () => sql(`SELECT string_agg(id || ':' || coalesce(parent_id,'-') || ':' || coalesce(folder_id,'-') || ':' || space_id, ',' ORDER BY id) FROM docs WHERE id IN ('${ids.join("','")}')`);
  check('5 nesting kept (both sub-pages under Roadmap)', sql(`SELECT count(*) FROM docs WHERE parent_id = '${roadmap.id}'`) === '2');
  check('5 moved out of General, Roadmap leaves General\'s sidebar', (await mb.side.getByRole('treeitem', { name: /Roadmap/ }).count()) === 0);
  await mb.switchTo('Marketing');
  // The tree as Maya sees it, Roadmap opened, before and after a reload.
  const tree = async () => {
    const r = mb.side.getByRole('treeitem', { name: /Roadmap/ }).first();
    await r.hover();
    const exp = mb.side.getByRole('button', { name: 'Expand Roadmap' });
    if (await exp.count()) { await exp.first().click(); await mb.page.waitForTimeout(300); }
    return (await mb.side.getByRole('treeitem').allInnerTexts()).map((t) => t.trim()).join(' / ');
  };
  const t1 = await tree(); const s1 = shape();
  await mb.page.reload(); await mb.page.waitForTimeout(2500);
  const t2 = await tree(); const s2 = shape();
  check('5 after a reload the tree is identical', t1 === t2 && s1 === s2 && t1.includes('Q3 goals') && t1.includes('Roadmap'), `${t1} || ${t2}`);
  const samTree = (await sam.get('/api/docs')).find((d) => d.id === secret.id);
  check('5 Sam\'s private sub-page still under Roadmap, in Marketing', samTree?.parent_id === roadmap.id && samTree.space_id === M);
});

// ── 6. one space at a time; filing a General page in a Marketing folder ────
await step('6', async () => {
  const drafts = await maya.post('/api/folders', { name: 'Drafts' });
  const brief = await maya.post('/api/docs', { title: 'Brief', content: 'x', folderId: drafts.id });
  const notes = await maya.post(`/api/docs/${brief.id}/children`, { title: 'Brief notes' });
  const campaigns = sql(`SELECT id FROM folders WHERE name = 'Campaigns'`);
  await mb.page.reload(); await mb.page.waitForTimeout(2500);
  check('6 reload keeps Maya in Marketing', (await mb.current()) === 'Marketing');
  check('6 in Marketing the sidebar shows Campaigns, not General\'s Drafts',
    await mb.side.getByRole('treeitem', { name: /Campaigns/ }).first().isVisible() && (await mb.side.getByRole('treeitem', { name: /Drafts/ }).count()) === 0);
  await mb.switchTo('General');
  check('6 in General the sidebar shows Drafts, not Marketing\'s Campaigns',
    await mb.side.getByRole('treeitem', { name: /Drafts/ }).first().isVisible() && (await mb.side.getByRole('treeitem', { name: /Campaigns/ }).count()) === 0);
  await maya.call('PATCH', `/api/docs/${brief.id}`, { folderId: campaigns });
  check('6 the page and its sub-page moved to Marketing', spaceOf('docs', brief.id) === M && spaceOf('docs', notes.id) === M);
  check('6 the page is filed in Campaigns', sql(`SELECT folder_id FROM docs WHERE id = '${brief.id}'`) === campaigns);
  check('6 the old folder link (Drafts) is cleared', sql(`SELECT count(*) FROM docs WHERE folder_id = '${drafts.id}'`) === '0');
  check('6 the sub-page is still nested', sql(`SELECT parent_id FROM docs WHERE id = '${notes.id}'`) === brief.id);
  // Opening a page from another joined space takes you into that space.
  await mb.page.goto(`${BASE}/d/${brief.id}`); await mb.page.waitForTimeout(2500);
  check('6 opening a Marketing page switches Maya to Marketing', (await mb.current()) === 'Marketing', await mb.current());
});

// ── 7. move a database ──────────────────────────────────────────────────────
await step('7', async () => {
  const ops = await maya.post('/api/projects', { name: 'Ops board' });
  const t1 = await maya.post('/api/tasks', { projectId: ops.id, title: 'Ops task with page' });
  const t1Page = (await maya.post(`/api/tasks/${t1.id}/page`)).docId;
  const linked = await maya.post('/api/docs', { title: 'Ops runbook', content: 'x' });
  const t2 = await maya.post('/api/tasks', { projectId: ops.id, title: 'Ops task with a linked page', docId: linked.id });
  check('7 the second task really links the ordinary page', sql(`SELECT doc_id FROM tasks WHERE id = '${t2.id}'`) === linked.id
    && sql(`SELECT coalesce(kind, '-') FROM docs WHERE id = '${linked.id}'`) !== 'task');
  const r = await maya.raw('POST', `/api/projects/${ops.id}/space`, { spaceId: M });
  check('7 moving the database succeeds', r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);
  check('7 the database is in Marketing', spaceOf('projects', ops.id) === M);
  check('7 its task\'s page moved with it', spaceOf('docs', t1Page) === M);
  check('7 an ordinary page linked to a task stays in General', spaceOf('docs', linked.id) === G);
});

// ── 8. a task page can't move on its own ────────────────────────────────────
await step('8', async () => {
  const r = await maya.raw('POST', `/api/docs/${taskPage}/space`, { spaceId: G });
  check('8 POST /api/docs/<task page>/space answers 409 "Move the database instead"', r.status === 409 && r.json.error === OWNED, `${r.status} ${JSON.stringify(r.json)}`);
  // The same rule for a folder that would carry a database's source page.
  const f = await maya.post('/api/folders', { name: 'Has a board page' });
  const src = await maya.post('/api/docs', { title: 'Board home', content: 'x', folderId: f.id });
  await maya.post('/api/projects', { name: 'Board on a page', docId: src.id });
  const rf = await maya.raw('POST', `/api/folders/${f.id}/space`, { spaceId: M });
  check('8 a folder carrying a database\'s page answers 409 too', rf.status === 409 && rf.json.error === OWNED && spaceOf('folders', f.id) === G, `${rf.status} ${JSON.stringify(rf.json)}`);
  check('8 the refused task page stayed put', spaceOf('docs', taskPage) === M);
});

// ── 9. assigned to me in a space I never joined (RF1) ───────────────────────
await step('9', async () => {
  const assigned = await maya.post('/api/tasks', { projectId: board.id, title: 'Cara reviews the launch', assigneeIds: [users.cara] });
  // Inbox: the web app reads GET /api/inbox; an assignment is a kind='assigned' row naming the task.
  let inbox = [];
  for (let i = 0; i < 10 && !inbox.some((n) => n.kind === 'assigned' && n.task_id === assigned.id); i++) {
    inbox = await cara.get('/api/inbox'); await wait(500);
  }
  check('9 Cara\'s Inbox has the assignment of the Marketing task', inbox.some((n) => n.kind === 'assigned' && n.task_id === assigned.id),
    JSON.stringify(inbox.map((n) => [n.kind, n.task_title])));
  const cb = await open(cara);
  await cb.side.getByRole('button', { name: /^Tasks/ }).first().click();
  await cb.page.waitForTimeout(2000);
  check('9 Cara\'s Tasks view shows the Marketing task assigned to her', await cb.main.getByText('Cara reviews the launch').first().isVisible());
  check('9 ...but not an unassigned task in Marketing', (await cb.main.getByText('Write launch copy').count()) === 0);
  await cb.side.getByRole('button', { name: /^Home/ }).first().click();
  await cb.page.waitForTimeout(2000);
  const home = await cara.get('/api/home');
  const mine = Object.values(home.myTasks).flat().map((t) => t.title);
  check('9 Home\'s My tasks lists it (API)', mine.some((t) => t.includes('Cara reviews the launch')), mine.join(','));
  check('9 Home\'s My tasks shows it (browser)', await cb.main.getByText('My tasks').first().isVisible() && await cb.main.getByText('Cara reviews the launch').first().isVisible());
  await cb.ctx.close();
});

// ── 9b. Home is the space you are in ───────────────────────────────────────
await step('9b', async () => {
  const gHome = await maya.get(`/api/home?spaceId=${G}`);
  const mHome = await maya.get(`/api/home?spaceId=${M}`);
  const space = (id) => spaceOf('docs', id);
  check('9b Home in General lists only General pages', gHome.recentDocs.length > 0 && gHome.recentDocs.every((d) => space(d.id) === G), gHome.recentDocs.map((d) => d.title).join(','));
  check('9b Home in Marketing lists only Marketing pages', mHome.recentDocs.length > 0 && mHome.recentDocs.every((d) => space(d.id) === M), mHome.recentDocs.map((d) => d.title).join(','));
  check('9b Home in General lists only General databases', gHome.projects.every((p) => spaceOf('projects', p.id) === G) && !gHome.projects.some((p) => p.name === 'Launch board'));
  check('9b Home in Marketing lists Marketing\'s database', mHome.projects.some((p) => p.name === 'Launch board'));
  check('9b activity in General has nothing from Marketing', gHome.activity.every((e) => !e.doc_id || space(e.doc_id) === G), gHome.activity.map((e) => e.title).join(','));
  const mine = await maya.get(`/api/docs/mine?limit=50&spaceId=${M}`);
  check('9b My documents in Marketing lists only Marketing pages', mine.rows.length > 0 && mine.rows.every((d) => space(d.id) === M), mine.rows.map((d) => d.title).join(','));
  const cHome = await cara.get(`/api/home?spaceId=${G}`);
  check('9b Cara\'s General Home still lists her task from unjoined Marketing', Object.values(cHome.myTasks).flat().some((t) => t.title.includes('Cara reviews the launch')));
  // The browser asks for the space it is in.
  if ((await mb.current()) === 'General') await mb.switchTo('Marketing');
  const req = mb.page.waitForRequest((r) => r.url().includes('/api/home'));
  await mb.switchTo('General');
  check('9b the browser\'s Home asks for General', (await req).url().includes(`spaceId=${G}`));
});

// ── 10. search: joined spaces first, "Other spaces" in the palette ──────────
await step('10', async () => {
  await maya.post('/api/docs', { title: 'Zebra launch notes', content: 'zebra zebra zebra campaign', spaceId: M });
  await maya.post('/api/docs', { title: 'Zebra', content: 'zebra' });
  await wait(500);
  const hits = (await cara.get('/api/search?q=zebra')).filter((h) => h.kind === 'doc');
  const gi = hits.findIndex((h) => h.space_id === G);
  const mi = hits.findIndex((h) => h.space_id === M);
  check('10 Cara\'s search lists the General hit before the Marketing hit', gi >= 0 && mi >= 0 && gi < mi, hits.map((h) => `${h.title}@${h.space_id === G ? 'G' : 'M'}`).join(', '));
  for (const [name, id] of [['Marketing', M], ['General', G]]) {
    const pref = (await maya.get(`/api/search?q=zebra&prefer=${id}`)).filter((h) => h.kind === 'doc');
    check(`10 in ${name}, its hits rank first on the server (prefer)`, pref[0]?.space_id === id, pref.map((h) => `${h.title}@${h.space_id === G ? 'G' : 'M'}`).join(', '));
  }
  const cb = await open(cara);
  await cb.page.getByRole('button', { name: 'Search' }).first().click();
  await cb.page.getByPlaceholder(/Search pages/).fill('zebra');
  await cb.page.waitForTimeout(1500);
  const pal = cb.page.getByRole('dialog');
  const other = pal.getByText('Other spaces', { exact: true });
  check('10 the palette shows the "Other spaces" heading', await other.isVisible());
  const ob = await other.boundingBox();
  const mb2 = await pal.getByText('Zebra launch notes').first().boundingBox();
  check('10 the Marketing hit sits under "Other spaces"', !!ob && !!mb2 && mb2.y > ob.y);
  await cb.ctx.close();
});

// ── 13. templates per space and everywhere (before 11: Cara must not have joined) ──
await step('13', async () => {
  const tpl = await maya.post('/api/docs', { title: 'Launch template', content: 'x', spaceId: M });
  await maya.post(`/api/docs/${tpl.id}/template`, { isTemplate: true });
  const offered = async (who, space = null) => {
    const b = await open(who, '/', space);
    const n = await b.side.locator('button[title="New page from Launch template"]').count();
    await b.ctx.close();
    return n > 0;
  };
  check('13 a Marketing template is offered in Marketing', await offered(maya, M));
  check('13 ...and not in General', !(await offered(maya, G)));
  check('13 ...and not to someone only in General', !(await offered(cara)));
  const samTpl = await sam.post('/api/docs', { title: 'Sam template', content: 'x', spaceId: M });
  await sam.post(`/api/docs/${samTpl.id}/template`, { isTemplate: true });
  const r = await sam.raw('POST', `/api/docs/${samTpl.id}/template`, { isTemplate: true, everywhere: true });
  check('13 a non-admin marking a template everywhere gets 403', r.status === 403 && sql(`SELECT template_everywhere FROM docs WHERE id = '${samTpl.id}'`) === 'f', `${r.status} ${JSON.stringify(r.json)}`);
  const ok = await maya.raw('POST', `/api/docs/${tpl.id}/template`, { isTemplate: true, everywhere: true });
  check('13 an admin marks it everywhere', ok.status === 200 && ok.json.everywhere === true);
  check('13 marked everywhere, it is offered in General too', await offered(cara));
  const use = await cara.post(`/api/templates/${tpl.id}/use`, {});
  check('13 a template used with no spaceId lands in the default space', spaceOf('docs', use.id) === G);
  const useG = await cara.post(`/api/templates/${tpl.id}/use`, { spaceId: G });
  check('13 ...and with spaceId in that space', spaceOf('docs', useG.id) === G);
});

// ── 11. breadcrumb Join ─────────────────────────────────────────────────────
await step('11', async () => {
  const launch = await maya.post('/api/docs', { title: 'Launch plan', content: 'x', spaceId: M });
  const cb = await open(cara, `/d/${launch.id}`);
  await cb.page.waitForTimeout(1000);
  const crumbs = cb.page.locator('nav[aria-label="Breadcrumb"]');
  const join = crumbs.getByRole('button', { name: 'Join Marketing' });
  check('11 the breadcrumb offers Join on a Marketing page', await join.isVisible());
  check('11 Cara stays in General on a page from a space she has not joined', (await cb.current()) === 'General');
  await join.click();
  await cb.page.waitForTimeout(2000);
  check('11 after Join, she is in Marketing', (await cb.current()) === 'Marketing', await cb.current());
  check('11 ...and Marketing is in her switcher', (await cb.listed()).includes('Marketing'));
  check('11 ...and she is a member', (await cara.get('/api/spaces')).find((s) => s.id === M)?.joined === true);
  check('11 no page errors in Cara\'s browser', !cb.errors.length, cb.errors.join(' | '));
  await cb.ctx.close();
});

// ── 12. deleting spaces (RF4) ───────────────────────────────────────────────
await step('12', async () => {
  // Marketing: trash one of its pages, then try. A space whose only row is a
  // trashed page is the case that matters, so Archive holds exactly that.
  const old = await maya.post('/api/docs', { title: 'Old campaign', content: 'x', spaceId: M });
  await maya.call('DELETE', `/api/docs/${old.id}`);
  const r1 = await maya.raw('DELETE', `/api/spaces/${M}`);
  check('12 deleting Marketing (holding a trashed page) is refused', r1.status === 409 && sql(`SELECT count(*) FROM spaces WHERE id = '${M}'`) === '1', `${r1.status} ${JSON.stringify(r1.json)}`);
  const archive = await maya.post('/api/spaces', { name: 'Archive' });
  const gone = await maya.post('/api/docs', { title: 'Archived page', content: 'x', spaceId: archive.id });
  await maya.call('DELETE', `/api/docs/${gone.id}`);
  const r2 = await maya.raw('DELETE', `/api/spaces/${archive.id}`);
  check('12 deleting a space whose only page is in the trash is refused', r2.status === 409, `${r2.status} ${JSON.stringify(r2.json)}`);
  await maya.call('DELETE', `/api/docs/${gone.id}/permanent`);
  const r3 = await maya.raw('DELETE', `/api/spaces/${archive.id}`);
  check('12 emptied, the new space deletes', r3.status === 200 && sql(`SELECT count(*) FROM spaces WHERE id = '${archive.id}'`) === '0', `${r3.status} ${JSON.stringify(r3.json)}`);
  const r4 = await maya.raw('DELETE', `/api/spaces/${G}`);
  check('12 deleting General is refused', r4.status === 409 && sql(`SELECT count(*) FROM spaces WHERE id = '${G}'`) === '1', `${r4.status}`);
});

// ── extra: drag-reordering a page inside a folder keeps its sub-pages nested ──
await step('reorder', async () => {
  const f = await maya.post('/api/folders', { name: 'Notes' });
  const alpha = await maya.post('/api/docs', { title: 'Alpha', content: 'x', folderId: f.id });
  const kid = await maya.post(`/api/docs/${alpha.id}/children`, { title: 'Alpha child' });
  await maya.post('/api/docs', { title: 'Beta', content: 'x', folderId: f.id });
  await mb.page.reload(); await mb.page.waitForTimeout(2500);
  if ((await mb.current()) !== 'General') await mb.switchTo('General');
  const nRow = mb.side.getByRole('treeitem', { name: /Notes/ }).first();
  await nRow.hover();
  await nRow.getByRole('button', { name: 'Expand folder' }).click();
  await mb.page.waitForTimeout(500);
  const reorder = mb.page.waitForRequest((rq) => rq.url().endsWith('/api/docs/reorder'));
  await mb.side.getByRole('treeitem', { name: /^Beta/ }).first().dragTo(mb.side.getByRole('treeitem', { name: /^Alpha/ }).first(), { targetPosition: { x: 40, y: 2 } });
  const sent = JSON.parse((await reorder).postData() || '{}');
  await mb.page.waitForTimeout(1500);
  check('reorder Beta now sits above Alpha', sql(`SELECT string_agg(title, ',' ORDER BY position) FROM docs WHERE folder_id = '${f.id}' AND parent_id IS NULL`).startsWith('Beta,Alpha'));
  check('reorder inside a folder keeps the sub-page nested', sql(`SELECT coalesce(parent_id, '-') FROM docs WHERE id = '${kid.id}'`) === alpha.id,
    `parent_id=${sql(`SELECT coalesce(parent_id, '-') FROM docs WHERE id = '${kid.id}'`)}; client sent ${sent.ids?.length} ids, sub-page among them: ${sent.ids?.includes(kid.id)}`);
});

// ── extra: the same at the top level, and for an old client that sends every page ──
await step('reorder-top', async () => {
  const gamma = await maya.post('/api/docs', { title: 'Gamma top', content: 'x' });
  const kid = await maya.post(`/api/docs/${gamma.id}/children`, { title: 'Gamma child' });
  const delta = await maya.post('/api/docs', { title: 'Delta top', content: 'x' });
  await mb.page.reload(); await mb.page.waitForTimeout(2500);
  const reorder = mb.page.waitForRequest((rq) => rq.url().endsWith('/api/docs/reorder'));
  await mb.side.getByRole('treeitem', { name: /^Delta top/ }).first().dragTo(mb.side.getByRole('treeitem', { name: /^Gamma top/ }).first(), { targetPosition: { x: 40, y: 2 } });
  const sent = JSON.parse((await reorder).postData() || '{}');
  await mb.page.waitForTimeout(1500);
  const parent = () => sql(`SELECT coalesce(parent_id, '-') FROM docs WHERE id = '${kid.id}'`);
  check('reorder-top Delta now sits above Gamma', Number(sql(`SELECT position FROM docs WHERE id = '${delta.id}'`)) < Number(sql(`SELECT position FROM docs WHERE id = '${gamma.id}'`)));
  check('reorder-top at the top level keeps the sub-page nested', parent() === gamma.id, `parent_id=${parent()}; sub-page sent: ${sent.ids?.includes(kid.id)}`);
  check('reorder-top the client sends only its space\'s top-level pages', !sent.ids?.includes(kid.id) && sent.dragId === delta.id);
  await maya.post('/api/docs/reorder', { folderId: null, ids: [delta.id, gamma.id, kid.id] });
  check('reorder-top an old client sending sub-pages too leaves them nested', parent() === gamma.id, `parent_id=${parent()}`);
});

// ── a space made while a page is open becomes current ──────────────────────
await step('create', async () => {
  const pg = await maya.post('/api/docs', { title: 'Open while creating', content: 'x' });
  await mb.page.goto(`${BASE}/d/${pg.id}`); await mb.page.waitForTimeout(2500);
  await mb.side.getByRole('button', { name: /^Space: / }).first().click();
  await mb.page.waitForTimeout(300);
  await mb.page.getByRole('menu').getByText('New space', { exact: true }).click();
  const dlg = mb.page.getByRole('dialog');
  await dlg.locator('input').first().fill('Ops');
  await dlg.getByRole('button', { name: 'New space' }).click();
  await mb.page.waitForTimeout(2500);
  check('create a new space made from a page becomes current', (await mb.current()) === 'Ops', await mb.current());
  const ops = (await maya.get('/api/spaces')).find((sp) => sp.name === 'Ops');
  if (ops) await maya.call('DELETE', `/api/spaces/${ops.id}`);
  await mb.switchTo('General');
});

// ── your pages in a space you left still show in My documents ──────────────
await step('left', async () => {
  await sam.post(`/api/spaces/${M}/leave`);
  const mine = await sam.get(`/api/docs/mine?limit=50&spaceId=${G}`);
  check('left Sam\'s Marketing pages still list in his General My documents', mine.rows.some((d) => d.title === 'Sam template'), mine.rows.map((d) => d.title).join(','));
  await sam.post(`/api/spaces/${M}/join`);
});

// ── phone: the top bar leads with the space and switches it ────────────────
await step('phone', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addCookies(maya.cookie.split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
  await ctx.addInitScript(() => { try { localStorage.setItem('mn-space', 'none-yet'); } catch { /* fine */ } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/'); await page.waitForTimeout(3000);
  const bar = page.locator('header').getByRole('button', { name: /^Space: / }).first();
  check('phone Home\'s top bar shows the space', (await bar.getAttribute('aria-label')) === 'Space: General');
  const tasksTab = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Tasks' });
  await tasksTab.tap(); await page.waitForTimeout(1000);
  await bar.tap(); await page.waitForTimeout(400);
  await page.getByRole('menu').getByText('Marketing', { exact: true }).tap(); await page.waitForTimeout(1500);
  check('phone switching from the top bar moves to Marketing', (await bar.getAttribute('aria-label')) === 'Space: Marketing');
  check('phone switching on Tasks stays on Tasks', (await tasksTab.getAttribute('aria-current')) === 'page');
  check('phone no page errors', !errors.length, errors.join(' | '));
  await ctx.close();
});

check('no page errors in Maya\'s browser', !!mb && !mb.errors.length, mb?.errors.join(' | '));
await browser.close();
console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
