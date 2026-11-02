// Inline suggestions, end to end: Andy's edit_doc lands as a suggestion an
// editor decides in the page; viewers, guests and suggesters each see their
// part; the server guard refuses a suggester's plain edit. Stack from run.sh.
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8102';
const PROJECT = process.env.PROJECT || 'mdocs-inlinesugg';
const PW = 'inlinesugg-1';
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: threw`, false, String(e?.message || e).slice(0, 400)); } };
const sql = (q) => execFileSync('docker', ['exec', `${PROJECT}-db-1`, 'psql', '-U', 'metanoia', '-d', 'metanoiadocs', '-At', '-F', '|', '-c', q]).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; let v; while (!(v = await fn()) && Date.now() < end) await sleep(300); return v; };

function client(token) {
  const s = { cookie: '' };
  s.raw = async (method, path, body) => {
    const r = await fetch(BASE + path, {
      method, redirect: 'manual',
      headers: { 'content-type': 'application/json', ...(s.cookie ? { cookie: s.cookie } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
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

const maya = client(); const eddie = client(); const vera = client(); const sam = client(); const andy = client();
const P1 = 'The roses bloom in June.';
const P2 = 'We water the beds every morning.';
const P3 = 'Tomatoes need full sun.';
const md = async () => (await maya.get(`/api/docs/${page}/markdown`)).markdown;
const pending = () => JSON.parse(sql(`SELECT pending_suggestions FROM docs WHERE id = '${page}'`) || '[]');

let users; let page; let andyTok; let sid; let shareToken; let samSid;

await step('seed', async () => {
  await maya.post('/api/setup', { name: 'Maya', username: 'maya', email: 'maya@example.com', password: PW });
  await maya.post('/api/auth/login', { username: 'maya', password: PW });
  for (const [name, u, c] of [['Eddie', 'eddie', eddie], ['Vera', 'vera', vera], ['Sam', 'sam', sam], ['Andy', 'andy', andy]]) {
    await maya.post('/api/invites', { email: `${u}@example.com` });
    await c.post('/api/auth/register', { name, username: u, email: `${u}@example.com`, password: PW });
  }
  users = Object.fromEntries((await maya.get('/api/users')).map((u) => [u.username, u.id]));
  await maya.call('PATCH', `/api/users/${users.andy}/kind`, { kind: 'agent' });
  andyTok = client((await maya.post(`/api/admin/users/${users.andy}/tokens`, { name: 'andy' })).token);
  page = (await maya.post('/api/docs', { title: 'Garden notes', content: [P1, P2, P3].join('\n\n'), visibility: 'private' })).id;
  for (const [u, role] of [['eddie', 'editor'], ['vera', 'viewer'], ['sam', 'suggester'], ['andy', 'editor']]) {
    await maya.post(`/api/docs/${page}/share`, { email: `${u}@example.com`, role });
  }
  shareToken = (await maya.post(`/api/docs/${page}/public`)).token;
  check('seed: page has the three paragraphs', (await md()).includes(P3));
});

await step('1 Andy edit_doc is one inline suggestion', async () => {
  const r = await andyTok.post(`/api/docs/${page}/edits`, { edits: [{ find: 'every morning', replace: 'every evening' }] });
  sid = new URL(r.link, BASE).searchParams.get('sugg');
  check('1 answers suggested:true with a ?sugg= link', r.suggested === true && !!sid, JSON.stringify(r));
  check('1 page reads as before until decided', (await md()).includes(P2), (await md()).slice(0, 200));
  const p = pending();
  check('1 docs.pending_suggestions holds it, by Andy', p.length === 1 && p[0].id === sid && p[0].by === users.andy, JSON.stringify(p));
});

const browser = await chromium.launch();
const open = async (who, path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, ...opts });
  if (who) await ctx.addCookies(who.cookie.split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
  const p = await ctx.newPage();
  await p.goto(BASE + path);
  await p.getByText('Tomatoes need full sun').first().waitFor({ timeout: 20000 });
  return p;
};
const cards = (p) => p.locator('[data-sugg-card]');
// Where `text` sits on the page (its centre, or just past its last letter).
const spot = (p, text, end = false) => p.evaluate(([t, e]) => {
  const w = document.createTreeWalker(document.querySelector('editor-host'), NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const i = n.data.indexOf(t);
    if (i < 0) continue;
    const r = document.createRange(); r.setStart(n, e ? i + t.length : i); r.setEnd(n, i + t.length);
    const b = r.getBoundingClientRect();
    return e ? { x: b.right + 1, y: b.y + b.height / 2 } : { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
  return null;
}, [text, end]);
const acceptButtons = (p) => p.getByRole('button', { name: /^Accept/ });
let ed; let owner;

await step('2 editor sees one green/red suggestion and one card', async () => {
  ed = await open(eddie, `/d/${page}`);
  await cards(ed).first().waitFor({ timeout: 15000 });
  const ins = await ed.locator('ins.mn-sugg-ins').allInnerTexts();
  const del = await ed.locator('del.mn-sugg-del').allInnerTexts();
  check('2 inserted text in an <ins>, removed in a <del>', /evening/.test(ins.join('')) && /morning/.test(del.join('')), `ins=${JSON.stringify(ins)} del=${JSON.stringify(del)}`);
  check('2 exactly one card, Andy\'s', await cards(ed).count() === 1 && /Andy/.test(await cards(ed).first().innerText()), await cards(ed).first().innerText());
  const counter = ed.locator('[aria-live="polite"]').filter({ hasText: /of 1$/ });
  await ed.getByRole('button', { name: 'Next change' }).click();
  check('2 next: "1 of 1", card active', /^1 of 1$/.test((await counter.innerText()).trim()) && /ring-2/.test(await cards(ed).first().getAttribute('class')), await counter.innerText());
  await ed.getByRole('button', { name: 'Previous change' }).click();
  check('2 prev: still "1 of 1"', /^1 of 1$/.test((await counter.innerText()).trim()), await counter.innerText());
});

await step('3 viewer sees the suggestion without buttons', async () => {
  const v = await open(vera, `/d/${page}`);
  await cards(v).first().waitFor({ timeout: 15000 });
  await v.waitForTimeout(1000);
  check('3 viewer: the <ins> shows', /evening/.test((await v.locator('ins.mn-sugg-ins').allInnerTexts()).join('')));
  check('3 viewer: one card, no Accept/Reject', await cards(v).count() === 1 && await acceptButtons(v).count() === 0
    && await v.getByRole('button', { name: /^Reject/ }).count() === 0, `accept=${await acceptButtons(v).count()}`);
  await v.context().close();
});

await step('4 guest share link shows no pending text', async () => {
  const g = await open(null, `/share/${shareToken}`);
  await g.getByText('every morning').first().waitFor({ timeout: 15000 });
  const txt = await g.locator('body').innerText();
  check('4 guest: old text, no "evening", no card', !/evening/.test(txt) && await cards(g).count() === 0, txt.slice(0, 300));
  await g.context().close();
});

await step('5 editor accepts; a second browser sees it', async () => {
  owner = await open(maya, `/d/${page}`);
  await cards(owner).first().waitFor({ timeout: 15000 });
  await acceptButtons(ed).first().click();
  await cards(ed).first().waitFor({ state: 'detached', timeout: 10000 });
  const seen = await until(async () => {
    const t = await owner.locator('body').innerText();
    return /every evening/.test(t) && !/every morning/.test(t) && await owner.locator('ins.mn-sugg-ins, del.mn-sugg-del').count() === 0;
  });
  check('5 Maya\'s open page reads "every evening", nothing pending', !!seen, (await owner.locator('body').innerText()).slice(0, 300));
  const stored = await until(async () => (await md()).includes('We water the beds every evening.') && pending().length === 0);
  check('5 stored: markdown has it, pending_suggestions empty', !!stored, `${(await md()).slice(0, 200)} ${JSON.stringify(pending())}`);
});

let phone;
await step('6 a suggester types on a phone; the editor sees the card', async () => {
  phone = await open(sam, `/d/${page}`, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.waitForTimeout(1500);
  const a = await spot(phone, 'full sun.', true);
  await phone.mouse.click(a.x, a.y);
  await phone.keyboard.type(' Basil too.', { delay: 40 });
  check('6 sam: typed text is his <ins>, at the end', await until(async () => /Basil too/.test((await phone.locator('ins.mn-sugg-ins').allInnerTexts()).join(''))
    && /full sun\. Basil too\./.test(await phone.locator('body').innerText())),
    JSON.stringify(await phone.locator('ins.mn-sugg-ins').allInnerTexts()));
  const mine = await until(() => pending().find((s) => s.by === users.sam));
  samSid = mine?.id;
  check('6 persisted: pending_suggestions has Sam\'s', !!mine, JSON.stringify(pending()));
  check('6 page text unchanged (only a suggestion)', !(await md()).includes('Basil'), (await md()).slice(0, 200));
  const card = await until(async () => (await cards(ed).count()) === 1 && /Sam/.test(await cards(ed).first().innerText()));
  check('6 editor sees Sam\'s card', !!card, await cards(ed).count() ? await cards(ed).first().innerText() : 'no card');
  await phone.reload();
  await phone.getByText(P3).first().waitFor({ timeout: 20000 });
  check('6 after reload Sam still sees his <ins>', await until(async () => /Basil too/.test((await phone.locator('ins.mn-sugg-ins').allInnerTexts()).join(''))));
});

await step('7 ?sugg= focuses the card', async () => {
  const p = await open(eddie, `/d/${page}?sugg=${encodeURIComponent(samSid)}`);
  const card = p.locator(`[data-sugg-card="${samSid}"]`);
  await card.waitFor({ timeout: 15000 });
  check('7 card active', !!(await until(async () => /ring-2/.test(await card.getAttribute('class') || ''), 8000)), await card.getAttribute('class'));
  await p.context().close();
});

await step('8 a forged plain insert is refused and the client reloads', async () => {
  const navigated = phone.waitForEvent('framenavigated', { predicate: (f) => f === phone.mainFrame(), timeout: 20000 }).then(() => true, () => false);
  // A plain insert straight into the model, past Suggesting mode's input handling.
  const forged = await phone.evaluate(() => {
    const store = document.querySelector('editor-host')?.std?.store;
    const para = store?.getBlocksByFlavour('affine:paragraph').map((b) => b.model).find((m) => m.text?.toString().startsWith('The roses'));
    if (!para) return false;
    para.text.insert('FORGED ', 0);
    return true;
  });
  check('8 forged a plain insert in Sam\'s editor', forged);
  check('8 the client reloaded', await navigated);
  await phone.waitForLoadState('load');
  const back = await until(async () => /Tomatoes need full sun/.test(await phone.locator('body').innerText().catch(() => '')), 30000);
  if (!back) await phone.screenshot({ path: '/tmp/inline-suggestions-forge.png' }).catch(() => {});
  const txt = await phone.locator('body').innerText().catch(() => '');
  check('8 after reload the page is back, without the forged text', !!back && !/FORGED/.test(txt), txt.slice(0, 300));
  check('8 nor stored, nor on the editor\'s page', !(await md()).includes('FORGED') && !/FORGED/.test(await ed.locator('body').innerText()));
  await phone.context().close();
});

await step('9 the owner in Editing mode is unaffected', async () => {
  const before = pending().length;
  const a = await spot(owner, 'in June.', true);
  await owner.mouse.click(a.x, a.y);
  await owner.keyboard.type(' Owner line.', { delay: 30 });
  const stored = await until(async () => (await md()).includes('The roses bloom in June. Owner line.'));
  check('9 owner\'s typing lands directly', !!stored, (await md()).slice(0, 200));
  check('9 no suggestion made', pending().length === before && await owner.locator('ins.mn-sugg-ins', { hasText: 'Owner line' }).count() === 0, JSON.stringify(pending()));
});

await step('10 the Suggest button writes a replace', async () => {
  const before = pending().length;
  // Double-click the word itself, as a person selects it.
  const at = await spot(ed, 'roses');
  await ed.mouse.dblclick(at.x, at.y);
  await ed.getByTestId('metanoia-suggest').click({ timeout: 8000 });
  const box = ed.getByPlaceholder('New text (leave empty to suggest deleting it)');
  await box.waitFor({ timeout: 8000 });
  await box.fill('tulips');
  await box.press('Enter');
  const mine = await until(() => pending().length === before + 1 && pending().find((s) => s.by === users.eddie));
  check('10 one new suggestion, by Eddie', !!mine, JSON.stringify(pending()));
  const shown = await until(async () => /tulips/.test((await ed.locator('ins.mn-sugg-ins').allInnerTexts()).join(''))
    && /roses/.test((await ed.locator('del.mn-sugg-del').allInnerTexts()).join('')));
  check('10 shown as a replace: <del>roses</del><ins>tulips</ins>', !!shown,
    `ins=${JSON.stringify(await ed.locator('ins.mn-sugg-ins').allInnerTexts())} del=${JSON.stringify(await ed.locator('del.mn-sugg-del').allInnerTexts())}`);
  check('10 no comment row made', sql(`SELECT count(*) FROM comments WHERE doc_id = '${page}'`) === '0');
});

await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
