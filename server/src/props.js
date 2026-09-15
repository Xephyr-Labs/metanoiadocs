import crypto from 'node:crypto';

/** The property types a database column can have. `relation` is the only one
 *  whose value lives outside `tasks.props` — see task_relations. */
export const PROP_TYPES = [
  'text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'person', 'url',
  'email', 'phone', 'file', 'relation', 'formula', 'rollup',
  // `created_time`, `created_by`, `edited_time` and `edited_by` are not here:
  // every task already carries those columns, so they are built-ins
  // (web-react/src/lib/builtinProps.ts) rather than properties anyone defines.
];

/** Types whose value is not stored in `tasks.props` at all. A formula and a
 *  rollup are computed from other cells every time they are read, so writing
 *  one is meaningless — `coercePropValue` refuses them the way it refuses a
 *  relation. */
export const COMPUTED_TYPES = ['formula', 'rollup'];

/** How a rollup reduces the values it gathers. */
export const ROLLUP_FUNCTIONS = [
  'count', 'count_values', 'count_unique', 'sum', 'average', 'min', 'max',
  'earliest', 'latest', 'percent_checked', 'show_original',
];

/**
 * A property's type-specific settings — a formula's expression, a rollup's
 * (relation, target, function).
 *
 * Stored as JSONB and read straight back by the client's evaluator, so this is
 * a trust boundary like a view's config. The *expression* is not parsed here:
 * the parser lives in the browser (web-react/src/lib/formula.ts), and one that
 * only builds literal, property and call nodes cannot be talked into doing
 * anything else whatever is typed at it. The length cap is the real defence.
 */
export function normalizeConfig(type, value) {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (type === 'formula') {
    return { expression: String(value.expression ?? '').slice(0, 2000) };
  }
  if (type === 'rollup') {
    const fn = ROLLUP_FUNCTIONS.includes(value.fn) ? value.fn : 'count';
    return {
      relation: String(value.relation ?? '').slice(0, 64),
      target: String(value.target ?? '').slice(0, 64),
      fn,
    };
  }
  return {};
}

/** How many files one property may hold, and how long a name may be. Both are
 *  bounds on what a single row can carry, not on the blob store. */
const MAX_FILES = 20;

/** One uploaded file, as it is stored inside `tasks.props`. The bytes live in
 *  the blobs table under `key`; this is the reference plus what a chip needs to
 *  render without fetching them. */
function coerceFile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // The key is the sha256 the uploader computed — hex, fixed length. Anything
  // else would be a path into someone else's blob or a bad request.
  const key = String(raw.key ?? '');
  if (!/^[a-f0-9]{64}$/i.test(key)) return null;
  const name = String(raw.name ?? '').trim().slice(0, 200) || 'file';
  const mime = String(raw.mime ?? '').slice(0, 100);
  const size = Number(raw.size);
  return { key: key.toLowerCase(), name, mime, size: Number.isFinite(size) && size >= 0 ? size : 0 };
}

/**
 * A list of attached files, or undefined when any entry is malformed.
 *
 * One bad entry fails the whole write rather than silently dropping a file
 * someone just uploaded — a half-saved attachment list is worse than a refusal
 * they can see. Shared by the `file` property and by the attachments column on
 * tasks, which store exactly the same thing in a different place.
 */
export function coerceFiles(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const files = value.slice(0, MAX_FILES).map(coerceFile);
  return files.some((f) => f === null) ? undefined : files;
}

/** A stable key for a user-typed label, unique within `taken`. Mirrors
 *  kindKey in tasks.js: derived once at creation, never recomputed, so a
 *  later rename cannot orphan stored values. */
export function propKey(label, taken = []) {
  const base =
    String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) ||
    'prop';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// Pairs allowed because the stored value stays readable after the flip —
// anything else is a 400 rather than a silent data loss. text<->url is
// lossless both ways. select -> multi_select is lossless. multi_select ->
// select is NOT lossless: it leaves a stored array in place under a
// single-value type, which selectedOptions() can still read without
// throwing. A caller that ever WRITES a single value for this property must
// truncate that array explicitly — this pair does not make the value safe
// to treat as a scalar.
const COMPATIBLE = [['text', 'url'], ['select', 'multi_select']];

export function canChangeType(from, to) {
  if (from === to) return true;
  return COMPATIBLE.some(([a, b]) => (from === a && to === b) || (from === b && to === a));
}

export function normalizeOptions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((o) => o && typeof o === 'object')
    .slice(0, 100)
    .map((o) => ({
      id: typeof o.id === 'string' && o.id ? o.id.slice(0, 64) : crypto.randomUUID(),
      label: String(o.label ?? '').trim().slice(0, 80),
      color: String(o.color ?? 'gray').slice(0, 20),
    }));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The storable JSON value for `type`, or undefined when the input is invalid.
 *  null always means "clear this property". */
export function coercePropValue(type, value) {
  if (value === null || value === '' || value === undefined) return null;
  switch (type) {
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'checkbox':
      return value !== false && value !== 'false' && value !== 0;
    case 'date': {
      const s = String(value).slice(0, 10);
      return DATE.test(s) && !Number.isNaN(Date.parse(s)) ? s : undefined;
    }
    case 'multi_select':
      return Array.isArray(value)
        ? [...new Set(value.filter((v) => typeof v === 'string'))].slice(0, 100)
        : undefined;
    case 'url': {
      const s = String(value).trim().slice(0, 2000);
      // Only http(s): a stored javascript: URL becomes a click target later.
      return /^https?:\/\//i.test(s) ? s : undefined;
    }
    case 'file':
      return coerceFiles(value);
    case 'relation':
      // Relations are edges, never values in props.
      return undefined;
    case 'formula':
    case 'rollup':
      // Computed every time they are read; there is nothing to store, and a
      // stored value would be a stale copy that silently outranks the formula.
      return undefined;
    case 'email': {
      const s = String(value).trim().slice(0, 320);
      // Deliberately loose: an address is validated by sending to it, and a
      // strict pattern here rejects real addresses people actually have.
      return s.includes('@') && !/\s/.test(s) ? s : undefined;
    }
    case 'phone':
      return String(value).trim().slice(0, 40);
    default:
      return String(value).trim().slice(0, 2000);
  }
}

/** Validates and coerces a whole `tasks.props` patch against a database's
 *  property definitions. Unknown ids are dropped (e.g. a stale property the
 *  client hasn't refreshed past); the first invalid value stops the patch
 *  instead of partially storing it. */
export function propsPatch(defs, patch) {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const value = {};
  for (const [id, raw] of Object.entries(patch || {})) {
    const def = byId.get(id);
    if (!def) continue;
    const coerced = coercePropValue(def.type, raw);
    if (coerced === undefined) return { ok: false, error: `${id} is not a valid ${def.type}` };
    value[id] = coerced;
  }
  return { ok: true, value };
}

/** A document is a page, a design opens on the canvas, a task is a row's page. */
export function docKind(value) {
  return value === 'design' || value === 'task' ? value : 'doc';
}

/** Why this relation edge is not allowed, or null when it is. */
export function relationError(prop, fromProjectId, toProjectId) {
  if (!prop) return 'unknown property';
  if (prop.type !== 'relation') return 'that property is not a relation';
  if (prop.project_id !== fromProjectId) return 'that property belongs to another database';
  if (prop.target_project_id !== toProjectId) return 'that row is not in the linked database';
  return null;
}
