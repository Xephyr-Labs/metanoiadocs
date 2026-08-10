// Slides, built on edgeless frames.
//
// A deck is the frames on the canvas, ordered by BlockSuite's presentation
// index — the same thing its own presentation runtime (PresentTool, arrow keys,
// fullscreen, the "3 / 8" toolbar) already drives. So this file adds no slide
// model of its own; it is the thin seam our React chrome calls to make a frame
// that is slide-shaped, move the viewport onto one, and start presenting.
import { EdgelessFrameManagerIdentifier, PresentTool } from '@blocksuite/affine/blocks/frame';
import { DefaultTool } from '@blocksuite/affine/blocks/surface';
import { Bound } from '@blocksuite/affine/global/gfx';
import { focusTextModel } from '@blocksuite/affine/rich-text';
import { GfxControllerIdentifier } from '@blocksuite/affine/std/gfx';
import { Text } from '@blocksuite/affine/store';

/** 16:9 in canvas units. Slide bodies are authored at this size, then scaled. */
export const SLIDE_W = 1600;
export const SLIDE_H = 900;
/** Gap between slides on the canvas, so the deck reads as a filmstrip. */
const SLIDE_GAP = 160;
/** Inset of the title box inside a new slide. */
const TITLE_PAD = 110;

/** Loosely typed at the BlockSuite boundary, like the rest of our editor glue. */
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Slide {
  id: string;
  title: string;
}

function scope(editor: Element | null): { gfx: Any; frames: Any; std: Any } | null {
  const host = editor?.querySelector('editor-host') as { std?: Any } | null;
  const std = host?.std;
  if (!std) return null;
  try {
    // Both live in the edgeless scope only — in page mode this throws, which is
    // the honest answer for "is there a canvas to put slides on".
    return { std, gfx: std.get(GfxControllerIdentifier), frames: std.get(EdgelessFrameManagerIdentifier) };
  } catch {
    return null;
  }
}

/** Every slide in presentation order. */
export function listSlides(editor: Element | null): Slide[] {
  const s = scope(editor);
  if (!s) return [];
  try {
    return s.frames.frames.map((f: Any, i: number) => ({
      id: f.id,
      title: String(f.props?.title ?? '').trim() || `Slide ${i + 1}`,
    }));
  } catch {
    return [];
  }
}

/**
 * Add a slide after the last one and put the viewport on it. The title box is
 * a real edgeless-text block inside the frame's bound, so BlockSuite adopts it
 * into the frame and it travels with the slide.
 */
export function addSlide(editor: Element | null): string | null {
  const s = scope(editor);
  if (!s) return null;
  try {
    const existing: Any[] = s.frames.frames;
    const last = existing[existing.length - 1];
    let bound: Any;
    if (last) {
      const prev = Bound.deserialize(last.xywh);
      bound = new Bound(prev.x + prev.w + SLIDE_GAP, prev.y, SLIDE_W, SLIDE_H);
    } else {
      // Clear of whatever is already on the canvas — a page's note sits at the
      // origin, and a frame drawn over it would swallow the whole document.
      const used = s.gfx.elementsBound;
      bound = used && used.w
        ? new Bound(used.x + used.w + SLIDE_GAP, used.y, SLIDE_W, SLIDE_H)
        : new Bound(0, 0, SLIDE_W, SLIDE_H);
    }

    const frame = s.frames.createFrameOnBound(bound);
    // BlockSuite names them "Frame N" and leaves them transparent; a slide is a
    // sheet of paper you can see against the canvas.
    try {
      (s.gfx.doc ?? s.std.store).updateBlock(frame, {
        title: new Text(`Slide ${existing.length + 1}`),
        background: { light: '#ffffff', dark: '#252525' },
      });
    } catch { /* keep BlockSuite's defaults */ }

    // Something to type into, or a new slide is an empty rectangle you have to
    // learn the toolbar to use.
    const store = s.gfx.doc ?? s.std.store;
    const textId = store.addBlock(
      'affine:edgeless-text',
      {
        xywh: new Bound(bound.x + TITLE_PAD, bound.y + TITLE_PAD, bound.w - TITLE_PAD * 2, 120).serialize(),
        index: s.gfx.layer.generateIndex(),
      },
      s.gfx.surface,
    );
    const titleId = store.addBlock('affine:paragraph', { type: 'h1', text: new Text('') }, textId);

    focusSlide(editor, frame.id);
    // Land the caret in the title box, so a new slide is something you type
    // into rather than a rectangle you have to learn the toolbar to fill. The
    // block's component doesn't exist until the next frame, hence the defer.
    requestAnimationFrame(() => {
      try {
        s.gfx.selection.set({ elements: [textId], editing: true });
        focusTextModel(s.std, titleId);
      } catch { /* the user clicked elsewhere first */ }
    });
    return frame.id as string;
  } catch {
    return null;
  }
}

/** Move the viewport onto a slide, the way clicking a thumbnail should. */
export function focusSlide(editor: Element | null, id: string, animate = true): void {
  const s = scope(editor);
  if (!s) return;
  try {
    const frame = s.gfx.getElementById(id);
    if (!frame) return;
    s.gfx.viewport.setViewportByBound(Bound.deserialize(frame.xywh), [40, 40, 40, 40], animate);
  } catch { /* frame went away mid-click */ }
}

export function deleteSlide(editor: Element | null, id: string): void {
  const s = scope(editor);
  if (!s) return;
  try {
    const frame = s.gfx.getElementById(id);
    if (!frame) return;
    // Delete the frame AND what it holds — a slide the deck no longer shows
    // should not leave its text floating on the canvas. Page notes are the
    // exception: a frame dragged over the document body must never take the
    // document with it.
    for (const el of s.frames.getChildElementsInFrame(frame)) {
      if (el?.flavour === 'affine:note') continue;
      s.gfx.deleteElement(el);
    }
    s.gfx.deleteElement(frame);
  } catch { /* already gone */ }
}

/**
 * Hand over to BlockSuite's presentation runtime: fullscreen-ish navigator,
 * arrow keys, the frame counter, Esc to leave. Starts from `id` when given.
 */
export function startPresenting(editor: Element | null, id?: string): void {
  const s = scope(editor);
  if (!s) return;
  if (id) focusSlide(editor, id, false);
  try { s.gfx.tool.setTool(PresentTool); } catch { /* no edgeless scope */ }
}

/** Back to editing. BlockSuite's own Esc does this too; this is for our chrome. */
export function stopPresenting(editor: Element | null): void {
  const s = scope(editor);
  try { s?.gfx.tool.setTool(DefaultTool); } catch { /* nothing to stop */ }
}

export function isPresenting(editor: Element | null): boolean {
  const s = scope(editor);
  try { return s?.gfx.tool.currentToolName$.value === 'frameNavigator'; } catch { return false; }
}
