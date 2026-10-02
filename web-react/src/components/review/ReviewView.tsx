import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, Minus, Plus, X } from 'lucide-react';
import { docsApi, type DraftChange, type SuggestionDetail } from '../../lib/docsApi';
import { closeReview, forgetDraft, loadDrafts } from '../../lib/reviewMode';
import { relativeTime } from '../../lib/time';
import { toast } from '../../lib/toast';
import { wordDiff } from '../../lib/wordDiff';
import { cn } from '../../lib/cn';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';

/** The words a change takes out (struck) and puts in (underlined). */
function Diff({ change }: { change: DraftChange }) {
  if (change.kind === 'added') {
    return <p className="whitespace-pre-wrap break-words text-sm text-ink"><ins className="mn-diff-add">{change.after || `New ${change.label.toLowerCase()}`}</ins></p>;
  }
  if (change.kind === 'removed') {
    return <p className="whitespace-pre-wrap break-words text-sm text-ink"><del className="mn-diff-del">{change.before || change.label}</del></p>;
  }
  if (change.before === change.after) {
    // Same words, different formatting or block type.
    return (
      <p className="whitespace-pre-wrap break-words text-sm text-ink">
        {change.after || change.label}
        <span className="ml-1.5 text-2xs text-faint">(formatting or type changed)</span>
      </p>
    );
  }
  return (
    <p className="whitespace-pre-wrap break-words text-sm text-ink">
      {wordDiff(change.before, change.after).map((p, i) =>
        p.op === 'same' ? <span key={i}>{p.text}</span>
          : p.op === 'add' ? <ins key={i} className="mn-diff-add">{p.text}</ins>
            : <del key={i} className="mn-diff-del">{p.text}</del>,
      )}
    </p>
  );
}

const KIND = {
  added: { icon: Plus, label: 'Added' },
  removed: { icon: Minus, label: 'Removed' },
  modified: { icon: Check, label: 'Edited' },
} as const;

/**
 * Reviewing a Suggesting-mode draft: every change it makes, in page order,
 * each one taken or left on its own, or all at once. Accepting writes the
 * change into the live page for everyone; the draft closes when nothing is
 * left to decide.
 */
export function ReviewView({ sid, docId }: { sid: string; docId: string }) {
  const [detail, setDetail] = useState<SuggestionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setDetail(await docsApi.suggestion(sid)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load these changes'); }
  }, [sid]);
  useEffect(() => { void load(); }, [load]);

  const decide = async (key: string, body: Parameters<typeof docsApi.decideChanges>[1]) => {
    setBusy(key);
    try {
      const r = await docsApi.decideChanges(sid, body);
      if (r.skipped) toast(`${r.skipped} change${r.skipped === 1 ? '' : 's'} could not be applied — that part of the page was deleted.`);
      if (r.closed) {
        toast('Review finished');
        forgetDraft(docId, sid);
        void loadDrafts(docId);
        return;
      }
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save that decision');
    } finally { setBusy(null); }
  };

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted">{error}</p>
        <Button size="sm" onClick={closeReview}>Back to the page</Button>
      </div>
    );
  }
  if (!detail) return <div className="flex h-full items-center justify-center"><Loader2 size={18} className="animate-spin text-faint" /></div>;

  const reviewer = detail.canReview;
  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <Avatar name={detail.authorName} size={28} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink">
            <span className="font-medium">{detail.authorName}</span>
            <span className="text-muted"> suggested {detail.changes.length} change{detail.changes.length === 1 ? '' : 's'}</span>
            {detail.submittedAt && <span className="text-faint"> · {relativeTime(detail.submittedAt)}</span>}
          </p>
          {detail.message && <p className="mt-0.5 truncate text-xs text-muted">“{detail.message}”</p>}
          {(detail.accepted > 0 || detail.rejected > 0) && (
            <p className="mt-0.5 text-2xs text-faint">{detail.accepted} accepted · {detail.rejected} declined so far</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {reviewer && detail.changes.length > 0 && (
            <>
              <Button variant="ghost" size="sm" leftIcon={<X size={14} />} disabled={!!busy} onClick={() => decide('all', { all: 'reject' })}>
                Decline all
              </Button>
              <Button variant="primary" size="sm" leftIcon={busy === 'all' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} disabled={!!busy} onClick={() => decide('all', { all: 'accept' })}>
                Accept all
              </Button>
            </>
          )}
          <Button variant="secondary" size="sm" onClick={closeReview}>Close</Button>
        </div>
      </header>

      <div className="scrollarea min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-2.5 p-4">
          {detail.changes.length === 0 && (
            <p className="py-10 text-center text-sm text-muted">Nothing left to review here.</p>
          )}
          {detail.changes.map((c) => {
            const K = KIND[c.kind];
            return (
              <article key={c.id} className="rounded-lg border border-line bg-surface p-3">
                <div className="mb-1.5 flex items-center gap-2 text-2xs font-medium uppercase tracking-wide text-faint">
                  <K.icon size={12} />
                  <span>{K.label} · {c.label}{c.type && c.type !== 'text' ? ` (${c.type})` : ''}</span>
                </div>
                <Diff change={c} />
                {(c.mainChanged || c.gone) && (
                  <p className="mt-2 flex items-start gap-1.5 text-2xs text-muted">
                    <AlertTriangle size={12} className="mt-px shrink-0 text-danger-strong" />
                    {c.gone
                      ? 'This part of the page has been deleted since; it can only be declined.'
                      : 'This part of the page was also edited since the suggestion was made. Accepting replaces those edits.'}
                  </p>
                )}
                {reviewer && (
                  <div className="mt-2.5 flex justify-end gap-1.5">
                    <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => decide(c.id, { reject: [c.id] })}>Decline</Button>
                    <Button
                      variant="subtle"
                      size="sm"
                      disabled={!!busy || c.gone}
                      leftIcon={busy === c.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      onClick={() => decide(c.id, { accept: [c.id] })}
                      className={cn(!c.gone && 'text-accent-strong')}
                    >
                      Accept
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
