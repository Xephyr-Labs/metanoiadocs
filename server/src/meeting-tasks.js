/**
 * "Make tasks from to-dos": every open to-do line on a page becomes a task in a
 * database the person picks — @handle → assignee, a simple date phrase → due
 * date — and the line is then linked to its task, which is what makes a second
 * run skip it.
 */
import * as Y from 'yjs';
import { dayIn, zoneOf } from './timezone.js';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// "by"/"on"/"due" ride along so "send the deck by Friday" leaves "send the deck".
// The lookarounds keep "today's" and "@friday" from reading as dates.
const DUE_RE = new RegExp(
  `(?<![\\w@'’-])(?:(?:by|on|due)\\s+)?(\\d{4}-\\d{2}-\\d{2}|today|tomorrow|${WEEKDAYS.join('|')})(?![\\w'’-])`,
  'gi',
);
// mentions.js's handle, minus email addresses: an @ after a word char or dot
// (ana@example.com) is not a mention here.
const HANDLE_RE = /(?<![\w.])@([a-z0-9][a-z0-9._-]*)/gi;
const handleOf = (h) => h.replace(/[.]+$/, '').toLowerCase();

const addDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const realIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;

/** The day a phrase names, counted from `today` ('YYYY-MM-DD'), or null. */
function dayFor(phrase, today) {
  const p = phrase.toLowerCase();
  if (p === 'today') return today;
  if (p === 'tomorrow') return addDays(today, 1);
  const want = WEEKDAYS.indexOf(p);
  if (want >= 0) {
    const [y, m, d] = today.split('-').map(Number);
    const now = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    // The coming one — today when today is that day (ledger ruling 1).
    return addDays(today, (want - now + 7) % 7);
  }
  return realIso(phrase) ? phrase : null;
}

/**
 * One to-do line → `{ title, handles, dueAt }`. Pure.
 *
 * `today` is the person's own date (defaults to today in `zone`). `known`, when
 * given, is the lower-cased handles that resolve to people: only those leave the
 * title, so an unknown @name stays readable in it. Without it every handle goes.
 */
