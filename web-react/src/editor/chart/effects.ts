// Registers the chart custom elements once. Mirrors affine-block-*'s effects():
// the page + edgeless block components are defined here; the canvas + config
// panel self-register via @customElement on import.

import './chart-canvas';
import './chart-config-panel';
import { MetanoiaChartBlockComponent } from './chart-block';
import { MetanoiaChartEdgelessBlockComponent } from './chart-edgeless-block';

let done = false;

export function chartEffects(): void {
  if (done) return;
  done = true;
  const def = (tag: string, cls: CustomElementConstructor) => {
    if (!customElements.get(tag)) customElements.define(tag, cls);
  };
  def('metanoia-chart', MetanoiaChartBlockComponent as unknown as CustomElementConstructor);
  def('metanoia-edgeless-chart', MetanoiaChartEdgelessBlockComponent as unknown as CustomElementConstructor);
}
