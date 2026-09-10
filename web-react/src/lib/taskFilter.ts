// Filtering for the project views. Pure so it can be tested without a DOM and
// reused by every tab — the board, table, gantt, calendar and gallery all draw
// the same already-filtered list.

import type { PropRow, SprintRow, TaskKindRow, TaskRow, ProjectMode } from './tasksApi';
import { STATUSES, STATUS_LABEL } from './tasksApi';

/** How a field behaves when filtered, which is coarser than its display type. */
export type FieldKind =
  | 'text' | 'url' | 'select' | 'multi_select' | 'person' | 'date' | 'number' | 'checkbox';

export type FilterOp =
  | 'is' | 'is_not' | 'contains' | 'is_empty' | 'is_not_empty'
  | 'on' | 'before' | 'after' | 'gt' | 'lt';

export interface FilterField {
  /** A TaskRow column, or `prop:<id>` for a custom property. */
  key: string;
  label: string;
  kind: FieldKind;
  options?: { value: string; label: string }[];
}

export interface Filter {
  id: string;
  field: string;
  op: FilterOp;
  /** Always a string so a filter set survives JSON round-tripping unchanged. */
  value: string;
}

export const OPS: Record<FieldKind, FilterOp[]> = {
  text: ['contains', 'is', 'is_not', 'is_empty', 'is_not_empty'],
  url: ['contains', 'is', 'is_empty', 'is_not_empty'],
  select: ['is', 'is_not', 'is_empty', 'is_not_empty'],
  multi_select: ['is', 'is_not', 'is_empty', 'is_not_empty'],
  person: ['is', 'is_not', 'is_empty', 'is_not_empty'],
  date: ['on', 'before', 'after', 'is_empty', 'is_not_empty'],
  number: ['is', 'gt', 'lt', 'is_empty', 'is_not_empty'],
  checkbox: ['is'],
};

export const OP_LABEL: Record<FilterOp, string> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  on: 'on',
  before: 'before',
  after: 'after',
  gt: 'greater than',
  lt: 'less than',
};

/** Ops that ignore the value box entirely. */
export function needsValue(op: FilterOp): boolean {
  return op !== 'is_empty' && op !== 'is_not_empty';
}

const PROP_KIND: Record<PropRow['type'], FieldKind | null> = {
  text: 'text',
  number: 'number',
  select: 'select',
  multi_select: 'multi_select',
  date: 'date',
  checkbox: 'checkbox',
  person: 'person',
  url: 'url',
  // Relations live in their own table, not in tasks.props, so there is nothing
  // on the row to match against.
  relation: null,
};

/**
 * Every field this project can be filtered on. A data database has no status,
 * assignee, dates or progress — the same split TaskTable draws — so it gets its
 * name plus whatever properties were added to it.
 */
export function fieldsFor({
  mode,
  props,
  users,
  kinds,
  sprints,
}: {
  mode: ProjectMode;
  props: PropRow[];
  users: { id: string; name: string; username: string }[];
  kinds: TaskKindRow[];
  sprints: SprintRow[];
}): FilterField[] {
  const work = mode !== 'data';
  const fields: FilterField[] = [
    { key: 'title', label: work ? 'Task' : 'Name', kind: 'text' },
  ];
  if (work) {
    fields.push(
      {
        key: 'status',
        label: 'Status',
        kind: 'select',
        options: STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
      },
      {
        key: 'kind',
        label: 'Type',
        kind: 'select',
        options: kinds.map((k) => ({ value: k.key, label: k.label })),
      },
      {
        key: 'assignee_id',
        label: 'Assignee',
        kind: 'person',
        options: users.map((u) => ({ value: u.id, label: u.name || u.username })),
      },
      {
        key: 'sprint_id',
        label: 'Sprint',
        kind: 'select',
        options: sprints.map((s) => ({ value: s.id, label: s.name })),
      },
      { key: 'start_at', label: 'Start', kind: 'date' },
      { key: 'due_at', label: 'Due', kind: 'date' },
      { key: 'priority', label: 'Priority', kind: 'number' },
      { key: 'progress', label: 'Progress', kind: 'number' },
      { key: 'points', label: 'Points', kind: 'number' },
      { key: 'milestone', label: 'Milestone', kind: 'checkbox' },
    );
  }
  for (const p of props) {
    const kind = PROP_KIND[p.type];
    if (!kind) continue;
    fields.push({
      key: `prop:${p.id}`,
      label: p.label,
      kind,
      options: p.options.map((o) => ({ value: o.id, label: o.label })),
    });
  }
  return fields;
}

