// Comment card -> its passage, an edited passage shown as a diff, and inbox paging. Stack from run.sh.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8094';
const OUT = process.env.OUT || '/tmp';
const PW = 'comments-inbox-1';
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: threw`, false, String(e?.message || e).slice(0, 400)); } };

function client() {
  const s = { cookie: '' };
  s.call = async (method, path, body) => {
    const r = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', ...(s.cookie ? { cookie: s.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.getSetCookie?.() ?? [];
    if (set.length) s.cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await r.text();
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  };
  s.get = (p) => s.call('GET', p);
  s.post = (p, b) => s.call('POST', p, b ?? {});
  return s;
}

const a = client(); const b = client();
let docId;
const TARGET = 'The quarterly target is ten new clients.';

await step('seed', async () => {
  await a.post('/api/setup', { name: 'Alice', username: 'alice', email: 'alice@example.com', password: PW });
  await a.post('/api/auth/login', { username: 'alice', password: PW });
  await a.post('/api/invites', { email: 'bob@example.com' });
  await b.post('/api/auth/register', { name: 'Bob', username: 'bob', email: 'bob@example.com', password: PW });
  // Enough paragraphs above the passage that it starts off screen.
  const filler = Array.from({ length: 60 }, (_, i) => `Filler paragraph ${i + 1}.`).join('\n\n');
  docId = (await a.post('/api/docs', { title: 'Plan', content: `${filler}\n\n${TARGET}\n\nLast line.` })).id;
  // 120 comments by Bob on Alice's page: one notification each, for Alice.
  for (let i = 0; i < 120; i++) await b.post(`/api/docs/${docId}/comments`, { body: `note ${i + 1}` });
  // The notification is written after the comment's response.
  await new Promise((r) => setTimeout(r, 1500));
});

await step('inbox pages', async () => {
  const p1 = await a.get('/api/inbox');
  const p2 = await a.get(`/api/inbox?before=${encodeURIComponent(p1.at(-1).id)}`);
  const p3 = await a.get(`/api/inbox?before=${encodeURIComponent(p2.at(-1).id)}`);
  const ids = [...p1, ...p2, ...p3].map((r) => r.id);
  check('inbox: 50, 50, then the rest', p1.length === 50 && p2.length === 50 && p3.length >= 20, `${p1.length}/${p2.length}/${p3.length}`);
  check('inbox: pages neither repeat nor skip', new Set(ids).size === ids.length && ids.length >= 120, `${ids.length} rows, ${new Set(ids).size} distinct`);
  check('inbox: newest first across pages', p1[0].body === 'note 120' && p3.at(-1).body.startsWith('note '), `${p1[0].body} … ${p3.at(-1).body}`);
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies(a.cookie.split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

/** Whether the target paragraph is inside the visible part of the window. */
const targetOnScreen = () => page.evaluate((t) => {
  const v = [...document.querySelectorAll('[data-v-text]')].find((n) => n.textContent === t);
    const el = v?.closest('[data-block-id]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.top >= 0 && r.bottom <= window.innerHeight;
}, TARGET);

await step('comment on the passage', async () => {
  await page.goto(`${BASE}/d/${docId}`);
  await page.waitForTimeout(3000);
  // Select the passage as a reader would, then the toolbar's Comment.
  await page.evaluate((t) => {
    const v = [...document.querySelectorAll('[data-v-text]')].find((n) => n.textContent === t);
    const el = v?.closest('[data-block-id]');
    el.scrollIntoView({ block: 'center' });
    const text = document.createTreeWalker(v, NodeFilter.SHOW_TEXT).nextNode();
    const r = document.createRange();
    r.setStart(text, 0);
    r.setEnd(text, text.textContent.length);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }, TARGET);
  await page.mouse.up();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Comment', exact: true }).first().click();
  await page.waitForTimeout(600);
  await page.keyboard.type('Is ten realistic?');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const rows = await a.get(`/api/docs/${docId}/comments`);
  const c = rows.find((r) => r.quote);
  check('quoted comment saved with anchors', !!c && c.quote === TARGET && !!c.anchor_start, JSON.stringify(c ? { quote: c.quote, anchor: !!c.anchor_start } : rows.length));
});

await step('card click goes to the passage', async () => {
  await page.getByText('Filler paragraph 1.', { exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  check('passage off screen before the click', (await targetOnScreen()) === false);
  await page.getByText('Is ten realistic?').click();
  await page.waitForTimeout(1200);
  check('card click scrolls the passage into view', (await targetOnScreen()) === true);
  check('passage flashed', await page.evaluate(() => CSS.highlights.has('mn-comment-active')));
  await page.screenshot({ path: `${OUT}/e2e-comment-jump.png` });
  await page.waitForTimeout(2000);
  check('flash fades', !(await page.evaluate(() => CSS.highlights.has('mn-comment-active'))));
});

await step('quote button goes to the passage', async () => {
  await page.getByText('Filler paragraph 1.', { exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  check('passage off screen before the quote click', (await targetOnScreen()) === false);
  await page.getByRole('button', { name: TARGET }).click();
  await page.waitForTimeout(1200);
  check('quote click scrolls the passage into view', (await targetOnScreen()) === true);
});

await step('edited passage shows old and new', async () => {
  // Type inside the passage: after "ten".
  await page.evaluate((t) => {
    const v = [...document.querySelectorAll('[data-v-text]')].find((n) => n.textContent === t);
    const el = v?.closest('[data-block-id]');
    const text = document.createTreeWalker(v, NodeFilter.SHOW_TEXT).nextNode();
    const at = text.textContent.indexOf('ten') + 3;
    const r = document.createRange();
    r.setStart(text, at);
    r.collapse(true);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    el.querySelector('[contenteditable="true"]')?.focus();
  }, TARGET);
  await page.keyboard.type(' or twelve');
  await page.waitForTimeout(1500);
  const del = await page.locator('del.mn-diff-del').first().textContent().catch(() => null);
  const ins = await page.locator('ins.mn-diff-add').first().textContent().catch(() => null);
  check('card strikes the old words', del === TARGET, String(del));
  check('card shows what they say now', ins === 'The quarterly target is ten or twelve new clients.', String(ins));
  check('card says the text changed', await page.getByText('The text has changed since this comment.').isVisible());
  const marks = await page.evaluate(() => ({
    changed: [...(CSS.highlights.get('mn-comment-changed') ?? [])].map((r) => r.toString()),
    plain: [...(CSS.highlights.get('mn-comment') ?? [])].map((r) => r.toString()),
  }));
  check('edited passage stays marked, in orange', marks.changed.length === 1 && marks.changed[0] === 'The quarterly target is ten or twelve new clients.', JSON.stringify(marks.changed));
  check('and not also in yellow', !marks.plain.some((t) => t.includes('twelve')), JSON.stringify(marks.plain));
  await page.screenshot({ path: `${OUT}/e2e-comment-changed.png` });
});

await step('inbox shows older', async () => {
  await page.getByRole('button', { name: /^Inbox/ }).first().click();
  await page.waitForTimeout(1500);
  const dialog = page.getByRole('dialog');
  const count = () => dialog.getByText(/^“note \d+”$/).count();
  const first = await count();
  check('inbox opens on 50', first === 50, String(first));
  await dialog.getByRole('button', { name: 'Show older' }).click();
  await page.waitForTimeout(1500);
  const second = await count();
  check('Show older adds the next 50', second === 100, String(second));
  await dialog.getByRole('button', { name: 'Show older' }).click();
  await page.waitForTimeout(1500);
  const third = await count();
  check('the last page, then no button', third === 120 && !(await dialog.getByRole('button', { name: 'Show older' }).count()), String(third));
});

await step('inbox row opens its comment', async () => {
  // An old one, far down the panel's list of 121 threads.
  await page.getByRole('dialog').getByText('“note 5”', { exact: true }).click();
  await page.waitForTimeout(1500);
  const card = page.locator('.ring-accent', { hasText: 'note 5' }).first();
  check('its card is picked out', (await card.count()) === 1);
  const box = await card.boundingBox();
  check('and scrolled into view', !!box && box.y >= 0 && box.y + box.height <= 900, JSON.stringify(box));
  await page.screenshot({ path: `${OUT}/e2e-inbox-to-comment.png` });
});

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
