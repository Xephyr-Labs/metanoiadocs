/* Hallmark · component: focus-area (page tag) cell · genre: modern-minimal
 * theme: project tokens (index.css) + tag palette (lib/tagColors)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default · hover · focus-visible · open · searching · creating ·
 *         empty · saving · no vocabulary yet · read-only (no onChanged)
 */
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { cn } from '../../../lib/cn';
import { useAnchoredPopover } from '../../../hooks/useAnchoredPopover';
import { useOutsideClick } from '../../../hooks/useOutsideClick';
import { docsApi, type TagRow } from '../../../lib/docsApi';
import { swatch, TAG_COLORS } from '../../../lib/tagColors';
import { tasksApi, type TaskRow } from '../../../lib/tasksApi';

/**
 * The workspace's tag vocabulary, fetched once and shared.
 *
 * Module scope rather than a store read, for the same reason the embedded
 * database fetches its projects over REST: this renders inside the database
 * block's own React root as well as the app's, and `useWorkspace()` cannot
 * cross that boundary. Refetched after a tag is created so the next cell to
 * open sees it.
 */
let vocabulary: TagRow[] = [];
const listeners = new Set<(t: TagRow[]) => void>();
let loading = false;

function loadVocabulary(force = false) {
  if (loading || (vocabulary.length && !force)) return;
  loading = true;
  docsApi.tags()
    .then((rows) => { vocabulary = rows; for (const l of listeners) l(rows); })
    .catch(() => { /* the cell still lists what the task already carries */ })
    .finally(() => { loading = false; });
}

function useVocabulary(active: boolean) {
  const [tags, setTags] = useState<TagRow[]>(vocabulary);
  useEffect(() => {
    if (!active) return;
    listeners.add(setTags);
    loadVocabulary();
    return () => { listeners.delete(setTags); };
  }, [active]);
  return tags;
}

/**
 * A task's focus areas, editable.
 *
 * These are the tags on the task's *page*, not a column on `tasks` — which is
 * why `writeBuiltin` returns null for them and why this cell exists instead of
 * the generic one. The write needs a doc id, and a row that nobody has opened
 * has no page yet; `tasksApi.taskPage` mints one, and doing that lazily on the
 * first tag is the same bargain opening the row already makes. Importing a
 * thousand rows still creates no documents.
 *
 * Without `onChanged` this is the read-only chip list it used to be: the task
 * row in the caller's cache would otherwise keep showing the old tags after a
 * write, which reads as the click having failed.
 */
export function TagsCell({ task, onChanged }: { task: TaskRow; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  const { anchor, style } = useAnchoredPopover(open);
  useOutsideClick(pop, () => setOpen(false), open);
  const tags = useVocabulary(open);

  const on = task.tags ?? [];
  const onLower = new Set(on.map((t) => t.toLowerCase()));

  if (!onChanged) {
    if (!on.length) return <span className="px-1 text-sm text-faint">—</span>;
    return (
      <span className="flex flex-wrap items-center gap-1" title="Focus areas are edited on the task’s page">
        {on.map((t) => <Chip key={t} name={t} tags={tags} />)}
      </span>
    );
  }

  /** The task's page, made on demand — see the component note. */
  const pageId = async () => task.doc_id ?? (await tasksApi.taskPage(task.id)).docId;

  const run = async (fn: (docId: string) => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn(await pageId());
      onChanged();
    } catch {
      /* the list is re-read from the server either way */
    } finally {
      setBusy(false);
    }
  };

  const q = query.trim();
  const matches = tags.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));
  const exact = tags.some((t) => t.name.toLowerCase() === q.toLowerCase());

  const add = (tag: TagRow) => run((docId) => docsApi.addDocTag(docId, { tagId: tag.id }));

  const create = () => {
    if (!q || exact) return;
    const color = TAG_COLORS[tags.length % TAG_COLORS.length];
    setQuery('');
    return run(async (docId) => {
      await docsApi.addDocTag(docId, { name: q, color });
      loadVocabulary(true);
    });
  };

  const remove = (name: string) => {
    const tag = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (!tag) return;
    return run((docId) => docsApi.removeDocTag(docId, tag.id));
  };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-7 w-full min-w-0 items-center gap-1 rounded border border-transparent px-2.5 text-left text-sm',
          'transition-colors hover:border-line focus:border-accent focus:outline-none disabled:opacity-50',
        )}
      >
        {on.length ? (
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {on.map((t) => <Chip key={t} name={t} tags={tags} />)}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-faint">Empty</span>
        )}
      </button>

      {open && style && createPortal(
        <div
          ref={pop}
          style={style}
          className="z-50 flex flex-col overflow-hidden rounded-lg border border-line bg-canvas p-1.5 shadow-pop"
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); create(); }
              if (e.key === 'Escape') setOpen(false);
            }}
            placeholder="Search or create…"
            className="mb-1 h-7 w-full shrink-0 rounded-md bg-surface px-2 text-xs text-ink outline-none ring-1 ring-inset ring-line placeholder:text-faint focus:ring-2 focus:ring-accent"
          />
          <div className="scrollarea min-h-0 flex-1 overflow-y-auto">
            {matches.map((t) => {
              const chosen = onLower.has(t.name.toLowerCase());
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => (chosen ? remove(t.name) : add(t))}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-hover"
                >
                  <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', swatch(t.color).dot)} />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">{t.name}</span>
                  {t.count ? <span className="shrink-0 text-2xs text-faint">{t.count}</span> : null}
                  {chosen && <Check size={13} className="shrink-0 text-accent-strong" />}
                </button>
              );
            })}
            {q && !exact && (
              <button
                type="button"
                onClick={create}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs text-ink hover:bg-hover"
              >
                <Plus size={13} className="shrink-0 text-faint" /> Create
                <span className={cn('rounded px-1.5 py-0.5 text-2xs', swatch(TAG_COLORS[tags.length % TAG_COLORS.length]).chip)}>{q}</span>
              </button>
            )}
            {!matches.length && !q && (
              <p className="px-2 py-2 text-2xs text-faint">No focus areas yet — type to make one.</p>
            )}
          </div>

          {on.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1 border-t border-line pt-1.5">
              {on.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => remove(name)}
                  aria-label={`Remove ${name}`}
                  className={cn('flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs', swatch(colorOf(name, tags)).chip)}
                >
                  {name}
                  <X size={10} className="opacity-60" />
                </button>
              ))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

/** A tag's colour, or grey until the vocabulary has arrived. */
const colorOf = (name: string, tags: TagRow[]) =>
  tags.find((t) => t.name.toLowerCase() === name.toLowerCase())?.color ?? 'gray';

function Chip({ name, tags }: { name: string; tags: TagRow[] }) {
  return (
    <span className={cn('truncate rounded px-1.5 py-0.5 text-2xs', swatch(colorOf(name, tags)).chip)}>{name}</span>
  );
}
