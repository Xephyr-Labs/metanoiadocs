/* Hallmark · component: frames panel · genre: modern-minimal
 * theme: project tokens (index.css) · states: default · hover · focus-visible ·
 * empty (no frames yet — BlockSuite draws its own)
 */
import { useEffect, useRef } from 'react';

interface FramePanelElement extends HTMLElement {
  host: Element;
}

/**
 * BlockSuite's own frames panel, parked beside the canvas.
 *
 * Frames are artboards, so this is the structural list a design needs — and
 * `affine-frame-panel` already draws it, including reordering and navigation.
 * `itEffects()` in `mountEditor` has already defined the element, so React's
 * whole job here is to create it and hand it the editor host, exactly as
 * `FloatingToc` does for the outline viewer.
 */
export function FramesPanel({ editor }: { editor: Element | null }) {
  const slotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const slot = slotRef.current;
    const host = editor?.querySelector('editor-host');
    if (!slot || !host) return;

    const panel = document.createElement('affine-frame-panel') as FramePanelElement;
    panel.host = host;
    slot.replaceChildren(panel);
    return () => slot.replaceChildren();
  }, [editor]);

  return (
    <aside
      aria-label="Frames"
      // 300px because BlockSuite's panel is built for a sidebar that width — at
      // 220 its header wraps and the frame cards are clipped.
      className="scrollarea hidden w-[300px] shrink-0 overflow-y-auto border-r border-line bg-surface-2 md:block"
    >
      <div ref={slotRef} className="h-full" />
    </aside>
  );
}
