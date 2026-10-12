import { focusBlockStart } from '@blocksuite/affine/shared/commands';
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

interface SlashStd {
  host?: { updateComplete: Promise<unknown> };
  view?: { getBlock(id: string): unknown };
  command?: { exec(cmd: unknown, ctx: unknown): unknown };
}

const item = (count: number, order: number) => ({
  name: `${count} columns`,
  description: `Put blocks side by side in ${count} columns.`,
  icon: columnsIcon(count),
  group: `4_Content & Media@${order}`,
  when: ({ model }: { model: { store: { schema: { flavourSchemaMap: Map<string, unknown> } } } }) =>
    model.store.schema.flavourSchemaMap.has(COLUMNS_FLAVOUR),
  action: ({ std, model }: { std?: SlashStd; model: ModelLike & { store: StoreLike; text?: { length: number } } }) => {
    const rowId = insertColumnRow(model.store, model, count);
    if (!rowId) return;
    // The line the "/" was typed on is empty once the menu has taken the
    // command back out of it; the row takes its place rather than leaving a
    // blank line above it, the way a block picked from the menu does.
    // Never one with lines nested under it: deleting it would take them along.
    if (model.flavour === 'affine:paragraph' && model.text?.length === 0 && !model.children?.length) {
      try { model.store.deleteBlock?.(model); } catch { /* the row is in; a spare line is harmless */ }
    }
    // The caret goes into the first column, where the reader is about to
    // type — it was left on the line above, so the first words missed the row.
    const first = model.store.getModelById(rowId)?.children?.[0]?.children?.[0];
    if (!first || !std) return;
    std.host?.updateComplete
      .then(() => {
        const block = std.view?.getBlock(first.id);
        if (block) std.command?.exec(focusBlockStart, { focusBlock: block });
      })
      .catch(() => { /* the row is in either way */ });
  },
});

export const columnsSlashMenuConfig: SlashMenuConfig = {
  items: [item(2, 11), item(3, 12)] as SlashMenuConfig['items'],
};
