// Typing cost in the real editor, in a real browser, against a running server.
//
// Fails when a keystroke in a long page costs much more than one in a short
// page. Work the editor does per keystroke should not grow with the page;
// when it did (a painter looking up every paragraph on every key) typing in a
// 300-block page went to ~47 ms a key while a short page stayed fast, and
// nothing caught it. A ratio, not a number of milliseconds, so it holds on a
// slow CI machine as well as a laptop; plus a loose absolute ceiling for the
// day both get slow together.
//
//   BASE=http://localhost:8092 E2E_USER=admin E2E_PASSWORD=… node perf-typing.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8092';
const USER = process.env.E2E_USER || 'admin';
const PASSWORD = process.env.E2E_PASSWORD;
// Today a long page costs ~4.5-5.5x a short one per key: what is left is
// BlockSuite's own per-keystroke selection sync and the browser's addRange,
// both of which grow with the page. The regression this was written for was
// ~25x. 8 leaves room for runner noise and fails on anything like it.
const MAX_RATIO = Number(process.env.PERF_MAX_RATIO || 8);
const MAX_MS_PER_KEY = Number(process.env.PERF_MAX_MS_PER_KEY || 40);
const TEXT = 'The quick brown fox jumps over the lazy dog, then types on. ';

if (!PASSWORD) { console.error('E2E_PASSWORD is required'); process.exit(2); }

// A long, ordinary page: headings, paragraphs, lists, a table every so often.
const longMarkdown = () => {
  const out = [];
  for (let i = 0; i < 60; i++) {
    out.push(`## Section ${i + 1}`, '', `Body text for section ${i + 1}, long enough to wrap on a phone.`, '');
    out.push(`- first point ${i}`, `- second point ${i}`, `1. step one`, `2. step two`, '');
    if (i % 10 === 0) out.push('| a | b |', '| - | - |', '| 1 | 2 |', '');
  }
  return out.join('\n');
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
if (!login.ok()) { console.error('login failed', login.status()); process.exit(2); }

const made = [];
const create = async (title, content) => {
  const r = await (await ctx.request.post(`${BASE}/api/docs`, { data: { title, content } })).json();
  const id = r.id ?? r.doc?.id;
  made.push(id);
  return id;
};

async function msPerKey(docId) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/d/${docId}`);
  await page.waitForSelector('affine-paragraph', { timeout: 60000 });
  await page.waitForTimeout(2500);
  const target = page.locator('affine-paragraph v-line').nth(1);
  await target.scrollIntoViewIfNeeded();
  await target.click();
  await page.keyboard.press('End');
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  // Main-thread busy time, not wall time: steadier on a shared runner.
  const busy = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value;
  await page.keyboard.type('warm up ', { delay: 0 });
  await page.waitForTimeout(500);
  const t0 = await busy();
  await page.keyboard.type(TEXT, { delay: 0 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(300);
  const t1 = await busy();
  await page.close();
  return ((t1 - t0) * 1000) / TEXT.length;
}

let failed = false;
try {
  const short = await create('perf: short page', 'One line.\n\nTwo line.\n\nThree line.');
  const long = await create('perf: long page', longMarkdown());
  // Best of three each: the first run pays for warm-up a page never sees twice.
  const best = async (id) => Math.min(await msPerKey(id), await msPerKey(id), await msPerKey(id));
  const s = await best(short);
  const l = await best(long);
  const ratio = l / Math.max(s, 0.1);
  console.log(`short page ${s.toFixed(1)} ms/key · long page ${l.toFixed(1)} ms/key · ratio ${ratio.toFixed(2)} (max ${MAX_RATIO}) · ceiling ${MAX_MS_PER_KEY} ms/key`);
  if (ratio > MAX_RATIO) { console.error('FAIL: typing cost grows with the page'); failed = true; }
  if (l > MAX_MS_PER_KEY) { console.error('FAIL: typing in a long page is over the ceiling'); failed = true; }
} finally {
  for (const id of made) await ctx.request.delete(`${BASE}/api/docs/${id}`).catch(() => {});
  await browser.close();
}
process.exit(failed ? 1 : 0);
