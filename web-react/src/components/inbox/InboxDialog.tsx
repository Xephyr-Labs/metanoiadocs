import { BadgeCheck, Bell, Bot, CalendarClock, Inbox, ListChecks, Loader2, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { inboxShortcut, triageInbox } from '../../lib/inboxActions';
import { tasksApi } from '../../lib/tasksApi';
import { cn } from '../../lib/cn';
import { docsApi, type InboxRow } from '../../lib/docsApi';
import { avatarFor } from '../../lib/avatar';
import { relativeTime } from '../../lib/time';
import { notifyEnabled } from '../../lib/desktopNotify';
import { enableAlerts, pushSupported } from '../../lib/push';
import { useAuth } from '../../store/auth';
import { openReview } from '../../lib/reviewMode';
import { focusCommentOnPage } from '../../editor/comments';
import { focusSuggestion } from '../../editor/suggest/rail';
import { useWorkspace } from '../../store/workspace';
import { wantSettingsSection } from '../../lib/calendar';
import { EmptyState } from '../ui/EmptyState';
import { Modal, ModalBody } from '../ui/Modal';

/** Per-browser, like the switch it offers: dismissing it here is not a decision
 *  worth syncing to an account. */
const DISMISSED = 'mn-notify-nudge-dismissed';

/**
 * The offer to turn browser alerts on, where the alerts would be about.
 *
 * The switch itself lives in Settings and always has — which is the problem:
 * nobody looking at an inbox goes to Settings to ask why it never interrupted
 * them, so for most people the feature simply did not exist. One line, above
 * the feed, dismissable, and gone for good once alerts are on.
 */
function NotifyNudge() {
  const [show, setShow] = useState(() => {
    if (typeof Notification === 'undefined') return false;
    // Nothing to offer once it is already working, and never re-ask a browser
    // that has refused: only site settings can undo a denial.
    if (Notification.permission === 'denied') return false;
    if (Notification.permission === 'granted' && notifyEnabled()) return false;
    try {
      return localStorage.getItem(DISMISSED) !== 'yes';
    } catch {
      return true;
    }
  });
  const [busy, setBusy] = useState(false);

  if (!show) return null;

  const turnOn = async () => {
    setBusy(true);
    // Whether push came with it is Settings' story to tell; here the offer has
    // done its job either way, and the foreground alerts start immediately.
    await enableAlerts().catch(() => {});
    setBusy(false);
    // A refusal closes the offer too — asking again is the browser's job now.
    setShow(false);
  };

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(DISMISSED, 'yes');
    } catch {
      /* private mode — it will be offered again next session */
    }
  };

  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-2 rounded-md bg-accent-soft px-2.5 py-2">
      <Bell size={14} className="shrink-0 text-accent-strong" />
      <p className="min-w-0 flex-1 text-xs text-ink">
        {pushSupported()
          ? 'Get told the moment something lands here, even with Metanoia closed.'
          : 'Get told the moment something lands here, without watching the tab.'}
      </p>
      <button
        type="button"
        onClick={turnOn}
        disabled={busy}
        className="h-6 shrink-0 rounded bg-accent-fill px-2 text-2xs font-medium text-white transition-colors hover:bg-accent-fill-hover active:bg-accent-fill-active disabled:opacity-60"
      >
        {busy ? 'Asking…' : 'Turn on alerts'}
      </button>
      <button
        type="button"
        aria-label="Not now"
        onClick={dismiss}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint transition-colors hover:bg-hover hover:text-ink"
      >
        <X size={12} />
      </button>
    </div>
  );
}

/**
 * The four kinds the daily sweep raises (server/src/reminders.js).
 *
 * Nobody did these — they are the calendar arriving — so they are drawn as a
 * line with a glyph rather than as "Someone did something to something", and
 * their body is already a whole sentence. Tone is the only hierarchy in the
 * feed: a missed deadline is the one row here about something being wrong, and
 * it is the one row that says so in red.
 */
const SYSTEM: Record<string, { icon: LucideIcon; tone: string }> = {
  due_soon: { icon: CalendarClock, tone: 'text-muted' },
  due_today: { icon: CalendarClock, tone: 'text-accent-strong' },
  overdue: { icon: TriangleAlert, tone: 'text-danger-strong' },
  digest: { icon: ListChecks, tone: 'text-muted' },
  verify_review: { icon: BadgeCheck, tone: 'text-amber-600 dark:text-amber-400' },
  agent_failed: { icon: Bot, tone: 'text-danger-strong' },
};


