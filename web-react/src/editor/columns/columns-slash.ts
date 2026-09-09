import { type SlashMenuConfig } from '@blocksuite/affine-widget-slash-menu';
import { html } from 'lit';
import { insertColumnRow, type ModelLike, type StoreLike } from './columns-dnd';
import { COLUMNS_FLAVOUR } from './columns-model';

// Written out per count rather than interpolated: a nested template inside an
// <svg> is parsed as HTML, so the rects come out as unknown elements and the
// icon renders blank.
const columnsIcon = (count: number) => (count === 2
  ? html`<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="4" width="6" height="12" rx="1.2" stroke="currentColor" stroke-width="1.4"/>
      <rect x="11" y="4" width="6" height="12" rx="1.2" stroke="currentColor" stroke-width="1.4"/>
    </svg>`
  : html`<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2.5" y="4" width="4" height="12" rx="1.2" stroke="currentColor" stroke-width="1.4"/>
      <rect x="8" y="4" width="4" height="12" rx="1.2" stroke="currentColor" stroke-width="1.4"/>
      <rect x="13.5" y="4" width="4" height="12" rx="1.2" stroke="currentColor" stroke-width="1.4"/>
    </svg>`);

const item = (count: number, order: number) => ({
  name: `${count} columns`,
  description: `Put blocks side by side in ${count} columns.`,
  icon: columnsIcon(count),
  group: `4_Content & Media@${order}`,
  when: ({ model }: { model: { store: { schema: { flavourSchemaMap: Map<string, unknown> } } } }) =>
    model.store.schema.flavourSchemaMap.has(COLUMNS_FLAVOUR),
  action: ({ model }: { model: ModelLike & { store: StoreLike } }) => {
    insertColumnRow(model.store, model, count);
  },
});

export const columnsSlashMenuConfig: SlashMenuConfig = {
  items: [item(2, 11), item(3, 12)] as SlashMenuConfig['items'],
};
