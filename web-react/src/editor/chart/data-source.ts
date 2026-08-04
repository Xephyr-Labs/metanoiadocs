// Resolves a ChartDataSource to concrete rows+columns. Inline is fully
// supported. Database reads columns/cells/child-rows straight off the
// affine:database model (see docs/CHART_BLOCK.md). This module is the single
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
  blocks?: Map<string, unknown>;
};

function findModelById(store: AnyStore, id: string): any {
  if (!store) return null;
  const direct = store.getModelById?.(id);
  if (direct) return direct;
  const wrapped = store.getBlock?.(id);
  if (wrapped?.model) return wrapped.model;
  // store.blocks may be a Map or a plain record — handle both.
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

function resolveDatabase(store: AnyStore, blockId: string, _viewId?: string): ResolvedData {
  try {
    const model = findModelById(store, blockId);
    if (!model || model.flavour !== 'affine:database') {
      return { ok: false, rows: [], columns: [], error: 'Source database was deleted or is inaccessible.' };
    }
    const columns: Array<{ id: string; name?: string }> = model.props?.columns ?? [];
    const cells: Record<string, Record<string, { value?: unknown }>> = model.props?.cells ?? {};
    const colNames = columns.map((c) => c.name || c.id);
    const rowIds: string[] = (model.children ?? []).map((c: any) => c?.id).filter(Boolean);
    const rows: Row[] = rowIds.map((rid) => {
      const row: Row = {};
      const cellMap = cells[rid] || {};
      for (const col of columns) {
        const cell = cellMap[col.id];
        row[col.name || col.id] = cell ? (cell.value ?? null) : null;
      }
      return row;
    });
    // TODO(view-filtering): only return rows visible in `_viewId`. Filters/sort/
    // grouping live in @blocksuite/data-view's view runtime, not the model, so we
    // currently return ALL rows regardless of the selected view. The viewId is
    // persisted + selectable in the UI but not yet applied here.
    return { ok: true, rows, columns: colNames };
  } catch (e) {
    return { ok: false, rows: [], columns: [], error: e instanceof Error ? e.message : 'Failed to read database.' };
  }
}
