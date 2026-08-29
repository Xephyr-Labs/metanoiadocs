import { type SlashMenuConfig } from '@blocksuite/affine-widget-slash-menu';
import { html } from 'lit';
import { DATABASE_FLAVOUR, defaultDatabaseProps } from './database-model';

const databaseIcon = () => html`
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="4" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
    <path d="M3 8.5h14M8 8.5v7.5" stroke="currentColor" stroke-width="1.4"/>
  </svg>`;

export const databaseSlashMenuConfig: SlashMenuConfig = {
  items: [
    {
      name: 'Database',
      description: 'Embed a database view.',
      icon: databaseIcon(),
      group: '4_Content & Media@2',
      when: ({ model }) => model.store.schema.flavourSchemaMap.has(DATABASE_FLAVOUR),
      action: ({ std, model }) => {
        const store = std.store;
        const props = { ...defaultDatabaseProps() };
        const parent = model ? store.getParent(model) : null;
        if (parent) {
          const index = parent.children.findIndex((c: { id: string }) => c.id === model.id) + 1;
          store.addBlock(DATABASE_FLAVOUR, props, parent, index);
        } else if (store.root) {
          store.addBlock(DATABASE_FLAVOUR, props, store.root);
        }
      },
    },
  ],
};
