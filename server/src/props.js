import crypto from 'node:crypto';

/** The property types a database column can have. `relation` is the only one
 *  whose value lives outside `tasks.props` — see task_relations. */
export const PROP_TYPES = [
  'text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'person', 'url', 'relation',
];

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
    case 'relation':
      // Relations are edges, never values in props.
      return undefined;
    default:
      return String(value).trim().slice(0, 2000);
  }
}
