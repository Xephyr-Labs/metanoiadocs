import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, GitPullRequestArrow, Loader2, MessageSquareText, Pencil, RotateCcw, Send, SquarePen, Trash2, X } from 'lucide-react';
import { canCommentRole, canEditRole, canSuggestRole, docsApi, type CommentRow, type UserRow } from '../../lib/docsApi';
import {
  applyCommentHighlights, clearPendingAnchor, clearPendingFocus, isDetached, onCommentsChanged, onMarkersChanged,
  setPendingMode, usePendingAnchor, usePendingFocus,
} from '../../editor/comments';
import { tasksApi, type DocTask } from '../../lib/tasksApi';
import { openReview, useReviewState } from '../../lib/reviewMode';
import { relativeTime } from '../../lib/time';
import { toast } from '../../lib/toast';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import { useWorkspace } from '../../store/workspace';
import { useAuth } from '../../store/auth';
import { cn } from '../../lib/cn';
import { TaskComments } from '../project/TaskComments';
import { Avatar } from '../ui/Avatar';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { CommentBox, savedDraft, type CommentBoxHandle } from '../ui/CommentBox';

type Filter = 'open' | 'suggestions' | 'resolved';

const GuestChip = () => (
  <span className="rounded bg-hover px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted">Guest</span>
);

/** "@" + word characters at the end of a draft: the handle being typed. */
function useMentions(text: string, members: UserRow[], dismissed: boolean) {
  const match = text.match(/@([a-z0-9._-]*)$/i);
  const query = match ? match[1].toLowerCase() : null;
  return query !== null && !dismissed
    ? members
        .filter((m) => m.username && (m.username.toLowerCase().includes(query) || (m.name || '').toLowerCase().includes(query)))
        .slice(0, 6)
    : [];
}
const withMention = (text: string, m: UserRow) => text.replace(/@([a-z0-9._-]*)$/i, `@${m.username} `);

/**
 * The page's comments: threads to read, answer, resolve and reopen, and
 * suggested changes to accept or decline. Refreshes itself when anyone changes
 * a comment on the page (the server announces it over the page's connection).
 */
