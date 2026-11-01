import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { detachedText, isDetached, onMarkersChanged, revealComment } from '../../editor/comments';

/** Enough of what a passage says now to read the change, not the whole block. */
const clip = (s: string) => (s.length > 280 ? `${s.slice(0, 280)}…` : s);

/**
 * The passage a thread is about, on its card. Clicking it scrolls the page to
 * the passage, the way clicking the passage opens the card. Once the passage
 * has been edited, the words as they were are struck through beside what they
 * say now — the diff a suggestion card draws — so the comment still reads
 * against the text it was written about.
 */
export function CommentQuote({ id, quote, blockId, resolved, onReveal }: {
  id: string;
  quote: string;
  blockId: string | null;
  resolved: boolean;
  /** Runs before the scroll — the phone sheet closes so the page shows. */
  onReveal?: () => void;
}) {
  // The highlighter decides which threads lost their text; it reruns on edits.
  const [, bump] = useState(0);
  useEffect(() => onMarkersChanged(() => bump((n) => n + 1)), []);

  const reveal = () => {
    onReveal?.();
    revealComment(id, blockId);
  };
  const changed = !resolved && isDetached(id);
  if (!changed) {
    return (
      <button
        type="button"
        onClick={reveal}
        title="Show in the page"
        className="mt-1.5 block w-full border-l-2 border-comment-mark pl-2 text-left text-2xs italic text-muted transition-colors duration-120 hover:text-ink"
      >
        {quote}
      </button>
    );
  }
  const now = detachedText(id);
  return (
    <button
      type="button"
      onClick={reveal}
      title="Show in the page"
      className="mt-1.5 block w-full rounded-md bg-canvas p-2 text-left ring-1 ring-inset ring-line transition-colors duration-120 hover:bg-hover"
    >
      <span className="block text-2xs text-faint">
        {now === null ? 'The text this was about has been removed.' : 'The text has changed since this comment.'}
      </span>
      <span className="mt-1 block whitespace-pre-wrap break-words text-xs leading-relaxed">
        <del className="mn-diff-del">{quote}</del>
        {now ? (
          <>
            <ArrowRight size={12} className="mx-1 inline text-faint" />
            <ins className="mn-diff-add">{clip(now)}</ins>
          </>
        ) : now === '' ? (
          <span className="ml-1 text-2xs italic text-muted">deleted</span>
        ) : null}
      </span>
    </button>
  );
}
