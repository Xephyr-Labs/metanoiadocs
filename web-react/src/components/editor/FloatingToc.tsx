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
    return () => slot.replaceChildren();
  }, [editor, setRightPanel]);

  return (
    <div
      ref={slotRef}
      className="mn-toc absolute right-5 top-8 bottom-12 z-20 hidden w-7 md:block"
      aria-label="Table of contents"
    />
  );
}
