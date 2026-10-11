// Body text in three sizes: small, normal, large.
//
// For footnotes, asides and fine print that should not take the space, or the
// weight, of the text around them — and the occasional line that wants a little
// more. Headings keep their own scale; this is a size for body lines only
// (paragraphs, quotes, list items).
//
// BlockSuite's paragraph has no size, so this takes the shape callout.ts and
// imageAlign.ts already use, neither of which forks BlockSuite:
//
//   · Storage. `prop:mnSize` on the block's Y.Map — read back generically, so
//     it survives a reload, syncs to everyone and is in the version history.
//     Normal is the absence of the prop. `store.updateBlock` would drop it
//     (that proxy only forwards keys the schema declared). The server writes
//     the same key for `<small>…</small>` lines in markdown (blocks.js), which
//     is how an agent sets it.
//
//   · Painting. A data attribute on the block element, re-applied whenever the
//     document changes, plus the rules in index.css.
import { getSelectedModelsCommand } from '@blocksuite/affine/shared/commands';

export type TextSize = 'small' | 'large';

const PROP = 'prop:mnSize';
const ATTR = 'data-mn-size';
/** Blocks with body text. Headings are excluded by type, below. */
const SIZED = new Set(['affine:paragraph', 'affine:list']);

interface YBlockLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
}
interface ModelLike {
  id: string;
  flavour: string;
  yBlock?: YBlockLike;
  children?: ModelLike[];
  props?: { type?: string };
}

const isSize = (v: unknown): v is TextSize => v === 'small' || v === 'large';
const sizable = (m: ModelLike) => SIZED.has(m.flavour) && !/^h[1-6]$/.test(m.props?.type ?? '');

export const sizeOf = (m: ModelLike): TextSize | null => {
  const v = m.yBlock?.get(PROP);
  return isSize(v) ? v : null;
};

/** The selected blocks that take a size (paragraphs, quotes, list items). */
function selectedSizable(std: any): ModelLike[] {
  try {
    const [, ctx] = std.command.chain().pipe(getSelectedModelsCommand, { types: ['text', 'block'], mode: 'flat' }).run();
    return ((ctx?.selectedModels ?? []) as ModelLike[]).filter(sizable);
  } catch {
    return [];
  }
}

/** The size the selection has, when every sizable block in it agrees. */
export function selectionSize(std: any): TextSize | 'normal' | null {
  const blocks = selectedSizable(std);
  if (!blocks.length) return null;
  const first = sizeOf(blocks[0]) ?? 'normal';
  return blocks.every((b) => (sizeOf(b) ?? 'normal') === first) ? first : null;
}

/** Set the size of every selected body block. False when there was none. */
export function setSelectionSize(std: any, size: TextSize | 'normal'): boolean {
  const blocks = selectedSizable(std);
  if (!blocks.length) return false;
  std.store?.captureSync?.();
  if (std.store?.transact) std.store.transact(() => apply(blocks, size));
  else apply(blocks, size);
  return true;
}

function apply(blocks: ModelLike[], size: TextSize | 'normal') {
  for (const b of blocks) {
    if (size === 'normal') b.yBlock?.delete(PROP);
    else b.yBlock?.set(PROP, size);
  }
}

/**
 * Mirror each block's stored size onto the DOM, and keep doing it as the
 * document changes — a remote edit arrives as a Yjs update, and BlockSuite
 * re-renders the block without knowing about this attribute.
 */
export function attachTextSize({
  store,
  root,
  onChange,
}: {
  store: { root?: ModelLike | null };
  root: Element;
  onChange: (cb: () => void) => () => void;
}): () => void {
  const paint = () => {
    const walk = (m: ModelLike | null | undefined) => {
      if (!m) return;
      if (SIZED.has(m.flavour)) {
        const el = root.querySelector(`[data-block-id="${CSS.escape(m.id)}"]`);
        const size = sizable(m) ? sizeOf(m) : null;
        if (el && el.getAttribute(ATTR) !== size) {
          if (size) el.setAttribute(ATTR, size);
          else el.removeAttribute(ATTR);
        }
      }
      for (const c of m.children ?? []) walk(c);
    };
    walk(store.root);
  };
  // The update fires before BlockSuite re-renders; paint on the next frame so
  // the attribute lands on the element that stays.
  const schedule = () => requestAnimationFrame(paint);
  schedule();
  const off = onChange(schedule);
  return () => { try { off(); } catch { /* noop */ } };
}
