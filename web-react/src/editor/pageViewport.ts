// Tell BlockSuite where the page really scrolls.
//
// BlockSuite hands `.affine-page-viewport` to `ViewportElementProvider` and
// then reads `scrollTop` off it. Here that element does not scroll: the editor
// grows to its full height and the app's own pane around it (the one that also
// carries the cover, the title and the metadata band) is the scroller. So
// `scrollTop` was permanently 0, and drag-to-select anchored its rectangle to a
// point on the SCREEN instead of a point in the document — scroll while
// dragging and the top of the selection slid down with the view, so the
// selection shrank to whatever was on screen rather than growing.
//
// Only two things read this provider in page mode: the root block, which uses
// `viewportElement` for a ResizeObserver, and the drag-to-select widget, which
// uses the numbers. So `viewportElement` is left exactly as it was and only the
// numbers are corrected.
//
// `top` is the subtle one. The widget only ever uses it as `point - top`, to
// turn a client coordinate into one relative to the viewport element (that is
// where it paints the rectangle), and it adds `scrollTop` to the same
// expression. For both the live pointer and the anchor captured at drag start
// to land in the same space, `top + (-scrollTop)` has to be the element's
// current client top at every moment — which is exactly what reporting the
// element's UNSCROLLED client top gives, and it is a constant, which is what
// BlockSuite assumes when it captures it once and reuses it for the whole drag.
import { ViewportElementProvider } from '@blocksuite/affine/shared/services';
import { getScrollContainer } from '@blocksuite/affine/shared/utils';
import { StdIdentifier } from '@blocksuite/affine/std';

export interface ViewportNumbers {
  top: number; left: number;
  scrollTop: number; scrollLeft: number;
  scrollWidth: number; scrollHeight: number;
  clientWidth: number; clientHeight: number;
}

/** Split out so the arithmetic can be checked without an editor. */
export function viewportNumbers(element: HTMLElement, scroller: HTMLElement): ViewportNumbers {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top + scroller.scrollTop,
    left: rect.left + scroller.scrollLeft,
    scrollTop: scroller.scrollTop,
    scrollLeft: scroller.scrollLeft,
    // Still the element's own content box: the rectangle is painted inside it,
    // and BlockSuite clamps the rectangle against these.
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
  };
}

/** Page-mode only — the canvas viewport really does scroll itself. */
export const pageViewportExtension = {
  setup: (di: { override: (id: unknown, factory: (provider: { get(id: unknown): unknown }) => unknown) => void }) => {
    di.override(ViewportElementProvider, (provider) => {
      const element = () => {
        const std = provider.get(StdIdentifier) as { host: Element };
        const found = std.host.closest('.affine-page-viewport');
        if (!found) throw new Error('ViewportElementProvider: viewport element is not found');
        return found as HTMLElement;
      };
      return {
        get viewportElement() { return element(); },
        get viewport() {
          const el = element();
          return viewportNumbers(el, getScrollContainer(el));
        },
      };
    });
  },
};
