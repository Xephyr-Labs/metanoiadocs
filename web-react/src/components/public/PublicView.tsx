import { useCallback, useEffect, useState } from 'react';
import { FileWarning, Globe, MessageSquareText } from 'lucide-react';
import { LazyEditor } from '../../editor/LazyEditor';
import { onCommentRequest } from '../../editor/comments';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { cn } from '../../lib/cn';
import { Logo } from '../brand/Logo';
import { GuestComments, loadGuestComments } from './GuestComments';

interface Doc {
  id: string;
  title: string;
  access?: 'view' | 'comment';
}

/**
 * Public viewer at /share/:token. No auth — the token is the whole capability.
 * Resolves the token to a doc, then mounts BlockSuite read-only over the same
 * Hocuspocus channel (the server allows a viewer connection when the share
 * token matches).
 *
 * When the owner set the link to "can comment", the page also carries the
 * comment layer and a comments panel: a guest reads, selects, and comments
 * under a name, with no account. The page itself stays read-only either way.
 */
export function PublicView({ token }: { token: string }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMobile = useMediaQuery('(max-width: 767px)');
  // On a phone the panel is a sheet over the page, opened on demand; on a
  // wider screen it simply sits beside the page.
  const [sheet, setSheet] = useState(false);
  const canComment = doc?.access === 'comment';
  const guestComments = useCallback(() => loadGuestComments(token), [token]);
  // Selecting text and pressing Comment (or an image's Comment button) asks
  // for the panel; on a phone that means opening the sheet.
  useEffect(() => (canComment ? onCommentRequest(() => setSheet(true)) : undefined), [canComment]);

  // Match the viewer's saved theme so shared pages aren't jarring.
  useEffect(() => {
    const stored = localStorage.getItem('mn-theme');
    const dark = stored ? stored === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', !!dark);
  }, []);

  useEffect(() => {
    let alive = true;
    fetch(`/api/public/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('This link is invalid or has been turned off.');
        return r.json();
      })
      .then((d) => alive && setDoc(d))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [token]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface text-faint ring-1 ring-inset ring-line">
          <FileWarning size={20} strokeWidth={1.75} />
        </div>
        <div>
          <p className="text-md font-semibold text-ink">Page unavailable</p>
          <p className="mt-1 text-sm text-muted">{error}</p>
        </div>
        <a href="/" className="text-sm font-medium text-accent-strong hover:underline">Go to MetanoiaDocs</a>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      <header className="sticky top-0 z-30 flex h-[var(--topbar-h)] shrink-0 items-center justify-between border-b border-line bg-glass px-4 backdrop-blur-md">
        <a href="/" className="flex items-center gap-2"><Logo size={20} /></a>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-2xs font-medium text-muted ring-1 ring-inset ring-line">
            <Globe size={12} /> {canComment ? 'Public · you can comment' : 'Public · read-only'}
          </span>
          {canComment && isMobile && (
            <button
              type="button"
              onClick={() => setSheet(true)}
              aria-label="Open comments"
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink"
            >
              <MessageSquareText size={16} />
            </button>
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="scrollarea min-h-0 min-w-0 flex-1 overflow-y-auto">
          {doc ? (
            <div className="pb-40 pt-10">
              <LazyEditor
                docId={doc.id}
                title={doc.title}
                mode="page"
                userName="Guest"
                share={token}
                guestComments={canComment ? guestComments : undefined}
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent" />
            </div>
          )}
        </main>
        {canComment && (!isMobile || sheet) && (
          <div
            className={cn(
              isMobile
                ? 'fixed inset-0 z-40 flex flex-col bg-canvas'
                : 'w-[340px] shrink-0 border-l border-line',
            )}
          >
            <GuestComments token={token} onClose={isMobile ? () => setSheet(false) : undefined} />
          </div>
        )}
      </div>
    </div>
  );
}
