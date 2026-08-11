// Left / centre / right alignment for images.
//
// BlockSuite's image block has no alignment: `affine-page-image` is a flex
// column with `align-items: center`, and neither the model nor the toolbar has
// anywhere to say otherwise. Two pieces are needed, and both avoid forking
// BlockSuite:
//
//   · Storage. The choice is written straight onto the block's Y.Map as
//     `prop:mnAlign`. Block props are read back generically — _parseYBlock
//     copies every `prop:*` key it finds — so the value survives a reload and
//     syncs to other clients like any built-in prop. It cannot go through
//     `store.updateBlock`, because that proxy only forwards keys the schema
//     already declared and would drop an unknown one silently. The `mn` prefix
//     keeps it out of the way of anything BlockSuite adds later.
//
//   · Painting. A data attribute on the block element, re-applied whenever the
//     document changes, plus two rules in index.css. Same shape as the mermaid
//     preview attachment next door.
import { ActionPlacement, ToolbarModuleExtension, type ToolbarContext } from '@blocksuite/affine/shared/services';
import { BlockFlavourIdentifier } from '@blocksuite/affine/std';
import { AlignHorizontalCenterIcon, AlignLeftIcon, AlignRightIcon } from '@blocksuite/icons/lit';
import type { TemplateResult } from 'lit';

export type ImageAlign = 'left' | 'center' | 'right';
const PROP = 'prop:mnAlign';
const ATTR = 'data-mn-align';

interface YBlockLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  has(key: string): boolean;
}
interface ImageModelLike {
  id: string;
  flavour: string;
  yBlock?: YBlockLike;
  children?: ImageModelLike[];
}

const alignOf = (model: ImageModelLike): ImageAlign => {
  const v = model.yBlock?.get(PROP);
  return v === 'left' || v === 'right' ? v : 'center';
};

function setAlign(model: ImageModelLike, align: ImageAlign) {
  if (!model.yBlock) return;
  // Centre is the default, so it is stored as the absence of the prop rather
  // than as a value — an untouched image and one explicitly re-centred should
  // not differ in the document.
  if (align === 'center') model.yBlock.delete(PROP);
  else model.yBlock.set(PROP, align);
}

/** Alignment actions on the image toolbar. */
export function imageAlignExtensions() {
  // The id is also the sort key, so it carries the reading order — plain names
  // would list the three as centre, left, right.
  const action = (order: number, align: ImageAlign, label: string, icon: TemplateResult) => ({
    placement: ActionPlacement.More,
    id: `b.metanoia-align-${order}-${align}`,
    label,
    icon,
    run: (ctx: ToolbarContext) => {
      // BlockModel's public type doesn't expose yBlock, which is the only way
      // to store a prop the schema never declared. See the note at the top.
      const model = ctx.getCurrentModel() as unknown as ImageModelLike | null;
      if (model) setAlign(model, align);
    },
  });

  return [
    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:affine:image'),
      config: {
        actions: [
          {
            placement: ActionPlacement.More,
            // Above BlockSuite's own `c.delete`; see blockLinks.ts.
            id: 'b.metanoia-align',
            actions: [
              action(1, 'left', 'Align left', AlignLeftIcon()),
              action(2, 'center', 'Align centre', AlignHorizontalCenterIcon()),
              action(3, 'right', 'Align right', AlignRightIcon()),
            ],
          },
        ],
      },
    }),
  ];
}

/**
 * Mirror each image's stored alignment onto the DOM, and keep doing it as the
 * document changes — a remote client's change arrives as a Yjs update, and
 * BlockSuite re-renders the block without knowing about this attribute.
 *
 * Returns a detach function.
 */
export function attachImageAlign({
  store,
  root,
  onChange,
}: {
  store: { root?: ImageModelLike | null };
  root: Element;
  onChange: (cb: () => void) => () => void;
}): () => void {
  const apply = () => {
    const walk = (model: ImageModelLike | null | undefined) => {
      if (!model) return;
      if (model.flavour === 'affine:image') {
        const el = root.querySelector(`affine-image[data-block-id="${CSS.escape(model.id)}"]`);
        if (el) {
          const align = alignOf(model);
          if (align === 'center') el.removeAttribute(ATTR);
          else el.setAttribute(ATTR, align);
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
