import { useEffect, useState } from 'react';
import { FileWarning, Globe, Loader2, MessageSquareText, Pencil, X } from 'lucide-react';
import { LazyEditor } from '../../editor/LazyEditor';
import { publicApi, type CommentRow, type ShareRole } from '../../lib/docsApi';
import { relativeTime } from '../../lib/time';
import { cn } from '../../lib/cn';
import { Logo } from '../brand/Logo';
import { Button } from '../ui/Button';
import { field } from '../ui/styles';

interface Doc {
  id: string;
  title: string;
  role: ShareRole;
}

const NAME_KEY = 'mn-guest-name';
const readName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
const saveName = (n: string) => { try { localStorage.setItem(NAME_KEY, n); } catch { /* private window */ } };

const BADGE: Record<ShareRole, { icon: typeof Globe; text: string }> = {
  view: { icon: Globe, text: 'Public · read-only' },
  comment: { icon: MessageSquareText, text: 'Public · can comment' },
  edit: { icon: Pencil, text: 'Public · can edit' },
};

/**
 * The page behind a public link at /share/:token. No account — the token is
 * the whole capability, and the link's role says what it allows: read, read
 * and comment, or edit. Guests who comment or edit give a name first (kept in
 * this browser), which the server always marks "(guest)".
 */
