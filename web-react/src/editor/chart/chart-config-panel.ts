// Config panel for a chart block — a right-side drawer (Lit element) that edits
// the block's props through BlockSuite transactions (store.updateBlock), so
// undo/redo + collaboration work. No raw ECharts JSON required; an optional
// Advanced section takes sanitized JSON only. A singleton instance is reused.

import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  AGGREGATIONS, CHART_TYPES, MAX_CHART_HEIGHT, MIN_CHART_HEIGHT,
  type Aggregation, type ChartBlockProps, type ChartType, type InlineChartData,
} from './chart-types';
import { normalizeChartProps, sanitizeAdvancedOptions } from './chart-schema';
import type { MetanoiaChartBlockModel } from './chart-model';

type AnyStore = {
  updateBlock?: (model: unknown, props: Record<string, unknown>) => void;
  getModelsByFlavour?: (f: string) => any[];
};

@customElement('metanoia-chart-config')
export class MetanoiaChartConfig extends LitElement {
  static override styles = css`
    :host { position: fixed; inset: 0; z-index: 60; display: none; }
    :host([open]) { display: block; }
    .backdrop { position: absolute; inset: 0; background: var(--overlay, rgba(15,15,15,.32)); }
    .drawer { position: absolute; right: 0; top: 0; height: 100%; width: min(420px, 92vw);
      background: var(--canvas, #fff); border-left: 1px solid var(--line, #e9e9e7);
      display: flex; flex-direction: column; box-shadow: -8px 0 40px rgba(15,15,15,.16);
      font: 13px/1.5 'Inter Variable', Inter, sans-serif; color: var(--ink, #37352f); }
    header { display: flex; align-items: center; gap: 8px; height: 45px; padding: 0 14px;
      border-bottom: 1px solid var(--line, #e9e9e7); font-weight: 600; }
    header .x { margin-left: auto; cursor: pointer; color: var(--muted, #787774);
      background: none; border: none; font-size: 18px; line-height: 1; }
    .body { flex: 1; overflow-y: auto; padding: 12px 14px 40px; }
    .field { margin-bottom: 12px; }
    .field > label { display: block; font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: .03em; color: var(--faint, #9b9a97); margin-bottom: 5px; }
    input[type='text'], input[type='number'], select, textarea {
      width: 100%; box-sizing: border-box; height: 30px; padding: 0 8px; font: inherit;
      color: var(--ink, #37352f); background: var(--surface, #f7f7f5);
      border: 1px solid var(--line, #e9e9e7); border-radius: 6px; outline: none; }
    textarea { height: 96px; padding: 6px 8px; resize: vertical; font-family: ui-monospace, monospace; font-size: 12px; }
    input:focus, select:focus, textarea:focus { border-color: var(--accent, #2383e2); }
    .row { display: flex; gap: 8px; }
    .row > * { flex: 1; }
    .checks { display: flex; flex-wrap: wrap; gap: 4px 12px; }
    .check { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; }
    .toggle { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid var(--line, #e9e9e7); padding: 0; }
    th { background: var(--surface, #f7f7f5); }
    th input { height: 26px; border: none; background: transparent; font-weight: 600; }
    td input { height: 26px; border: none; background: transparent; }
    td.bad input { background: color-mix(in srgb, var(--danger, #d44c47) 12%, transparent); }
    .tbtn { height: 24px; padding: 0 8px; margin: 6px 6px 0 0; font-size: 12px; cursor: pointer;
      border: 1px solid var(--line, #e9e9e7); border-radius: 6px; background: var(--surface, #f7f7f5); color: var(--ink); }
    .del { cursor: pointer; color: var(--faint, #9b9a97); background: none; border: none; font-size: 13px; width: 22px; }
    .hint { font-size: 11px; color: var(--faint, #9b9a97); margin-top: 4px; }
    .err { color: var(--danger, #d44c47); font-size: 11px; margin-top: 4px; }
    details { margin-top: 8px; border-top: 1px solid var(--line, #e9e9e7); padding-top: 10px; }
    summary { cursor: pointer; font-size: 12px; color: var(--muted, #787774); }
    .linklike { background: none; border: none; color: var(--accent, #2383e2); cursor: pointer; padding: 0; font: inherit; }
  `;

  private model: MetanoiaChartBlockModel | null = null;
  private store: AnyStore | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingPatch: Partial<ChartBlockProps> = {};

