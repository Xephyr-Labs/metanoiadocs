import { useState, type ReactNode } from 'react';
import { AtSign, CalendarClock, CheckCircle2, FileText, PenLine } from 'lucide-react';
import { useWorkspace } from '../../store/workspace';
import { docsApi } from '../../lib/docsApi';
import { tasksApi, type NeedsPayload } from '../../lib/tasksApi';
import { openReview } from '../../lib/reviewMode';
import { focusComment } from '../../editor/comments';
import { relativeTime } from '../../lib/time';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/cn';
import { NEEDS_TABS, defaultTab, joiner, summaryParts, tabCount, type NeedsTab } from '../../lib/needs';
import { Button } from '../ui/Button';

const LABEL: Record<NeedsTab, string> = { review: 'To review', overdue: 'Overdue', mentions: 'Mentions', changed: 'Changed pages' };
const EMPTY: Record<NeedsTab, string> = {
  review: 'No suggestions waiting for you.',
  overdue: 'Nothing overdue or due today.',
  mentions: 'No mentions waiting.',
  changed: 'No pages changed since you looked.',
};

function Row({ icon, children, meta, actions }: { icon: ReactNode; children: ReactNode; meta?: string; actions: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md px-2 py-2 hover:bg-hover">
      <span className="shrink-0 text-faint">{icon}</span>
      <p className="min-w-0 flex-1 basis-48 text-sm text-ink">{children}</p>
      {meta && <span className="shrink-0 text-2xs text-faint">{meta}</span>}
      <span className="flex shrink-0 gap-1">{actions}</span>
    </div>
  );
}

/** Top of Home: one sentence, a chip per tab, one list. `onChanged` refetches
 *  this block and the rest of Home after an action. */
export function NeedsYou({ needs, onChanged }: { needs: NeedsPayload; onChanged: () => void }) {
  const ws = useWorkspace();
  const { counts } = needs;
  const [picked, setPicked] = useState<NeedsTab | null>(null);
  const [busy, setBusy] = useState(false);
  const tab = picked ?? defaultTab(counts);
  const parts = summaryParts(counts);

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not do that.');
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const action = (label: string, onClick: () => void, primary = false) => (
    <Button size="sm" variant={primary ? 'primary' : 'secondary'} disabled={busy} onClick={onClick}>{label}</Button>
  );

  const rows = (): ReactNode[] => {
    switch (tab) {
      case 'review':
        return needs.review.map((r) => (
          <Row key={r.suggestionId} icon={<PenLine size={16} />} meta={relativeTime(r.submittedAt)}
            actions={action('Review', () => { ws.select(r.docId); openReview(r.suggestionId, r.docId); }, true)}>
            {r.writerVia ? 'AI draft' : <b className="font-medium">{r.authorName}</b>} suggested changes to <b className="font-medium">{r.docTitle || 'Untitled'}</b>
          </Row>
        ));
      case 'overdue':
        return needs.overdue.map((t) => (
          <Row key={t.taskId} icon={<CalendarClock size={16} />}
            actions={<>
              {action('Mark done', () => act(() => tasksApi.patchTask(t.taskId, { status: 'done' })), true)}
              {action('Tomorrow', () => act(() => tasksApi.patchTask(t.taskId, { dueAt: needs.tomorrow })))}
            </>}>
            <button type="button" className="text-left hover:underline" onClick={() => ws.openProject(t.projectId, t.taskId)}>
              <b className="font-medium">{t.title || 'Untitled'}</b>
            </button>
            <span className="text-muted"> · {t.projectName}</span>
            {t.today
              ? <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-2xs text-accent-strong">Today</span>
              : <span className="ml-2 text-2xs text-danger-strong">
                  Due {new Date(`${t.dueAt}T00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>}
          </Row>
        ));
      case 'mentions':
        return needs.mentions.map((m) => (
          <Row key={m.threadId} icon={<AtSign size={16} />} meta={relativeTime(m.createdAt)}
            actions={<>
              {action('Reply', () => {
                if (m.docId) {
                  ws.select(m.docId);
                  ws.setRightPanel('comments');
                  focusComment(m.threadId);
                } else if (m.projectId) ws.openProject(m.projectId, m.taskId ?? undefined);
              }, true)}
              {m.canResolve && action('Resolve', () => act(() => docsApi.resolveComment(m.threadId, true)))}
            </>}>
            <b className="font-medium">{m.authorName}</b> in <i>{m.title || 'Untitled'}</i>
            {m.snippet && <span className="text-muted">: “{m.snippet}”</span>}
          </Row>
        ));
      case 'changed':
        return needs.changed.map((d) => (
          <Row key={d.docId} icon={<FileText size={16} />} meta={relativeTime(d.changedAt)}
            actions={action('Open', () => ws.select(d.docId), true)}>
            <b className="font-medium">{d.title || 'Untitled'}</b> <span className="text-muted">— edited by {d.changedByName}</span>
          </Row>
        ));
      default:
        return [];
    }
  };

  if (!tab) {
    return (
      <p className="mb-8 flex items-center gap-2 text-sm text-muted">
        <CheckCircle2 size={16} className="text-faint" /> You're all caught up
      </p>
    );
  }

  const list = rows();
  const more = tabCount(counts, tab) - list.length;
  const seeAll = () => {
    if (tab === 'overdue') ws.openTasks();
    else if (tab === 'changed') ws.openAllDocs();
    else ws.setInboxOpen(true);
  };

  return (
    <section className="mb-8 min-w-0 rounded-lg border border-line bg-canvas p-4">
      <p className="text-base text-ink">
        You have{' '}
        {parts.map((p, i) => (
          <span key={p.text}>
            <button type="button" onClick={() => setPicked(p.tab)} className="font-medium text-accent-strong hover:underline">{p.text}</button>
            {joiner(i, parts.length)}
          </span>
        ))}.
      </p>
      <div role="tablist" className="mt-3 flex flex-wrap gap-1.5">
        {NEEDS_TABS.map((t) => {
          const n = tabCount(counts, t);
          return (
            <button key={t} type="button" role="tab" aria-selected={t === tab} onClick={() => setPicked(t)}
              className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-sm ring-1 ring-inset transition-colors duration-120',
                t === tab ? 'bg-selected text-ink ring-line-strong' : 'text-muted ring-line hover:bg-hover')}>
              <b className={cn('tabular-nums', t === 'overdue' && counts.overdue > 0 && 'text-danger-strong')}>{n}</b>
              {LABEL[t]}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="mt-3 space-y-px">
        {list.length ? list : <p className="px-2 py-3 text-sm text-faint">{EMPTY[tab]}</p>}
        {more > 0 && (
          <button type="button" onClick={seeAll} className="px-2 pt-1 text-xs text-muted hover:text-ink hover:underline">
            and {more} more
          </button>
        )}
      </div>
    </section>
  );
}
