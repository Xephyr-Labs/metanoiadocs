/* Hallmark · component: task discussion thread · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: loading · empty · posting · own comment (deletable) · agent author
 *         · mention menu open · send failed
 */
import { Loader2, MessageSquareText, Pencil, Send, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { avatarFor } from '../../lib/avatar';
import type { UserRow } from '../../lib/docsApi';
import { relativeTime } from '../../lib/time';
import { tasksApi, type TaskComment } from '../../lib/tasksApi';
import { useAuth } from '../../store/auth';
import { ActorMark } from '../ui/ActorMark';
import { IconButton } from '../ui/IconButton';

/**
 * The handle being typed, if the caret is inside one.
 *
 * Only the run of characters after the last `@` on the line, and only while it
 * still looks like a handle — a space ends it, so "@ada replied" stops
 * suggesting after "ada". Returns null when there is nothing to complete,
 * which is the common case and the one that must cost nothing.
 *
 * Exported for its test: the menu opening at the wrong moment is the whole
 * failure mode of an @-picker, and it needs no DOM to check.
 */
export function mentionQuery(text: string): string | null {
  const at = text.lastIndexOf('@');
  if (at < 0) return null;
  // A handle starts a word: an email address typed into a comment is not one.
  if (at > 0 && !/\s/.test(text[at - 1])) return null;
  const rest = text.slice(at + 1);
  return /^[a-z0-9._-]*$/i.test(rest) ? rest.toLowerCase() : null;
}

/** Replace the handle being typed with the one that was picked. */
export function applyMention(text: string, username: string): string {
  return `${text.slice(0, text.lastIndexOf('@'))}@${username} `;
}

function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  const a = avatarFor(name);
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: a.color, fontSize: size * 0.42 }}
    >
      {a.initials}
    </span>
  );
}

/**
 * The conversation about one task.
 *
 * Flat, not threaded. A page's comments hang off a paragraph and a reply is
 * about that paragraph; a task has one subject — itself — and every message is
 * about it, so nesting would only add a level nobody needs to choose. The
 * table underneath still carries parent_id, so a reply is a later decision and
 * not a migration.
 */
export function TaskComments({ taskId, users }: { taskId: string; users: UserRow[] }) {
  const auth = useAuth();
  const [rows, setRows] = useState<TaskComment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape clears the draft, but the blur it causes still runs with the old
  // state — this tells that late save to stand down.
  const cancelEdit = useRef(false);

  useEffect(() => {
    let alive = true;
    setRows(null);
    tasksApi
      .comments(taskId)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [taskId]);

  const query = dismissed ? null : mentionQuery(draft);
  const suggestions =
    query === null
      ? []
      : users
          .filter((u) => `${u.username ?? ''} ${u.name ?? ''}`.toLowerCase().includes(query))
          .slice(0, 5);

  const pick = (u: UserRow) => {
    setDraft(applyMention(draft, u.username));
    setDismissed(true);
    inputRef.current?.focus();
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const row = await tasksApi.addComment(taskId, { body });
      // Appended rather than re-fetched: the row the server hands back is the
      // row it stored, and a round trip here is a visible pause on the one
      // action in this panel that has to feel immediate.
      setRows((r) => [...(r ?? []), row]);
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post that comment.');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (cancelEdit.current) { cancelEdit.current = false; return; }
    if (!editing) return;
    const body = editing.text.trim();
    const { id } = editing;
    setEditing(null);
    const before = rows;
    if (!body) return;
    setRows((r) => (r ?? []).map((c) => (c.id === id ? { ...c, body } : c)));
    try {
      const saved = await tasksApi.editComment(id, { body });
      setRows((r) => (r ?? []).map((c) => (c.id === id ? { ...c, ...saved } : c)));
    } catch (e) {
      setRows(before);
      setError(e instanceof Error ? e.message : 'Could not save that edit.');
    }
  };

  const remove = async (id: string) => {
    setRows((r) => (r ?? []).filter((c) => c.id !== id));
    await tasksApi.deleteComment(id).catch(() => {
      // Put it back: a comment that vanishes on screen and survives on the
      // server is worse than one that never went.
      tasksApi.comments(taskId).then(setRows).catch(() => {});
    });
  };

  return (
    <section className="px-4 py-3">
      <h3 className="mb-1.5 text-2xs font-semibold uppercase text-muted">Comments</h3>

      {rows === null ? (
        <div className="flex justify-center py-4">
          <Loader2 size={16} className="animate-spin text-faint" />
        </div>
      ) : rows.length === 0 ? (
        <p className="flex items-center gap-1.5 py-1 text-xs text-faint">
          <MessageSquareText size={14} /> No comments yet.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((c) => (
            <li key={c.id} className="group/comment flex items-start gap-2">
              <Avatar name={c.author_name || '?'} size={20} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-2xs text-faint">
                  <span className="font-medium text-ink">{c.author_name || 'Someone'}</span>
                  <ActorMark kind={c.author_kind} name={c.author_name || ''} />
                  <span>{relativeTime(c.created_at)}</span>
                  {c.edited_at && <span>· edited</span>}
                  {c.author_id === auth.user?.id && (
                    <span className="ml-auto flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover/comment:opacity-100">
                      <button
                        type="button"
                        onClick={() => setEditing({ id: c.id, text: c.body })}
                        aria-label="Edit this comment"
                        className="text-faint hover:text-ink"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(c.id)}
                        aria-label="Delete this comment"
                        className="text-faint hover:text-danger-strong"
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  )}
                </p>
                {/* Whitespace kept: people paste lists and short logs in here,
                    and a comment reflowed into one paragraph loses them. */}
                {editing?.id === c.id ? (
                  // A textarea, not an input: the same pasted lists have to
                  // survive being edited, and Enter still sends.
                  <textarea
                    autoFocus
                    rows={Math.min(6, editing.text.split('\n').length)}
                    value={editing.text}
                    onChange={(e) => setEditing({ id: c.id, text: e.target.value })}
                    onBlur={saveEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        saveEdit();
                      }
                      if (e.key === 'Escape') { cancelEdit.current = true; setEditing(null); }
                    }}
                    className="mt-0.5 w-full resize-none rounded-md bg-transparent px-1.5 py-1 text-sm leading-relaxed text-ink outline-none ring-1 ring-inset ring-line focus:ring-2 focus:ring-accent"
                  />
                ) : (
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{c.body}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="relative mt-2.5">
        {suggestions.length > 0 && (
          <div className="absolute bottom-[38px] left-0 right-0 z-10 overflow-hidden rounded-lg border border-line bg-canvas shadow-pop">
            {suggestions.map((u) => (
              <button
                key={u.id}
                type="button"
                // mousedown, not click: the input blurs first otherwise and the
                // menu is gone before the click can land.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(u);
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-hover"
              >
                <Avatar name={u.name || u.username || u.email} size={18} />
                <span className="font-medium text-ink">{u.name || u.username}</span>
                <span className="truncate text-2xs text-faint">@{u.username}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 rounded-md ring-1 ring-inset ring-line focus-within:ring-2 focus-within:ring-accent">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDismissed(false);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              if (suggestions.length > 0) {
                e.preventDefault();
                pick(suggestions[0]);
                return;
              }
              send();
            }}
            placeholder="Add a comment…  @ to mention"
            className="h-8 flex-1 bg-transparent px-2.5 text-sm outline-none placeholder:text-faint"
          />
          <IconButton
            icon={busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            label="Post comment"
            onClick={send}
            className="mr-0.5"
          />
        </div>
        {error && <p className="mt-1 text-2xs text-danger-strong">{error}</p>}
      </div>
    </section>
  );
}