  @state() private accessor draft: ChartBlockProps | null = null;
  @state() private accessor advancedText = '';
  @state() private accessor advancedError = '';

  openFor(model: MetanoiaChartBlockModel, store: AnyStore): void {
    // Flush any pending edit to the PREVIOUS chart before switching models, so a
    // debounced patch can't land on the wrong block.
    if (this.timer) { clearTimeout(this.timer); this.flush(); }
    this.model = model; this.store = store;
    this.draft = normalizeChartProps((model as any).props ?? model);
    this.advancedText = this.draft.advancedOptions ? JSON.stringify(this.draft.advancedOptions, null, 2) : '';
    this.advancedError = '';
    this.setAttribute('open', '');
  }

  close(): void {
    if (this.timer) { clearTimeout(this.timer); this.flush(); } // persist a queued edit now
    this.removeAttribute('open');
  }

  // Debounced transactional commit so rapid edits become few undo steps. Patches
  // ACCUMULATE between flushes — otherwise changing field A then field B within
  // the debounce window would drop A (the timer for A gets cleared).
  private commit(patch: Partial<ChartBlockProps>): void {
    if (!this.draft) return;
    this.draft = { ...this.draft, ...patch };
    this.pendingPatch = { ...this.pendingPatch, ...patch };
    this.requestUpdate();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
  }

  private flush(): void {
    const patch = this.pendingPatch;
    this.pendingPatch = {};
    this.timer = null;
    if (this.model && this.store?.updateBlock && Object.keys(patch).length) {
      this.store.updateBlock(this.model, patch);
    }
  }

  private commitInline(mutate: (d: InlineChartData) => void): void {
    if (!this.draft || this.draft.dataSource.sourceType !== 'inline') return;
    const next: InlineChartData = {
      sourceType: 'inline',
      columns: [...this.draft.dataSource.columns],
      rows: this.draft.dataSource.rows.map((r) => ({ ...r })),
    };
    mutate(next);
    this.commit({ dataSource: next });
  }

  private databaseBlocks(): Array<{ id: string; title: string }> {
    const models = this.store?.getModelsByFlavour?.('affine:database') ?? [];
    return models.map((m) => ({ id: m.id, title: (m.props?.title?.toString?.() || 'Untitled database') }));
  }

  private applyAdvanced(text: string): void {
    this.advancedText = text;
    if (!text.trim()) { this.advancedError = ''; this.commit({ advancedOptions: undefined }); return; }
    try {
      const parsed = JSON.parse(text);
      const clean = sanitizeAdvancedOptions(parsed);
      this.advancedError = '';
      this.commit({ advancedOptions: clean });
    } catch (e) {
      this.advancedError = 'Invalid JSON: ' + (e instanceof Error ? e.message : 'parse error');
    }
  }