export function parseTodo(text, { today, zone, known } = {}) {
  const day = today ?? dayIn(zone);
  let title = String(text ?? '');
  let dueAt = null;
  for (const m of title.matchAll(DUE_RE)) {
    const d = dayFor(m[1], day);
    if (!d) continue;
    dueAt = d;
    title = title.slice(0, m.index) + ' ' + title.slice(m.index + m[0].length);
    break;
  }
  const handles = [...new Set([...title.matchAll(HANDLE_RE)].map((m) => handleOf(m[1])).filter(Boolean))];
  title = title.replace(HANDLE_RE, (whole, h, at, all) => {
    const handle = handleOf(h);
    if (known && !known.has(handle)) return whole;
    // "@ana's deck" reads as "ana's deck", not "'s deck".
    if (/['’]/.test(all[at + whole.length] ?? '')) return h;
    return h.slice(handle.length); // keeps a sentence's full stop
  });
  title = title.replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
  return { title, handles, dueAt };
}

/** True when the text already carries a link to a task (`/db/...`). */
function linkedToTask(text, baseUrl) {
  const abs = baseUrl ? `${String(baseUrl).replace(/\/+$/, '')}/db/` : null;
  return text.toDelta().some((op) => {
    const link = op.attributes?.link;
    return typeof link === 'string' && (link.startsWith('/db/') || (abs && link.startsWith(abs)));
  });
}

/**
 * The page's to-do lines in page order: `todos` are the open, unlinked ones
 * ({ blockId, text }); `skipped` counts the checked or linked ones. Empty lines
 * (the notes template ends with one) are neither.
 */
export function openTodos(doc, baseUrl) {
  const blocks = doc.getMap('blocks');
  const todos = [];
  let skipped = 0;
  const seen = new Set();
  const walk = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const b = blocks.get(id);
    if (!(b instanceof Y.Map)) return;
    const text = b.get('prop:text');
    if (b.get('sys:flavour') === 'affine:list' && b.get('prop:type') === 'todo' && text instanceof Y.Text) {
      const plain = text.toString();
      if (plain.trim()) {
        if (b.get('prop:checked') || linkedToTask(text, baseUrl)) skipped++;
        else todos.push({ blockId: id, text: plain });
      }
    }
    const kids = b.get('sys:children');
    if (kids instanceof Y.Array) for (const c of kids.toArray()) walk(c);
  };
  for (const [id, b] of blocks) {
    if (b instanceof Y.Map && b.get('sys:flavour') === 'affine:page') walk(id);
  }
  return { todos, skipped };
}

/**
 * Link a line to its task without touching what it already links: runs that
 * carry a link or a page reference keep theirs, the rest get the task's. A line
 * with no plain run left gets a short linked marker, so it still reads as linked.
 */
function linkLine(text, link) {
  let at = 0;
  let done = false;
  for (const op of text.toDelta()) {
    const len = typeof op.insert === 'string' ? op.insert.length : 1;
    if (!op.attributes?.link && !op.attributes?.reference) {
      text.format(at, len, { link });
      done = true;
    }
    at += len;
  }
  if (!done) text.insert(text.length, ' ↗', { link });
}

/**
 * Deps: `editGrant(docId, userId)` → role|null; `createTask(body, user)` →
 * `{ task } | { status, error }` (tasks.js createTaskRow); `taskPage(taskId,
 * userId, markdown)` writes the task's own page; `getHocuspocus()`.
 */
export function registerMeetingTaskRoutes(app, {
  requireUser, needsPerson, wrap, pool, editGrant, getHocuspocus, createTask, taskPage,
  baseUrl = process.env.BASE_URL,
}) {
  // ponytail: in-process guard against a double click making every task twice;
  // a single server instance is the deployment, a row lock if that changes.
  const running = new Set();

  app.post('/api/docs/:id/make-tasks', requireUser, needsPerson, wrap(async (req, res) => {
    const docId = req.params.id;
    if (!(await editGrant(docId, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : '';
    if (!projectId) return res.status(400).json({ error: 'projectId required' });
    const d = await pool.query('SELECT 1 FROM docs WHERE id = $1 AND deleted_at IS NULL', [docId]);
    if (!d.rows[0]) return res.status(404).json({ error: 'not found' });
    const p = await pool.query('SELECT mode, archived_at FROM projects WHERE id = $1', [projectId]);
    if (!p.rows[0] || p.rows[0].archived_at) return res.status(404).json({ error: 'no such database' });
    if (p.rows[0].mode === 'data') return res.status(400).json({ error: 'that database does not hold tasks' });
    if (running.has(docId)) return res.status(409).json({ error: 'already making tasks from this page' });

    running.add(docId);
    let conn;
    try {
      conn = await getHocuspocus().openDirectConnection(docId, { docId, user: req.user });
    } catch (err) {
      running.delete(docId);
      throw err;
    }
    try {
      let { todos, skipped } = openTodos(conn.document, baseUrl);
      const wanted = [...new Set(todos.flatMap((t) => parseTodo(t.text, { today: '2000-01-01' }).handles))];
      const { rows: people } = wanted.length
        ? await pool.query(
          `SELECT id, lower(username) AS handle FROM users
            WHERE lower(username) = ANY($1) AND kind <> 'agent'`, [wanted])
        : { rows: [] };
      const idOf = new Map(people.map((u) => [u.handle, u.id]));
      const today = dayIn(zoneOf(req.user));
      const known = new Set(idOf.keys());

      const created = [];
      const links = [];
      let failure = null;
      let tried = 0;
      try {
        for (const t of todos) {
          tried++;
          const parsed = parseTodo(t.text, { today, known });
          if (!parsed.title) { skipped++; continue; }
          const made = await createTask({
            projectId, title: parsed.title, dueAt: parsed.dueAt,
            assigneeIds: parsed.handles.map((h) => idOf.get(h)).filter(Boolean),
          }, req.user);
          if (made.error) { failure = made; tried--; break; }
          const taskId = made.task.id;
          created.push({ taskId, title: parsed.title });
          links.push({ blockId: t.blockId, link: `/db/${encodeURIComponent(projectId)}?task=${encodeURIComponent(taskId)}` });
          await taskPage(taskId, req.user.id, `From meeting notes: [[${docId}]]`)
            .catch((err) => console.error('[make-tasks] page:', err.message));
        }
      } catch (err) {
        failure = { thrown: err };
        tried--;
      }
      // Whatever was made gets its link, even after a failure: an unlinked line
      // with a task behind it would be made again on the next run.
      if (links.length) {
        await conn.transact((doc) => {
          const blocks = doc.getMap('blocks');
          for (const { blockId, link } of links) {
            const text = blocks.get(blockId)?.get('prop:text');
            if (text instanceof Y.Text) linkLine(text, link);
          }
        });
      }
      if (failure && !created.length) {
        if (failure.thrown) throw failure.thrown;
        return res.status(failure.status).json({ error: failure.error });
      }
      if (!failure) return res.json({ created, skipped });
      const error = failure.thrown?.message ?? failure.error;
      console.error('[make-tasks]', error);
      res.json({ created, skipped, failed: todos.length - tried, error });
    } finally {
      running.delete(docId);
      await conn.disconnect().catch(() => {});
    }
  }));
}
