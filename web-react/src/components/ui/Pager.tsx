import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from './IconButton';

export const PAGE_SIZE = 50;

/**
 * One page of a list held in memory. `resetOn` names the list: when it
 * changes (a new filter, sort or folder) the view goes back to page one, since
 * staying on page 7 of the old list would open on an empty screen.
 */
export function usePaged<T>(items: T[], resetOn: unknown, size = PAGE_SIZE) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [resetOn]);
  const pages = Math.max(1, Math.ceil(items.length / size));
  // Deleting the last page's only row must not strand the view past the end.
  const current = Math.min(page, pages - 1);
  return {
    shown: items.slice(current * size, (current + 1) * size),
    current,
    pages,
    total: items.length,
    size,
    setPage,
  };
}

/** "51–100 of 240 ‹ ›", drawn only when there is more than one page. */
export function Pager({ paged, onPage, className }: {
  paged: ReturnType<typeof usePaged<unknown>>;
  /** After the page changes — a long list wants to scroll back to its top. */
  onPage?: () => void;
  className?: string;
}) {
  const { current, pages, size, total, shown, setPage } = paged;
  if (pages <= 1) return null;
  const go = (p: number) => { setPage(p); onPage?.(); };
  return (
    <nav aria-label="Pages" className={className ?? 'mt-3 flex items-center justify-end gap-1 text-2xs tabular-nums text-faint'}>
      {current * size + 1}–{current * size + shown.length} of {total}
      <IconButton icon={<ChevronLeft size={14} />} label="Previous page" onClick={() => go(current - 1)} disabled={current === 0} />
      <IconButton icon={<ChevronRight size={14} />} label="Next page" onClick={() => go(current + 1)} disabled={current >= pages - 1} />
    </nav>
  );
}