export function PublicView({ token }: { token: string }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(readName);
  const [panel, setPanel] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('mn-theme');
    const dark = stored ? stored === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', !!dark);
  }, []);

  useEffect(() => {
    let alive = true;
    publicApi.resolve(token)
      .then((d) => {
        if (!alive) return;
        setDoc(d);
        // Wide screens open the thread beside the page; phones keep the page.
        if (d.role !== 'view' && window.matchMedia?.('(min-width: 1024px)').matches) setPanel(true);
      })
      .catch(() => alive && setError('This link is invalid or has been turned off.'));
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

  const badge = doc ? BADGE[doc.role] : BADGE.view;
  const canComment = doc?.role === 'comment' || doc?.role === 'edit';
  // An editor's name is their cursor, so it is asked before the page mounts.
  const needName = doc?.role === 'edit' && !name;

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      <header className="sticky top-0 z-30 flex h-[var(--topbar-h)] shrink-0 items-center justify-between gap-2 border-b border-line bg-glass px-4 backdrop-blur-md">
        <a href="/" className="flex items-center gap-2"><Logo size={20} /></a>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-2xs font-medium text-muted ring-1 ring-inset ring-line">
            <badge.icon size={12} /> {badge.text}
          </span>
          {canComment && (
            <Button size="sm" variant="ghost" leftIcon={<MessageSquareText size={14} />} onClick={() => setPanel((p) => !p)} aria-pressed={panel}>
              Comments
            </Button>
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="scrollarea min-h-0 flex-1 overflow-y-auto">
          {!doc ? (
            <div className="flex h-full items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent" />
            </div>
          ) : needName ? (
            <NamePrompt onDone={(n) => { saveName(n); setName(n); }} />
          ) : (
            <div className="pb-40 pt-10">
              <LazyEditor
                docId={doc.id}
                title={doc.title}
                mode="page"
                userName={name ? `${name} (guest)` : 'Guest'}
                share={token}
                shareEdit={doc.role === 'edit'}
              />
            </div>
          )}
        </main>
        {doc && canComment && panel && (
          <aside className="fixed inset-0 z-40 flex flex-col bg-canvas lg:static lg:inset-auto lg:z-auto lg:w-[340px] lg:shrink-0 lg:border-l lg:border-line">
            <GuestComments token={token} name={name} onName={(n) => { saveName(n); setName(n); }} onClose={() => setPanel(false)} />
          </aside>
        )}
      </div>
    </div>
  );
}

function NamePrompt({ onDone }: { onDone: (name: string) => void }) {
  const [value, setValue] = useState('');
  const submit = () => value.trim() && onDone(value.trim());
  return (
    <div className="flex h-full items-center justify-center px-4">
      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="w-full max-w-sm rounded-xl bg-surface p-5 ring-1 ring-inset ring-line"
      >
        <p className="text-md font-semibold text-ink">What's your name?</p>
        <p className="mt-1 text-sm text-muted">Others on this page see it beside your edits, marked as a guest.</p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={40}
          placeholder="Your name"
          aria-label="Your name"
          className={cn(field, 'mt-4 w-full')}
        />
        <Button type="submit" variant="primary" className="mt-3 w-full" disabled={!value.trim()}>Continue</Button>
      </form>
    </div>
  );
}

function GuestComments({ token, name, onName, onClose }: {
  token: string;
  name: string;
  onName: (n: string) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<CommentRow[] | null>(null);
  const [text, setText] = useState('');
  const [nameDraft, setNameDraft] = useState(name);
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => publicApi.comments(token).then((r) => alive && setRows(r)).catch(() => alive && setRows([]));
    load();
    const timer = window.setInterval(load, 20_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [token]);

  const post = async () => {
    const who = (name || nameDraft).trim();
    const body = text.trim();
    if (!who || !body || busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (!name) onName(who);
      await publicApi.addComment(token, { body, name: who, parentId: replyTo?.id });
      setText('');
      setReplyTo(null);
      setRows(await publicApi.comments(token));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not post that comment.');
    } finally {
      setBusy(false);
    }
  };

  const roots = (rows ?? []).filter((c) => !c.parent_id);
  const replies = (id: string) => (rows ?? []).filter((c) => c.parent_id === id);
  const Item = ({ c }: { c: CommentRow }) => (
    <div>
      <p className="text-xs"><span className="font-semibold text-ink">{c.author_name}</span> <span className="text-faint">· {relativeTime(c.created_at)}</span></p>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">{c.body}</p>
    </div>
  );

  return (
    <>
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="text-sm font-semibold text-ink">Comments</h2>
        <button type="button" onClick={onClose} aria-label="Close comments" className="rounded p-1 text-muted hover:bg-hover hover:text-ink">
          <X size={16} />
        </button>
      </div>
      <div className="scrollarea min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {rows === null ? (
          <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-faint" /></div>
        ) : roots.length === 0 ? (
          <p className="py-8 text-center text-sm text-faint">No comments yet.</p>
        ) : roots.map((c) => (
          <div key={c.id} className={cn('rounded-lg bg-surface p-3 ring-1 ring-inset ring-line', c.resolved && 'opacity-70')}>
            {c.quote && <p className="mb-1.5 border-l-2 border-line-strong pl-2 text-xs italic text-muted">{c.quote}</p>}
            <Item c={c} />
            {replies(c.id).map((r) => <div key={r.id} className="mt-2.5 border-l-2 border-line pl-2.5"><Item c={r} /></div>)}
            <button type="button" onClick={() => setReplyTo(c)} className="mt-2 text-xs font-medium text-muted hover:text-ink">Reply</button>
          </div>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); post(); }} className="shrink-0 space-y-2 border-t border-line p-3">
        {replyTo && (
          <p className="flex items-center justify-between text-xs text-muted">
            <span className="truncate">Replying to {replyTo.author_name}</span>
            <button type="button" onClick={() => setReplyTo(null)} className="font-medium hover:text-ink">Cancel</button>
          </p>
        )}
        {!name && (
          <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={40} placeholder="Your name" aria-label="Your name" className={cn(field, 'w-full')} />
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(); }}
          rows={3}
          maxLength={4000}
          placeholder="Add a comment…"
          aria-label="Add a comment"
          className={cn(field, 'h-auto w-full resize-none py-2')}
        />
        {err && <p className="text-xs text-danger-strong">{err}</p>}
        <Button type="submit" variant="primary" size="sm" disabled={busy || !text.trim() || !(name || nameDraft.trim())}>
          {busy ? 'Posting…' : 'Post comment'}
        </Button>
      </form>
    </>
  );
}
