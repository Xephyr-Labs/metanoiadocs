import { Tag as TagIcon } from 'lucide-react';
import { swatch } from '../../lib/tagColors';
import { relativeTime } from '../../lib/time';
import { useWorkspace } from '../../store/workspace';
import { DocIcon } from '../ui/DocIcon';
import { EmptyState } from '../ui/EmptyState';
import { Modal, ModalBody } from '../ui/Modal';

/** Docs carrying the currently-filtered tag. Opened from the sidebar Tags list. */
export function TagView() {
  const ws = useWorkspace();
  const open = ws.tagFilter !== null;
  const tag = ws.allTags.find((t) => t.id === ws.tagFilter);
  const docs = Object.values(ws.pages)
    .filter((p) => p.tags.some((t) => t.id === ws.tagFilter))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const pick = (id: string) => {
    ws.select(id);
    ws.setTagFilter(null);
  };

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && ws.setTagFilter(null)}
      placement="top"
      className="max-h-[70vh]"
      title={
        <>
          {tag ? <span className={`h-3 w-3 shrink-0 rounded-full ${swatch(tag.color).dot}`} /> : <TagIcon size={16} className="text-muted" />}
          <span className="truncate">{tag?.name ?? 'Tag'}</span>
          <span className="shrink-0 text-sm font-normal text-faint">{docs.length}</span>
        </>
      }
    >
      <ModalBody>
        {docs.length === 0 ? (
          <EmptyState icon={TagIcon} title="No pages" hint="No pages carry this tag yet." />
        ) : (
          docs.map((p) => (
            <button key={p.id} onClick={() => pick(p.id)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-hover">
              <DocIcon hasChildren={p.children.length > 0} size={16} />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.title || 'Untitled'}</span>
              <span className="shrink-0 text-2xs text-faint">{relativeTime(p.updatedAt)}</span>
            </button>
          ))
        )}
      </ModalBody>
    </Modal>
  );
}
