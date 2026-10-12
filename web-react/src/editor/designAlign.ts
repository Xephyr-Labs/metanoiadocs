// Align and distribute on the canvas.
//
// BlockSuite ships no alignment of its own, so this is the seam between our
// chrome and its gfx controller — the same shape `slides.ts` uses for frames.
// The geometry lives in `lib/align.ts` and is tested there; this file only
// reads the selection, hands it over, and writes back what moved.
import { Bound } from '@blocksuite/affine/global/gfx';
import { GfxControllerIdentifier, isGfxGroupCompatibleModel } from '@blocksuite/affine/std/gfx';
import { alignBoxes, movedBoxes, MIN_FOR, type AlignMode, type Box } from '../lib/align';

/** Loosely typed at the BlockSuite boundary, like the rest of our editor glue. */
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function gfxOf(editor: Element | null): Any | null {
  const host = editor?.querySelector('editor-host') as { std?: Any } | null;
  const std = host?.std;
  if (!std) return null;
  try {
    // Edgeless scope only — in page mode this throws, which is the honest
    // answer to "is there a canvas to align anything on".
    return std.get(GfxControllerIdentifier);
  } catch {
    return null;
  }
}

/** How many canvas elements are selected right now. */
export function selectedCount(editor: Element | null): number {
  try {
    return gfxOf(editor)?.selection?.selectedElements?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Whether `mode` would do anything with the current selection. */
export const canAlign = (editor: Element | null, mode: AlignMode): boolean =>
  selectedCount(editor) >= MIN_FOR(mode);

/**
 * Align the selection. Returns how many elements moved.
 *
 * Every write happens inside one `store.transact`, so the whole alignment is a
 * single undo step and a single Yjs update — collaborators see the elements
 * arrive together rather than march into place one by one.
 */
export function applyAlign(editor: Element | null, mode: AlignMode): number {
  const gfx = gfxOf(editor);
  if (!gfx) return 0;

  let elements: Any[] = [];
  try {
    elements = gfx.selection.selectedElements ?? [];
  } catch {
    return 0;
  }
  if (elements.length < MIN_FOR(mode)) return 0;

  let before: Box[];
  try {
    before = elements.map((el: Any) => {
      const b = Bound.deserialize(el.xywh);
      return { x: b.x, y: b.y, w: b.w, h: b.h };
    });
  } catch {
    // An element without a serialisable bound (there should be none on the
    // canvas) — do nothing rather than move the rest into a wrong arrangement.
    return 0;
  }

  const after = alignBoxes(before, mode);
  const moved = movedBoxes(before, after);
  if (!moved.length) return 0;

  const selected = new Set(elements);
  gfx.doc.transact(() => {
    for (const i of moved) {
      const b = after[i];
      const el = elements[i];
      gfx.updateElement(el, { xywh: new Bound(b.x, b.y, b.w, b.h).serialize() });
      if (!isGfxGroupCompatibleModel(el)) continue;
      // A group's (or mind map's) xywh is derived from its children and its
      // setter is a no-op, so the write above moved nothing; a frame does move,
      // but leaves its contents behind. Shift every descendant by the same
      // offset, the way BlockSuite's own drag does. A nested group's write is
      // the same harmless no-op; anything also selected on its own already has
      // its own target.
      const dx = b.x - before[i].x;
      const dy = b.y - before[i].y;
      // Contents of a group nested in this one that is selected too follow
      // that group's own move, not this one's as well.
      const nested = (el.descendantElements as Any[]).filter((x) => selected.has(x) && isGfxGroupCompatibleModel(x));
      for (const d of el.descendantElements as Any[]) {
        if (selected.has(d)) continue;
        if (nested.some((n) => (n.descendantElements as Any[]).includes(d))) continue;
        const db = Bound.deserialize(d.xywh);
        gfx.updateElement(d, { xywh: new Bound(db.x + dx, db.y + dy, db.w, db.h).serialize() });
      }
    }
  });
  return moved.length;
}
