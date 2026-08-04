// View extensions for metanoia:chart. ONE BlockViewExtension picks the page vs
// edgeless custom element by parent (surface = edgeless), so a single flavour
// renders in both modes — the exact mechanism the built-in image block uses.

import { SlashMenuConfigExtension } from '@blocksuite/affine-widget-slash-menu';
import { BlockViewExtension, FlavourExtension } from '@blocksuite/std';
import type { ExtensionType } from '@blocksuite/store';
import { literal } from 'lit/static-html.js';
import { CHART_FLAVOUR } from './chart-model';
import { chartSlashMenuConfig } from './chart-slash';

export const chartViewExtensions: ExtensionType[] = [
  FlavourExtension(CHART_FLAVOUR),
  BlockViewExtension(CHART_FLAVOUR, (model) => {
    const parent = model.store.getParent(model.id);
    return parent?.flavour === 'affine:surface'
      ? literal`metanoia-edgeless-chart`
      : literal`metanoia-chart`;
  }),
  SlashMenuConfigExtension(CHART_FLAVOUR, chartSlashMenuConfig),
];
