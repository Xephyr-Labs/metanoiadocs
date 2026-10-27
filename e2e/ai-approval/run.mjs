// AI edit approval, end to end: an untrusted agent's write becomes a draft a
// person reviews; a trusted one writes directly. Stack from run.sh.
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
const md = async (id) => (await admin.get(`/api/docs/${id}/markdown`)).markdown;
const write = (c, id, markdown, onBehalfOf) => c.raw('POST', `/api/docs/${id}/content`, { markdown, mode: 'replace' }, onBehalfOf ? { 'X-On-Behalf-Of': onBehalfOf } : {});

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
  // Andy mints two tokens; one is made trusted by the admin.
  const a = (await andy.post('/api/tokens', { name: 'untrusted' }));
  const b = (await andy.post('/api/tokens', { name: 'trusted' }));
  untrustedTok = client({ token: a.token }); trustedTok = client({ token: b.token }); untrustedId = a.id;
  await admin.call('PUT', `/api/admin/tokens/${b.id}/trusted`, { trusted: true });
  check('seed: page has the five paragraphs', (await md(page)).includes(P5), (await md(page)).slice(0, 80));
});

await step('1 untrusted write is a suggestion', async () => {
  const changed = 'Third paragraph about cherries.';
  const w = await write(untrustedTok, page, body(changed), 'farhanaj');
  sid = w.json.suggestionId;
  check('1 write answers suggested:true with an id and review url', w.status === 200 && w.json.suggested === true && !!sid && /review=/.test(w.json.reviewUrl || ''), `${w.status} ${JSON.stringify(w.json).slice(0, 250)}`);
  check('1 approver is Farhanaj', /farhanaj/i.test(w.json.approverName || ''), w.json.approverName);
  check('1 live page unchanged', (await md(page)).includes('plums') && !(await md(page)).includes('cherries'));
  const rv = await farhanaj.get(`/api/suggestions/${sid}`);
  check('1 review shows exactly 1 change, canReview', rv.changes?.length === 1 && rv.canReview === true, JSON.stringify(rv).slice(0, 300));
  const inbox = await farhanaj.get('/api/inbox');
  check('1 Farhanaj has an ai_suggestion inbox item', inbox.some((n) => n.kind === 'ai_suggestion' && n.suggestion_id === sid), JSON.stringify(inbox.map((n) => n.kind)));
});

await step('2 who may decide', async () => {
  const a = await untrustedTok.raw('POST', `/api/suggestions/${sid}/decide`, { all: 'accept' });
  check('2 untrusted agent token decide -> 403', a.status === 403, `${a.status}`);
  const v = await viewer.raw('POST', `/api/suggestions/${sid}/decide`, { all: 'accept' });
  // 404, not 403: a viewer can't see the draft at all, so it "does not exist" for them.
  check('2 viewer decide -> 404', v.status === 404, `${v.status} ${JSON.stringify(v.json)}`);
  check('2 page still unchanged after refusals', !(await md(page)).includes('cherries'));
});

await step('3 browser review (before accept)', async () => {
  const browser = await chromium.launch();
  try {
  const open = async (who, path) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    await ctx.addCookies(who.cookie.split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
    const p = await ctx.newPage();
    await p.goto(BASE + path);
    return { ctx, p };
  };
  const f = await open(farhanaj, `/d/${page}?review=${sid}`);
  await f.p.getByRole('button', { name: /^Accept/ }).first().waitFor({ timeout: 15000 });
  const txt = await f.p.locator('body').innerText();
  const acc = await f.p.getByRole('button', { name: /^Accept/ }).count();
  check('3 Farhanaj: review shows the change and Accept buttons', acc > 0 && /cherries/.test(txt), `accept=${acc} cherries=${/cherries/.test(txt)}`);
  check('3 Farhanaj: address no longer has ?review=', !f.p.url().includes('review='), f.p.url());
  await f.p.screenshot({ path: '/tmp/ai-approval-farhanaj.png' });
  const v = await open(viewer, `/d/${page}?review=${sid}`);
  // Positive control: the page itself loaded for the viewer (live text visible).
  await v.p.getByText('plums').first().waitFor({ timeout: 15000 });
  await v.p.waitForTimeout(1500);
  const vacc = await v.p.getByRole('button', { name: /^Accept/ }).count();
  check('3 viewer: no Accept buttons', vacc === 0, `accept=${vacc}`);
  } finally { await browser.close(); }
});

await step('4 accept', async () => {
  const d = await farhanaj.post(`/api/suggestions/${sid}/decide`, { all: 'accept' });
  check('4 Farhanaj accepts', d.ok && d.applied === 1, JSON.stringify(d));
  check('4 page has the change', (await md(page)).includes('cherries'));
  check("4 updated_via = 'ai'", sql(`SELECT updated_via FROM docs WHERE id = '${page}'`) === 'ai', sql(`SELECT updated_via FROM docs WHERE id = '${page}'`));
});

await step('5 trusted token writes directly', async () => {
  const w = await write(trustedTok, page, body('Third paragraph about dates.'), 'farhanaj');
  check('5 trusted write applied, no draft', w.status === 200 && !w.json.suggested && (await md(page)).includes('dates'), `${w.status} ${JSON.stringify(w.json)}`);
  check('5 no open draft rows', sql(`SELECT count(*) FROM doc_suggestions WHERE doc_id = '${page}' AND status <> 'closed'`) === '0');
});

await step('6 onBehalfOf a viewer falls back to the owner', async () => {
  const w = await write(untrustedTok, page, body('Third paragraph about kiwis.'), 'viewer');
  check('6 approver is the owner (Maya)', w.json.suggested === true && /maya/i.test(w.json.approverName || ''), `${w.status} ${JSON.stringify(w.json).slice(0, 250)}`);
});

await step('7 agent-owned page, no approver', async () => {
  const own = (await trustedTok.post('/api/docs', { title: 'Andy page', content: 'one\n\ntwo' })).id;
  const w = await write(untrustedTok, own, 'one\n\nthree');
  check('7 untrusted write to own page with no X-On-Behalf-Of -> 409', w.status === 409, `${w.status} ${JSON.stringify(w.json)}`);
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
  const dec = await trustedTok.raw('POST', `/api/suggestions/${sid}/decide`, { all: 'reject' });
  check('8 trusted agent deciding a suggestion -> 403', dec.status === 403, `${dec.status}`);
});

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
