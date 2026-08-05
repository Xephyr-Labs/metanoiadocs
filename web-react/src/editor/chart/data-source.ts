// Resolves a ChartDataSource to concrete rows+columns. Inline is fully
// supported. Database reads columns/cells/child-rows off the affine:database
// model AND, when a viewId is given, applies that table view's column
// visibility/order, sort, and filter (see applyView). This module is the single
// seam for adding new external data-source adapters.

import type { ChartDataSource } from './chart-types';

export type Row = Record<string, unknown>;

export interface ResolvedData {
  ok: boolean;
  rows: Row[];
  columns: string[];
  /** Present when ok=false (missing/inaccessible source) so the UI can explain. */
  error?: string;
}

// BlockSuite Store is typed loosely at this boundary (mirrors mermaidPreview.ts).
type AnyStore = {
  getModelById?: (id: string) => unknown;
  getBlock?: (id: string) => { model?: unknown } | undefined;
  blocks?: Map<string, unknown> | Record<string, unknown>;
};

export function findModelById(store: AnyStore, id: string): any {
  if (!store) return null;
  const direct = store.getModelById?.(id);
  if (direct) return direct;
  const wrapped = store.getBlock?.(id);
  if (wrapped?.model) return wrapped.model;
  const blocks: any = store.blocks;
  if (blocks) {
    const b = typeof blocks.get === 'function' ? blocks.get(id) : blocks[id];
    if (b) return b.model ?? b;
  }
  return null;
}

export function resolveChartData(store: AnyStore, source: ChartDataSource): ResolvedData {
  if (!source || source.sourceType === 'inline') {
    const s = source as import('./chart-types').InlineChartData;
    return { ok: true, rows: Array.isArray(s?.rows) ? s.rows : [], columns: Array.isArray(s?.columns) ? s.columns : [] };
  }
  return resolveDatabase(store, source.databaseBlockId, source.viewId);
}

interface DbColumn { id: string; name?: string }

function resolveDatabase(store: AnyStore, blockId: string, viewId?: string): ResolvedData {
  try {
    const model = findModelById(store, blockId);
    if (!model || model.flavour !== 'affine:database') {
      return { ok: false, rows: [], columns: [], error: 'Source database was deleted or is inaccessible.' };
    }
    const allColumns: DbColumn[] = model.props?.columns ?? [];
    const cells: Record<string, Record<string, { value?: unknown }>> = model.props?.cells ?? {};
    const rowIds: string[] = (model.children ?? []).map((c: any) => c?.id).filter(Boolean);
    const views: any[] = model.props?.views ?? [];
    const view = viewId ? views.find((v) => v?.id === viewId) : null;

    // Each row as columnId -> raw cell value (for filter/sort, which reference
    // columns by id). Uses ALL columns so filters on hidden columns still work.
    const rowsById = rowIds.map((rid) => {
      const byId: Record<string, unknown> = {};
      const cellMap = cells[rid] || {};
      for (const col of allColumns) byId[col.id] = cellMap[col.id]?.value ?? null;
      return byId;
    });

    const { rows: shownRows, columns: shownCols } = applyView(view, rowsById, allColumns);

    const colNames = shownCols.map((c) => c.name || c.id);
    const rows: Row[] = shownRows.map((byId) => {
      const row: Row = {};
      for (const col of shownCols) row[col.name || col.id] = byId[col.id] ?? null;
      return row;
    });
    return { ok: true, rows, columns: colNames };
  } catch (e) {
    return { ok: false, rows: [], columns: [], error: e instanceof Error ? e.message : 'Failed to read database.' };
  }
}

// Apply a table view's column visibility/order, filter and sort. Without a view
// (or an unrecognized shape) it returns everything unchanged.
function applyView(view: any, rowsById: Record<string, unknown>[], allColumns: DbColumn[]) {
  // Column visibility + order.
  let columns = allColumns;
  const viewCols: Array<{ id: string; hide?: boolean }> | undefined = view?.columns;
  if (Array.isArray(viewCols) && viewCols.length) {
    const byId = new Map(allColumns.map((c) => [c.id, c]));
    columns = viewCols.filter((c) => !c.hide).map((c) => byId.get(c.id)).filter((c): c is DbColumn => !!c);
    if (!columns.length) columns = allColumns; // never hide everything
  }

  // Filter.
  let rows = rowsById;
  const filter = view?.filter;
  if (filter && Array.isArray(filter.conditions) && filter.conditions.length) {
    rows = rows.filter((r) => evalFilter(filter, r));
  }

  // Sort (multi-key).
  const sortBy: Array<{ ref?: { name?: string }; desc?: boolean }> | undefined = view?.sort?.sortBy;
  if (Array.isArray(sortBy) && sortBy.length) {
    rows = [...rows].sort((a, b) => {
      for (const s of sortBy) {
        const cid = s?.ref?.name; if (!cid) continue;
        const cmp = compareValues(a[cid], b[cid]);
        if (cmp !== 0) return s.desc ? -cmp : cmp;
      }
      return 0;
    });
  }
  return { rows, columns };
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls last
  if (b == null) return -1;
  const na = Number(a), nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb ? 0 : na < nb ? -1 : 1;
  return String(a).localeCompare(String(b));
}

/**
 * Faithful re-implementation of @blocksuite/data-view's filter evaluation (the
 * matcher registry there isn't exported for reuse). Covers the common string /
 * number / boolean / empty operators; ANY unrecognized operator returns true
 * (row kept), exactly like data-view's own fallback — so an unknown filter never
 * wrongly hides data. `left.name` is a column id; args are literals.
 */
function evalFilter(filter: any, row: Record<string, unknown>): boolean {
  if (!filter) return true;
  if (filter.type === 'group') {
    const conds: any[] = Array.isArray(filter.conditions) ? filter.conditions : [];
    if (!conds.length) return true;
    return filter.op === 'or' ? conds.some((c) => evalFilter(c, row)) : conds.every((c) => evalFilter(c, row));
  }
  if (filter.type !== 'filter') return true;
  const value = row[filter.left?.name];
  const fn = String(filter.function ?? '');
  const arg = filter.args?.[0]?.value;
  const s = (v: unknown) => (v == null ? '' : String(v)).toLowerCase();
  const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0);
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
  switch (fn) {
    case 'isEmpty': return empty;
    case 'isNotEmpty': return !empty;
    case 'contains': return s(value).includes(s(arg));
    case 'doesNoContains': return !s(value).includes(s(arg));
    case 'startsWith': return s(value).startsWith(s(arg));
    case 'endsWith': return s(value).endsWith(s(arg));
    case 'is': return s(value) === s(arg);
    case 'isNot': return s(value) !== s(arg);
    case 'equal': return num(value) === num(arg);
    case 'notEqual': return num(value) !== num(arg);
    case 'greatThan': return num(value) > num(arg);
    case 'lessThan': return num(value) < num(arg);
    case 'greatThanOrEqual': return num(value) >= num(arg);
    case 'lessThanOrEqual': return num(value) <= num(arg);
    case 'isChecked': return value === true;
    case 'isUnchecked': return value !== true;
    default: return true; // unknown operator -> keep the row (data-view's fallback)
  }
}
