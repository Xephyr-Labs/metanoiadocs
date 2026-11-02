// AI edit approval, end to end: an untrusted agent's write lands as inline
// suggestions a person decides in the page; a trusted one writes directly; no
// agent decides suggestions or changes who is trusted. Stack from run.sh.
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8098';
const PROJECT = process.env.PROJECT || 'mdocs-aiapproval';
const PW = 'aiapproval-1';
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: threw`, false, String(e?.message || e).slice(0, 300)); } };
const sql = (q) => execFileSync('docker', ['exec', `${PROJECT}-db-1`, 'psql', '-U', 'metanoia', '-d', 'metanoiadocs', '-At', '-F', '|', '-c', q]).toString().trim();

// A client: cookie session, or a bearer token (+ optional X-On-Behalf-Of).
function client({ token } = {}) {
  const s = { cookie: '', token };
  s.raw = async (method, path, body, headers = {}) => {
    const r = await fetch(BASE + path, {
      method, redirect: 'manual',
      headers: { 'content-type': 'application/json', ...(s.cookie ? { cookie: s.cookie } : {}), ...(s.token ? { authorization: `Bearer ${s.token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.getSetCookie?.() ?? [];
    if (set.length) s.cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await r.text();
    let json = text;
    try { json = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
    return { status: r.status, json, type: r.headers.get('content-type') || '' };
  };
  s.call = async (method, path, body, headers) => {
    const r = await s.raw(method, path, body, headers);
    if (r.status >= 300 || !r.type.includes('json')) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    return r.json;
  };
  s.get = (p) => s.call('GET', p);
  s.post = (p, b, h) => s.call('POST', p, b ?? {}, h);
  return s;
}

const admin = client(); const farhanaj = client(); const viewer = client(); const andy = client();
const P1 = 'First paragraph about apples.';
const P2 = 'Second paragraph about pears.';
const P3 = 'Third paragraph about plums.';
const P4 = 'Fourth paragraph about figs.';
const P5 = 'Fifth paragraph about limes.';
const body = (p3) => [P1, P2, p3, P4, P5].join('\n\n');
const md = async (id, c = admin) => (await c.get(`/api/docs/${id}/markdown`)).markdown;
const write = (c, id, markdown) => c.raw('POST', `/api/docs/${id}/content`, { markdown, mode: 'replace' });
const pending = (id) => JSON.parse(sql(`SELECT pending_suggestions FROM docs WHERE id = '${id}'`) || '[]');
const suggOf = (r) => { try { return new URL(r.json.link, BASE).searchParams.get('sugg'); } catch { return null; } };
const told = async (c, id) => (await c.get('/api/inbox')).filter((n) => n.kind === 'page_suggestion' && n.doc_id === id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; let v; while (!(v = await fn()) && Date.now() < end) await sleep(300); return v; };

const browser = await chromium.launch();
/** `who`'s browser on a page, once its text and suggestion cards are drawn. */
const open = async (who, id, query = '') => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addCookies(who.cookie.split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
  const p = await ctx.newPage();
  await p.goto(`${BASE}/d/${id}${query}`);
  await p.locator('[data-sugg-card]').first().waitFor({ timeout: 20000 });
  await p.waitForTimeout(1000);
  return p;
};
const buttons = async (p) => ({
  accept: await p.getByRole('button', { name: /^Accept/ }).count(),
  reject: await p.getByRole('button', { name: /^Reject/ }).count(),
});

let users; let page; let untrustedTok; let trustedTok; let sid; let untrustedId;

await step('seed', async () => {
  await admin.post('/api/setup', { name: 'Maya', username: 'maya', email: 'maya@example.com', password: PW });
  await admin.post('/api/auth/login', { username: 'maya', password: PW });
  for (const [name, u] of [['Farhanaj', 'farhanaj'], ['Viewer', 'viewer'], ['Andy', 'andy']]) {
    await admin.post('/api/invites', { email: `${u}@example.com` });
    const c = { farhanaj, viewer, andy }[u];
    await c.post('/api/auth/register', { name, username: u, email: `${u}@example.com`, password: PW });
  }
  users = Object.fromEntries((await admin.get('/api/users')).map((u) => [u.username, u.id]));
  await admin.call('PATCH', `/api/users/${users.andy}/kind`, { kind: 'agent' });
  page = (await admin.post('/api/docs', { title: 'Fruit notes', content: body(P3), visibility: 'private' })).id;
  await admin.post(`/api/docs/${page}/share`, { email: 'farhanaj@example.com', role: 'editor' });
  await admin.post(`/api/docs/${page}/share`, { email: 'viewer@example.com', role: 'viewer' });
  await admin.post(`/api/docs/${page}/share`, { email: 'andy@example.com', role: 'editor' });
  // An agent cannot mint its own tokens: the admin mints two for Andy, then trusts one.
  const a = (await admin.post(`/api/admin/users/${users.andy}/tokens`, { name: 'untrusted' }));
  const b = (await admin.post(`/api/admin/users/${users.andy}/tokens`, { name: 'trusted' }));
  const selfMint = await andy.raw('POST', '/api/tokens', { name: 'mine' });
  check('9 agent minting its own token -> 403', selfMint.status === 403, `${selfMint.status}`);
  untrustedTok = client({ token: a.token }); trustedTok = client({ token: b.token }); untrustedId = a.id;
  await admin.call('PUT', `/api/admin/tokens/${b.id}/trusted`, { trusted: true });
  check('seed: page has the five paragraphs', (await md(page)).includes(P5), (await md(page)).slice(0, 80));
});

