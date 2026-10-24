// Voice notes: review-1 findings (guest view, Esc, reply note, double Stop, deleted anchor).
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8098';
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
let cookie = '';
const api = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : {};
};
await api('POST', '/api/auth/login', { username: 'maya', password: 'voice-test-1' });
const newDoc = async (title) => { const d = await api('POST', '/api/docs', { title, content: 'Line one.' }); return d.id ?? d.doc?.id; };

// Guest: a voice-only comment on a comment-access share link carries its note.
const gdoc = await newDoc('Guest test');
const bytes = new Uint8Array(3000).map((_, i) => (i * 13) % 256);
const key = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
await fetch(`${BASE}/api/blob/${key}`, { method: 'PUT', headers: { 'content-type': 'audio/webm', cookie }, body: bytes });
await api('POST', `/api/docs/${gdoc}/comments`, { body: '', attachments: [{ key, name: 'Voice note.webm', mime: 'audio/webm', size: 3000 }] });
const { token } = await api('POST', `/api/docs/${gdoc}/public`, { access: 'comment' });
const guestRows = await (await fetch(`${BASE}/api/public/${token}/comments`)).json();
check('guest comment list carries the voice note', guestRows[0]?.attachments?.[0]?.key === key, JSON.stringify(guestRows[0]?.attachments ?? null));

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies(cookie.split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
const page = await ctx.newPage();

const startVoice = async () => {
  await page.getByText('Line one.').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/voice', { delay: 60 });
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(1500);
};

// Double-click Stop inserts one block, not two.
await page.goto(`${BASE}/d/${await newDoc('Double stop')}`);
await page.waitForTimeout(3000);
await startVoice();
await page.getByRole('button', { name: 'Stop', exact: true }).dblclick();
await page.waitForTimeout(3000);
check('double-click Stop inserts one block', (await page.locator('affine-attachment').count()) === 1, String(await page.locator('affine-attachment').count()));

// Deleting the paragraph the recording started from still keeps the recording.
await page.goto(`${BASE}/d/${await newDoc('Deleted anchor')}`);
await page.waitForTimeout(3000);
await startVoice();
await page.keyboard.press('Backspace'); // the empty line the slash item left
await page.keyboard.press('Backspace');
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Stop', exact: true }).click();
await page.waitForTimeout(3000);
const failMsg = await page.getByText('Could not add the voice note.').count();
check('recording kept when its paragraph was deleted', (await page.locator('affine-attachment').count()) === 1 && !failMsg, `${await page.locator('affine-attachment').count()} blocks, failMsg=${failMsg}`);

// Esc meant for something else does not throw the recording away.
await page.goto(`${BASE}/d/${await newDoc('Esc test')}`);
await page.waitForTimeout(3000);
await startVoice();
await page.getByRole('button', { name: /^Comments/ }).first().click();
await page.waitForTimeout(600);
await page.getByPlaceholder(/Add a comment/).last().click();
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('Esc outside the editor keeps the recording', (await page.getByRole('button', { name: 'Stop', exact: true }).count()) === 1);
const stopBtn = page.getByRole('button', { name: 'Stop', exact: true });
if (await stopBtn.count()) { await stopBtn.click(); await page.waitForTimeout(2000); }

// A reply's voice note stays with the thread it was recorded for.
const rdoc = await newDoc('Reply test');
await api('POST', `/api/docs/${rdoc}/comments`, { body: 'thread A' });
await api('POST', `/api/docs/${rdoc}/comments`, { body: 'thread B' });
await page.goto(`${BASE}/d/${rdoc}`);
await page.waitForTimeout(3000);
if (!(await page.getByText('thread A').count())) { await page.getByRole('button', { name: /^Comments/ }).first().click(); await page.waitForTimeout(800); }
const replyButtons = page.getByRole('button', { name: 'Reply', exact: true });
await replyButtons.nth(0).click();
await page.getByRole('button', { name: 'Record a voice note' }).first().click();
await page.getByRole('group', { name: 'Recording a voice note' }).waitFor({ timeout: 5000 });
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Stop and attach' }).click();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Reply', exact: true }).last().click();
await page.getByPlaceholder('Reply…').fill('words only');
await page.getByRole('button', { name: 'Send reply' }).click();
await page.waitForTimeout(1500);
const rrows = await api('GET', `/api/docs/${rdoc}/comments`);
const wordsOnly = rrows.find((r) => r.body === 'words only');
check('reply note does not follow to another thread', !!wordsOnly && !(wordsOnly.attachments?.length), JSON.stringify(wordsOnly?.attachments ?? 'no reply'));

// Guest view shows something for a voice-only comment.
const gctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const gp = await gctx.newPage();
await gp.goto(`${BASE}/share/${token}`);
await gp.waitForTimeout(3000);
const commentsBtn = gp.getByRole('button', { name: /comment/i }).first();
if (await commentsBtn.count()) { await commentsBtn.click(); await gp.waitForTimeout(1000); }
check('guest view shows the voice note', (await gp.locator('audio').count()) > 0, `${await gp.locator('audio').count()} audio`);

await browser.close();
console.log(results.join('\n'));

if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
