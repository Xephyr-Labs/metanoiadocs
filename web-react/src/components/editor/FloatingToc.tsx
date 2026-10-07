import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
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

/**
 * Name BlockSuite's "open in the side panel" button.
 *
 * It is an icon with a hover tooltip and no accessible name, so a screen
 * reader announced a bare "button". It also sits a click away from the editor
 * bar's own contents button, which shows and hides this rail, so the name says
 * what is different about it: it moves the contents to the side panel. It is
 * left out of the tab order as BlockSuite leaves it — the panel it lives in
 * only opens under the pointer — and the editor bar's button and the side
 * panel's Outline tab are the keyboard's way to the same place.
 */
const OPEN_IN_PANEL_LABEL = 'Open table of contents in side panel';
function nameOpenInPanel(root: ParentNode) {
  const button = root.querySelector('[data-testid="toggle-outline-panel-button"]');
  if (button && button.getAttribute('aria-label') !== OPEN_IN_PANEL_LABEL) button.setAttribute('aria-label', OPEN_IN_PANEL_LABEL);
}

/** What the rail needs beside the text: its 20px offset from the column edge,
 *  its own 28px, and a little air so a dash never touches a line end. */
const RAIL_RESERVE = 56;

/**
 * Whether the rail fits in the column's right margin without sitting on text.
 *
 * The rail floats over the editor column rather than taking a column of its
 * own, which is free while the page is centred in a wide window. Open the
 * comments panel or put the window in half a screen and that margin goes to
 * nothing: the rail lands on the ends of lines, and its hover strip — the
 * full height of the page — pops a 282px list over the text whenever the
 * pointer comes near the right edge. Below this, it gets out of the way.
 */
export function tocFits(columnRight: number, textRight: number): boolean {
  return columnRight - textRight >= RAIL_RESERVE;
}

export function FloatingToc({ editor, hidden, onFits }: {
  editor: Element | null;
  /** Turned off from the editor bar. */
  hidden: boolean;
  onFits: (fits: boolean) => void;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  const { setRightPanel } = useWorkspace();
  const [fits, setFits] = useState(true);

  useEffect(() => {
    const column = slotRef.current?.parentElement;
    const text = editor?.querySelector<HTMLElement>('.affine-page-root-block-container');
    if (!column || !text) return;
    const check = () => {
      // The container is the centred measure plus its own side padding; the
      // words end where the padding starts.
      const textRight = text.getBoundingClientRect().right - parseFloat(getComputedStyle(text).paddingRight || '0');
      setFits(tocFits(column.getBoundingClientRect().right, textRight));
    };
    // Both, because each moves on its own: the column with the side panels and
    // the window, the text with the full-width toggle.
    const ro = new ResizeObserver(check);
    ro.observe(column);
    ro.observe(text);
    return () => ro.disconnect();
  }, [editor]);

  useEffect(() => onFits(fits), [fits, onFits]);

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
    const stamp = () => { stampLevels(viewer); nameOpenInPanel(viewer); };
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
      // Hidden rather than unmounted, so turning it back on does not rebuild
      // the viewer. The strip stops where the rail does (the dashes share at
      // most 58vh): below that it was an invisible hover target over the text.
      className={cn('mn-toc absolute right-5 top-8 bottom-12 z-20 hidden max-h-[58vh] w-7', fits && !hidden && 'md:block')}
      aria-label="Table of contents"
    />
  );
}
