// Voice-note transcripts against the Deepgram stand-in (deepgram-stub.mjs):
// settings, the transcript under a comment's note, a page block's toolbar,
// an older note transcribed on first open, and who may see or change what.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8098';
const STUB = process.env.STUB || 'http://localhost:8094';
const OUT = process.env.OUT || '/tmp';
const PW = 'voice-test-1';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: threw`, false, String(e?.message || e).slice(0, 300)); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function session() {
  let cookie = '';
  const raw = async (method, path, body, headers = {}) => {
    const r = await fetch(BASE + path, {
      method,
      headers: { ...(body instanceof Uint8Array ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
    });
    const set = r.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await r.text();
    let json = text; try { json = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
    return { status: r.status, json };
  };
  const call = async (method, path, body) => {
    const r = await raw(method, path, body);
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    return r.json;
  };
  return { raw, call, cookie: () => cookie, post: (p, b) => call('POST', p, b ?? {}), get: (p) => call('GET', p) };
}
const listens = async () => (await (await fetch(`${STUB}/count`)).json()).listens;
const putAudio = async (who, bytes, mime = 'audio/webm', voiceNote = true) => {
  const key = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await who.raw('PUT', `/api/blob/${key}`, bytes, { 'content-type': mime, ...(voiceNote ? { 'x-voice-note': '1' } : {}) });
  return key;
};
const until = async (fn, ms = 10000) => { for (let t = 0; t < ms; t += 250) { const v = await fn(); if (v) return v; await wait(250); } return null; };

const maya = session();
await maya.post('/api/setup', { name: 'Maya', username: 'maya', email: 'maya@example.com', password: PW }).catch(() => {});
await maya.post('/api/auth/login', { username: 'maya', password: PW });
const sam = session();
await maya.post('/api/invites', { email: 'sam@example.com' }).catch(() => {});
await sam.post('/api/auth/register', { name: 'Sam', username: 'sam', email: 'sam@example.com', password: PW }).catch(() => {});
await sam.post('/api/auth/login', { username: 'sam', password: PW });
// Start from off, whatever an earlier run left.
await maya.raw('PUT', '/api/settings/transcription', { enabled: false });

let oldKey;
await step('off', async () => {
  const s = await sam.get('/api/settings/transcription');
  check('off: a member reads the setting, no key in it', s.enabled === false && !('apiKey' in s), JSON.stringify(s));
  const before = await listens();
  oldKey = await putAudio(maya, new Uint8Array(3000).map((_, i) => i % 199));
  await wait(2500);
  check('off: an upload is not sent to Deepgram', (await listens()) === before);
  const t = await maya.get(`/api/blob/${oldKey}/transcript`);
  check('off: the transcript says off', t.status === 'off', JSON.stringify(t));
  const anon = await fetch(`${BASE}/api/blob/${oldKey}/transcript`);
  check('signed-out readers get no transcript (401)', anon.status === 401, String(anon.status));
});

await step('settings', async () => {
  const r = await sam.raw('PUT', '/api/settings/transcription', { enabled: true, apiKey: 'good-key' });
  check('settings: a member cannot change it (403)', r.status === 403, String(r.status));
  const noKey = await maya.raw('PUT', '/api/settings/transcription', { enabled: true });
  check('settings: turning on with no key is refused', noKey.status === 400, JSON.stringify(noKey.json));
  const bad = await maya.raw('PUT', '/api/settings/transcription', { enabled: true, apiKey: 'typo-key' });
  check('settings: a key Deepgram rejects is not kept', bad.status === 400 && /did not accept/.test(bad.json.error), JSON.stringify(bad.json));
});

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctxFor = async (who, viewport = { width: 1400, height: 900 }) => {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies(who.cookie().split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
  return ctx;
};
const errors = [];

await step('settings-ui', async () => {
  const ctx = await ctxFor(maya);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/'); await page.waitForTimeout(2500);
  await page.locator('aside').getByRole('button', { name: 'Settings' }).last().click();
  await page.getByRole('button', { name: 'Voice transcription' }).click();
  await page.waitForTimeout(500);
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('group', { name: 'Enabled' }).getByRole('switch').click();
  await dlg.locator('input[type=password]').fill('typo-key');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(800);
  check('settings UI: a rejected key says so', (await dlg.getByText('Deepgram did not accept that key.').count()) === 1);
  await dlg.locator('input[type=password]').fill('good-key');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(800);
  check('settings UI: a good key saves', (await dlg.getByRole('status').filter({ hasText: 'Saved.' }).count()) === 1);
  const s = await maya.get('/api/settings/transcription');
  check('settings UI: on, key stored, auto language', s.enabled && s.keySet && s.language === 'auto', JSON.stringify(s));
  await page.screenshot({ path: `${OUT}/e2e-transcription-settings.png` });
  await ctx.close();

  const sctx = await ctxFor(sam);
  const sp = await sctx.newPage();
  await sp.goto(BASE + '/'); await sp.waitForTimeout(2500);
  await sp.locator('aside').getByRole('button', { name: 'Settings' }).last().click();
  await sp.getByRole('button', { name: 'Voice transcription' }).click();
  await sp.waitForTimeout(500);
  const sd = sp.getByRole('dialog');
  check('settings UI: a member sees it read-only, and that it is on',
    (await sd.getByText('Only workspace admins can change these.').count()) === 1 && await sd.locator('input[type=password]').isDisabled());
  await sctx.close();
});

const doc = await maya.post('/api/docs', { title: 'Transcript test', content: 'Hello.' });

await step('upload', async () => {
  const before = await listens();
  const key = await putAudio(maya, new Uint8Array(4321).map((_, i) => (i * 7) % 251), 'audio/mp4;codecs=mp4a.40.2');
  const t = await until(async () => { const r = await maya.get(`/api/blob/${key}/transcript`); return r.status === 'done' && r; });
  check('upload: an audio upload is transcribed in the background', t?.text === 'Stub transcript of 4321 bytes.' && t.language === 'en', JSON.stringify(t));
  check('upload: Deepgram was called once', (await listens()) === before + 1);
  await maya.get(`/api/blob/${key}/transcript`);
  check('upload: reading it again does not call Deepgram again', (await listens()) === before + 1);
  const img = new Uint8Array(500).fill(3);
  const ikey = [...new Uint8Array(await crypto.subtle.digest('SHA-256', img))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await maya.raw('PUT', `/api/blob/${ikey}`, img, { 'content-type': 'image/png' });
  await wait(2000);
  check('upload: a non-audio upload is not transcribed', (await listens()) === before + 1 && (await maya.get(`/api/blob/${ikey}/transcript`)).status === 'none');
  // Audio that is not a voice note (a file attached to a task) waits until asked.
  const att = await putAudio(maya, new Uint8Array(1234).map((_, i) => (i * 3) % 241), 'audio/mpeg', false);
  await wait(2500);
  check('upload: an attached audio file is not transcribed unasked', (await listens()) === before + 1);
  const asked = await until(async () => { const r = await maya.get(`/api/blob/${att}/transcript`); return r.status === 'done' && r; });
  check('upload: ...but is when someone opens its transcript', asked?.text === 'Stub transcript of 1234 bytes.', JSON.stringify(asked));
  // Nothing past 10 MB goes to Deepgram, on any path.
  const big = await putAudio(maya, new Uint8Array(10 * 1024 * 1024 + 10).map((_, i) => i % 233), 'audio/mpeg', true);
  const n = await listens();
  const tl = await maya.get(`/api/blob/${big}/transcript`);
  await wait(2500);
  check('upload: an audio file over 10 MB is never sent, even when asked', tl.status === 'toolong' && (await listens()) === n, JSON.stringify(tl));
});

await step('older', async () => {
  const first = await maya.get(`/api/blob/${oldKey}/transcript`);
  check('older: a note from before is started on first ask', first.status === 'pending', JSON.stringify(first));
  const t = await until(async () => { const r = await maya.get(`/api/blob/${oldKey}/transcript`); return r.status === 'done' && r; });
  check('older: ...and finishes', t?.text === 'Stub transcript of 3000 bytes.', JSON.stringify(t));
});

await step('comment', async () => {
  const ctx = await ctxFor(sam);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/d/${doc.id}`); await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /^Comments/ }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Record a voice note' }).last().click();
  await page.getByRole('group', { name: 'Recording a voice note' }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Stop and attach' }).click();
  await page.locator('audio').first().waitFor({ timeout: 10000 });
  check('comment: the composer\'s pending note has no Transcript toggle', (await page.getByRole('button', { name: 'Transcript', exact: true }).count()) === 0);
  const before = await listens();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForTimeout(1200);
  check('comment: the recorded note was sent to Deepgram without anyone asking', !!(await until(async () => (await listens()) > before, 8000)));
  const toggle = page.getByRole('button', { name: 'Transcript', exact: true }).first();
  check('comment: a sent note shows a folded Transcript toggle', await toggle.isVisible() && (await toggle.getAttribute('aria-expanded')) === 'false');
  check('comment: the text is hidden until opened', (await page.getByText(/^Stub transcript of \d+ bytes\.$/).count()) === 0);
  await toggle.click();
  const text = await page.getByText(/^Stub transcript of \d+ bytes\.$/).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  check('comment: opening it shows the transcript', text);
  await page.screenshot({ path: `${OUT}/e2e-transcript-comment.png` });
  await toggle.click();
  check('comment: it folds away again', (await page.getByText(/^Stub transcript of \d+ bytes\.$/).count()) === 0);
  await ctx.close();
});

