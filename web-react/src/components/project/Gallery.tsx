import { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { cn } from '../../lib/cn';
import { previewLine } from '../../lib/preview';
import type { TaskRow } from '../../lib/tasksApi';
import { SegmentedControl } from '../ui/SegmentedControl';
import { TaskChip } from './TaskChip';

const SIZES = {
  s: { label: 'S', min: 190, preview: 'h-20' },
  m: { label: 'M', min: 250, preview: 'h-28' },
  l: { label: 'L', min: 330, preview: 'h-40' },
} as const;

type Size = keyof typeof SIZES;

const STORE_KEY = 'mn-gallery-size';

const isSize = (v: string | null): v is Size => v === 's' || v === 'm' || v === 'l';

/** Reading it can throw in a locked-down browser, and a missing size is not an error. */
function storedSize(): Size {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return isSize(v) ? v : 'm';
  } catch {
    return 'm';
  }
}

/**
 * Cards over the same task list the board shows, each topped with the opening
 * text of the row's own page.
 *
 * The card body is a flush TaskChip, so the title, type, points, due date,
 * dependency count and assignee stay pixel-identical to the board's — a task
 * reads as the same object in both views, and only one of them has to change
 * when that metadata row does.
 */
export function Gallery({
  tasks,
  onOpen,
  onAdd,
}: {
  tasks: TaskRow[];
  onOpen: (t: TaskRow) => void;
  onAdd: () => void;
}) {
  const [size, setSize] = useState<Size>(storedSize);

  const pick = (next: Size) => {
    setSize(next);
    try {
      localStorage.setItem(STORE_KEY, next);
    } catch {
      /* a browser that refuses storage still gets the size for this session */
    }
  };

  const { min, preview } = SIZES[size];
  const ordered = [...tasks].sort((a, b) => a.position - b.position);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <span className="text-2xs text-faint">
          {ordered.length} {ordered.length === 1 ? 'card' : 'cards'}
        </span>
        <SegmentedControl
          aria-label="Card size"
          value={size}
          onChange={(v) => pick(v as Size)}
          segments={(Object.keys(SIZES) as Size[]).map((k) => ({ value: k, label: SIZES[k].label }))}
        />
      </div>

      <div className="scrollarea flex-1 overflow-y-auto p-4">
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }}
        >
          {ordered.map((t) => {
            const line = previewLine(t.preview, t.title);
            return (
              <article
                key={t.id}
                className="overflow-hidden rounded-lg bg-canvas shadow-subtle transition-shadow duration-120 hover:shadow-pop"
              >
                <button
                  type="button"
                  onClick={() => onOpen(t)}
                  aria-label={`Open ${t.title || 'Untitled'}`}
                  className={cn(
                    'block w-full border-b border-line bg-surface px-3 py-2 text-left',
                    preview,
                  )}
                >
                  {line ? (
                    <p className="text-2xs leading-4 text-muted">{line}</p>
                  ) : (
                    <span className="flex h-full flex-col items-center justify-center gap-1 text-faint">
                      <FileText size={16} />
                      <span className="text-3xs">Empty page</span>
                    </span>
                  )}
                </button>
                <TaskChip task={t} onOpen={() => onOpen(t)} flush />
              </article>
            );
          })}

          <button
            type="button"
            onClick={onAdd}
            className="flex min-h-[120px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-faint transition-colors duration-120 hover:border-line-strong hover:text-muted"
          >
            <Plus size={16} />
            <span className="text-2xs">New</span>
          </button>
        </div>

        {!ordered.length && (
          <p className="mt-6 text-center text-2xs text-faint">
            Nothing here yet — a card appears for every task in this project.
          </p>
        )}
      </div>
    </div>
  );
}
