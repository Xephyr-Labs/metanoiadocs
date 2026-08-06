/* Hallmark · component: gutter comment markers · genre: modern-minimal
 * theme: project tokens (index.css) · states: default · hover · focus · active
 * · disabled (n/a) · loading (renders nothing until ranges resolve) · error
 * (n/a — a missing marker just doesn't render) · success (n/a)
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { commentMarkers, focusComment, onMarkersChanged, type CommentMarker } from '../../editor/comments';
import { avatarFor } from '../../lib/avatar';
import { cn } from '../../lib/cn';

/**
 * A pip in the right margin beside every commented passage. The highlight tells
 * you a sentence has a thread only once you're reading that sentence; the pip
 * tells you from anywhere on the page, which is the part that was missing.
 *
 * Positions come from the same ranges the highlighter resolved, so a pip can
 * never sit beside text its comment isn't about.
 */
export function CommentMarkers({ container, fullWidth }: { container: HTMLElement | null; fullWidth: boolean }) {
  const [markers, setMarkers] = useState<CommentMarker[]>([]);
  const frame = useRef(0);

  useLayoutEffect(() => {
    if (!container) return;
    const measure = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => setMarkers(commentMarkers(container)));
    };
    measure();
    const stop = onMarkersChanged(measure);
    // Reflow moves every marker: the editor grows as content loads, and the
    // reading column re-centres on resize.
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    window.addEventListener('resize', measure);
    return () => {
      stop();
      ro.disconnect();
      window.removeEventListener('resize', measure);
      cancelAnimationFrame(frame.current);
    };
  }, [container]);

  // Late-loading content (images, mermaid diagrams) shifts text after the first
  // measure, so take one more pass when the page has settled.
  useEffect(() => {
    const t = setTimeout(() => container && setMarkers(commentMarkers(container)), 1200);
    return () => clearTimeout(t);
  }, [container, markers.length]);

  if (!markers.length) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* Same measure as the page header and the editor body, so a pip sits in
          the gutter beside its line instead of way out at the viewport edge. */}
      <div
        className={cn(
          'relative mx-auto h-full',
          fullWidth ? 'max-w-none px-[clamp(40px,7vw,120px)]' : 'max-w-[var(--reading-w)] px-6',
        )}
      >
        {markers.map((m) => {
          const a = avatarFor(m.author || 'Someone');
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => focusComment(m.id)}
              title={m.author ? `Comment from ${m.author}` : 'Comment'}
              aria-label={m.author ? `Open comment from ${m.author}` : 'Open comment'}
              style={{ top: m.top - 2, background: a.color }}
              // Narrow viewports have no gutter to sit in, so the pip tucks
              // against the column edge rather than pushing out of the page.
              className={cn(
                'pointer-events-auto absolute right-0 flex h-5 w-5 items-center justify-center rounded-full',
                'text-3xs font-semibold text-white ring-2 ring-canvas',
                'transition-transform duration-120 hover:scale-110 active:scale-95',
                'lg:translate-x-[calc(100%+10px)]',
              )}
            >
              {a.initials}
            </button>
          );
        })}
      </div>
    </div>
  );
}
