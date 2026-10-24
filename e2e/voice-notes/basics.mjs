// Voice notes: recording, playback, comments, replies, the /voice block, blocked mic.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8098';
const OUT = process.env.OUT || '/tmp';
const PW = 'voice-test-1';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };

function session() {
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
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  };
  return { call, cookie: () => cookie, post: (p, b) => call('POST', p, b ?? {}), get: (p) => call('GET', p) };
}

const maya = session();
await maya.post('/api/setup', { name: 'Maya', username: 'maya', email: 'maya@example.com', password: PW }).catch(() => {});
await maya.post('/api/auth/login', { username: 'maya', password: PW });
const doc = await maya.post('/api/docs', { title: 'Voice test', content: 'Hello voice notes.' });
const docId = doc.id ?? doc.doc?.id;

// --- server: blob mime stripped, inline audio with ranges ---
const bytes = new Uint8Array(2048).map((_, i) => i % 251);
const key = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
await fetch(`${BASE}/api/blob/${key}`, { method: 'PUT', headers: { 'content-type': 'audio/webm;codecs=opus', cookie: maya.cookie() }, body: bytes });
const got = await fetch(`${BASE}/api/blob/${key}`, { headers: { cookie: maya.cookie(), range: 'bytes=0-9' } });
check('blob stored without codec params, served inline', got.headers.get('content-type') === 'audio/webm', got.headers.get('content-type'));
check('blob range request', got.status === 206, String(got.status));

// --- server: empty comment still refused, malformed attachment refused ---
const empty = await fetch(`${BASE}/api/docs/${docId}/comments`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: maya.cookie() }, body: JSON.stringify({ body: '  ' }) });
check('empty comment refused', empty.status === 400);
const bad = await fetch(`${BASE}/api/docs/${docId}/comments`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: maya.cookie() }, body: JSON.stringify({ body: 'x', attachments: [{ key: '../x' }] }) });
check('malformed attachment refused', bad.status === 400);

// --- browser ---
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies(maya.cookie().split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const puts = [];
page.on('request', (r) => { if (r.method() === 'PUT' && r.url().includes('/api/blob/')) puts.push(r.url()); });

await page.goto(`${BASE}/d/${docId}`);
await page.waitForTimeout(2500);
await page.getByRole('button', { name: /^Comments/ }).first().click();
await page.waitForTimeout(800);

// 1. voice-only page comment
const panel = page.locator('body');
await panel.getByRole('button', { name: 'Record a voice note' }).last().click();
await page.getByRole('group', { name: 'Recording a voice note' }).waitFor({ timeout: 5000 });
await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Stop and attach' }).click();
await page.locator('audio').first().waitFor({ timeout: 10000 });
await page.getByRole('button', { name: 'Send', exact: true }).click();
await page.waitForTimeout(1500);
let rows = await maya.get(`/api/docs/${docId}/comments`);
const voice = rows.find((r) => r.attachments?.length);
check('voice-only page comment saved', !!voice && voice.body === '' && /^audio\/(webm|mp4)$/.test(voice.attachments[0].mime), JSON.stringify(voice?.attachments?.[0] ?? null));
check('note name format', /^Voice note \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.(webm|m4a)$/.test(voice?.attachments?.[0]?.name ?? ''), voice?.attachments?.[0]?.name);

// 2. reload: plays, duration finite (seekable before first play)
await page.reload();
await page.waitForTimeout(2500);
if (!(await page.locator('audio').count())) { await page.getByRole('button', { name: /^Comments/ }).first().click(); await page.waitForTimeout(1000); }
const dur = await page.locator('audio').first().evaluate(async (a) => {
  for (let i = 0; i < 40 && !(Number.isFinite(a.duration) && a.duration > 0); i++) await new Promise((r) => setTimeout(r, 100));
  return a.duration;
});
check('comment audio has finite duration after reload', Number.isFinite(dur) && dur > 1, String(dur));
await page.screenshot({ path: `${OUT}/e2e-comment.png` });

// 3. reply with text + voice
await page.getByRole('button', { name: 'Reply', exact: true }).first().click();
await page.getByPlaceholder('Reply…').fill('and a spoken answer');
await page.getByRole('button', { name: 'Record a voice note' }).first().click();
await page.getByRole('group', { name: 'Recording a voice note' }).waitFor({ timeout: 5000 });
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Stop and attach' }).click();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Send reply' }).click();
await page.waitForTimeout(1500);
rows = await maya.get(`/api/docs/${docId}/comments`);
const reply = rows.find((r) => r.parent_id && r.attachments?.length);
check('reply with text and voice saved', !!reply && reply.body === 'and a spoken answer', reply ? 'ok' : JSON.stringify(rows.map((r) => [r.body, r.attachments?.length])));

