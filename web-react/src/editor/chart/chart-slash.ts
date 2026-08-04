// `/chart` slash-menu item — inserts a chart block with sample inline data and
// safe defaults, right after the current block.

import { type SlashMenuConfig } from '@blocksuite/affine-widget-slash-menu';
import { html } from 'lit';
import { CHART_FLAVOUR } from './chart-model';
import { defaultChartProps } from './chart-types';

const chartIcon = () => html`
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 3v13a1 1 0 0 0 1 1h13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    <rect x="5.5" y="9" width="2.4" height="5" rx="0.5" fill="currentColor"/>
    <rect x="9.3" y="6" width="2.4" height="8" rx="0.5" fill="currentColor"/>
    <rect x="13.1" y="11" width="2.4" height="3" rx="0.5" fill="currentColor"/>
  </svg>`;

export const chartSlashMenuConfig: SlashMenuConfig = {
  items: [
    {
      name: 'Chart',
      description: 'Insert an interactive chart.',
      icon: chartIcon(),
      group: '4_Content & Media@2',
      when: ({ model }) => model.store.schema.flavourSchemaMap.has(CHART_FLAVOUR),
      action: ({ std, model }) => {
        const store = std.store;
        const parent = model ? store.getParent(model) : null;
        const props = { ...defaultChartProps() };
        if (!parent) { store.addBlock(CHART_FLAVOUR, props, store.root ?? undefined); return; }
        const index = parent.children.findIndex((c: { id: string }) => c.id === model.id) + 1;
        store.addBlock(CHART_FLAVOUR, props, parent, index);
      },
    },
  ],
};
