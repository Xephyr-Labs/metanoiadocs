/* Hallmark · component: comments for a guest on a public link · genre: modern-minimal
 * theme: project tokens (index.css)
 * states: loading · empty · threads · name needed · posting · error · editing
 */
import { MessageSquareText, Pencil, Send, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  onCommentsChanged,
  applyCommentHighlights, clearPendingAnchor, clearPendingFocus, usePendingAnchor, usePendingFocus,
} from '../../editor/comments';
import { avatarFor } from '../../lib/avatar';
import { cn } from '../../lib/cn';
import { relativeTime } from '../../lib/time';
import { EmptyState } from '../ui/EmptyState';
import { Reactions } from '../ui/Reactions';
import { ClampedText } from '../ui/ClampedText';
import { emojify } from '../../lib/emoji';
import { field } from '../ui/styles';

export interface GuestCommentRow {
  id: string;
  block_id: string | null;
  quote: string | null;
  body: string;
  author_name: string;
  guest: boolean;
  parent_id: string | null;
  resolved: boolean;
  created_at: string;
  edited_at: string | null;
  /** A suggested replacement for the quote, decided by the page's editors. */
  kind?: 'comment' | 'suggestion';
  suggestion?: string | null;
  suggestion_status?: 'accepted' | 'rejected' | null;
  reactions?: { emoji: string; count: number; names?: string[] }[];
}

const NAME_KEY = 'mn-guest-name';
/** Keys for this browser's own comments, per link: comment id -> key. */
const keysKey = (token: string) => `mn-guest-keys:${token}`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: nothing remembered */ }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || 'Something went wrong. Try again.');
  return data as T;
}

/** The page's comments, as a guest reads them. Shared with the editor's
 *  highlight layer, which loads through the same endpoint. */
export const loadGuestComments = (token: string) =>
  call<GuestCommentRow[]>(`/api/public/${encodeURIComponent(token)}/comments`);

function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  const a = avatarFor(name);
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: a.color, fontSize: size * 0.42 }}>
      {a.initials}
    </span>
  );
}

function GuestBadge() {
  return <span className="rounded bg-hover px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted">Guest</span>;
}

/**
 * Comments for someone reading a page through a public link that allows them.
 *
 * No account and no session: the visitor types a name once (remembered in this
 * browser), and each comment they post comes back with a key that lets this
 * browser — and only this one — edit or delete it later. Selecting text or
 * using an image's Comment button pins the comment to that spot, exactly as for
 * a member; the editor's comment layer feeds this panel the same anchor.
 */
