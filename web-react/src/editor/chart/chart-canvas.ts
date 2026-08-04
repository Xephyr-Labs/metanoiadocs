// The ECharts host element. Owns the ECharts instance lifecycle for a chart
// block and is shared by both the Page and Edgeless block views. It is a plain
// LitElement (not a BlockSuite component) so it carries no editor coupling — it
// takes the block `model` + `store`, reads config from model props, resolves
// data, and renders. ECharts is dynamically imported so it stays out of the main
// bundle.

import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';
import type { EChartsInstance } from './echarts-setup';
import { buildEChartsOption } from './buildEChartsOption';
import { normalizeChartProps } from './chart-schema';
import { resolveChartData, type ResolvedData } from './data-source';
import type { MetanoiaChartBlockModel } from './chart-model';

type ChartState = 'ok' | 'empty' | 'invalid' | 'error' | 'loading';

@customElement('metanoia-chart-canvas')
export class MetanoiaChartCanvas extends LitElement {
  static override styles = css`
    :host { display: block; width: 100%; height: 100%; position: relative; }
    .wrap { position: absolute; inset: 0; border-radius: 8px; overflow: hidden;
      background: var(--surface-2, #fbfbfa); border: 1px solid var(--line, #e9e9e7);
      box-sizing: border-box; }
    .chart { position: absolute; inset: 0; pointer-events: none; }
    .wrap[data-interacting='true'] .chart { pointer-events: auto; }
    .wrap[data-interacting='true'] { outline: 2px solid var(--accent, #2383e2); outline-offset: -2px; }
    .overlay { position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 6px; text-align: center;
      color: var(--muted, #787774); font: 13px/1.5 'Inter Variable', Inter, sans-serif; padding: 16px; }
    .overlay .sub { color: var(--faint, #9b9a97); font-size: 12px; }
    .overlay.err { color: var(--danger, #d44c47); }
    .chip { position: absolute; top: 8px; right: 8px; z-index: 3; pointer-events: auto;
      display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px;
      border-radius: 999px; border: 1px solid var(--line, #e9e9e7); background: var(--canvas, #fff);
      color: var(--muted, #787774); font: 11px/1 'Inter Variable', Inter, sans-serif; cursor: pointer;
      opacity: 0; transition: opacity 120ms; }
    :host(:hover) .chip, .wrap[data-interacting='true'] .chip { opacity: 1; }
    .chip:hover { color: var(--ink, #37352f); }
    .spinner { width: 18px; height: 18px; border-radius: 50%;
      border: 2px solid var(--line, #e9e9e7); border-top-color: var(--accent, #2383e2);
      animation: spin .7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;

  @property({ attribute: false }) accessor model!: MetanoiaChartBlockModel;
  @property({ attribute: false }) accessor store: unknown = null;

  @state() private accessor chartState: ChartState = 'loading';
  @state() private accessor message = '';
  @state() private accessor interacting = false;

  private containerRef = createRef<HTMLDivElement>();
  private chart: EChartsInstance | null = null;
  private ro: ResizeObserver | null = null;
  private themeObs: MutationObserver | null = null;
  private modelUnsub: (() => void) | null = null;
  private currentTheme: 'dark' | 'light' = 'light';
  private lastKey = '';
  private disposed = false;

  private isDark(): boolean { return document.documentElement.classList.contains('dark'); }

  override connectedCallback(): void {
    super.connectedCallback();
    this.disposed = false;
    this.themeObs = new MutationObserver(() => this.refresh());
    this.themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    // Refresh when the block's props change (config edits / collaboration).
    const m = this.model as any;
    const slot = m?.propsUpdated;
    if (slot?.on) { const d = slot.on(() => this.refresh()); this.modelUnsub = () => d?.dispose?.(); }
    else if (slot?.subscribe) { const d = slot.subscribe(() => this.refresh()); this.modelUnsub = () => d?.unsubscribe?.(); }
    document.addEventListener('keydown', this.onKeydown);
    document.addEventListener('pointerdown', this.onDocPointerDown, true);
    // On reconnect (BlockSuite can move block elements), firstUpdated won't run
    // again — re-establish the resize observer + a render.
    if (this.hasUpdated) void this.updateComplete.then(() => { this.ensureResizeObserver(); void this.refresh(); });
  }

  private ensureResizeObserver(): void {
    if (this.ro || this.disposed) return;
    const el = this.containerRef.value;
    if (el) { this.ro = new ResizeObserver(() => this.chart?.resize()); this.ro.observe(el); }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.disposed = true;
    this.ro?.disconnect(); this.ro = null;
    this.themeObs?.disconnect(); this.themeObs = null;
    try { this.modelUnsub?.(); } catch { /* noop */ }
    this.modelUnsub = null;
    document.removeEventListener('keydown', this.onKeydown);
    document.removeEventListener('pointerdown', this.onDocPointerDown, true);
    this.chart?.dispose(); this.chart = null; // prevent leaks
  }

  override firstUpdated(): void {
    this.ensureResizeObserver();
    void this.refresh();
  }

  override updated(changed: PropertyValues): void {
    if (changed.has('model') || changed.has('store')) void this.refresh();
  }

  private rendering = false;
  private queued = false;

  /** Public: force a re-resolve + re-render (called by the host block on update).
   *  Serialized so overlapping calls can't double-initialize ECharts. */
  async refresh(): Promise<void> {
    if (this.disposed) return;
    if (this.rendering) { this.queued = true; return; }
    this.rendering = true;
    try { await this.doRefresh(); }
    finally { this.rendering = false; if (this.queued && !this.disposed) { this.queued = false; void this.refresh(); } }
  }

  private async doRefresh(): Promise<void> {
    if (this.disposed) return;
    const model = this.model;
    if (!model) return;
    const config = normalizeChartProps((model as any).props ?? model);
    const resolved: ResolvedData = resolveChartData(this.store as any, config.dataSource);

    if (!resolved.ok) { this.setState('error', resolved.error ?? 'Data source unavailable.'); return; }
    if (!resolved.rows.length) { this.setState('empty', 'No data to display.'); return; }
    const needsFields = config.chartType && (!config.xField || !config.yFields.length);
    if (needsFields) { this.setState('invalid', 'Pick an X field and at least one Y field.'); return; }

    this.chartState = 'ok'; this.message = '';
    await this.renderChart(config, resolved.rows);
  }

  private setState(s: ChartState, msg: string): void {
    this.chartState = s; this.message = msg; this.lastKey = '';
    if (this.chart) { this.chart.clear(); }
  }

  private async renderChart(config: ReturnType<typeof normalizeChartProps>, rows: Array<Record<string, unknown>>): Promise<void> {
    const theme: 'dark' | 'light' = this.isDark() ? 'dark' : 'light';
    await this.updateComplete;
    const el = this.containerRef.value;
    if (!el || this.disposed) return;

    // ECharts bakes theme at init — recreate only when the theme actually flips.
    if (this.chart && theme !== this.currentTheme) { this.chart.dispose(); this.chart = null; }
    if (!this.chart) {
      const { echarts } = await import('./echarts-setup');
      if (this.disposed) return;
      this.chart = echarts.init(el, theme === 'dark' ? 'dark' : undefined, { renderer: 'canvas' });
      this.currentTheme = theme;
      this.lastKey = '';
    }

    let option;
    try { option = buildEChartsOption(config, rows); }
    catch (e) { this.setState('error', e instanceof Error ? e.message : 'Could not build chart.'); return; }
    // Keep transparent so our themed surface shows through.
    (option as Record<string, unknown>).backgroundColor = 'transparent';

    const key = theme + '|' + JSON.stringify(option);
    if (key === this.lastKey) return; // avoid redundant setOption churn
    this.lastKey = key;
    this.chart.setOption(option, { notMerge: true });
    this.chart.resize();
  }

  private enterInteraction(): void { this.interacting = true; }
  private exitInteraction(): void { if (this.interacting) this.interacting = false; }

  private onKeydown = (e: KeyboardEvent) => { if (e.key === 'Escape') this.exitInteraction(); };
  private onDocPointerDown = (e: PointerEvent) => {
    if (this.interacting && !e.composedPath().includes(this)) this.exitInteraction();
  };

  override render() {
    return html`
      <div class="wrap" data-interacting=${this.interacting ? 'true' : 'false'} @dblclick=${() => this.enterInteraction()}>
        <div class="chart" ${ref(this.containerRef)}></div>
        ${this.chartState === 'loading' ? html`<div class="overlay"><div class="spinner"></div></div>` : ''}
        ${this.chartState === 'empty' ? html`<div class="overlay">${this.message}<span class="sub">Add rows in the chart config.</span></div>` : ''}
        ${this.chartState === 'invalid' ? html`<div class="overlay">${this.message}</div>` : ''}
        ${this.chartState === 'error' ? html`<div class="overlay err">${this.message}</div>` : ''}
        <button class="chip" @pointerdown=${(e: Event) => e.stopPropagation()} @click=${() => (this.interacting ? this.exitInteraction() : this.enterInteraction())}>
          ${this.interacting ? 'Done · Esc' : 'Interact'}
        </button>
      </div>
    `;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface HTMLElementTagNameMap { 'metanoia-chart-canvas': MetanoiaChartCanvas; }
}