await step('1 untrusted write is a suggestion', async () => {
  const w = await write(untrustedTok, page, body('Third paragraph about cherries.'));
  sid = suggOf(w);
  check('1 write answers suggested:true with a ?sugg= link', w.status === 200 && w.json.suggested === true && !!sid, `${w.status} ${JSON.stringify(w.json).slice(0, 250)}`);
  check('1 no named approver: any editor decides', w.json.approverName == null, w.json.approverName);
  check('1 live page unchanged', (await md(page)).includes('plums') && !(await md(page)).includes('cherries'));
  const p = pending(page);
  check('1 the page holds it as Andy\'s suggestion', p.some((x) => x.id === sid && x.by === users.andy), JSON.stringify(p));
  const n = await told(farhanaj, page);
  check('1 Farhanaj is told once, linking it', n.length === 1 && n[0].suggestion_id === sid, JSON.stringify(n));
});

await step('2 the agent and a viewer cannot decide', async () => {
  // An agent's live session is read-only on the server (pageSyncRole). Its
  // page may still draw Accept (the UI goes by the page role), so press it:
  // nothing it does there may reach the page.
  const a = await open(andy, page);
  const ab = await buttons(a);
  if (ab.accept) await a.getByRole('button', { name: /^Accept/ }).first().click();
  await a.evaluate(() => {
    const m = document.querySelector('editor-host')?.std?.store?.getBlocksByFlavour('affine:paragraph').map((b) => b.model).find((x) => x.text?.toString().startsWith('First'));
    try { m?.text.insert('AGENTEDIT ', 0); } catch { /* read-only store */ }
  });
  await sleep(3000);
  check('2 agent session: its Accept and a forced edit change nothing', !(await md(page)).includes('cherries') && !(await md(page)).includes('AGENTEDIT')
    && pending(page).some((x) => x.id === sid), `${JSON.stringify(ab)} ${JSON.stringify(pending(page))}`);
  await a.context().close();
  const v = await open(viewer, page);
  check('2 viewer: the card, no Accept/Reject', JSON.stringify(await buttons(v)) === '{"accept":0,"reject":0}', JSON.stringify(await buttons(v)));
  await v.context().close();
  check('2 page still unchanged', !(await md(page)).includes('cherries'));
});

await step('3+4 an editor accepts it in the page', async () => {
  const f = await open(farhanaj, page, `?sugg=${encodeURIComponent(sid)}`);
  const b = await buttons(f);
  check('3 Farhanaj: Accept and Reject on the card', b.accept > 0 && b.reject > 0, JSON.stringify(b));
  check('3 Farhanaj: ?sugg= makes its card active', !!(await until(async () => /ring-2/.test(await f.locator(`[data-sugg-card="${sid}"]`).getAttribute('class') || ''), 8000)));
  await f.screenshot({ path: '/tmp/ai-approval-farhanaj.png' });
  await f.getByRole('button', { name: /^Accept/ }).first().click();
  check('4 the page has the change', !!(await until(async () => (await md(page)).includes('cherries') && !(await md(page)).includes('plums'))), (await md(page)).slice(0, 200));
  check('4 nothing pending', !!(await until(async () => pending(page).length === 0)), JSON.stringify(pending(page)));
  await f.context().close();
});

await step('5 trusted token writes directly', async () => {
  const w = await write(trustedTok, page, body('Third paragraph about dates.'));
  check('5 trusted write applied, not suggested', w.status === 200 && !w.json.suggested && (await md(page)).includes('dates'), `${w.status} ${JSON.stringify(w.json)}`);
  check('5 nothing pending, no draft rows', pending(page).length === 0 && sql(`SELECT count(*) FROM doc_suggestions WHERE doc_id = '${page}'`) === '0');
});