export function GuestComments({ token, onClose }: { token: string; onClose?: () => void }) {
  const [rows, setRows] = useState<GuestCommentRow[] | null>(null);
  const [name, setName] = useState<string>(() => read(NAME_KEY, ''));
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>(() => read(keysKey(token), {}));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const anchor = usePendingAnchor();
  const focusId = usePendingFocus();

  const load = () =>
    loadGuestComments(token)
      .then((r) => { setRows(r); applyCommentHighlights(r); })
      .catch((e: Error) => { setRows([]); setError(e.message); });
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);
  // Someone commented, answered or decided a suggestion while this is open.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onCommentsChanged(() => { load(); }), [token]);

  // A selection was just turned into a comment — put the caret in the box.
  useEffect(() => {
    if (!anchor) return;
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [anchor]);
  // A highlighted passage was clicked — bring its thread into view.
  useEffect(() => {
    if (!focusId || !rows) return;
    cardRefs.current.get(focusId)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = setTimeout(clearPendingFocus, 1800);
    return () => clearTimeout(t);
  }, [focusId, rows]);

  const remember = (id: string, key: string) => {
    const next = { ...keys, [id]: key };
    setKeys(next);
    write(keysKey(token), next);
  };

  const saveName = (value: string) => {
    const clean = value.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!clean) return false;
    setName(clean);
    write(NAME_KEY, clean);
    setNaming(false);
    return true;
  };

  const post = async (body: string, parentId: string | null) => {
    const text = body.trim();
    if (!text || busy) return false;
    if (!name) { setNaming(true); return false; }
    setBusy(true);
    setError(null);
    try {
      const made = await call<{ id: string; key: string }>(`/api/public/${encodeURIComponent(token)}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          body: text,
          parentId,
          blockId: parentId ? undefined : anchor?.blockId ?? undefined,
          quote: parentId ? undefined : anchor?.quote ?? undefined,
        }),
      });
      remember(made.id, made.key);
      if (!parentId) clearPendingAnchor();
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const { id, text } = editing;
    setEditing(null);
    if (!text.trim()) return;
    try {
      await call(`/api/public/${encodeURIComponent(token)}/comments/${id}`, {
        method: 'PATCH', body: JSON.stringify({ key: keys[id], body: text }),
      });
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this comment?')) return;
    try {
      await call(`/api/public/${encodeURIComponent(token)}/comments/${id}`, {
        method: 'DELETE', body: JSON.stringify({ key: keys[id] }),
      });
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const roots = (rows ?? []).filter((c) => !c.parent_id);
  const open = roots.filter((c) => !c.resolved);
  const resolved = roots.filter((c) => c.resolved);
  const replies = (id: string) => (rows ?? []).filter((c) => c.parent_id === id);

  const ownTools = (c: GuestCommentRow) => keys[c.id] && (
    <span className="ml-auto flex items-center gap-0.5">
      <button type="button" aria-label="Edit comment" onClick={() => setEditing({ id: c.id, text: c.body })} className="rounded p-1 text-faint hover:bg-hover hover:text-ink"><Pencil size={12} /></button>
      <button type="button" aria-label="Delete comment" onClick={() => remove(c.id)} className="rounded p-1 text-faint hover:bg-hover hover:text-danger-strong"><Trash2 size={12} /></button>
    </span>
  );

  const body = (c: GuestCommentRow, className: string) => editing?.id === c.id ? (
    <textarea
      autoFocus
      value={editing.text}
      onChange={(e) => setEditing({ id: c.id, text: e.target.value })}
      onBlur={saveEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
        if (e.key === 'Escape') setEditing(null);
      }}
      rows={2}
      className={cn(field, 'mt-1 w-full resize-none text-sm')}
    />
  ) : (
    <ClampedText className={className}>
      {emojify(c.body)}
      {c.edited_at && <span className="ml-1 text-2xs text-faint">(edited)</span>}
    </ClampedText>
  );

  const card = (c: GuestCommentRow) => (
    <div
      key={c.id}
      ref={(el) => { if (el) cardRefs.current.set(c.id, el); else cardRefs.current.delete(c.id); }}
      className={cn(
        'rounded-lg border border-line bg-comment p-3 transition-shadow duration-220',
        c.resolved && 'bg-transparent opacity-55',
        focusId === c.id && 'ring-2 ring-accent',
      )}
    >
      <div className="flex items-center gap-2">
        <Avatar name={c.author_name} />
        <span className="truncate text-sm font-medium text-ink">{c.author_name}</span>
        {c.guest && <GuestBadge />}
        <span className="shrink-0 text-2xs text-faint">{relativeTime(c.created_at)}</span>
        {ownTools(c)}
      </div>
      {c.kind === 'suggestion' ? (
        <p className="mt-1.5 whitespace-pre-wrap break-words rounded-md bg-canvas p-2 text-sm ring-1 ring-inset ring-line">
          <del className="mn-diff-del">{c.quote}</del>{' → '}
          {c.suggestion ? <ins className="mn-diff-add">{c.suggestion}</ins> : <span className="text-2xs italic text-muted">delete it</span>}
          {c.suggestion_status && <span className="ml-1.5 text-2xs text-faint">({c.suggestion_status})</span>}
        </p>
      ) : c.quote && <p className="mt-1.5 border-l-2 border-comment-mark pl-2 text-2xs italic text-muted">{c.quote}</p>}
      {body(c, 'mt-1.5 text-sm leading-relaxed text-ink')}
      {/* Read-only: reacting needs an account. */}
      <Reactions reactions={c.reactions} />
      {replies(c.id).map((r) => (
        <div key={r.id} className="mt-2.5 flex items-start gap-2 border-l-2 border-line pl-2.5">
          <Avatar name={r.author_name} size={18} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-2xs font-medium text-ink">
              {r.author_name}
              {r.guest && <GuestBadge />}
              <span className="font-normal text-faint">· {relativeTime(r.created_at)}</span>
              {ownTools(r)}
            </p>
            {body(r, 'text-sm text-ink')}
            <Reactions reactions={r.reactions} />
          </div>
        </div>
      ))}
      {!c.resolved && (replyTo === c.id ? (
        <form
          className="mt-2.5 flex items-end gap-1.5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await post(replyDraft, c.id)) { setReplyDraft(''); setReplyTo(null); }
          }}
        >
          <textarea
            autoFocus
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
              if (e.key === 'Escape') setReplyTo(null);
            }}
            rows={1}
            placeholder="Reply…"
            className={cn(field, 'min-h-8 flex-1 resize-none py-1.5 text-sm')}
          />
          <button type="submit" disabled={busy || !replyDraft.trim()} aria-label="Send reply" className="flex h-8 w-8 items-center justify-center rounded-md text-accent-strong hover:bg-hover disabled:text-faint"><Send size={14} /></button>
        </form>
      ) : (
        <button type="button" onClick={() => { setReplyTo(c.id); setReplyDraft(''); }} className="mt-2 text-2xs font-medium text-muted hover:text-ink">Reply</button>
      ))}
    </div>
  );

  return (
    <aside className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <MessageSquareText size={15} className="text-muted" />
        <span className="flex-1 text-sm font-medium text-ink">Comments</span>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close comments" className="rounded p-1 text-muted hover:bg-hover hover:text-ink"><X size={15} /></button>
        )}
      </header>

      <div className="scrollarea min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        {rows === null ? (
          <div className="flex justify-center py-10"><div className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-accent" /></div>
        ) : open.length === 0 && resolved.length === 0 ? (
          <EmptyState icon={MessageSquareText} title="No comments yet" hint="Select text in the page to comment on it, or add a comment below." compact />
        ) : (
          <>
            {open.map(card)}
            {resolved.length > 0 && (
              <details className="pt-1">
                <summary className="cursor-pointer text-2xs font-medium text-muted">{resolved.length} resolved</summary>
                <div className="mt-2 space-y-2.5">{resolved.map(card)}</div>
              </details>
            )}
          </>
        )}
      </div>

      <div className="border-t border-line p-3">
        {error && <p className="mb-2 text-xs text-danger-strong">{error}</p>}
        {!name || naming ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const value = new FormData(e.currentTarget).get('name');
              if (saveName(String(value ?? ''))) setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            <label className="block text-2xs font-medium text-muted" htmlFor="mn-guest-name">
              Your name — shown next to your comments
            </label>
            <div className="flex gap-1.5">
              <input
                id="mn-guest-name"
                name="name"
                autoFocus
                defaultValue={name}
                maxLength={60}
                placeholder="e.g. Sam from Acme"
                className={cn(field, 'flex-1')}
              />
              <button type="submit" className="rounded-md bg-accent-fill px-3 text-sm font-medium text-white hover:opacity-90">Continue</button>
            </div>
            <p className="text-2xs text-faint">No account needed. Anyone with this link can read what you write.</p>
          </form>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await post(draft, null)) setDraft('');
            }}
          >
            {anchor && (
              <div className="mb-2 flex items-center gap-2 rounded-md bg-comment px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-2xs italic text-muted">“{anchor.quote}”</span>
                <button type="button" onClick={clearPendingAnchor} aria-label="Remove quote" className="shrink-0 text-faint hover:text-ink"><X size={12} /></button>
              </div>
            )}
            <div className="flex items-end gap-1.5">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
                }}
                rows={2}
                placeholder={anchor ? 'Comment on selection…' : 'Add a comment…'}
                className={cn(field, 'flex-1 resize-none py-1.5 text-sm')}
              />
              <button type="submit" disabled={busy || !draft.trim()} aria-label="Send comment" className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-fill text-white hover:opacity-90 disabled:bg-line-strong"><Send size={14} /></button>
            </div>
            <p className="mt-1.5 text-2xs text-faint">
              Commenting as <span className="font-medium text-muted">{name}</span> ·{' '}
              <button type="button" onClick={() => setNaming(true)} className="underline-offset-2 hover:text-ink hover:underline">change</button>
            </p>
          </form>
        )}
      </div>
    </aside>
  );
}
