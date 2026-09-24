import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const STEP = 20;

/**
 * The sidebar's form of paging. Page numbers make no sense inside a tree, so
 * each level draws its first twenty rows and a "Show more" under them. The
 * open page always stays drawn, however far down its list it sits, so the
 * tree never hides where you are.
 */
export function useShowMore(ids: string[], currentId: string | null) {
  const [limit, setLimit] = useState(STEP);
  const at = currentId ? ids.indexOf(currentId) : -1;
  const n = Math.max(limit, at + 1);
  return { shown: ids.slice(0, n), rest: ids.length - n, more: () => setLimit(n + STEP) };
}

export function ShowMoreRow({ rest, depth, onClick }: { rest: number; depth: number; onClick: () => void }) {
  if (rest <= 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 w-full items-center gap-2 rounded-md pr-1 text-left text-sm text-muted transition-colors duration-120 hover:bg-hover hover:text-ink"
      style={{ paddingLeft: 8 + depth * 16 }}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center"><ChevronDown size={14} /></span>
      Show {Math.min(rest, STEP)} more
      <span className="text-2xs text-faint">· {rest} hidden</span>
    </button>
  );
}
