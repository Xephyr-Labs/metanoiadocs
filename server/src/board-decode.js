// Read task rows out of a BlockSuite `affine:database` block stored as Yjs.
// Ported from the standalone taskgantt service (/opt/taskgantt/decode.js) —
// same walk, but undated rows are kept (they still belong on a board) and the
// output is shaped for the tasks table rather than for a gantt renderer.
import * as Y from 'yjs';

export function docFromState(buf) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  return doc;
}

const json = (v) => (v && v.toJSON ? v.toJSON() : v);
const arr = (v) => (v ? (v.toArray ? v.toArray() : v) : []);

/** Cell value -> YYYY-MM-DD, or null. BlockSuite stores epoch ms. */
export function toDateStr(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') {
    const m = v.match(/^\d{4}-\d{2}-\d{2}/);
    if (m) return m[0];
    const n = Number(v);
    if (Number.isNaN(n)) return null;
    v = n;
  }
  if (typeof v !== 'number') return null;
  const d = new Date(v < 1e12 ? v * 1000 : v); // tolerate seconds
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Free-text status -> one of the four statuses the tasks table allows. */
export function normalizeStatus(s) {
  if (!s) return 'todo';
  if (/done|complete|closed|ship|finish/i.test(s)) return 'done';
  if (/review|qa|test|verify/i.test(s)) return 'review';
  if (/doing|progress|active|wip|ongoing|started/i.test(s)) return 'doing';
  return 'todo';
}

export function statusToProgress(status) {
  return { done: 100, review: 75, doing: 50, todo: 0 }[status] ?? 0;
}

// A dependency cell is either free text (comma/newline separated names) or a
// multi-select (option ids that must be resolved through the column's options).
function depNamesFrom(val, col) {
  if (val == null || val === '') return [];
  if (Array.isArray(val)) {
    const opts = Object.fromEntries((col?.data?.options || []).map((o) => [o.id, o.value]));
    return val.map((v) => opts[v] || v);
  }
  return String(val).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Find the task database in a page doc and return its rows.
 * The task board is the `affine:database` block that has date columns — a page
 * may hold other tables that are not schedules.
 */
export function extractTasks(pageDoc) {
  const blocks = pageDoc.getMap('blocks');
  let db = null;
  blocks.forEach((b) => {
    if (db || b.get('sys:flavour') !== 'affine:database') return;
    if (arr(b.get('prop:columns')).map(json).some((c) => c.type === 'date')) db = b;
  });
  if (!db) return { found: false, tasks: [] };

  const cols = arr(db.get('prop:columns')).map(json);
  const dateCols = cols.filter((c) => c.type === 'date');
  const byName = (re) => cols.find((c) => re.test(c.name || ''));
  const startCol = byName(/start|begin/i) || dateCols[0];
  const dueCol = byName(/due|end|finish/i) || dateCols[1] || dateCols[0];
  const statusCol = byName(/status|state/i) || cols.find((c) => c.type === 'select');
  const statusOpts = Object.fromEntries((statusCol?.data?.options || []).map((o) => [o.id, o]));
  const progressCol = cols.find((c) => c.type === 'number' && /progress|percent|%|complete/i.test(c.name || ''));
  const depCol = byName(/depend|block|predecessor/i);
  const assigneeCol = cols.find((c) => c.type === 'member') || byName(/assignee|owner|assigned/i);
  const milestoneCol =
    cols.find((c) => c.type === 'checkbox' && /milestone/i.test(c.name || '')) || byName(/milestone/i);

  const cells = db.get('prop:cells');
  const tasks = [];
  for (const rid of arr(db.get('sys:children'))) {
    const rowBlock = blocks.get(rid);
    if (!rowBlock) continue;
    const text = rowBlock.get('prop:text');
    const name = (text ? text.toString() : '').trim();
    const cj = json(cells ? cells.get(rid) : null) || {};
    const get = (col) => (col && cj[col.id] ? cj[col.id].value : undefined);

    const start = toDateStr(get(startCol));
    const end = toDateStr(get(dueCol));
    if (!name && !start && !end) continue; // genuinely empty row

    const opt = statusOpts[get(statusCol)];
    const status = normalizeStatus(opt ? opt.value : null);
    const rawProgress = get(progressCol);
    const av = get(assigneeCol);

    tasks.push({
      sourceId: rid,
      title: name || '(untitled)',
      status,
      startAt: start,
      dueAt: end || start,
      progress: typeof rawProgress === 'number'
        ? Math.max(0, Math.min(100, Math.round(rawProgress)))
        : statusToProgress(status),
      milestone: milestoneCol ? !!get(milestoneCol) : false,
      assigneeRefs: Array.isArray(av) ? av : av ? [av] : [],
      depNames: depNamesFrom(get(depCol), depCol),
    });
  }

  // Dependencies are written as task names; resolve them within this board.
  const byNameLc = new Map(tasks.map((t) => [t.title.toLowerCase(), t.sourceId]));
  for (const t of tasks) {
    t.deps = t.depNames.map((n) => byNameLc.get(n.toLowerCase())).filter((id) => id && id !== t.sourceId);
    delete t.depNames;
  }
  return { found: true, title: String(db.get('prop:title') || '').trim(), tasks };
}
