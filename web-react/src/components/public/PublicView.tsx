import { useEffect, useState } from 'react';
import { FileWarning, Globe } from 'lucide-react';
import { BlockSuiteEditor } from '../../editor/BlockSuiteEditor';
import { Logo } from '../brand/Logo';

interface Doc {
  id: string;
  title: string;
}

/**
 * Read-only public viewer at /share/:token. No auth — the token is the whole
 * capability. Resolves the token to a doc, then mounts BlockSuite read-only
 * over the same Hocuspocus channel (the server allows a viewer connection when
 * the share token matches).
 */
export function PublicView({ token }: { token: string }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          <FileWarning size={22} strokeWidth={1.75} />
        </div>
        <div>
          <p className="text-[15px] font-semibold text-ink">Page unavailable</p>
          <p className="mt-1 text-[13.5px] text-muted">{error}</p>
        </div>
        <a href="/" className="text-[13px] font-medium text-accent hover:underline">Go to MetanoiaDocs</a>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      <header className="sticky top-0 z-30 flex h-[45px] shrink-0 items-center justify-between border-b border-line bg-canvas/80 px-4 backdrop-blur-md">
        <a href="/" className="flex items-center gap-2"><Logo size={22} /></a>
        <span className="flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-2xs font-medium text-muted ring-1 ring-inset ring-line">
          <Globe size={12} /> Public · read-only
        </span>
      </header>
      <main className="scrollarea min-h-0 flex-1 overflow-y-auto">
        {doc ? (
          <div className="pb-40 pt-10">
            <BlockSuiteEditor docId={doc.id} title={doc.title} mode="page" userName="Guest" share={token} />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent" />
          </div>
        )}
      </main>
    </div>
  );
}
