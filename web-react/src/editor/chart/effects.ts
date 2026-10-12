// Registers the chart custom elements once. Mirrors affine-block-*'s effects().
// All four are defined here behind a customElements.get check rather than with
// @customElement, which throws when HMR re-evaluates a module and defines the
// same tag a second time.

import { SurfaceBlockSchema } from '@blocksuite/affine-block-surface';
import { MetanoiaChartCanvas } from './chart-canvas';
import { MetanoiaChartConfig } from './chart-config-panel';
import { CHART_FLAVOUR } from './chart-model';
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
  def('metanoia-chart-canvas', MetanoiaChartCanvas);
  def('metanoia-chart-config', MetanoiaChartConfig);

  // Allow a chart to live directly on the edgeless surface (like image/frame).
  // The surface schema's children is a closed allowlist; without this a chart
  // parented to affine:surface is rejected by schema validation and never
  // rendered as a standalone gfx element. The validator reads this array live.
  try {
    const children = SurfaceBlockSchema.model.children as string[] | undefined;
    if (children && !children.includes(CHART_FLAVOUR)) children.push(CHART_FLAVOUR);
  } catch { /* array frozen: chart still works in page + note-embedded edgeless */ }
}