/** How each kind of notification reads after the person's name. */
const INBOX_VERBS: Partial<Record<string, string>> = {
  comment: 'commented on',
  reply: 'replied in',
  reply_to_you: 'replied to your comment on',
  suggestion: 'suggested a change to',
  suggestion_accepted: 'accepted your suggestion on',
  suggestion_rejected: 'declined your suggestion on',
  review_requested: 'asked you to review changes to',
  ai_suggestion: 'suggested changes to',
  page_suggestion: 'suggested changes to',
  agent_suggested: 'suggested changes to',
  review_done: 'reviewed your changes to',
  integrity: 'found a problem in',
};

/** Rows per request, as the server pages them (GET /api/inbox). */
const PAGE = 50;

export function InboxDialog() {
  const ws = useWorkspace();
  const auth = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [undo, setUndo] = useState<InboxRow | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<string | undefined>(undefined);
  const sessionRef = useRef(0);
  const [items, setItems] = useState<InboxRow[] | null>(null);
  // A full page means there may be older rows; the feed used to stop at 50.
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const session = ++sessionRef.current;
    if (!ws.inboxOpen) return;
    let alive = true;
    setItems(null);
    cursorRef.current = undefined;
    setLoadingMore(false);
    setBusy(null);
    setError('');
    setUndo(null);
    setReplyTo(null);
    setReply('');
    setActive(0);
    setMore(false);
    // Load the feed (its read_at snapshot drives the unread dots), then mark
    // everything read so the sidebar badge clears.
    docsApi.inbox().then((rows) => { if (!alive) return; cursorRef.current = rows.at(-1)?.id; setItems(rows); setMore(rows.length === PAGE); ws.markInboxRead(); }).catch(() => { if (alive) setError('Could not load your inbox. Close it and try again.'); });
    return () => { alive = false; if (sessionRef.current === session) sessionRef.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.inboxOpen]);

  const loadOlder = () => {
    const last = cursorRef.current;
    if (!last || loadingMore) return;
    const session = sessionRef.current;
    setLoadingMore(true);
    docsApi.inbox(last)
      .then((rows) => { if (sessionRef.current !== session) return; cursorRef.current = rows.at(-1)?.id; setItems((cur) => [...(cur ?? []), ...rows]); setMore(rows.length === PAGE); })
      .catch(() => { if (sessionRef.current === session) setError('Could not load older items. Try again.'); })
      .finally(() => { if (sessionRef.current === session) setLoadingMore(false); });
  };

  // A mention or comment lands on a document with a thread to read; anything
  // about a task opens that task's panel over its database, since its page may
  // not exist yet.
  const open = (it: InboxRow) => {
    ws.setInboxOpen(false);
    // A summary is about everything at once, so it opens the list of everything
    // rather than picking one of the tasks it counted.
    if (it.kind === 'digest') {
      ws.openTasks();
      return;
    }
    // A failed agent run: its log, with the error, is under Settings → Agents.
    if (it.kind === 'agent_failed') {
      wantSettingsSection('agents');
      ws.setSettingsOpen(true);
      return;
    }
    // Straight to the task a row names — an assignment included: a board with
    // forty cards on it is not an answer to "which one was late" or "what did
    // I just get", and a comment on a task belongs to the task's own thread
    // rather than to whatever page it was eventually given.
    if (it.kind === 'verify_review' && it.doc_id) {
      ws.select(it.doc_id);
      return;
    }
    if (SYSTEM[it.kind] || it.task_id) {
      if (it.project_id) ws.openProject(it.project_id, it.task_id ?? undefined);
      return;
    }
    if (!it.doc_id) return;
    ws.select(it.doc_id);
    // An inline suggestion: the page opens on its card and text.
    if (it.kind === 'page_suggestion' && it.suggestion_id) {
      focusSuggestion(it.suggestion_id);
      return;
    }
    // An agent's run: the page, where its suggestions wait in the margin.
    if (it.kind === 'agent_suggested') return;
    if (it.kind === 'ai_suggestion' && it.suggestion_id) {
      openReview(it.suggestion_id, it.doc_id);
      return;
    }
    ws.setRightPanel('comments');
    if (it.comment_id) focusCommentOnPage(it.doc_id, it.comment_id);
  };

  const act = async (it: InboxRow, action: 'archive' | 'snooze' | 'complete' | 'reply') => {
    if (busy) return;
    const session = sessionRef.current;
    setBusy(it.id); setError('');
    try {
      if (action === 'complete' && it.task_id) await tasksApi.patchTask(it.task_id, { status: 'done' });
      if (action === 'reply') {
        if (!reply.trim()) return;
        // Resolve the root thread first: a notification can point at a reply.
        if (it.task_id) {
          const comments = await tasksApi.comments(it.task_id);
          const comment = comments.find(c => c.id === it.comment_id);
          if (!comment) throw new Error('This comment is no longer available. Open the item to continue.');
          await tasksApi.addComment(it.task_id, { body: reply.trim(), parentId: comment.parent_id || comment.id });
        } else if (it.doc_id) {
          const comments = await docsApi.comments(it.doc_id);
          const comment = comments.find(c => c.id === it.comment_id);
          if (!comment) throw new Error('This comment is no longer available. Open the item to continue.');
          await docsApi.addComment(it.doc_id, reply.trim(), { parentId: comment.parent_id || comment.id });
        }
        if (sessionRef.current !== session) return;
        setReply(''); setReplyTo(null);
        return;
      }
      await triageInbox(it.id, action === 'snooze' ? 'snooze' : 'archive', action === 'snooze' ? new Date(Date.now() + 86400000).toISOString() : undefined);
      if (sessionRef.current !== session) return;
      setItems(cur => cur?.filter(row => row.id !== it.id) ?? []);
      setUndo(it);
      setActive(i => Math.max(0, Math.min(i, (items?.length ?? 1) - 2)));
    } catch (err) { if (sessionRef.current === session) setError(err instanceof Error ? err.message : 'Could not save. Try again.'); }
    finally { if (sessionRef.current === session) setBusy(null); }
  };
  const restore = async () => {
    if (!undo || busy) return;
    const session = sessionRef.current;
    setBusy(undo.id); setError('');
    try {
      await triageInbox(undo.id, 'restore');
      if (sessionRef.current !== session) return;
      setItems(cur => [undo, ...(cur ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)));
      setUndo(null);
    } catch { if (sessionRef.current === session) setError('Could not undo. Try again.'); }
    finally { if (sessionRef.current === session) setBusy(null); }
  };
  const actions = (it: InboxRow) => <div className="mn-inbox-actions mb-3 ml-11 flex flex-wrap items-center gap-1">
    {it.task_id && <button type="button" disabled={!!busy} onClick={() => act(it, 'complete')} className={actionClass}>Mark done</button>}
    {it.comment_id && ['mention', 'comment', 'reply', 'reply_to_you'].includes(it.kind) && (it.task_id || it.doc_id) && <button type="button" disabled={!!busy} onClick={() => { setReplyTo(replyTo === it.id ? null : it.id); setReply(''); }} className={actionClass}>Reply</button>}
    <button type="button" disabled={!!busy} onClick={() => act(it, 'archive')} className={actionClass}>Archive</button>
    <button type="button" disabled={!!busy} onClick={() => act(it, 'snooze')} className={actionClass}>Snooze 1 day</button>
    {busy === it.id && <Loader2 size={12} className="animate-spin text-muted" aria-label="Saving" />}
    {replyTo === it.id && <form className="mt-1 flex w-full gap-2" onSubmit={e => { e.preventDefault(); void act(it, 'reply'); }}>
      <textarea autoFocus aria-label="Reply to comment" maxLength={4000} value={reply} onChange={e => setReply(e.target.value)} className="min-h-20 min-w-0 flex-1 rounded-md border border-line bg-canvas p-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" />
      <button type="submit" disabled={!!busy || !reply.trim()} className={actionClass}>Send reply</button>
    </form>}
  </div>;

  return (
    <Modal
      open={ws.inboxOpen}
      onOpenChange={ws.setInboxOpen}
      placement="top"
      focusPanel
      width={680}
      className="mn-inbox max-h-[82dvh]"
      title={<><Inbox size={16} className="text-muted" /> Inbox</>}
    >
      <ModalBody>
        <NotifyNudge />
        <p className="mb-4 flex flex-wrap justify-between gap-2 text-xs text-muted">Act here and keep your place. <span className="hidden sm:inline">J / K to move · Enter to open</span></p>
        {error && <p role="alert" className="mb-2 rounded-md bg-danger-soft p-2 text-sm text-danger-strong">{error}</p>}
        {undo && <div role="status" className="mb-2 flex items-center justify-between gap-2 rounded-md bg-accent-soft p-2 text-xs text-ink"><span>Item moved out of your inbox.{undo.task_id ? ' Task changes remain saved.' : ''}</span><button type="button" disabled={!!busy} onClick={restore} className={actionClass}>Undo</button></div>}
        <div ref={listRef} onKeyDown={e => {
          if (e.altKey || e.ctrlKey || e.metaKey) return;
          const target = e.target as HTMLElement;
          const result = inboxShortcut(e.key, !!target.closest('input, textarea, select, [contenteditable="true"]') || (e.key === 'Enter' && !target.hasAttribute('data-inbox-open')), active, items?.length ?? 0);
          if (result === null) return;
          e.preventDefault();
          if (result === 'open') { if (items?.[active]) open(items[active]); }
          else { setActive(result); listRef.current?.querySelector<HTMLButtonElement>(`[data-inbox-index="${result}"]`)?.focus(); }
        }}>
        {items === null && error ? null : items === null ? (
          <div role="status" aria-label="Loading inbox" className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-faint" /></div>
        ) : items.length === 0 ? (
          <EmptyState icon={Inbox} title={more ? "This page is clear" : "You're all caught up"} hint="@-mentions, comments on your pages, tasks assigned to you and your daily task summary show up here." />
        ) : (
          items.map((it, index) => {
            const unread = !it.read_at;
            const sys = SYSTEM[it.kind];
            if (sys) {
              const Icon = sys.icon;
              return (
                <div key={it.id} className="mn-inbox-item"><button data-inbox-open data-inbox-index={index} onFocus={() => setActive(index)} onClick={() => open(it)} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent flex w-full items-start gap-2.5 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-hover">
                  <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface">
                    <Icon size={14} className={sys.tone} />
                    {unread && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-canvas bg-accent" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm leading-snug', it.kind === 'overdue' || it.kind === 'agent_failed' ? 'text-danger-strong' : 'text-ink')}>
                      {it.body}
                    </p>
                    <p className="mt-0.5 text-2xs text-faint">{relativeTime(it.created_at)}</p>
                  </div>
                </button>{actions(it)}</div>
              );
            }
            const a = avatarFor(it.actor_name);
            // Tagging yourself is a reminder you left yourself; naming yourself
            // in the third person to do it reads like a stranger wrote it.
            const self = !!it.actor_id && it.actor_id === auth.user?.id;
            return (
              <div key={it.id} className="mn-inbox-item"><button data-inbox-open data-inbox-index={index} onFocus={() => setActive(index)} onClick={() => open(it)} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent flex w-full items-start gap-2.5 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-hover">
                <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-2xs font-semibold text-white" style={{ background: a.color }}>
                  {a.initials}
                  {unread && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-canvas bg-accent" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug text-ink">
                    <span className="font-medium">{self ? 'You' : it.actor_name}</span>
                    <span className="text-muted">
                      {it.kind === 'assigned'
                        ? (self ? ' took on ' : ' assigned you ')
                        : it.kind === 'mention'
                          ? (self ? ' tagged yourself in ' : ' mentioned you in ')
                          : ` ${INBOX_VERBS[it.kind] ?? 'commented on'} `}
                    </span>
                    <span className="font-medium">
                      {it.kind === 'assigned'
                        ? (it.task_title || it.body || 'a task')
                        : it.task_id
                          ? (it.task_title || 'a task')
                          : <>{it.doc_icon} {it.doc_title || 'Untitled'}</>}
                    </span>
                  </p>
                  {it.kind !== 'assigned' && (
                    <p className="mt-0.5 truncate text-xs text-muted">“{it.body}”</p>
                  )}
                  <p className="mt-0.5 text-2xs text-faint">{relativeTime(it.created_at)}</p>
                </div>
              </button>{actions(it)}</div>
            );
          })
        )}
        {items && more && (
          <button
            type="button"
            onClick={loadOlder}
            disabled={loadingMore}
            className="mt-1 flex h-8 w-full items-center justify-center gap-1.5 rounded-md text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-60"
          >
            {loadingMore && <Loader2 size={12} className="animate-spin" />}
            Show older
          </button>
        )}
        </div>
      </ModalBody>
    </Modal>
  );
}

const actionClass = 'min-h-8 rounded px-2 text-xs font-medium text-muted hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50';
