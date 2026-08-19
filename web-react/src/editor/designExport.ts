// Exporting the canvas to an image.
//
// BlockSuite's own ExportManager already does this — it renders the surface,
// draws the background, and hands the browser a download — and the surface view
// extensions register it, so there is nothing to install. This is the seam that
// reaches it from our chrome, the shape `slides.ts` and `designAlign.ts` use.
import { ExportManager } from '@blocksuite/affine/blocks/surface';

/** Loosely typed at the BlockSuite boundary, like the rest of our editor glue. */
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function stdOf(editor: Element | null): Any | null {
  const host = editor?.querySelector('editor-host') as { std?: Any } | null;
  return host?.std ?? null;
}

/**
 * Export the whole canvas as a PNG. Resolves to whether it happened, so the
 * caller can say something rather than leaving a click that did nothing.
 *
 * Exporting only the selection is possible with `edgelessToCanvas(renderer,
 * bound, gfx, blocks, elements)` and `gfx.selection.selectedBound` — deferred
 * until someone wants it, because it needs the surface renderer threaded
 * through and the whole-canvas export is what people reach for first.
 */
export async function exportCanvasPng(editor: Element | null): Promise<boolean> {
  const std = stdOf(editor);
  if (!std) return false;
  try {
    await std.get(ExportManager).exportPng();
    return true;
  } catch {
    // An empty canvas, a tainted image, or no surface in scope.
    return false;
  }
}