function valueOf(task: TaskRow, field: FilterField): unknown {
  if (field.key.startsWith('prop:')) return task.props?.[field.key.slice(5)] ?? null;
  // A task can be on several people. The field keeps its old key so filters
  // already saved in localStorage keep working; what it reads is the list.
  if (field.key === 'assignee_id') {
    const ids = task.assignees?.map((a) => a.id) ?? [];
    // A row that predates the assignees table — an old import, a cached
    // response — carries only the single column. Read that rather than
    // reporting it as unassigned.
    return ids.length ? ids : (task.assignee_id ? [task.assignee_id] : []);
  }
  return (task as unknown as Record<string, unknown>)[field.key];
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true;
  return Array.isArray(v) && v.length === 0;
}

/** A date cell is either a full timestamp or a bare date; compare the day. */
const day = (v: unknown) => String(v).slice(0, 10);

/** `is` and its negation, shared so `is_not` is always the exact complement. */
function equals(v: unknown, kind: FieldKind, want: string): boolean {
  if (kind === 'multi_select') {
    return Array.isArray(v) && v.some((x) => String(x) === want);
  }
  // A single-valued field whose cell now holds several values — the assignees.
  // "is X" means X is one of them.
  if (Array.isArray(v)) return v.some((x) => equals(x, kind, want));
  if (kind === 'checkbox') return Boolean(v) === (want === 'true');
  if (kind === 'number') return Number(v) === Number(want);
  if (isEmpty(v)) return false;
  return String(v).toLowerCase() === want.toLowerCase();
}

export function matches(task: TaskRow, filter: Filter, field: FilterField): boolean {
  const v = valueOf(task, field);
  const want = filter.value;
  switch (filter.op) {
    case 'is_empty':
      return isEmpty(v);
    case 'is_not_empty':
      return !isEmpty(v);
    case 'is':
      return equals(v, field.kind, want);
    // Deliberately the complement of `is`, so an unset cell counts as "is not
    // X" — a task with no assignee genuinely is not assigned to anyone.
    case 'is_not':
      return !equals(v, field.kind, want);
    case 'contains':
      return !isEmpty(v) && String(v).toLowerCase().includes(want.toLowerCase());
    case 'on':
      return !isEmpty(v) && day(v) === want;
    case 'before':
      return !isEmpty(v) && day(v) < want;
    case 'after':
      return !isEmpty(v) && day(v) > want;
    case 'gt':
      return !isEmpty(v) && Number(v) > Number(want);
    case 'lt':
      return !isEmpty(v) && Number(v) < Number(want);
    default:
      return true;
  }
}

/**
 * Every filter must pass (AND). A filter whose field no longer exists — a
 * property someone deleted while the view was open — is skipped rather than
 * emptying the table.
 */
export function applyFilters(
  tasks: TaskRow[],
  filters: Filter[],
  fields: FilterField[],
): TaskRow[] {
  const active = filters
    .map((f) => [f, fields.find((x) => x.key === f.field)] as const)
    .filter((pair): pair is readonly [Filter, FilterField] => !!pair[1])
    .filter(([f]) => !needsValue(f.op) || f.value !== '');
  if (!active.length) return tasks;
  return tasks.filter((t) => active.every(([f, field]) => matches(t, f, field)));
}

/** A fresh filter on a field, with that field's first operator. */
export function newFilter(field: FilterField): Filter {
  return {
    id: crypto.randomUUID(),
    field: field.key,
    op: OPS[field.kind][0],
    value: field.kind === 'checkbox' ? 'true' : '',
  };
}
