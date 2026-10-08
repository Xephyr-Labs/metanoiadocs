/* Hallmark · component: task discussion thread · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: loading · empty · posting · own comment (deletable) · agent author
 *         · reply box open · thread with replies
 *         · mention menu open · send failed
 */
import { Loader2, MessageSquareText, Pencil, Send, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { avatarFor } from '../../lib/avatar';
import { docsApi, type UserRow } from '../../lib/docsApi';
import { relativeTime } from '../../lib/time';
import { tasksApi, type TaskComment } from '../../lib/tasksApi';
import { useAuth } from '../../store/auth';
import { ActorMark } from '../ui/ActorMark';
import { IconButton } from '../ui/IconButton';
import { CommentBox, savedDraft, type CommentBoxHandle } from '../ui/CommentBox';
import { Reactions } from '../ui/Reactions';
import { ClampedText } from '../ui/ClampedText';
import { emojify, toggleLocal } from '../../lib/emoji';

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

/**
 * Top-level comments, each with its replies, in posting order.
 *
 * One level deep, like a page's threads: the server files a reply to a reply
 * under the same top-level comment. The parent chain is still followed here,
 * because rows filed before it did may point at a reply; a parent that is
 * gone (or was never on this task) leaves the row standing on its own.
 */
export function threadComments<T extends { id: string; parent_id: string | null }>(rows: T[]) {
  const byId = new Map(rows.map((c) => [c.id, c]));
  const rootOf = (c: T) => {
    const seen = new Set<string>();
    while (c.parent_id && byId.has(c.parent_id) && !seen.has(c.id)) {
      seen.add(c.id);
      c = byId.get(c.parent_id)!;
    }
    return c;
  };
  const threads = new Map<string, { root: T; replies: T[] }>();
  for (const c of rows) {
    const root = rootOf(c);
    if (!threads.has(root.id)) threads.set(root.id, { root, replies: [] });
    if (root !== c) threads.get(root.id)!.replies.push(c);
  }
  return [...threads.values()];
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
 * Threaded one level deep, the same as a page's comments: any comment can be
 * answered, and the answer sits under the top-level comment it belongs to.
 * Deeper nesting would make a narrow peek panel a staircase.
 *
 * Mounted twice: under the row in the peek, and in the right panel when the
 * open page is a task's page. There `title` separates it from the page's own
 * anchored comments, which are a different conversation about the same thing.
 */
export function TaskComments({
  taskId,
  users,
  title = 'Comments',
}: {
  taskId: string;
  users: UserRow[];
  title?: string;
}) {
  const auth = useAuth();
  const [rows, setRows] = useState<TaskComment[] | null>(null);
  const draftKey = `task:${taskId}`;
  const [draft, setDraft] = useState(() => savedDraft(draftKey));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  // The thread the reply box sits under, and the comment actually answered —
  // a reply's author is the one told, even though it files under the thread.
  const [replyTo, setReplyTo] = useState<{ thread: string; to: string } | null>(null);
  const [replyText, setReplyText] = useState('');
  const inputRef = useRef<CommentBoxHandle>(null);
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
    // Replies (an agent answering an @mention) arrive while the task is open;
    // pick them up without a reopen. ponytail: polling, a push event if it ever matters.
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      tasksApi.comments(taskId).then((r) => alive && setRows(r)).catch(() => {});
    };
    const timer = window.setInterval(refresh, 20_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
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

  const sendReply = async () => {
    const body = replyText.trim();
    if (!body || busy || !replyTo) return;
    setBusy(true);
    setError(null);
    try {
      const row = await tasksApi.addComment(taskId, { body, parentId: replyTo.to });
      setRows((r) => [...(r ?? []), row]);
      setReplyText('');
      setReplyTo(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post that reply.');
    } finally {
      setBusy(false);
    }
  };

  const openReply = (thread: string, to: string) => {
    setReplyTo({ thread, to });
    setReplyText(savedDraft(`task-reply:${thread}`));
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

  /** Toggle a reaction: shown at once, then the server's count. */
  const react = async (cid: string, emoji: string) => {
    setRows((r) => (r ?? []).map((c) => (c.id === cid ? { ...c, reactions: toggleLocal(c.reactions, emoji, auth.user?.name) } : c)));
    try {
      const out = await docsApi.react(cid, emoji);
      setRows((r) => (r ?? []).map((c) => (c.id === cid ? { ...c, reactions: out.reactions } : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not react.');
    }
  };

  const remove = async (id: string) => {
    // A top-level comment goes with its replies, as on a page (the server does
    // the same) — and, as on a page, not without asking.
    if (rows?.some((c) => c.parent_id === id) && !confirm('Delete this comment and its replies?')) return;
    setRows((r) => (r ?? []).filter((c) => c.id !== id && c.parent_id !== id));
    await tasksApi.deleteComment(id).catch(() => {
      // Put it back: a comment that vanishes on screen and survives on the
      // server is worse than one that never went.
      tasksApi.comments(taskId).then(setRows).catch(() => {});
    });
  };

  // A plain function, not a component: one declared here gets a new identity
  // every render, and the open edit box would remount on each keystroke.
  const renderComment = (c: TaskComment, thread: string, size: number) => (
    <>
      <Avatar name={c.author_name || '?'} size={size} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-2xs text-faint">
          <span className="font-medium text-ink">{c.author_name || 'Someone'}</span>
          <ActorMark kind={c.author_kind} name={c.author_name || ''} />
          <span>{relativeTime(c.created_at)}</span>
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
            // Newlines and wrapping both count: a pasted list and a long
            // single line each need more than one row to be editable.
            rows={Math.min(8, Math.max(2, editing.text.split('\n').length, Math.ceil(editing.text.length / 60)))}
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
          <ClampedText className="text-sm leading-relaxed text-ink">
            {emojify(c.body)}
            {c.edited_at && <span className="ml-1 text-2xs text-faint">(edited)</span>}
          </ClampedText>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Reactions reactions={c.reactions} onToggle={(e) => void react(c.id, e)} className="mt-0" />
          <button
            type="button"
            onClick={() => openReply(thread, c.id)}
            className="text-2xs font-medium text-muted hover:text-ink"
          >
            Reply
          </button>
        </div>
      </div>
    </>
  );

  return (
    <section className="px-4 py-3">
      <h3 className="mb-1.5 text-2xs font-semibold uppercase text-muted">{title}</h3>

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
          {threadComments(rows).map(({ root, replies }) => (
            <li key={root.id}>
              <div className="group/comment group/card flex items-start gap-2">{renderComment(root, root.id, 20)}</div>
              {(replies.length > 0 || replyTo?.thread === root.id) && (
                <ul className="ml-[9px] mt-2 space-y-2 border-l-2 border-line pl-2.5">
                  {replies.map((r) => (
                    <li key={r.id} className="group/comment group/card flex items-start gap-2">
                      {renderComment(r, root.id, 18)}
                    </li>
                  ))}
                  {replyTo?.thread === root.id && (
                    <li className="flex items-end gap-1.5 rounded-md ring-1 ring-inset ring-line focus-within:ring-2 focus-within:ring-accent">
                      <CommentBox
                        draftKey={`task-reply:${root.id}`}
                        value={replyText}
                        onChange={setReplyText}
                        onEnter={() => { void sendReply(); }}
                        placeholder="Reply…"
                        className="px-2.5 py-1.5"
                      />
                      <IconButton
                        icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        label="Send reply"
                        onClick={() => void sendReply()}
                        className="mb-0.5 mr-0.5"
                      />
                    </li>
                  )}
                </ul>
              )}
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
        <div className="flex items-end gap-2 rounded-md ring-1 ring-inset ring-line focus-within:ring-2 focus-within:ring-accent">
          <CommentBox
            ref={inputRef}
            draftKey={draftKey}
            value={draft}
            onChange={(v) => {
              setDraft(v);
              setDismissed(false);
            }}
            onEnter={() => {
              if (suggestions.length > 0) {
                pick(suggestions[0]);
                return;
              }
              send();
            }}
            placeholder="Add a comment…  @ to mention"
            className="px-2.5 py-1.5"
          />
          <IconButton
            icon={busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            label="Post comment"
            onClick={send}
            className="mb-0.5 mr-0.5"
          />
        </div>
        {error && <p className="mt-1 text-2xs text-danger-strong">{error}</p>}
      </div>
    </section>
  );
}
