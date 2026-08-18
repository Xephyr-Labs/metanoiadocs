import { useEffect, useRef } from 'react';
import { useWorkspace } from '../../store/workspace';

interface OutlineViewer extends HTMLElement {
  editor: Element;
  toggleOutlinePanel: (() => void) | null;
}

/**
 * AFFiNE's floating table of contents, parked against the right edge.
 *
 * `affine-outline-viewer` is a BlockSuite custom element that reads the store
 * itself and provides its own context, so React's whole job is to create it and
 * hand it the editor host. It renders nothing in edgeless mode or before a doc
 * has loaded, which is why the wrapper is width-less — an empty strip must not
 * sit on top of the page and swallow clicks.
 */
const PREVIEW_PREFIX = 'outline-block-preview-';

/**
 * Tell the rail and the list which heading level each row is.
 *
 * BlockSuite draws one indicator per heading and gives them all the same 20px
 * dash — the level lives only on the panel rows, as `data-testid="…-h2"`. Both
 * lists are the same headings in the same order, so copying the level across by
 * index is what lets the rail draw the shape of the document instead of a
 * picket fence. That index-match is the entire contract: if the two lists ever
 * disagree on length, stamp nothing and let both fall back to flat styling
 * rather than to confidently wrong indentation.
 */
function stampLevels(root: ParentNode) {
  const rows = [...root.querySelectorAll<HTMLElement>('.outline-viewer-panel .outline-viewer-item')]
    .filter((row) => !row.classList.contains('outline-viewer-header'));
  const dashes = [...root.querySelectorAll<HTMLElement>('.outline-viewer-indicator-wrapper')];
  if (!rows.length || rows.length !== dashes.length) return;

  rows.forEach((row, i) => {
    const testid = row.querySelector<HTMLElement>(`[data-testid^="${PREVIEW_PREFIX}"]`)?.dataset.testid;
    const level = testid?.slice(PREVIEW_PREFIX.length);
    if (!level || !/^(title|h[1-6])$/.test(level)) return;
    row.dataset.level = level;
    dashes[i].dataset.level = level;
  });
}

export function FloatingToc({ editor }: { editor: Element | null }) {
  const slotRef = useRef<HTMLDivElement>(null);
  const { setRightPanel } = useWorkspace();

  useEffect(() => {
    const slot = slotRef.current;
    // Not `editor` itself: the viewer wants the inner editor-host, which is what
    // carries `std` and the store it reads headings from.
    const host = editor?.querySelector('editor-host');
    if (!slot || !host) return;

    const viewer = document.createElement('affine-outline-viewer') as OutlineViewer;
    viewer.editor = host;
    // The expanded panel offers a "open the full outline" button; send it to the
    // Outline tab that already exists in the right panel.
    viewer.toggleOutlinePanel = () => setRightPanel('outline');
    slot.replaceChildren(viewer);

    // The viewer re-renders its whole list whenever a heading is typed, moved or
    // deleted, which drops the stamps. Watching children only (never attributes)
    // is what keeps the stamping from re-triggering itself.
    const stamp = () => stampLevels(viewer);
    const watch = new MutationObserver(stamp);
    watch.observe(viewer, { childList: true, subtree: true });
    stamp();

    return () => {
      watch.disconnect();
      slot.replaceChildren();
    };
  }, [editor, setRightPanel]);

  return (
    <div
      ref={slotRef}
      className="mn-toc absolute right-5 top-8 bottom-12 z-20 hidden w-7 md:block"
      aria-label="Table of contents"
    />
  );
}
