import { AlertCircle, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { docsApi, type TrashRow } from '../../lib/docsApi';
import { cn } from '../../lib/cn';
import { daysUntil, relativeTime } from '../../lib/time';
import { useWorkspace } from '../../store/workspace';
import { DocIcon } from '../ui/DocIcon';
import { EmptyState } from '../ui/EmptyState';
import { Modal, ModalBody } from '../ui/Modal';

/** "removed today" / "removed in 1 day" / "removed in 27 days". */
function countdown(purgeAt: string): string | null {
  const n = daysUntil(purgeAt);
  if (n === null) return null;
  if (n === 0) return 'removed today';
  return `removed in ${n} day${n === 1 ? '' : 's'}`;
}

export function TrashDialog() {
  const ws = useWorkspace();
  const [items, setItems] = useState<TrashRow[] | null>(null);
  // Overwritten by the first response; the fallback only ever shows if that
  // request failed, in which case the hint is the least of the problems.
  const [retentionDays, setRetentionDays] = useState(30);
  const [restoring, setRestoring] = useState<string | null>(null);
  // Which row is asking to be confirmed, and which is mid-delete. A permanent
  // delete is the one action here with no undo, so it takes two deliberate
  // clicks — inline, because a dialog inside a dialog is its own problem.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [destroying, setDestroying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bulk purge is armed separately from the per-row confirm, so one can't be
  // mistaken for the other.
  const [emptying, setEmptying] = useState(false);
  const [askEmpty, setAskEmpty] = useState(false);

  useEffect(() => {
    if (!ws.trashOpen) return;
    setItems(null);
    setConfirming(null);
    setAskEmpty(false);
    setError(null);
    docsApi
      .trash()
      .then((t) => { setItems(t.rows); setRetentionDays(t.retentionDays); })
      .catch(() => setItems([]));
  }, [ws.trashOpen]);

  const ownCount = (items ?? []).filter((d) => d.can_delete).length;

  const emptyTrash = async () => {
    setEmptying(true);
    setError(null);
    try {
      const { skipped } = await docsApi.emptyTrash();
      const rest = await docsApi.trash();
      setItems(rest.rows);
      setAskEmpty(false);
      // Don't claim the trash is empty when someone else's pages are still in it.
      if (skipped) setError(`${skipped} page${skipped === 1 ? '' : 's'} kept — only their owner can delete those.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not empty the trash.');
    } finally {
      setEmptying(false);
    }
  };

  const restore = async (id: string) => {
    setRestoring(id);
    await ws.restorePage(id);
    setItems((cur) => (cur ? cur.filter((d) => d.id !== id) : cur));
    setRestoring(null);
    ws.setTrashOpen(false);
  };

  const destroy = async (id: string) => {
    setDestroying(id);
    setError(null);
    try {
      await docsApi.destroy(id);
      setItems((cur) => (cur ? cur.filter((d) => d.id !== id) : cur));
      setConfirming(null);
    } catch (e) {
      // The server refuses when you don't own the page. Say which page, since
      // the row it applied to is about to lose its confirm state.
      setError(e instanceof Error ? e.message : 'Could not delete that page.');
    } finally {
      setDestroying(null);
    }
  };

  return (
    <Modal
      open={ws.trashOpen}
      onOpenChange={ws.setTrashOpen}
      width={480}
      className="max-h-[70vh]"
      title={<><Trash2 size={16} className="text-muted" /> Trash</>}
    >
      <ModalBody>
        {items === null ? (
          <div className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-faint" /></div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Trash2}
            title="Trash is empty"
            hint={`Deleted pages show up here for ${retentionDays} days, then they're removed for good.`}
          />
        ) : (
          items.map((d) => {
            const asking = confirming === d.id;
            const busy = destroying === d.id;
            const left = daysUntil(d.purge_at);
            const soon = left !== null && left <= 3;
            return (
              <div
                key={d.id}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors duration-120',
                  asking ? 'bg-danger/10' : 'hover:bg-hover',
                )}
              >
                <DocIcon size={16} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{d.title || 'Untitled'}</p>
                  <p className="truncate text-2xs text-faint">
                    {asking ? (
                      'Deleted for good — this cannot be undone.'
                    ) : (
                      <>
                        Deleted {relativeTime(d.deleted_at)}
                        {/* The countdown is the only part that ever needs to
                            raise its voice, so the tint stays on that span. */}
                        {countdown(d.purge_at) && (
                          <> · <span className={cn(soon && 'font-medium text-danger')}>{countdown(d.purge_at)}</span></>
                        )}
                      </>
                    )}
                  </p>
                </div>

                {asking ? (
                  <>
                    <button
                      onClick={() => setConfirming(null)}
                      disabled={busy}
                      className="rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors duration-120 hover:bg-selected hover:text-ink disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => destroy(d.id)}
                      disabled={busy}
                      className="flex items-center gap-1.5 rounded-md bg-danger px-2 py-1 text-xs font-medium text-white transition-[filter] duration-120 hover:brightness-95 disabled:opacity-60"
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => restore(d.id)}
                      disabled={restoring === d.id}
                      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors duration-120 hover:bg-selected hover:text-ink"
                    >
                      {restoring === d.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Restore
                    </button>
                    {/* Only where it would actually work — offering it on
                        someone else's page and then 403-ing is worse than not
                        offering it. */}
                    {d.can_delete && (
                      <button
                        onClick={() => { setConfirming(d.id); setError(null); }}
                        aria-label={`Delete ${d.title || 'Untitled'} permanently`}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint transition-colors duration-120 hover:bg-danger/10 hover:text-danger"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })
        )}

        {error && (
          <p className="mt-1 flex items-center gap-1.5 px-2 py-1.5 text-xs text-danger">
            <AlertCircle size={14} className="shrink-0" /> {error}
          </p>
        )}
      </ModalBody>

      {/* Only when there is something this person could actually purge. */}
      {ownCount > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2.5">
          {askEmpty ? (
            <>
              <span className="flex-1 text-xs text-ink">
                Delete {ownCount} page{ownCount === 1 ? '' : 's'} for good?
              </span>
              <button
                onClick={() => setAskEmpty(false)}
                disabled={emptying}
                className="rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors duration-120 hover:bg-selected hover:text-ink disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={emptyTrash}
                disabled={emptying}
                className="flex items-center gap-1.5 rounded-md bg-danger px-2 py-1 text-xs font-medium text-white transition-[filter] duration-120 hover:brightness-95 disabled:opacity-60"
              >
                {emptying ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Delete {ownCount}
              </button>
            </>
          ) : (
            <button
              onClick={() => { setAskEmpty(true); setConfirming(null); setError(null); }}
              className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors duration-120 hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 size={14} /> Empty trash
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
