// Voice notes: a second person, the inbox, task comments, comment player width.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8098';
const OUT = process.env.OUT || '/tmp';
const PW = 'voice-test-1';
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);

function session() {
  let cookie = '';
  const call = async (method, path, body) => {
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  };
  return { cookie: () => cookie, post: (p, b) => call('POST', p, b ?? {}), get: (p) => call('GET', p) };
}

const maya = session();
await maya.post('/api/auth/login', { username: 'maya', password: PW });
const sam = session();
try {
  await maya.post('/api/invites', { email: 'sam@example.com' }).catch((e) => { if (!/email failed/.test(e.message)) throw e; });
  await sam.post('/api/auth/register', { name: 'Sam', username: 'sam', email: 'sam@example.com', password: PW });
} catch { /* already there */ }
await sam.post('/api/auth/login', { username: 'sam', password: PW });

// Upload a fake note as Sam.
const bytes = new Uint8Array(4096).map((_, i) => (i * 7) % 256);
const key = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
await fetch(`${BASE}/api/blob/${key}`, { method: 'PUT', headers: { 'content-type': 'audio/webm;codecs=opus', cookie: sam.cookie() }, body: bytes });
const note = { key, name: 'Voice note 2026-10-22 10.00.webm', mime: 'audio/webm', size: bytes.length };

// Page comment from Sam on Maya's page → Maya's inbox says it's a voice note.
const doc = await maya.post('/api/docs', { title: 'Inbox test', content: 'x' });
const docId = doc.id ?? doc.doc?.id;
await maya.post(`/api/docs/${docId}/share`, { email: 'sam@example.com', role: 'editor' });
let posted = true;
await sam.post(`/api/docs/${docId}/comments`, { body: '', attachments: [note] }).catch((e) => { posted = false; results.push(`INFO sam page comment: ${e.message}`); });
if (posted) {
  await new Promise((r) => setTimeout(r, 1000));
  const inbox = await maya.get('/api/inbox');
  const n = inbox.find((x) => x.doc_id === docId);
  check('voice-only page comment reads as a voice note in the inbox', n?.body === '🎤 Voice note', JSON.stringify(n?.body));
}

// Task comment from Sam on Maya's task → API returns attachments, inbox says voice note.
const proj = await maya.post('/api/projects', { name: 'Voice project', icon: '🎤', color: 'blue' });
const projectId = proj.id ?? proj.project?.id;
const task = await maya.post('/api/tasks', { projectId, title: 'Voice task' });
const taskId = task.id ?? task.task?.id;
const row = await sam.post(`/api/tasks/${taskId}/comments`, { body: '', attachments: [note] });
check('task comment POST returns the attachment', row.attachments?.[0]?.key === key);
const trows = await maya.get(`/api/tasks/${taskId}/comments`);
check('task comment GET returns the attachment', trows.some((r) => r.attachments?.[0]?.key === key));
await new Promise((r) => setTimeout(r, 1000));
const inbox2 = await maya.get('/api/inbox');
const n2 = inbox2.find((x) => x.task_id === taskId);
check('voice-only task comment reads as a voice note in the inbox', n2?.body === '🎤 Voice note', JSON.stringify(n2?.body));

// Browser: task comments panel records too; comment player is wide enough to scrub.
const page2 = await maya.post(`/api/tasks/${taskId}/page`);
const taskDoc = page2.id ?? page2.docId ?? page2.doc_id ?? page2.doc?.id;
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies(maya.cookie().split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/d/${taskDoc}`);
await page.waitForTimeout(3000);
if (!(await page.getByRole('button', { name: 'Record a voice note' }).count())) await page.getByRole('button', { name: /^Comments/ }).first().click();
await page.waitForTimeout(1000);
const section = page.locator('section', { has: page.locator('h3') }).filter({ has: page.getByRole('button', { name: 'Post comment' }) });
await section.getByRole('button', { name: 'Record a voice note' }).click();
await page.getByRole('group', { name: 'Recording a voice note' }).waitFor({ timeout: 5000 });
await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'Stop and attach' }).click();
await page.waitForTimeout(1500);
await section.getByRole('button', { name: 'Post comment' }).click();
await page.waitForTimeout(1500);
const after = await maya.get(`/api/tasks/${taskId}/comments`);
check('task comment recorded in the UI', after.filter((r) => r.attachments?.length).length === 2, String(after.length));
const width = await page.locator('audio').first().evaluate((a) => a.getBoundingClientRect().width);
check('comment player is wide enough for a scrubber', width >= 200, `${Math.round(width)}px`);
await page.screenshot({ path: `${OUT}/e2e-task.png` });
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(results.join('\n'));

if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