export function CommentsTab({ docId }: { docId: string }) {
  const auth = useAuth();
  const ws = useWorkspace();
  const role = ws.pages[docId]?.role;
  const me = auth.user?.id;
  const mayComment = canCommentRole(role);
  const maySuggest = canSuggestRole(role);
  const mayDecide = canEditRole(role);
  const review = useReviewState(docId, role, me);

  const [comments, setComments] = useState<CommentRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const draftKey = `doc:${docId}`;
  const [draft, setDraft] = useState(() => savedDraft(draftKey));
  const [replacement, setReplacement] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [members, setMembers] = useState<UserRow[]>([]);
  // The row this page belongs to, if any. Its comments live on the task, not
  // on the page — without this they are only visible from the board, which is
  // not where somebody reading the page looks for them.
  const [task, setTask] = useState<DocTask | null>(null);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [, bumpDetached] = useState(0);
  const composerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<CommentBoxHandle>(null);
  const replacementRef = useRef<CommentBoxHandle>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  // Escape abandons an edit, but the blur it causes still runs with the old
  // state — this tells that late save to stand down.
  const cancelEdit = useRef(false);
  const anchor = usePendingAnchor();
  const focusId = usePendingFocus();
  const suggesting = anchor?.mode === 'suggest' && maySuggest;

  const load = useCallback(() =>
    docsApi.comments(docId)
      .then((rows) => { setComments(rows); applyCommentHighlights(rows); })
      .catch(() => setComments((c) => c ?? [])), [docId]);
  useEffect(() => { setComments(null); void load(); }, [load]);
  // Live: the server's broadcast, a return to the tab, and a slow poll for the
  // rare case the page's connection is down.
  useEffect(() => {
    const off = onCommentsChanged(() => void load());
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    return () => { off(); document.removeEventListener('visibilitychange', onVisible); window.clearInterval(t); };
  }, [load]);
  // Which threads lost their text is decided by the highlighter.
  useEffect(() => onMarkersChanged(() => bumpDetached((n) => n + 1)), []);
  useEffect(() => {
    let alive = true;
    setTask(null);
    tasksApi.docTask(docId).then((r) => alive && setTask(r.task)).catch(() => {});
    return () => { alive = false; };
  }, [docId]);
  useEffect(() => { docsApi.users().then(setMembers).catch(() => {}); }, []);

  // Selection just landed here — put the caret in the composer. Delay past the
  // panel slide-in, which otherwise steals focus back.
  useEffect(() => {
    if (!anchor) return;
    if (anchor.mode === 'suggest') setReplacement(anchor.quote);
    setFilter(anchor.mode === 'suggest' ? 'suggestions' : 'open');
    const t = setTimeout(() => (anchor.mode === 'suggest' ? replacementRef : inputRef).current?.focus(), 300);
    return () => clearTimeout(t);
  }, [anchor]);
  // A marked range was clicked in the doc — bring its card into view, flash it.
  useEffect(() => {
    if (!focusId || !comments) return;
    const target = comments.find((c) => c.id === focusId);
    if (target) setFilter(target.resolved ? 'resolved' : target.kind === 'suggestion' && !target.suggestion_status ? 'suggestions' : 'open');
    const t0 = setTimeout(() => cardRefs.current.get(focusId)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
    const t = setTimeout(clearPendingFocus, 1800);
    return () => { clearTimeout(t0); clearTimeout(t); };
  }, [focusId, comments]);

  const mentions = useMentions(draft, members, mentionDismissed);
  useOutsideClick(composerRef, useCallback(() => setMentionDismissed(true), []), mentions.length > 0);

  const run = async (key: string, fn: () => Promise<unknown>, fail = 'Something went wrong') => {
    setBusy(key);
    try { await fn(); await load(); }
    catch (e) { toast(e instanceof Error ? e.message : fail); }
    finally { setBusy(null); }
  };

  const add = async () => {
    const body = draft.trim();
    if (busy) return;
    if (suggesting && anchor) {
      if (replacement === anchor.quote) { toast('Change the text to suggest something different'); return; }
      await run('add', async () => {
        await docsApi.addComment(docId, body, { blockId: anchor.blockId, quote: anchor.quote, kind: 'suggestion', suggestion: replacement });
        setDraft('');
        setReplacement('');
        clearPendingAnchor();
      }, 'Could not post the suggestion');
      return;
    }
    if (!body) return;
    await run('add', async () => {
      await docsApi.addComment(docId, body, anchor ? { blockId: anchor.blockId, quote: anchor.quote } : undefined);
      setDraft('');
      clearPendingAnchor();
    }, 'Could not post the comment');
  };

  const sendReply = async (parentId: string) => {
    const body = replyText.trim();
    if (!body || busy) return;
    await run(`reply:${parentId}`, async () => {
      await docsApi.addComment(docId, body, { parentId });
      setReplyText('');
      setReplyTo(null);
    }, 'Could not post the reply');
  };

  const saveEdit = async () => {
    if (cancelEdit.current) { cancelEdit.current = false; return; }
    if (!editing) return;
    const body = editing.text.trim();
    const { id } = editing;
    setEditing(null);
    if (!body) return;
    setComments((r) => (r ?? []).map((c) => (c.id === id ? { ...c, body } : c)));
    await docsApi.editComment(id, body).catch(() => toast('Could not save that edit'));
    await load();
  };

  const remove = (c: CommentRow) => {
    if (!confirm(c.parent_id ? 'Delete this reply?' : 'Delete this thread and its replies?')) return;
    void run(`del:${c.id}`, () => docsApi.deleteComment(c.id), 'Could not delete');
  };

  // Plain functions, not components: a component declared here gets a new
  // identity every render, so the open input would remount on each keystroke.
  const renderBody = (c: CommentRow, className: string) =>
    editing?.id === c.id ? (
      <textarea
        autoFocus
        rows={Math.min(8, Math.max(2, editing.text.split('\n').length, Math.ceil(editing.text.length / 40)))}
        value={editing.text}
        onChange={(e) => setEditing({ id: c.id, text: e.target.value })}
        onBlur={saveEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void saveEdit(); }
          if (e.key === 'Escape') { cancelEdit.current = true; setEditing(null); }
        }}
        className="mt-1.5 w-full resize-none rounded-md bg-canvas px-1.5 py-1 text-sm leading-relaxed text-ink outline-none ring-1 ring-inset ring-line focus:ring-2 focus:ring-accent"
      />
    ) : c.body ? (
      // "(edited)" trails the text rather than sitting in the header: the
      // panel is narrow, and one more chip up there wraps the author's name.
      <p className={cn('whitespace-pre-wrap break-words', className)}>
        {c.body}
        {c.edited_at && <span className="ml-1 text-2xs text-faint">(edited)</span>}
      </p>
    ) : null;

  /** Edit (your own words only) and delete (yours, or anything on a page you own). */
  const renderActions = (c: CommentRow) => {
    const mine = !!c.author_id && c.author_id === me;
    return (
      <span className="flex shrink-0 items-center gap-1.5">
        {mine && (
          <button type="button" onClick={() => setEditing({ id: c.id, text: c.body })} aria-label="Edit" className="text-faint hover:text-ink">
            <Pencil size={12} />
          </button>
        )}
        {(mine || role === 'owner') && (
          <button type="button" onClick={() => remove(c)} aria-label="Delete" className="text-faint hover:text-danger-strong">
            <Trash2 size={12} />
          </button>
        )}
      </span>
    );
  };

  /** The proposed change on a suggestion card, and what became of it. */
  const renderSuggestion = (c: CommentRow) => (
    <div className="mt-1.5 rounded-md bg-canvas p-2 text-sm ring-1 ring-inset ring-line">
      <p className="whitespace-pre-wrap break-words leading-relaxed">
        <del className="mn-diff-del">{c.quote}</del>
        <ArrowRight size={12} className="mx-1 inline text-faint" />
        {c.suggestion ? <ins className="mn-diff-add">{c.suggestion}</ins> : <span className="text-2xs italic text-muted">delete it</span>}
      </p>
      {c.suggestion_status ? (
        <p className="mt-1.5 flex items-center gap-1 text-2xs text-faint">
          {c.suggestion_status === 'accepted' ? <Check size={12} /> : <X size={12} />}
          {c.suggestion_status === 'accepted' ? 'Accepted' : 'Declined'}
          {c.decided_by_name ? ` by ${c.decided_by_name}` : ''}
        </p>
      ) : mayDecide ? (
        <div className="mt-2 flex justify-end gap-1.5">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => run(`dec:${c.id}`, () => docsApi.decideSuggestion(c.id, 'reject'), 'Could not decline')}
            className="rounded-md px-2 py-1 text-2xs font-medium text-muted hover:bg-hover hover:text-ink"
          >
            Decline
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => run(`dec:${c.id}`, async () => {
              await docsApi.decideSuggestion(c.id, 'accept');
              toast('Change applied to the page');
            }, 'Could not apply the change')}
            className="flex items-center gap-1 rounded-md bg-accent-fill px-2 py-1 text-2xs font-medium text-white hover:brightness-95"
          >
            {busy === `dec:${c.id}` ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Accept
          </button>
        </div>
      ) : (
        <p className="mt-1.5 text-2xs text-faint">Waiting for someone who can edit the page.</p>
      )}
    </div>
  );

  if (comments === null) return <div className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-faint" /></div>;

  const roots = comments.filter((c) => !c.parent_id);
  const replies = (id: string) => comments.filter((c) => c.parent_id === id);
  const pendingSuggestion = (c: CommentRow) => c.kind === 'suggestion' && !c.suggestion_status;
  const counts = {
    open: roots.filter((c) => !c.resolved).length,
    suggestions: roots.filter(pendingSuggestion).length,
    resolved: roots.filter((c) => c.resolved).length,
  };
  const shown = roots.filter((c) =>
    filter === 'resolved' ? c.resolved : filter === 'suggestions' ? pendingSuggestion(c) : !c.resolved);

  const drafts = [
    ...(review.myDraft ? [{ d: review.myDraft, mine: true }] : []),
    ...review.toReview.map((d) => ({ d, mine: false })),
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 p-3">
        {/* Two conversations, kept apart. The task thread is about the work;
            the page's own comments hang off a paragraph in it. */}
        {task && (
          <div className="-mx-3 -mt-3 border-b border-line">
            <TaskComments key={task.id} taskId={task.id} users={members} title="On this task" />
          </div>
        )}

        {/* Suggesting-mode drafts: yours, and others' waiting on you. */}
        {drafts.map(({ d, mine }) => (
          <div key={d.id} className="flex items-center gap-2 rounded-lg border border-line bg-accent-soft px-3 py-2">
            <GitPullRequestArrow size={15} className="shrink-0 text-accent-strong" />
            <p className="min-w-0 flex-1 text-xs text-ink">
              <span className="font-medium">{mine ? 'Your suggested edits' : `${d.authorName}'s suggested edits`}</span>
              <span className="text-muted"> · {d.status === 'submitted' ? 'waiting for review' : 'draft, not sent yet'}</span>
            </p>
            {!mine ? (
              <button type="button" onClick={() => openReview(d.id, docId)} className="shrink-0 text-xs font-medium text-accent-strong hover:underline">Review</button>
            ) : review.mode !== 'suggesting' ? (
              <button type="button" onClick={() => review.setMode('suggesting')} className="shrink-0 text-xs font-medium text-accent-strong hover:underline">Open</button>
            ) : null}
          </div>
        ))}

        {task && <h3 className="text-2xs font-semibold uppercase text-muted">On this page</h3>}

        {roots.length > 0 && (
          <div role="tablist" aria-label="Show" className="flex gap-1">
            {(['open', 'suggestions', 'resolved'] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-md px-2 py-1 text-2xs font-medium transition-colors',
                  filter === f ? 'bg-hover text-ink' : 'text-muted hover:bg-hover',
                )}
              >
                {f === 'open' ? 'Open' : f === 'suggestions' ? 'Suggestions' : 'Resolved'}
                <span className="ml-1 tabular-nums text-faint">{counts[f]}</span>
              </button>
            ))}
          </div>
        )}

        {roots.length === 0 &&
          (task ? (
            <p className="flex items-center gap-1.5 text-xs text-faint">
              <MessageSquareText size={14} /> Select text in the page to comment on it.
            </p>
          ) : (
            <EmptyState
              icon={MessageSquareText}
              title="No comments yet"
              hint={mayComment ? 'Select text in the page to comment on it or suggest a change.' : 'Nobody has commented on this page.'}
              compact
            />
          ))}
        {roots.length > 0 && shown.length === 0 && (
          <p className="py-4 text-center text-xs text-faint">
            {filter === 'resolved' ? 'Nothing resolved yet.' : filter === 'suggestions' ? 'No suggestions waiting.' : 'No open threads.'}
          </p>
        )}

        {shown.map((c) => {
          const thread = replies(c.id);
          const detachedNow = !c.resolved && isDetached(c.id);
          const mayResolve = c.author_id === me || mayDecide;
          return (
            <div
              key={c.id}
              ref={(el) => { if (el) cardRefs.current.set(c.id, el); else cardRefs.current.delete(c.id); }}
              className={cn(
                'rounded-lg border border-line bg-comment p-3 transition-shadow duration-220',
                c.resolved && 'bg-transparent',
                focusId === c.id && 'ring-2 ring-accent',
              )}
            >
              <div className="flex items-center gap-2">
                <Avatar name={c.author_name} />
                <span className="min-w-0 truncate text-sm font-medium text-ink">{c.author_name}</span>
                {c.guest && <GuestChip />}
                {c.kind === 'suggestion' && <SquarePen size={12} className="shrink-0 text-accent-strong" aria-label="Suggested change" />}
                <span className="shrink-0 text-2xs text-faint">{relativeTime(c.created_at)}</span>
                {renderActions(c)}
                <span className="ml-auto shrink-0">
                  {c.resolved ? (
                    mayResolve ? (
                      <button type="button" onClick={() => run(`res:${c.id}`, () => docsApi.resolveComment(c.id, false))} className="flex items-center gap-1 text-2xs text-muted hover:text-ink">
                        <RotateCcw size={11} /> Reopen
                      </button>
                    ) : (
                      <span className="flex items-center gap-1 text-2xs text-faint"><Check size={12} /> Resolved</span>
                    )
                  ) : mayResolve && !pendingSuggestion(c) ? (
                    <button type="button" onClick={() => run(`res:${c.id}`, () => docsApi.resolveComment(c.id, true))} className="flex items-center gap-1 text-2xs text-muted hover:text-ink">
                      <Check size={12} /> Resolve
                    </button>
                  ) : null}
                </span>
              </div>
              {c.kind === 'suggestion' ? renderSuggestion(c) : c.quote && (
                <p className="mt-1.5 border-l-2 border-comment-mark pl-2 text-2xs italic text-muted">{c.quote}</p>
              )}
              {detachedNow && (
                <p className="mt-1 text-2xs text-faint">The text this was about has since changed.</p>
              )}
              {renderBody(c, 'mt-1.5 text-sm leading-relaxed text-ink')}

              {thread.map((r) => (
                <div key={r.id} className="mt-2.5 flex items-start gap-2 border-l-2 border-line pl-2.5">
                  <Avatar name={r.author_name} size={18} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-2xs font-medium text-ink">
                      <span className="truncate">{r.author_name}</span>
                      {r.guest && <GuestChip />}
                      <span className="shrink-0 font-normal text-faint">· {relativeTime(r.created_at)}</span>
                      {renderActions(r)}
                    </p>
                    {renderBody(r, 'text-sm text-ink')}
                  </div>
                </div>
              ))}

              {mayComment && !c.resolved && (
                replyTo === c.id ? (
                  <div className="mt-2.5 flex items-end gap-1.5 rounded-md bg-canvas ring-1 ring-inset ring-line focus-within:ring-2 focus-within:ring-accent">
                    <CommentBox
                      draftKey={`reply:${c.id}`}
                      value={replyText}
                      onChange={setReplyText}
                      onEnter={() => { void sendReply(c.id); }}
                      placeholder="Reply…"
                      className="px-2.5 py-1.5"
                    />
                    <IconButton
                      icon={busy === `reply:${c.id}` ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      label="Send reply"
                      onClick={() => void sendReply(c.id)}
                      className="mb-0.5 mr-0.5"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setReplyTo(c.id); setReplyText(savedDraft(`reply:${c.id}`)); }}
                    className="mt-2 text-2xs font-medium text-muted hover:text-ink"
                  >
                    Reply
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>

      {mayComment ? (
        <div ref={composerRef} className="relative border-t border-line p-3">
          {anchor && (
            <div className="mb-2 rounded-md bg-comment px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-2xs italic text-muted">“{anchor.quote}”</span>
                {maySuggest && anchor.blockId && (
                  <span className="flex shrink-0 rounded bg-canvas p-px text-2xs">
                    {(['comment', 'suggest'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPendingMode(m)}
                        className={cn('rounded px-1.5 py-px', (anchor.mode ?? 'comment') === m ? 'bg-hover font-medium text-ink' : 'text-muted')}
                      >
                        {m === 'comment' ? 'Comment' : 'Suggest'}
                      </button>
                    ))}
                  </span>
                )}
                <button type="button" onClick={clearPendingAnchor} aria-label="Remove quote" className="shrink-0 text-faint hover:text-ink">
                  <X size={12} />
                </button>
              </div>
            </div>
          )}
          {suggesting && (
            <div className="mb-2">
              <label className="mb-1 block text-2xs font-medium text-muted">Replace with</label>
              <div className="flex items-end rounded-md ring-1 ring-inset ring-accent">
                <CommentBox
                  ref={replacementRef}
                  value={replacement}
                  onChange={setReplacement}
                  onEnter={() => { void add(); }}
                  placeholder="New text (leave empty to suggest deleting it)"
                  className="px-3 py-2"
                />
              </div>
            </div>
          )}
          {mentions.length > 0 && (
            <div className="absolute bottom-[52px] left-3 right-3 z-10 overflow-hidden rounded-lg border border-line bg-canvas shadow-pop">
              {mentions.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); setDraft((d) => withMention(d, m)); }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-hover"
                >
                  <Avatar name={m.name || m.username || m.email} size={18} />
                  <span className="font-medium text-ink">{m.name || m.username}</span>
                  <span className="truncate text-2xs text-faint">@{m.username}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-md ring-1 ring-inset ring-line focus-within:ring-2 focus-within:ring-accent">
            <CommentBox
              ref={inputRef}
              draftKey={draftKey}
              value={draft}
              onChange={(v) => { setDraft(v); setMentionDismissed(false); }}
              onEnter={() => {
                // If the mention menu is open, Enter picks the top suggestion
                // instead of submitting a half-typed handle.
                if (mentions.length > 0) { setDraft((d) => withMention(d, mentions[0])); return; }
                void add();
              }}
              placeholder={suggesting ? 'Why? (optional)' : anchor ? 'Comment on selection…' : 'Add a comment…  @ to mention'}
              className="px-3 py-2"
            />
            <IconButton
              icon={busy === 'add' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              label={suggesting ? 'Suggest' : 'Send'}
              onClick={() => void add()}
              className="mb-0.5 mr-0.5"
            />
          </div>
        </div>
      ) : (
        <p className="border-t border-line p-3 text-2xs text-faint">You can read this page’s comments. Ask its owner for comment access to join in.</p>
      )}
    </div>
  );
}
