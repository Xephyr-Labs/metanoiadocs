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

async function open(who, path = '/') {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addCookies(who.cookie.split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
  await ctx.addInitScript(() => {
    try {
      // No saved Tasks filter (the first visit would narrow to "assigned to me"),
      // and no folded sidebar sections (Templates starts folded).
      if (!localStorage.getItem('mn-filters-all')) localStorage.setItem('mn-filters-all', '[]');
      if (!localStorage.getItem('mn.sidebar.v1')) localStorage.setItem('mn.sidebar.v1', '{"collapsed":[]}');
    } catch { /* fine */ }
  });
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
  return { ctx, page, side: page.locator('aside'), main: page.locator('main'), errors, nextDialog };
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
  check('3 Maya\'s sidebar shows General', await mb.side.getByRole('button', { name: /General/ }).first().isVisible());
  check('3 Maya\'s sidebar shows Marketing', await mb.side.getByRole('button', { name: /Marketing/ }).first().isVisible());
  const cb = await open(cara);
  check('3 Cara (joined nothing) sees General', await cb.side.getByRole('button', { name: /General/ }).first().isVisible());
  check('3 Cara does not see Marketing', (await cb.side.getByRole('button', { name: /Marketing/ }).count()) === 0);
  await cb.ctx.close();
});

// ── 4. inheritance in Marketing; an old client lands in General (RF5) ───────
let board; let task; let taskPage;
await step('4', async () => {
  const before = new Set(Object.keys(await docsById(maya)));
  const head = mb.side.getByRole('button', { name: /Marketing/ }).first();
  await head.hover();
  await mb.side.getByRole('button', { name: 'New in Marketing' }).click();
  await mb.page.getByRole('menu').getByText('Page', { exact: true }).click();
  await mb.page.waitForTimeout(3000);
  const fresh = Object.values(await docsById(maya)).filter((d) => !before.has(d.id));
  const plus = fresh[0];
  check('4 page from Marketing\'s + is in Marketing', fresh.length === 1 && plus.space_id === M, JSON.stringify(fresh.map((d) => [d.title, d.space_id])));
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
  const row = mb.side.getByRole('treeitem', { name: /Roadmap/ }).first();
  await row.hover();
  await row.getByRole('button', { name: 'Document actions' }).click();
  await mb.page.getByRole('menu').getByText('Move to space', { exact: true }).click();
  await mb.page.waitForTimeout(400);
  const dlg = mb.nextDialog(true);
  await mb.page.getByRole('menu').last().getByText('Marketing', { exact: true }).click();
  const msg = await dlg;
  check('5 preview says "and some pages you can\'t see"', msg.includes('Moves 2 pages and some pages you can\'t see'), JSON.stringify(msg));
  await mb.page.waitForTimeout(1500);
  const ids = [roadmap.id, q3.id, secret.id];
  check('5 all three pages moved to Marketing', ids.every((id) => spaceOf('docs', id) === M), ids.map((id) => spaceOf('docs', id)).join(' '));
  const shape = () => sql(`SELECT string_agg(id || ':' || coalesce(parent_id,'-') || ':' || coalesce(folder_id,'-') || ':' || space_id, ',' ORDER BY id) FROM docs WHERE id IN ('${ids.join("','")}')`);
  check('5 nesting kept (both sub-pages under Roadmap)', sql(`SELECT count(*) FROM docs WHERE parent_id = '${roadmap.id}'`) === '2');
  // The tree as Maya sees it, Roadmap opened, before and after a reload.
  const tree = async () => {
    const r = mb.side.getByRole('treeitem', { name: /Roadmap/ }).first();
    await r.hover();
    const exp = mb.side.getByRole('button', { name: 'Expand Roadmap' });
    if (await exp.count()) { await exp.first().click(); await mb.page.waitForTimeout(300); }
    const sec = mb.side.locator('section').filter({ has: mb.page.getByRole('button', { name: /Marketing/ }) }).first();
    return (await sec.getByRole('treeitem').allInnerTexts()).map((t) => t.trim()).join(' / ');
  };
  const t1 = await tree(); const s1 = shape();
  await mb.page.reload(); await mb.page.waitForTimeout(2500);
  const t2 = await tree(); const s2 = shape();
  check('5 after a reload the tree is identical', t1 === t2 && s1 === s2 && t1.includes('Q3 goals') && t1.includes('Roadmap'), `${t1} || ${t2}`);
  const samTree = (await sam.get('/api/docs')).find((d) => d.id === secret.id);
  check('5 Sam\'s private sub-page still under Roadmap, in Marketing', samTree?.parent_id === roadmap.id && samTree.space_id === M);
});

