// Voice notes: Send waits for a note; removed and deleted notes leave storage, used ones stay.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8098';
const PW = 'voice-test-1';
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
process.on('exit', () => console.log(results.join('\n')));
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
const blobStatus = async (key) => (await fetch(`${BASE}/api/blob/${key}`, { headers: { cookie } })).status;

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies(cookie.split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
const page = await ctx.newPage();
const puts = [];
page.on('request', (r) => { if (r.method() === 'PUT' && r.url().includes('/api/blob/')) puts.push(r.url().split('/api/blob/')[1].split('?')[0]); });
const openComments = async () => {
  if (!(await page.getByRole('button', { name: 'Record a voice note' }).count())) { await page.getByRole('button', { name: /^Comments/ }).first().click(); await page.waitForTimeout(800); }
};
const record = async (ms = 1500) => {
  await page.getByRole('button', { name: 'Record a voice note' }).last().click();
  await page.getByRole('group', { name: 'Recording a voice note' }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(ms);
};

// Send while recording: the words wait for the note instead of going alone.
const d1 = await newDoc('Send while recording');
await page.goto(`${BASE}/d/${d1}`);
await page.waitForTimeout(3000);
await openComments();
await record();
await page.getByPlaceholder(/Add a comment/).last().fill('said and typed');
await page.getByPlaceholder(/Add a comment/).last().press('Enter');
await page.waitForTimeout(1200);
const early = (await api('GET', `/api/docs/${d1}/comments`)).json;
check('Send during a recording does not post the words alone', early.length === 0, `${early.length} posted`);
check('Send during a recording says why', (await page.getByText('Finish the voice note first.').count()) > 0);
await page.getByRole('button', { name: 'Stop and attach' }).click();
await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'Send', exact: true }).click();
await page.waitForTimeout(1500);
const later = (await api('GET', `/api/docs/${d1}/comments`)).json;
check('after stopping, words and note go together', later.length === 1 && later[0].body === 'said and typed' && later[0].attachments?.length === 1, JSON.stringify(later.map((c) => [c.body, c.attachments?.length])));

// Removing a pending note frees its storage.
const d2 = await newDoc('Remove pending');
await page.goto(`${BASE}/d/${d2}`);
await page.waitForTimeout(3000);
await openComments();
const before = puts.length;
await record();
await page.getByRole('button', { name: 'Stop and attach' }).click();
await page.waitForTimeout(2500);
const pendingKey = puts[before];
await page.getByRole('button', { name: 'Remove voice note' }).click();
await page.waitForTimeout(1500);
check('removing a pending note deletes the file', pendingKey && (await blobStatus(pendingKey)) === 404, `${pendingKey ? await blobStatus(pendingKey) : 'no upload'}`);

// Deleting a voice comment deletes its note…
const posted = (await api('POST', `/api/docs/${d2}/comments`, { body: '', attachments: [{ key: later[0].attachments[0].key, name: 'n.webm', mime: 'audio/webm', size: 1 }] })).json;
const sharedKey = later[0].attachments[0].key; // also on the first comment, so it must survive
await api('DELETE', `/api/comments/${posted.id}`);
check('a note still used by another comment survives a delete', (await blobStatus(sharedKey)) === 200);
await api('DELETE', `/api/comments/${later[0].id}`);
await page.waitForTimeout(300);
check('deleting the last comment that uses a note deletes the file', (await blobStatus(sharedKey)) === 404, String(await blobStatus(sharedKey)));

// …but never one the page itself uses.
const d3 = await newDoc('Page keeps it');
await page.goto(`${BASE}/d/${d3}`);
await page.waitForTimeout(3000);
const b3 = puts.length;
await page.getByText('Line one.').click();
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await page.keyboard.type('/voice', { delay: 60 });
await page.waitForTimeout(600);
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ timeout: 5000 });
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Stop', exact: true }).click();
await page.waitForTimeout(5000); // the page's state reaches the server
const pageKey = puts[b3];
const c3 = (await api('POST', `/api/docs/${d3}/comments`, { body: '', attachments: [{ key: pageKey, name: 'n.webm', mime: 'audio/webm', size: 1 }] })).json;
await api('DELETE', `/api/comments/${c3.id}`);
check('a note the page uses survives deleting a comment that shared it', pageKey && (await blobStatus(pageKey)) === 200, String(pageKey && await blobStatus(pageKey)));

// Only the uploader's own unused note can be removed through the API.
const other = (await api('DELETE', `/api/blob/${pageKey}/unused`)).status;
check('a note in use cannot be removed through the API', other !== 200 || (await blobStatus(pageKey)) === 200, String(other));

await browser.close();

if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
