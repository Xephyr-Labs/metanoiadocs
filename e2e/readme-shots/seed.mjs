// The fictional workspace the README screenshots are taken in: four people
// (one of them an agent account), six pages, two projects. Run once against an
// empty stack (see compose.yml), then backdate.sql, then shots.mjs.
//
// Dates are written relative to the day it runs, a whole number of weeks after
// the day the content was written for, so weekdays in the text stay true and
// nothing on the board is months overdue.
//
//   BASE=http://localhost:8097 node seed.mjs
const BASE = process.env.BASE || 'http://localhost:8097';
const PASSWORD = 'readme-demo-1';

const DAY = 86400000;
// The content reads as of Monday 21 September 2026: freeze done, tokens in
// progress, launch four weeks out.
const WRITTEN_FOR = Date.UTC(2026, 8, 21);
const today = new Date(); today.setUTCHours(0, 0, 0, 0);
const shift = Math.floor((today - WRITTEN_FOR) / (7 * DAY)) * 7 * DAY;
const moved = (iso) => new Date(Date.parse(iso) + shift);
/** '2026-09-22' as it falls today, YYYY-MM-DD. */
const d = (iso) => (iso ? moved(iso).toISOString().slice(0, 10) : undefined);
const fmt = (iso, month) => moved(iso).toLocaleDateString('en-GB', { day: 'numeric', month, timeZone: 'UTC' });
const monthOf = (iso) => moved(iso).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });

/** Swap every dated phrase in one pass, so a new date never gets swapped again. */
function redate(text, pairs) {
  const map = new Map(pairs);
  const re = new RegExp([...map.keys()].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  return text.replace(re, (m) => map.get(m));
}

// ---- http, one cookie jar per person ---------------------------------------
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
  return { post: (p, b) => call('POST', p, b ?? {}), patch: (p, b) => call('PATCH', p, b), put: (p, b) => call('PUT', p, b), get: (p) => call('GET', p) };
}

const people = {
  maya: { name: 'Maya Okonkwo', email: 'maya@example.com' },
  sam: { name: 'Sam Tan', email: 'sam@example.com' },
  elena: { name: 'Elena Ruiz', email: 'elena@example.com' },
  ravi: { name: 'Ravi Menon', email: 'ravi@example.com' },
};
for (const [username, p] of Object.entries(people)) p.as = session(), p.username = username;
const { maya, sam, elena, ravi } = people;

await maya.as.post('/api/setup', { name: maya.name, username: 'maya', email: maya.email, password: PASSWORD });
await maya.as.post('/api/auth/login', { username: 'maya', password: PASSWORD });
for (const p of [sam, elena, ravi]) {
  await maya.as.post('/api/invites', { email: p.email }).catch((e) => { if (!/email failed/.test(e.message)) throw e; });
  await p.as.post('/api/auth/register', { name: p.name, username: p.username, email: p.email, password: PASSWORD });
  await p.as.post('/api/auth/login', { username: p.username, password: PASSWORD });
}
const users = await maya.as.get('/api/users');
for (const p of Object.values(people)) p.id = users.find((u) => u.username === p.username).id;
await maya.as.patch(`/api/users/${ravi.id}/kind`, { kind: 'agent' });

// ---- pages -----------------------------------------------------------------
const folders = {};
for (const name of ['Product', 'Engineering', 'Marketing']) folders[name] = (await maya.as.post('/api/folders', { name })).id;

const launch = fmt('2026-10-20', 'long');
const dates = [
  ['20 October', launch], ['9 September', fmt('2026-09-09', 'long')], ['15 September', fmt('2026-09-15', 'long')],
  ['15 Sep', fmt('2026-09-15', 'short')], ['22 Sep', fmt('2026-09-22', 'short')], ['6 Oct', fmt('2026-10-06', 'short')], ['13 Oct', fmt('2026-10-13', 'short')],
  ['(October)', `(${monthOf('2026-10-20')})`], ['(November)', `(${monthOf('2026-11-14')})`],
  ['(November–December)', `(${monthOf('2026-11-14')}–${monthOf('2026-12-14')})`],
  ['for November', `for ${monthOf('2026-11-14')}`], ['moves in November', `moves in ${monthOf('2026-11-14')}`],
  ['a November project', `a ${monthOf('2026-11-14')} project`],
];
const { pages } = await import('./content.mjs');
const docs = {};
for (const page of pages) {
  const made = await maya.as.post('/api/docs', {
    title: redate(page.title, dates), icon: page.icon, folderId: folders[page.folder], content: redate(page.body, dates),
  });
  docs[page.key] = made.id ?? made.doc?.id;
  for (const [name, color] of page.tags) await maya.as.post(`/api/docs/${docs[page.key]}/tags`, { name, color });
}
for (const k of ['launch', 'onboarding']) await maya.as.put(`/api/docs/${docs[k]}/pin`, { pinned: true });
for (const k of ['launch', 'roadmap', 'principles']) await maya.as.put(`/api/docs/${docs[k]}/favorite`, { favorite: true });

// ---- projects --------------------------------------------------------------
const tasks = {};
async function project(name, icon, color, list) {
  const p = await maya.as.post('/api/projects', { name, icon, color });
  const id = p.id ?? p.project?.id;
  const sprint = await maya.as.post(`/api/projects/${id}/sprints`, { name: 'Sprint 1', startAt: d('2026-09-14'), endAt: d('2026-09-27') });
  await maya.as.patch(`/api/sprints/${sprint.id ?? sprint.sprint?.id}`, { state: 'active' });
  for (const t of list) {
    const by = people[t.by ?? 'maya'];
    const made = await by.as.post('/api/tasks', {
      projectId: id, title: t.title, kind: t.kind, status: t.status,
      startAt: d(t.start), dueAt: d(t.due), assigneeIds: t.who ? [people[t.who].id] : [],
      parentId: t.parent ? tasks[t.parent] : undefined, sprintId: t.sprint ? (sprint.id ?? sprint.sprint?.id) : undefined,
    });
    tasks[t.ref] = made.id ?? made.task?.id;
    await by.as.patch(`/api/tasks/${tasks[t.ref]}`, {
      points: t.points ?? null, progress: t.progress ?? 0, priority: t.priority ?? 0, milestone: !!t.milestone,
    });
    for (const dep of t.deps ?? []) await maya.as.post(`/api/tasks/${tasks[t.ref]}/deps`, { dependsOn: tasks[dep] });
  }
}
const { websiteRelaunch, mobileApp } = await import('./content.mjs');
await project('Website relaunch', '🌐', 'blue', websiteRelaunch);
await project('Mobile app', '📱', 'purple', mobileApp);

// ---- conversation on the launch plan ---------------------------------------
await sam.as.post(`/api/docs/${docs.launch}/comments`, { body: `The redirect map is the real risk here. @maya can we walk it before ${fmt('2026-10-13', 'short')} rather than on it?` });
await maya.as.post(`/api/docs/${docs.launch}/comments`, { body: `Yes — Thursday with the search team. I will bring the top-40 list. @sam can the pricing skeleton take the real tokens by Friday?` });
await elena.as.post(`/api/docs/${docs.launch}/comments`, { body: 'Two of the twelve pages still need legal review on the quotes. Chasing this week.' });

console.log(JSON.stringify({ docs, tasks, users: Object.fromEntries(Object.values(people).map((p) => [p.username, p.id])) }));