// ── 6. drag a General page onto a Marketing folder ──────────────────────────
await step('6', async () => {
  const drafts = await maya.post('/api/folders', { name: 'Drafts' });
  const brief = await maya.post('/api/docs', { title: 'Brief', content: 'x', folderId: drafts.id });
  const notes = await maya.post(`/api/docs/${brief.id}/children`, { title: 'Brief notes' });
  const campaigns = sql(`SELECT id FROM folders WHERE name = 'Campaigns'`);
  await mb.page.reload(); await mb.page.waitForTimeout(2500);
  const dRow = mb.side.getByRole('treeitem', { name: /Drafts/ }).first();
  await dRow.hover();
  await dRow.getByRole('button', { name: 'Expand folder' }).click();
  await mb.page.waitForTimeout(500);
  const dlg = mb.nextDialog(true);
  await mb.side.getByRole('treeitem', { name: /^Brief/ }).first().dragTo(mb.side.getByRole('treeitem', { name: /Campaigns/ }).first());
  const msg = await Promise.race([dlg, wait(5000).then(() => null)]);
  check('6 the cross-space confirm appears', !!msg && msg.includes('Marketing') && msg.includes('Moves 2 pages'), JSON.stringify(msg));
  await mb.page.waitForTimeout(1500);
  check('6 the page and its sub-page moved to Marketing', spaceOf('docs', brief.id) === M && spaceOf('docs', notes.id) === M);
  check('6 the page is filed in Campaigns', sql(`SELECT folder_id FROM docs WHERE id = '${brief.id}'`) === campaigns);
  check('6 the old folder link (Drafts) is cleared', sql(`SELECT count(*) FROM docs WHERE folder_id = '${drafts.id}'`) === '0');
  check('6 the sub-page is still nested', sql(`SELECT parent_id FROM docs WHERE id = '${notes.id}'`) === brief.id);
});

// ── 7. move a database ──────────────────────────────────────────────────────
await step('7', async () => {
  const ops = await maya.post('/api/projects', { name: 'Ops board' });
  const t1 = await maya.post('/api/tasks', { projectId: ops.id, title: 'Ops task with page' });
  const t1Page = (await maya.post(`/api/tasks/${t1.id}/page`)).docId;
  const linked = await maya.post('/api/docs', { title: 'Ops runbook', content: 'x' });
  await maya.post('/api/tasks', { projectId: ops.id, title: 'Ops task with a linked page', docId: linked.id });
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
  await maya.post('/api/tasks', { projectId: board.id, title: 'Cara reviews the launch', assigneeIds: [users.cara] });
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

// ── 10. search: joined spaces first, "Other spaces" in the palette ──────────
await step('10', async () => {
  await maya.post('/api/docs', { title: 'Zebra launch notes', content: 'zebra zebra zebra campaign', spaceId: M });
  await maya.post('/api/docs', { title: 'Zebra', content: 'zebra' });
  await wait(500);
  const hits = (await cara.get('/api/search?q=zebra')).filter((h) => h.kind === 'doc');
  const gi = hits.findIndex((h) => h.space_id === G);
  const mi = hits.findIndex((h) => h.space_id === M);
  check('10 Cara\'s search lists the General hit before the Marketing hit', gi >= 0 && mi >= 0 && gi < mi, hits.map((h) => `${h.title}@${h.space_id === G ? 'G' : 'M'}`).join(', '));
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
  const offered = async (who) => {
    const b = await open(who);
    const n = await b.side.locator('button[title="New page from Launch template"]').count();
    await b.ctx.close();
    return n > 0;
  };
  check('13 a Marketing template is offered to a Marketing member', await offered(maya));
  check('13 ...and not to someone only in General', !(await offered(cara)));
  const samTpl = await sam.post('/api/docs', { title: 'Sam template', content: 'x', spaceId: M });
  await sam.post(`/api/docs/${samTpl.id}/template`, { isTemplate: true });
  const r = await sam.raw('POST', `/api/docs/${samTpl.id}/template`, { isTemplate: true, everywhere: true });
  check('13 a non-admin marking a template everywhere gets 403', r.status === 403 && sql(`SELECT template_everywhere FROM docs WHERE id = '${samTpl.id}'`) === 'f', `${r.status} ${JSON.stringify(r.json)}`);
  const ok = await maya.raw('POST', `/api/docs/${tpl.id}/template`, { isTemplate: true, everywhere: true });
  check('13 an admin marks it everywhere', ok.status === 200 && ok.json.everywhere === true);
  check('13 marked everywhere, it is offered in General too', await offered(cara));
  const use = await cara.post(`/api/templates/${tpl.id}/use`, {});
  check('13 a template used with no spaceId lands in the template\'s own space', spaceOf('docs', use.id) === M);
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
  check('11 Marketing is not in Cara\'s sidebar yet', (await cb.side.getByRole('button', { name: /Marketing/ }).count()) === 0);
  await join.click();
  await cb.page.waitForTimeout(1500);
  check('11 after Join, Marketing appears in her sidebar', await cb.side.getByRole('button', { name: /Marketing/ }).first().isVisible());
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

check('no page errors in Maya\'s browser', !!mb && !mb.errors.length, mb?.errors.join(' | '));
await browser.close();
console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
