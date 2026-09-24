import { useRef, useState } from 'react';
import { Plus, Tag as TagIcon, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { swatch } from '../../lib/tagColors';
import { relativeTime } from '../../lib/time';
import { useWorkspace } from '../../store/workspace';
import { CheckList } from '../ui/CheckList';
import { DocIcon } from '../ui/DocIcon';
import { EmptyState } from '../ui/EmptyState';
import { Modal, ModalBody } from '../ui/Modal';
import { Pager, usePaged } from '../ui/Pager';

/**
 * Docs carrying the chosen tags. Opened from the sidebar Tags list.
 *
 * More than one tag can be on at a time, and a page matching any of them is
 * listed — picking Marketing and Design asks for both teams' pages, not the
 * handful filed under both, which is the same rule the task filter's "is any
 * of" follows. The picker is in here rather than the sidebar so tags can be
 * added and dropped while looking at what they return.
 */
export function TagView() {
  const ws = useWorkspace();
  const [pick, setPick] = useState(false);

  const chosen = ws.tagFilter;
  const open = chosen.length > 0;
  const tags = ws.allTags.filter((t) => chosen.includes(t.id));
  const docs = Object.values(ws.pages)
    .filter((p) => p.tags.some((t) => chosen.includes(t.id)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const paged = usePaged(docs, chosen.join());
  const top = useRef<HTMLDivElement>(null);

  const choose = (id: string) => {
    ws.select(id);
    ws.setTagFilter([]);
  };

  const toggle = (id: string) =>
    ws.setTagFilter(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && ws.setTagFilter([])}
      placement="top"
      className="max-h-[70vh]"
      title={
        <>
          {tags.length === 1 ? (
            <span className={`h-3 w-3 shrink-0 rounded-full ${swatch(tags[0].color).dot}`} />
          ) : (
            <TagIcon size={16} className="text-muted" />
          )}
          <span className="truncate">
            {tags.length === 1 ? tags[0].name : tags.length ? `${tags.length} tags` : 'Tag'}
          </span>
          <span className="shrink-0 text-sm font-normal text-faint">{docs.length}</span>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
        {tags.map((t) => (
          <span
            key={t.id}
            className={cn('flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium', swatch(t.color).chip)}
          >
            {t.name}
            <button
              type="button"
              aria-label={`Remove ${t.name}`}
              onClick={() => toggle(t.id)}
              className="rounded-sm opacity-60 hover:opacity-100"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <button
          type="button"
          aria-expanded={pick}
          onClick={() => setPick((v) => !v)}
          className="flex h-6 items-center gap-1 rounded px-1.5 text-2xs text-muted hover:bg-hover hover:text-ink"
        >
          <Plus size={12} /> Tag
        </button>
      </div>

      {pick && (
        <CheckList
          className="mx-2 mt-2 shrink-0"
          options={ws.allTags.map((t) => ({
            value: t.id,
            label: t.name,
            lead: <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', swatch(t.color).dot)} />,
            trail: t.count ? <span className="shrink-0 text-2xs text-faint">{t.count}</span> : undefined,
          }))}
          chosen={chosen}
          onToggle={toggle}
          onClear={() => ws.setTagFilter([])}
          empty="No tags yet."
        />
      )}

      <ModalBody>
        <div ref={top} />
        {docs.length === 0 ? (
          <EmptyState icon={TagIcon} title="No pages" hint="No pages carry these tags yet." />
        ) : (
          paged.shown.map((p) => (
            <button key={p.id} onClick={() => choose(p.id)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-hover">
              <DocIcon hasChildren={p.children.length > 0} size={16} />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.title || 'Untitled'}</span>
              <span className="shrink-0 text-2xs text-faint">{relativeTime(p.updatedAt)}</span>
            </button>
          ))
        )}
        <Pager paged={paged} onPage={() => top.current?.scrollIntoView({ block: 'start' })} />
      </ModalBody>
    </Modal>
  );
}
