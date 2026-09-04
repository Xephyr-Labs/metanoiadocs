// Confluence-style panels, built on BlockSuite's callout block.
//
// BlockSuite ships `affine:callout` — an emoji plus an indented child area —
// but it is off by default and it is always the same grey: the background is
// hardcoded in the component's own stylesheet, and the model has no colour to
// change. A Confluence panel is that block plus a type: info, note, success,
// warning, error, each with its own tint and icon.
//
// Same two-piece shape as imageAlign.ts, for the same reason — neither piece
// forks BlockSuite:
//
//   · Storage. The type goes onto the block's Y.Map as `prop:mnPanel`. Block
//     props are read back generically, so it survives a reload and syncs to
//     other clients; `store.updateBlock` would drop it, because that proxy only
//     forwards keys the schema declared. The emoji is a real prop, so that one
//     goes through the store as normal.
//
//   · Painting. A data attribute on the block element, re-applied whenever the
//     document changes, plus one rule per type in index.css.
import { focusBlockEnd } from '@blocksuite/affine/shared/commands';
import { EditorChevronDown } from '@blocksuite/affine/components/toolbar';
import { ToolbarModuleExtension, type ToolbarContext } from '@blocksuite/affine/shared/services';
import { isInsideBlockByFlavour } from '@blocksuite/affine/shared/utils';
import { BlockFlavourIdentifier } from '@blocksuite/affine/std';
import { SlashMenuConfigExtension, type SlashMenuConfig } from '@blocksuite/affine-widget-slash-menu';
import { html } from 'lit';

export type PanelType = 'info' | 'note' | 'success' | 'warning' | 'error';

const PROP = 'prop:mnPanel';
const ATTR = 'data-mn-panel';

const PANELS: { type: PanelType; label: string; emoji: string }[] = [
  { type: 'info', label: 'Info', emoji: 'ℹ️' },
  { type: 'note', label: 'Note', emoji: '📝' },
  { type: 'success', label: 'Success', emoji: '✅' },
  { type: 'warning', label: 'Warning', emoji: '⚠️' },
  { type: 'error', label: 'Error', emoji: '❌' },
];

// BlockSuite's own default, and every icon we set ourselves. Switching type
// replaces the icon only while it is still one of these — an emoji the reader
// picked from the emoji menu is theirs, and survives a recolour.
const OURS = new Set(['😀', ...PANELS.map((p) => p.emoji)]);

const isPanel = (v: unknown): v is PanelType => PANELS.some((p) => p.type === v);

interface YBlockLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
}
interface CalloutModelLike {
  id: string;
  flavour: string;
  yBlock?: YBlockLike;
  children?: CalloutModelLike[];
  props?: { emoji?: string };
}
interface StoreLike {
  updateBlock(model: unknown, props: Record<string, unknown>): void;
}

export const panelOf = (model: CalloutModelLike): PanelType | null => {
  const v = model.yBlock?.get(PROP);
  return isPanel(v) ? v : null;
};

/** Set a callout's panel type, and its icon unless the reader chose one. */
export function setPanel(model: CalloutModelLike, store: StoreLike, type: PanelType | null) {
  if (!model.yBlock) return;
  // Neutral is stored as the absence of the prop: a plain callout and one
  // explicitly set back to neutral are the same block.
  if (type === null) model.yBlock.delete(PROP);
  else model.yBlock.set(PROP, type);
  const emoji = model.props?.emoji ?? '';
  if (OURS.has(emoji)) {
    try {
      store.updateBlock(model, { emoji: PANELS.find((p) => p.type === type)?.emoji ?? '😀' });
    } catch { /* schema said no; the colour still applied */ }
  }
}

/** A filled swatch, so the menu reads as the panel colours it sets. */
const swatch = (type: PanelType | null) => html`
  <span
    style="width:16px;height:16px;border-radius:4px;display:inline-block;
           background:${type ? `var(--mn-panel-hue-${type})` : 'var(--table-hue-grey)'};
           opacity:0.9"
  ></span>`;

interface SlashStd {
  store: StoreLike & {
    getParent(m: unknown): CalloutModelLike | null;
    addBlock(flavour: string, props: object, parent: unknown, index?: number): string | null;
  };
  host: { updateComplete: Promise<unknown> };
  view: { getBlock(id: string): unknown };
  command: { exec(cmd: unknown, args: object): unknown };
}

