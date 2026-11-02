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

/**
 * Print slide images one per 16:9 page; the browser's print dialog is where
 * "Save as PDF" lives, so this needs no PDF library. A hidden iframe rather than
 * a new window, because the click's popup allowance is long gone by the time
 * the slides have rendered.
 */
export async function printSlides(images: string[], title: string): Promise<void> {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(
    '<!doctype html><style>@page{size:1600px 900px;margin:0}html,body{margin:0}' +
      'img{display:block;width:1600px;height:900px;object-fit:contain}img+img{break-before:page}</style>' +
      images.map((src) => `<img src="${src}">`).join(''),
  );
  doc.close();
  doc.title = title;
  await Promise.all([...doc.images].map((img) => img.decode().catch(() => {})));
  const win = frame.contentWindow!;
  win.addEventListener('afterprint', () => frame.remove());
  win.print();
}

/** Hand the browser one image to save. */
export function downloadPng(dataUrl: string, name: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'slide'}.png`;
  a.click();
}
