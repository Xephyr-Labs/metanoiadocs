// Voice notes: review-2 findings (edit, share scope, focus, live region, thread note, mic retry).
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8098';
const PW = 'voice-test-1';
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
let cookie = '';
const api = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  const t = await r.text();
  return { ok: r.ok, status: r.status, json: t ? JSON.parse(t) : {} };
};
await api('POST', '/api/setup', { name: 'Maya', username: 'maya', email: 'maya@example.com', password: PW });
await api('POST', '/api/auth/login', { username: 'maya', password: PW });
const newDoc = async (title) => { const d = (await api('POST', '/api/docs', { title, content: 'Line one.' })).json; return d.id ?? d.doc?.id; };
const putBlob = async (seed) => {
  const bytes = new Uint8Array(1500).map((_, i) => (i * seed) % 256);
  const key = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await fetch(`${BASE}/api/blob/${key}`, { method: 'PUT', headers: { 'content-type': 'audio/webm', cookie }, body: bytes });
  return key;
};

// 7. Edit the words out of a comment that has a voice note.
const edoc = await newDoc('Edit test');
const ekey = await putBlob(17);
const ec = (await api('POST', `/api/docs/${edoc}/comments`, { body: 'words', attachments: [{ key: ekey, name: 'n.webm', mime: 'audio/webm', size: 1500 }] })).json;
const patched = await api('PATCH', `/api/comments/${ec.id}`, { body: '' });
check('text can be edited out of a voice comment', patched.ok, String(patched.status));
const plain = (await api('POST', `/api/docs/${edoc}/comments`, { body: 'plain' })).json;
const patched2 = await api('PATCH', `/api/comments/${plain.id}`, { body: '' });
check('a text-only comment still cannot be emptied', patched2.status === 400, String(patched2.status));

// 8. A share token reads only what its page uses.
const sdoc = await newDoc('Share scope');
const own = await putBlob(23);
await api('POST', `/api/docs/${sdoc}/comments`, { body: '', attachments: [{ key: own, name: 'n.webm', mime: 'audio/webm', size: 1500 }] });
const other = await putBlob(29);
const { token } = (await api('POST', `/api/docs/${sdoc}/public`, { access: 'comment' })).json;
const ownRes = await fetch(`${BASE}/api/blob/${own}?share=${token}`);
const otherRes = await fetch(`${BASE}/api/blob/${other}?share=${token}`);
check('share token reads a note on its own page', ownRes.status === 200, String(ownRes.status));
check('share token cannot read an unrelated file', otherRes.status === 401 || otherRes.status === 403 || otherRes.status === 404, String(otherRes.status));

process.on('exit', () => console.log(results.join('\n')));
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies(cookie.split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
const page = await ctx.newPage();
const focused = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || document.activeElement?.tagName);
const startVoice = async (p = page) => {
  await p.getByText('Line one.').click();
  await p.keyboard.press('End');
  await p.keyboard.press('Enter');
  await p.keyboard.type('/voice', { delay: 60 });
  await p.waitForTimeout(600);
  await p.keyboard.press('Enter');
};

// 8b. The page's own audio block still plays for a guest.
await page.goto(`${BASE}/d/${sdoc}`);
await page.waitForTimeout(3000);
await startVoice();
await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ timeout: 5000 });
// 4. The pill's Stop takes focus.
check('pill Stop is focused when recording starts', (await focused()) === 'Stop', String(await focused()));
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Stop', exact: true }).click();
await page.waitForTimeout(4000);
const gctx = await browser.newContext();
const gp = await gctx.newPage();
const blobStatuses = [];
gp.on('response', (r) => { if (r.url().includes('/api/blob/')) blobStatuses.push(r.status()); });
await gp.goto(`${BASE}/share/${token}`);
await gp.waitForTimeout(4000);
check('guest still loads the page\'s own audio block', blobStatuses.length > 0 && blobStatuses.every((s) => s === 200 || s === 206), JSON.stringify(blobStatuses));

// 1. Switching to Edgeless while recording ends the recording.
await page.goto(`${BASE}/d/${await newDoc('Mode switch')}`);
await page.waitForTimeout(3000);
await startVoice();
await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ timeout: 5000 });
await page.getByText('Edgeless', { exact: true }).first().click();
await page.waitForTimeout(1500);
check('switching to Edgeless ends the recording', (await page.getByRole('button', { name: 'Stop', exact: true }).count()) === 0);
await page.getByText('Page', { exact: true }).first().click().catch(() => {});

// 2 + 3. Mic button keeps keyboard focus; the recording is a group, not a ticking live region.
const kdoc = await newDoc('Keyboard test');
await page.goto(`${BASE}/d/${kdoc}`);
await page.waitForTimeout(3000);
if (!(await page.getByRole('button', { name: 'Record a voice note' }).count())) { await page.getByRole('button', { name: /^Comments/ }).first().click(); await page.waitForTimeout(800); }
await page.getByRole('button', { name: 'Record a voice note' }).last().focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);
check('focus moves to Stop when recording starts', (await focused()) === 'Stop and attach', String(await focused()));
check('recording is a labelled group, not a status region', (await page.getByRole('group', { name: 'Recording a voice note' }).count()) === 1 && (await page.getByRole('status', { name: 'Recording a voice note' }).count()) === 0);
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
check('focus returns to the mic after stopping', (await focused()) === 'Record a voice note', String(await focused()));

// 6. Replying to another message in the same task thread keeps the note.
const proj = (await api('POST', '/api/projects', { name: 'Thread project', icon: '🧵', color: 'blue' })).json;
const task = (await api('POST', '/api/tasks', { projectId: proj.id ?? proj.project?.id, title: 'Thread task' })).json;
const taskId = task.id ?? task.task?.id;
const root = (await api('POST', `/api/tasks/${taskId}/comments`, { body: 'root message' })).json;
await api('POST', `/api/tasks/${taskId}/comments`, { body: 'second message', parentId: root.id });
const tdoc = (await api('POST', `/api/tasks/${taskId}/page`)).json.docId;
await page.goto(`${BASE}/d/${tdoc}`);
await page.waitForTimeout(3000);
if (!(await page.getByText('root message').count())) { await page.getByRole('button', { name: /^Comments/ }).first().click(); await page.waitForTimeout(800); }
const section = page.locator('section', { has: page.locator('h3') }).filter({ has: page.getByRole('button', { name: 'Post comment' }) });
await section.getByRole('button', { name: 'Reply', exact: true }).first().click();
await page.waitForTimeout(400);
await section.getByRole('button', { name: 'Record a voice note' }).first().click();
await page.waitForTimeout(1500);
await section.getByRole('button', { name: 'Stop and attach' }).click();
await page.waitForTimeout(2000);
await section.getByRole('button', { name: 'Reply', exact: true }).nth(1).click();
await page.waitForTimeout(400);
check('note survives replying to another message in the same thread', (await section.getByRole('button', { name: 'Remove voice note' }).count()) === 1);

// 5. After a refused mic, /voice can be tried again at once.
const bctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await bctx.addCookies(cookie.split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
const bp = await bctx.newPage();
await bp.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); });
await bp.goto(`${BASE}/d/${await newDoc('Retry test')}`);
await bp.waitForTimeout(3000);
await startVoice(bp);
await bp.waitForTimeout(500);
await startVoice(bp);
await bp.waitForTimeout(500);
const msgs = await bp.getByText("Microphone is blocked — allow it in the browser's site settings.").count();
check('a refused mic does not block the next try', msgs === 2, `${msgs} messages`);

await browser.close();

if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