  override render() {
    const d = this.draft;
    if (!d) return html``;
    const inline = d.dataSource.sourceType === 'inline' ? d.dataSource : null;
    const cols = inline ? inline.columns : [];
    const yset = new Set(d.yFields);

    return html`
      <div class="backdrop" @click=${() => this.close()}></div>
      <div class="drawer" @click=${(e: Event) => e.stopPropagation()}>
        <header>Chart settings <button class="x" @click=${() => this.close()}>×</button></header>
        <div class="body">
          <div class="row">
            <div class="field"><label>Type</label>
              <select @change=${(e: Event) => this.commit({ chartType: (e.target as HTMLSelectElement).value as ChartType })}>
                ${CHART_TYPES.map((t) => html`<option value=${t} ?selected=${d.chartType === t}>${t}</option>`)}
              </select></div>
            <div class="field"><label>Height</label>
              <input type="number" min=${MIN_CHART_HEIGHT} max=${MAX_CHART_HEIGHT} .value=${String(d.height)}
                @change=${(e: Event) => this.commit({ height: Number((e.target as HTMLInputElement).value) })}></div>
          </div>

          <div class="field"><label>Title</label>
            <input type="text" .value=${d.title ?? ''} placeholder="Optional"
              @input=${(e: Event) => this.commit({ title: (e.target as HTMLInputElement).value })}></div>

          <div class="field"><label>Data source</label>
            <select @change=${(e: Event) => this.onSourceType((e.target as HTMLSelectElement).value)}>
              <option value="inline" ?selected=${d.dataSource.sourceType === 'inline'}>Inline table</option>
              <option value="database" ?selected=${d.dataSource.sourceType === 'database'}>Database block</option>
            </select>
          </div>

          ${d.dataSource.sourceType === 'database' ? this.renderDatabasePicker(d) : ''}

          <div class="row">
            <div class="field"><label>X field</label>
              <select @change=${(e: Event) => this.commit({ xField: (e.target as HTMLSelectElement).value || undefined })}>
                <option value="">—</option>
                ${(cols.length ? cols : this.knownColumns()).map((c) => html`<option value=${c} ?selected=${d.xField === c}>${c}</option>`)}
              </select></div>
            <div class="field"><label>Group by</label>
              <select @change=${(e: Event) => this.commit({ groupField: (e.target as HTMLSelectElement).value || undefined })}>
                <option value="">None</option>
                ${(cols.length ? cols : this.knownColumns()).map((c) => html`<option value=${c} ?selected=${d.groupField === c}>${c}</option>`)}
              </select></div>
          </div>

          <div class="field"><label>Y fields (series)</label>
            <div class="checks">
              ${(cols.length ? cols : this.knownColumns()).map((c) => html`
                <label class="check"><input type="checkbox" ?checked=${yset.has(c)}
                  @change=${(e: Event) => this.toggleY(c, (e.target as HTMLInputElement).checked)}>${c}</label>`)}
            </div></div>

          <div class="field"><label>Aggregation</label>
            <select @change=${(e: Event) => this.commit({ aggregation: (e.target as HTMLSelectElement).value as Aggregation })}>
              ${AGGREGATIONS.map((a) => html`<option value=${a} ?selected=${d.aggregation === a}>${a}</option>`)}
            </select></div>

          <div class="field">
            <div class="toggle"><span>Legend</span><input type="checkbox" ?checked=${d.showLegend} @change=${(e: Event) => this.commit({ showLegend: (e.target as HTMLInputElement).checked })}></div>
            <div class="toggle"><span>Tooltip</span><input type="checkbox" ?checked=${d.showTooltip} @change=${(e: Event) => this.commit({ showTooltip: (e.target as HTMLInputElement).checked })}></div>
            <div class="toggle"><span>Zoom / pan</span><input type="checkbox" ?checked=${d.enableZoom} @change=${(e: Event) => this.commit({ enableZoom: (e.target as HTMLInputElement).checked })}></div>
          </div>

          ${inline ? this.renderTable(inline, d) : ''}

          <details>
            <summary>Advanced (ECharts JSON, styling only)</summary>
            <textarea .value=${this.advancedText} placeholder='{"color":["#2383e2"]}'
              @change=${(e: Event) => this.applyAdvanced((e.target as HTMLTextAreaElement).value)}></textarea>
            ${this.advancedError ? html`<div class="err">${this.advancedError}</div>` : ''}
            <div class="hint">Serializable JSON only — no functions. Cannot override series/dataset.</div>
          </details>
        </div>
      </div>`;
  }

  private renderDatabasePicker(d: ChartBlockProps) {
    if (d.dataSource.sourceType !== 'database') return '';
    const dbs = this.databaseBlocks();
    const src = d.dataSource;
    const current = dbs.find((x) => x.id === src.databaseBlockId);
    const viewModel = (this.store?.getModelsByFlavour?.('affine:database') ?? []).find((m) => m.id === src.databaseBlockId);
    const views: Array<{ id: string; name?: string }> = viewModel?.props?.views ?? [];
    return html`
      <div class="field"><label>Database block</label>
        <select @change=${(e: Event) => this.commit({ dataSource: { sourceType: 'database', databaseBlockId: (e.target as HTMLSelectElement).value, viewId: src.viewId } })}>
          <option value="">— select —</option>
          ${dbs.map((x) => html`<option value=${x.id} ?selected=${x.id === src.databaseBlockId}>${x.title}</option>`)}
        </select>
        ${views.length ? html`<label style="margin-top:6px">View</label>
          <select @change=${(e: Event) => this.commit({ dataSource: { sourceType: 'database', databaseBlockId: src.databaseBlockId, viewId: (e.target as HTMLSelectElement).value || undefined } })}>
            <option value="">All rows</option>
            ${views.map((v) => html`<option value=${v.id} ?selected=${v.id === src.viewId}>${v.name || v.id}</option>`)}
          </select>` : ''}
        ${current ? html`<button class="linklike" style="margin-top:6px" @click=${() => this.openSourceDatabase(src.databaseBlockId)}>Open source database →</button>` : ''}
        <div class="hint">A selected view's column visibility, sort and filter are applied.</div>
      </div>`;
  }

