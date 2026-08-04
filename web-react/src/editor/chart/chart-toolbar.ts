// Block toolbar for a selected chart: Configure + Open source database.
// (Insertion is via the /chart slash command.)

import {
  type ToolbarModuleConfig, ToolbarModuleExtension,
} from '@blocksuite/affine-shared/services';
import { BlockFlavourIdentifier } from '@blocksuite/std';
import type { ExtensionType } from '@blocksuite/store';
import { html } from 'lit';
import { CHART_FLAVOUR, MetanoiaChartBlockModel } from './chart-model';
import { openChartConfig } from './chart-config-panel';

const gearIcon = () => html`
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="10" cy="10" r="2.4" stroke="currentColor" stroke-width="1.4"/>
    <path d="M10 3.2v1.4M10 15.4v1.4M3.2 10h1.4M15.4 10h1.4M5.2 5.2l1 1M13.8 13.8l1 1M14.8 5.2l-1 1M6.2 13.8l-1 1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`;
const dbIcon = () => html`
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="10" cy="5" rx="5.5" ry="2.2" stroke="currentColor" stroke-width="1.4"/>
    <path d="M4.5 5v10c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V5" stroke="currentColor" stroke-width="1.4"/>
    <path d="M4.5 10c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2" stroke="currentColor" stroke-width="1.4"/>
  </svg>`;

const chartToolbarConfig: ToolbarModuleConfig = {
  actions: [
    {
      id: 'a.configure',
      tooltip: 'Chart settings',
      icon: gearIcon(),
      run: (ctx) => {
        const m = ctx.getCurrentModelByType(MetanoiaChartBlockModel);
        if (m) openChartConfig(m, m.store);
      },
    },
    {
      id: 'b.open-database',
      tooltip: 'Open source database',
      icon: dbIcon(),
      when: (ctx) => {
        const m = ctx.getCurrentModelByType(MetanoiaChartBlockModel);
        return !!m && m.props?.dataSource?.sourceType === 'database';
      },
      run: (ctx) => {
        const m = ctx.getCurrentModelByType(MetanoiaChartBlockModel);
        const src = m?.props?.dataSource;
        const id = src?.sourceType === 'database' ? src.databaseBlockId : '';
        if (id) document.querySelector(`[data-block-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
    },
  ],
};

export const chartToolbarExtension: ExtensionType = ToolbarModuleExtension({
  id: BlockFlavourIdentifier(CHART_FLAVOUR),
  config: chartToolbarConfig,
});
