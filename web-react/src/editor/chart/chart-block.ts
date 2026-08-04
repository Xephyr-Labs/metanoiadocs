// Page-mode view for metanoia:chart. A leaf BlockComponent hosting the shared
// ECharts canvas at the configured height, plus a settings affordance. Styling
// lives in index.css (BlockSuite block components render to light DOM).

import { BlockComponent } from '@blocksuite/std';
import { html } from 'lit';
import './chart-canvas';
import { openChartConfig } from './chart-config-panel';
import { normalizeChartProps } from './chart-schema';
import type { MetanoiaChartBlockModel } from './chart-model';

export class MetanoiaChartBlockComponent extends BlockComponent<MetanoiaChartBlockModel> {
  private openConfig = (e: Event) => { e.stopPropagation(); openChartConfig(this.model, this.store); };

  override renderBlock() {
    const cfg = normalizeChartProps((this.model as unknown as { props?: unknown }).props ?? this.model);
    return html`
      <div class="mn-chart mn-chart-page" style=${`height:${cfg.height}px`} contenteditable="false">
        <button class="mn-chart-gear" title="Chart settings" @click=${this.openConfig}>⚙</button>
        <metanoia-chart-canvas .model=${this.model} .store=${this.store}></metanoia-chart-canvas>
      </div>`;
  }
}
