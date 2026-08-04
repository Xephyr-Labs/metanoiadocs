// Edgeless-mode view for metanoia:chart. Extends GfxBlockComponent so the block
// is a selectable/resizable canvas element (position + size come from model.xywh,
// handled by the base). Hosts the SAME canvas element + config affordance as the
// page view, using the same model/store — so a chart is one block in both modes.

import { GfxBlockComponent } from '@blocksuite/std';
import { html } from 'lit';
import './chart-canvas';
import { openChartConfig } from './chart-config-panel';
import type { MetanoiaChartBlockModel } from './chart-model';

export class MetanoiaChartEdgelessBlockComponent extends GfxBlockComponent<MetanoiaChartBlockModel> {
  private openConfig = (e: Event) => { e.stopPropagation(); openChartConfig(this.model, this.store); };

  override renderGfxBlock() {
    return html`
      <div class="mn-chart mn-chart-edgeless" contenteditable="false">
        <button class="mn-chart-gear" title="Chart settings" @click=${this.openConfig}>⚙</button>
        <metanoia-chart-canvas .model=${this.model} .store=${this.store}></metanoia-chart-canvas>
      </div>`;
  }
}