await step('page', async () => {
  const ctx = await ctxFor(maya);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/d/${doc.id}`); await page.waitForTimeout(2500);
  await page.locator('.affine-paragraph-block-container, [data-block-id] [contenteditable="true"]').last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/voice', { delay: 60 });
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(2000);
  const before = await listens();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.locator('affine-attachment audio').first().waitFor({ timeout: 10000 });
  check('page: the /voice note was sent to Deepgram without anyone asking', !!(await until(async () => (await listens()) > before, 10000)));
  await page.waitForTimeout(1000);
  // Select the block so its toolbar shows.
  const block = page.locator('affine-attachment').first();
  const box = await block.boundingBox();
  await page.mouse.click(box.x + box.width - 12, box.y + 6);
  await page.waitForTimeout(800);
  const btn = page.locator('editor-icon-button[aria-label="Transcript"], [aria-label="Transcript"]').first();
  const has = await btn.count();
  check('page: the voice block\'s toolbar offers Transcript', has > 0);
  if (has) {
    await btn.click();
    const card = page.getByRole('dialog', { name: 'Transcript' });
    const shown = await card.getByText(/^Stub transcript of \d+ bytes\.$/).waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
    check('page: it opens the transcript under the block', shown);
    await page.screenshot({ path: `${OUT}/e2e-transcript-page.png` });
    check('page: focus moves into the card', await card.evaluate((c) => c.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check('page: Esc closes it', (await card.count()) === 0);
    await btn.click();
    await card.waitFor({ timeout: 5000 });
    await page.goto(`${BASE}/`); await page.waitForTimeout(1500);
    check('page: leaving the page closes the card', (await page.getByRole('dialog', { name: 'Transcript' }).count()) === 0);
  }
  await ctx.close();
});

await step('turned-off', async () => {
  await maya.call('PUT', '/api/settings/transcription', { enabled: false });
  const ctx = await ctxFor(maya);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/d/${doc.id}`); await page.waitForTimeout(2500);
  if (!(await page.locator('audio').count())) { await page.getByRole('button', { name: /^Comments/ }).first().click(); await page.waitForTimeout(1000); }
  check('turned off: no Transcript toggle under notes', (await page.locator('audio').count()) > 0 && (await page.getByRole('button', { name: 'Transcript', exact: true }).count()) === 0);
  const again = await maya.call('PUT', '/api/settings/transcription', { enabled: true });
  check('turned on again: the stored key is kept', again.enabled && again.keySet);
  await ctx.close();
});

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(results.join('\n'));
if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