await step('6 the page owner rejects an agent edit', async () => {
  const w = await write(untrustedTok, page, body('Third paragraph about kiwis.'));
  check('6 untrusted write is a suggestion again', w.json.suggested === true && !!suggOf(w), JSON.stringify(w.json));
  const m = await open(admin, page);
  const b = await buttons(m);
  check('6 Maya (owner): Accept and Reject', b.accept > 0 && b.reject > 0, JSON.stringify(b));
  await m.getByRole('button', { name: /^Reject/ }).first().click();
  check('6 rejected: nothing pending, page as it was', !!(await until(async () => pending(page).length === 0))
    && (await md(page)).includes('dates') && !(await md(page)).includes('kiwis'), (await md(page)).slice(0, 200));
  await m.context().close();
});

let own;
await step('7 agent-owned page shared with a person', async () => {
  own = (await trustedTok.post('/api/docs', { title: 'Andy page', content: 'one\n\ntwo', visibility: 'private' })).id;
  await trustedTok.post(`/api/docs/${own}/share`, { email: 'farhanaj@example.com', role: 'editor' });
  const w = await write(untrustedTok, own, 'one\n\nthree');
  check('7 untrusted write to its own page is a suggestion', w.status === 200 && w.json.suggested === true && !!suggOf(w), `${w.status} ${JSON.stringify(w.json)}`);
  const n = await told(farhanaj, own);
  check('7 Farhanaj was told', n.length === 1 && n[0].suggestion_id === suggOf(w), JSON.stringify(n));
  const f = await open(farhanaj, own);
  const b = await buttons(f);
  check('7 the editor (Farhanaj) can decide it', b.accept > 0 && b.reject > 0, JSON.stringify(b));
  await f.context().close();
});

await step('8 an admin agent cannot switch approval off', async () => {
  await admin.call('PATCH', `/api/users/${users.andy}/role`, { role: 'admin' });
  const t = await untrustedTok.raw('PUT', `/api/admin/tokens/${untrustedId}/trusted`, { trusted: true });
  check('8 untrusted admin agent trusting its own token -> 403', t.status === 403, `${t.status} ${JSON.stringify(t.json)}`);
  check('8 token still untrusted', sql(`SELECT trusted FROM api_tokens WHERE id = '${untrustedId}'`) === 'f');
  const k = await untrustedTok.raw('PATCH', `/api/users/${users.farhanaj}/kind`, { kind: 'agent' });
  check('8 untrusted admin agent changing a kind -> 403', k.status === 403, `${k.status}`);
  const r = await untrustedTok.raw('PATCH', `/api/users/${users.farhanaj}/role`, { role: 'admin' });
  check('8 untrusted admin agent changing a role -> 403', r.status === 403, `${r.status}`);
  const c = await andy.raw('PUT', `/api/admin/tokens/${untrustedId}/trusted`, { trusted: true });
  check('8 agent cookie session -> 403 too', c.status === 403, `${c.status}`);
  const i = await untrustedTok.raw('POST', '/api/invites', { email: 'sock@example.com' });
  check('8 admin agent inviting an address -> 403', i.status === 403, `${i.status}`);
  check('8 no invite row for it', sql("SELECT count(*) FROM invites WHERE email = 'sock@example.com'") === '0');
  const tt = await trustedTok.raw('PUT', `/api/admin/tokens/${untrustedId}/trusted`, { trusted: true });
  check('8 trusted admin agent trusting another token -> 403', tt.status === 403, `${tt.status}`);
  check('8 token still untrusted after trusted-token try', sql(`SELECT trusted FROM api_tokens WHERE id = '${untrustedId}'`) === 'f');
  const del = await trustedTok.raw('DELETE', `/api/users/${users.viewer}`);
  check('8 trusted admin agent deleting a member -> 403', del.status === 403, `${del.status}`);
  // An admin agent, on the page it owns: still no deciding its suggestions.
  const before = await md(own, trustedTok);
  const a = await open(andy, own);
  if ((await buttons(a)).accept) await a.getByRole('button', { name: /^Accept/ }).first().click();
  await sleep(3000);
  check('8 admin agent accepting on its own page changes nothing', (await md(own, trustedTok)) === before && pending(own).length === 1, `${await md(own, trustedTok)} ${JSON.stringify(pending(own))}`);
  await a.context().close();
});

await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
