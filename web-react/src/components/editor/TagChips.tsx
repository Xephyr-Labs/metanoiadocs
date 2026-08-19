import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Tag as TagIcon, X } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import { swatch, TAG_COLORS, type TagColor } from '../../lib/tagColors';
import type { Page } from '../../lib/types';
import { useWorkspace } from '../../store/workspace';

/** Add/remove coloured tags on a doc. Sits under the page icon in the header. */
/** `trailing` rides on the same wrapped row — suggested tags, today. */
export function TagChips({ page, trailing, compact }: { page: Page; trailing?: ReactNode; compact?: boolean }) {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [color, setColor] = useState<TagColor>(TAG_COLORS[6]); // blue default for new tags
  const boxRef = useRef<HTMLDivElement>(null);
  useOutsideClick(boxRef, useCallback(() => setOpen(false), []), open);

  const onIds = new Set(page.tags.map((t) => t.id));
  const query = q.trim().toLowerCase();
  const suggestions = ws.allTags.filter((t) => !onIds.has(t.id) && t.name.toLowerCase().includes(query));
  const exact = ws.allTags.some((t) => t.name.toLowerCase() === query);

  const attach = (body: { tagId?: string; name?: string; color?: string }) => {
    ws.addTagToPage(page.id, body);
    setQ('');
  };

  return (
    <div className={compact ? 'flex flex-wrap items-center gap-1.5' : 'mt-2 flex flex-wrap items-center gap-1.5'}>
      {page.tags.map((t) => {
        const s = swatch(t.color);
        return (
          <span key={t.id} className={`group inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${s.chip}`}>
            {t.name}
            <button
              type="button"
              onClick={() => ws.removeTagFromPage(page.id, t.id)}
              className="opacity-40 transition-opacity hover:opacity-100"
              aria-label={`Remove ${t.name}`}
            >
              <X size={12} />
            </button>
          </span>
        );
      })}

      <div ref={boxRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-faint transition-colors hover:bg-hover hover:text-muted"
        >
          <TagIcon size={14} /> {page.tags.length ? 'Add tag' : 'Add tags'}
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -4 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
              className="absolute left-0 top-[26px] z-40 w-[260px] rounded-lg border border-line bg-canvas p-2 shadow-pop"
            >
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && query && !exact) attach({ name: q.trim(), color });
                }}
                placeholder="Search or create a tag…"
                className="mb-2 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none placeholder:text-faint focus:border-accent"
              />

              {/* colour picker for the tag about to be created */}
              {query && !exact && (
                <div className="mb-2 flex items-center gap-1 px-0.5">
                  {TAG_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`h-4 w-4 rounded-full ${swatch(c).dot} ${color === c ? 'ring-2 ring-offset-1 ring-offset-canvas ring-ink/40' : ''}`}
                      aria-label={c}
                    />
                  ))}
                </div>
              )}

              <div className="max-h-[200px] overflow-y-auto">
                {query && !exact && (
                  <button
                    type="button"
                    onClick={() => attach({ name: q.trim(), color })}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-hover"
                  >
                    <Plus size={14} className="text-faint" /> Create
                    <span className={`ml-0.5 rounded px-1.5 py-0.5 text-xs font-medium ${swatch(color).chip}`}>{q.trim()}</span>
                  </button>
                )}
                {suggestions.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => attach({ tagId: t.id })}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted hover:bg-hover"
                  >
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${swatch(t.color).dot}`} />
                    <span className="flex-1 truncate">{t.name}</span>
                    {t.count ? <span className="text-2xs text-faint">{t.count}</span> : null}
                  </button>
                ))}
                {!suggestions.length && !query && (
                  <p className="px-2 py-2 text-xs text-faint">No tags yet. Type to create one.</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {trailing}
    </div>
  );
}