  private renderTable(inline: InlineChartData, d: ChartBlockProps) {
    const yset = new Set(d.yFields);
    const isBad = (col: string, v: unknown) => yset.has(col) && v != null && v !== '' && Number.isNaN(Number(v));
    return html`
      <div class="field"><label>Inline data</label>
        <div style="overflow-x:auto">
        <table>
          <thead><tr>
            ${inline.columns.map((c, ci) => html`<th>
              <input type="text" .value=${c} @change=${(e: Event) => this.renameColumn(ci, (e.target as HTMLInputElement).value)}>
            </th>`)}
            <th style="width:24px"></th>
          </tr></thead>
          <tbody>
            ${inline.rows.map((row, ri) => html`<tr>
              ${inline.columns.map((c) => html`<td class=${isBad(c, row[c]) ? 'bad' : ''}>
                <input type="text" .value=${row[c] == null ? '' : String(row[c])}
                  @change=${(e: Event) => this.setCell(ri, c, (e.target as HTMLInputElement).value)}>
              </td>`)}
              <td><button class="del" title="Delete row" @click=${() => this.deleteRow(ri)}>×</button></td>
            </tr>`)}
          </tbody>
        </table>
        </div>
        <button class="tbtn" @click=${() => this.addRow()}>+ Row</button>
        <button class="tbtn" @click=${() => this.addColumn()}>+ Column</button>
        ${d.yFields.some((y) => inline.rows.some((r) => isBad(y, r[y]))) ? html`<div class="err">Some Y-field cells are not numeric.</div>` : ''}
      </div>`;
  }

  private knownColumns(): string[] {
    // For database sources we don't have inline columns; fall back to any fields
    // the user already selected so the selects aren't empty.
    const d = this.draft; if (!d) return [];
    const s = new Set<string>();
    if (d.xField) s.add(d.xField);
    if (d.groupField) s.add(d.groupField);
    d.yFields.forEach((y) => s.add(y));
    return [...s];
  }

  private onSourceType(v: string): void {
    if (v === 'database') this.commit({ dataSource: { sourceType: 'database', databaseBlockId: '', viewId: undefined } });
    else this.commit({ dataSource: { sourceType: 'inline', columns: ['x', 'y'], rows: [{ x: 'A', y: 1 }, { x: 'B', y: 2 }] } });
  }

  private toggleY(col: string, on: boolean): void {
    if (!this.draft) return;
    const set = new Set(this.draft.yFields);
    if (on) set.add(col); else set.delete(col);
    this.commit({ yFields: [...set] });
  }

  private renameColumn(index: number, name: string): void {
    const clean = name.trim() || `col${index + 1}`;
    this.commitInline((d) => {
      const old = d.columns[index];
      if (old === clean || d.columns.includes(clean)) return;
      d.columns[index] = clean;
      d.rows.forEach((r) => { r[clean] = r[old]; delete r[old]; });
    });
  }
  private setCell(ri: number, col: string, value: string): void {
    this.commitInline((d) => { d.rows[ri][col] = value; });
  }
  private deleteRow(ri: number): void { this.commitInline((d) => { d.rows.splice(ri, 1); }); }
  private addRow(): void {
    this.commitInline((d) => { const r: Record<string, string | number | null> = {}; d.columns.forEach((c) => (r[c] = null)); d.rows.push(r); });
  }
  private addColumn(): void {
    this.commitInline((d) => { let i = d.columns.length + 1; let name = `col${i}`; while (d.columns.includes(name)) name = `col${++i}`; d.columns.push(name); d.rows.forEach((r) => (r[name] = null)); });
  }

  private openSourceDatabase(id: string): void {
    this.dispatchEvent(new CustomEvent('open-database', { detail: { id }, bubbles: true, composed: true }));
    // Scroll the source database into view if it is rendered.
    const el = document.querySelector(`affine-database[data-block-id="${id}"], [data-block-id="${id}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.close();
  }
}

// Singleton drawer reused across all chart blocks.
let panel: MetanoiaChartConfig | null = null;
export function openChartConfig(model: MetanoiaChartBlockModel, store: unknown): void {
  if (!panel) { panel = document.createElement('metanoia-chart-config') as MetanoiaChartConfig; document.body.appendChild(panel); }
  panel.openFor(model, store as AnyStore);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface HTMLElementTagNameMap { 'metanoia-chart-config': MetanoiaChartConfig; }
}