function insertPanel(std: SlashStd, model: CalloutModelLike, type: PanelType) {
  const store = std.store;
  const parent = store.getParent(model);
  if (!parent) return;
  const index = (parent.children ?? []).findIndex((c) => c.id === model.id);
  if (index === -1) return;
  const emoji = PANELS.find((p) => p.type === type)?.emoji ?? '😀';
  const calloutId = store.addBlock('affine:callout', { emoji }, parent, index + 1);
  if (!calloutId) return;
  const paragraphId = store.addBlock('affine:paragraph', {}, calloutId);
  // addBlock puts the model in the tree straight away, so the Y.Map is there to
  // write the type onto — see the note at the top.
  const created = (parent.children ?? []).find((c) => c.id === calloutId);
  if (created) created.yBlock?.set(PROP, type);
  // Land the cursor inside the panel, or the next keystroke goes to the empty
  // paragraph the slash menu was typed in. Same dance as BlockSuite's own
  // Callout item: the block has to be rendered before it can be focused.
  if (!paragraphId) return;
  std.host.updateComplete
    .then(() => {
      const paragraph = std.view.getBlock(paragraphId);
      if (paragraph) std.command.exec(focusBlockEnd, { focusBlock: paragraph });
    })
    .catch(() => { /* the panel is inserted either way */ });
}

const panelSlashMenuConfig: SlashMenuConfig = {
  // A callout only takes paragraphs and lists as children, so inserting one
  // inside another silently does nothing — the schema refuses the block and the
  // typed "/warning" is left sitting in the text. Upstream's own Callout item
  // hides itself the same way.
  disableWhen: ({ model }: { model: { store: unknown; id: string } }) =>
    isInsideBlockByFlavour(model.store as never, model as never, 'affine:callout'),
  items: PANELS.map((p, i) => ({
    name: `${p.label} panel`,
    description: `${p.label} callout, Confluence style.`,
    icon: html`<span style="font-size:16px;line-height:1">${p.emoji}</span>`,
    searchAlias: ['panel', 'callout', p.type],
    group: `0_Basic@${10 + i}`,
    action: ({ std, model }: { std: unknown; model: unknown }) =>
      insertPanel(std as SlashStd, model as CalloutModelLike, p.type),
  })) as SlashMenuConfig['items'],
};

/** Panel type on the callout toolbar, and `/info`-style slash items. */
export function calloutExtensions() {
  // A top-level button, not a `More` action: the More menu is drawn by a
  // flavour's own built-in toolbar module, and callout has none — actions filed
  // under More would have nowhere to appear.
  const content = (ctx: ToolbarContext) => {
    // BlockModel's public type doesn't expose yBlock, the only way to store a
    // prop the schema never declared. See the note at the top.
    const model = ctx.getCurrentModel() as unknown as CalloutModelLike | null;
    if (!model) return null;
    const current = panelOf(model);
    const item = (type: PanelType | null, label: string) => html`
      <editor-menu-action
        data-testid="panel-${type ?? 'neutral'}"
        ?data-selected=${current === type}
        @click=${() => setPanel(model, ctx.store as unknown as StoreLike, type)}
      >
        ${swatch(type)}<span class="label">${label}</span>
      </editor-menu-action>
    `;
    return html`
      <editor-menu-button
        .contentPadding=${'8px'}
        .button=${html`
          <editor-icon-button aria-label="Panel" .tooltip=${'Panel type'}>
            ${swatch(current)}${EditorChevronDown}
          </editor-icon-button>
        `}
      >
        <div data-size="small" data-orientation="vertical">
          ${item(null, 'Neutral')}
          ${PANELS.map((p) => item(p.type, p.label))}
        </div>
      </editor-menu-button>
    `;
  };

  return [
    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:affine:callout'),
      config: { actions: [{ id: 'a.metanoia-panel', content }] },
    }),
    SlashMenuConfigExtension('metanoia:callout-panels', panelSlashMenuConfig),
  ];
}

/**
 * Mirror each callout's stored panel type onto the DOM, and keep doing it as
 * the document changes — a remote client's change arrives as a Yjs update, and
 * BlockSuite re-renders the block without knowing about this attribute.
 *
 * Returns a detach function.
 */
export function attachCalloutPanels({
  store,
  root,
  onChange,
}: {
  store: { root?: CalloutModelLike | null };
  root: Element;
  onChange: (cb: () => void) => () => void;
}): () => void {
  const apply = () => {
    const walk = (model: CalloutModelLike | null | undefined) => {
      if (!model) return;
      if (model.flavour === 'affine:callout') {
        const el = root.querySelector(`affine-callout[data-block-id="${CSS.escape(model.id)}"]`);
        if (el) {
          const type = panelOf(model);
          if (type) el.setAttribute(ATTR, type);
          else el.removeAttribute(ATTR);
        }
      }
      for (const child of model.children ?? []) walk(child);
    };
    walk(store.root);
  };

  // The Yjs update fires before BlockSuite has re-rendered, so the attribute is
  // written on the next frame — otherwise it lands on the element about to be
  // replaced.
  const schedule = () => requestAnimationFrame(apply);
  schedule();
  const off = onChange(schedule);
  return () => { try { off(); } catch { /* noop */ } };
}
