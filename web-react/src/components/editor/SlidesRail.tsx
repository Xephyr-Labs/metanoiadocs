/* Hallmark · component: slide sorter rail · genre: modern-minimal
 * theme: project tokens (index.css) · states: default · hover · focus-visible ·
 * active (current slide) · disabled (editor not mounted) · empty (no slides)
 */
import { Play, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  addSlide, deleteSlide, focusSlide, isPresenting, listSlides, startPresenting, stopPresenting,
  type Slide,
} from '../../editor/slides';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';

interface Props {
  /** The mounted `affine-editor-container`, or null before it loads. */
  editor: Element | null;
}

/**
 * The deck, down the left edge. Frames on the edgeless canvas are the slides,
 * so this reads them straight off the document rather than keeping a list of
 * its own — a frame drawn with the canvas frame tool shows up here too.
 */
export function SlidesRail({ editor }: Props) {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [current, setCurrent] = useState<string | null>(null);

  const read = useCallback(() => setSlides(listSlides(editor)), [editor]);

  // The doc is a CRDT: slides can appear from a teammate, from undo, or from the
  // canvas frame tool. Poll on a slow tick rather than reaching into BlockSuite's
  // internal slots — the list is tiny and this can't get out of step.
  useEffect(() => {
    if (!editor) return;
    read();
    const t = setInterval(() => {
      read();
      // Presentation can also end from BlockSuite's own stop button; drop out of
      // fullscreen with it rather than leaving a full-screen editor behind.
      if (document.fullscreenElement && !isPresenting(editor)) document.exitFullscreen().catch(() => {});
    }, 1000);
    return () => clearInterval(t);
  }, [editor, read]);

  // Presenting fills the screen with the canvas pane alone — the sidebar, this
  // rail and the top bar are simply not inside it. Leaving fullscreen (Esc, or
  // the browser's own exit) has to end the presentation too, or the deck is
  // left in navigator mode with no way back that looks like one.
  const present = () => {
    const pane = editor?.closest('[data-slides-pane]') as HTMLElement | null;
    startPresenting(editor, current ?? slides[0]?.id);
    pane?.requestFullscreen?.().catch(() => { /* denied — present in place */ });
  };

  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && isPresenting(editor)) stopPresenting(editor);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [editor]);

  const onAdd = () => {
    const id = addSlide(editor);
    if (id) setCurrent(id);
    read();
  };

  const onSelect = (id: string) => {
    setCurrent(id);
    focusSlide(editor, id);
  };

  const onDelete = (id: string) => {
    deleteSlide(editor, id);
    if (current === id) setCurrent(null);
    read();
  };

  return (
    <aside className="flex h-full w-[196px] shrink-0 flex-col border-r border-line bg-surface-2">
      <div className="flex items-center gap-1 px-2 py-2">
        <Button size="sm" variant="ghost" leftIcon={<Plus size={14} />} onClick={onAdd} disabled={!editor}>
          New slide
        </Button>
        <span className="flex-1" />
        <IconButton
          size="sm"
          icon={<Play size={14} />}
          label="Present"
          disabled={!editor || slides.length === 0}
          onClick={present}
        />
      </div>

      <div className="scrollarea min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {slides.length === 0 ? (
          <p className="px-1 py-6 text-xs leading-relaxed text-faint">
            No slides yet. <span className="text-muted">New slide</span> adds a 16:9 frame to the canvas.
          </p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {slides.map((s, i) => (
              <li key={s.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left transition-colors duration-120 ease-out',
                    current === s.id
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line bg-canvas text-ink hover:bg-hover',
                  )}
                >
                  <span
                    className={cn(
                      'w-4 shrink-0 text-[11px] tabular-nums',
                      current === s.id ? 'text-accent' : 'text-faint',
                    )}
                  >
                    {i + 1}
                  </span>
                  {/* 16:9 stand-in for the slide. A live thumbnail needs a second
                      canvas renderer per card; the number and title carry the
                      sorter until that earns its cost. */}
                  <span className="aspect-video w-10 shrink-0 rounded-sm border border-line bg-surface" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-xs">{s.title}</span>
                </button>
                <span className="absolute right-1 top-1/2 hidden -translate-y-1/2 group-hover:block">
                  <IconButton
                    size="sm"
                    tone="danger"
                    icon={<Trash2 size={13} />}
                    label={`Delete slide ${i + 1}`}
                    onClick={() => onDelete(s.id)}
                  />
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