// 4. edit keeps the note
const edited = await fetch(`${BASE}/api/comments/${reply.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: maya.cookie() }, body: JSON.stringify({ body: 'edited words' }) });
rows = await maya.get(`/api/docs/${docId}/comments`);
check('edit keeps attachment', edited.ok && rows.find((r) => r.id === reply.id)?.attachments?.length === 1);

// 5. inbox text for voice-only — the author is not notified of their own comment, so use a second account
// (checked via unit test commentInput.notifyText; here: webhook-free path not observable without second user)

// 6. leave mid-recording: tracks stop, no upload
const before = puts.length;
await page.getByRole('button', { name: 'Record a voice note' }).last().click();
await page.getByRole('group', { name: 'Recording a voice note' }).waitFor({ timeout: 5000 });
await page.getByRole('button', { name: /^Comments/ }).first().click(); // close panel
await page.waitForTimeout(1500);
check('closing panel mid-recording uploads nothing', puts.length === before, `${puts.length - before} PUTs`);

// 7. /voice note in the page
await page.locator('.affine-paragraph-block-container, [data-block-id] [contenteditable="true"]').last().click();
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await page.keyboard.type('/voice', { delay: 60 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/e2e-slash.png` });
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ timeout: 5000 });
await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'Stop', exact: true }).click();
await page.waitForTimeout(2500);
const blockAudio = await page.locator('affine-attachment audio').count();
check('/voice note inserts a playing attachment block', blockAudio === 1, `${blockAudio} audio in attachment blocks`);
await page.screenshot({ path: `${OUT}/e2e-page.png` });
await page.waitForTimeout(2000);
await page.reload();
await page.waitForTimeout(3500);
const afterReload = await page.locator('affine-attachment audio').count();
check('page voice note survives reload', afterReload === 1, String(afterReload));
const blockDur = afterReload ? await page.locator('affine-attachment audio').first().evaluate(async (a) => {
  for (let i = 0; i < 40 && !(Number.isFinite(a.duration) && a.duration > 0); i++) await new Promise((r) => setTimeout(r, 100));
  return a.duration;
}) : NaN;
check('page audio has finite duration', Number.isFinite(blockDur) && blockDur > 1, String(blockDur));

// 8. blocked mic message
const ctx2 = await browser.newContext();
await ctx2.addCookies(maya.cookie().split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
const p2 = await ctx2.newPage();
await p2.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); });
await p2.goto(`${BASE}/d/${docId}`);
await p2.waitForTimeout(2500);
if (!(await p2.getByRole('button', { name: 'Record a voice note' }).count())) await p2.getByRole('button', { name: /^Comments/ }).first().click();
await p2.waitForTimeout(800);
await p2.getByRole('button', { name: 'Record a voice note' }).last().click();
await p2.waitForTimeout(800);
const blockedShown = await p2.getByText("Microphone is blocked — allow it in the browser's site settings.").count();
check('blocked mic message shown', blockedShown > 0);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(results.join('\n'));

if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
