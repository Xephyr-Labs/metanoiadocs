import { useEffect, useState } from 'react';
import { docsApi } from '../../lib/docsApi';
import {
  acceptedItems, draftsFrom, madeTasksMessage, rememberDatabase, suggestTasks, tasksFromProposals, type Draft,
} from '../../lib/meetingTasks';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { field, selectField } from '../ui/styles';
import { DatabaseSelect, useTaskDatabase } from './MakeTasksDialog';

type Member = { id: string; name: string; username: string };

/**
 * Ask AI reads the page and proposes tasks; the person edits, keeps or drops
 * each one. Nothing is made until "Create".
 */
export function SuggestTasksDialog({ docId, open, onOpenChange }: { docId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const db = useTaskDatabase(open);
  const [members, setMembers] = useState<Member[]>([]);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setDrafts(null);
    setError('');
    Promise.all([suggestTasks(docId), docsApi.users().catch(() => [])])
      .then(([proposals, users]) => {
        if (!live) return;
        const people = users.filter((u) => u.kind !== 'agent');
        setMembers(people);
        setDrafts(draftsFrom(proposals, people));
      })
      .catch((err) => { if (live) setError(err instanceof Error ? err.message : 'Ask AI could not answer'); });
    return () => { live = false; };
  }, [open, docId]);

  const edit = (i: number, patch: Partial<Draft>) =>
    setDrafts((ds) => ds && ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const picked = drafts?.filter((d) => d.accept).length ?? 0;
  const create = async () => {
    if (!drafts || !db.projectId) return;
    const { items, error: problem } = acceptedItems(drafts);
    if (!items) { toast(problem!); return; }
    setBusy(true);
    try {
      const made = await tasksFromProposals(docId, db.projectId, items);
      rememberDatabase(db.projectId);
      toast(madeTasksMessage(made));
      onOpenChange(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not make tasks');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Suggest tasks (Ask AI)" width={620}>
      <div className="space-y-3 p-4">
        {error ? (
          <p className="text-sm text-danger-strong" role="alert">{error}</p>
        ) : !drafts ? (
          <p className="text-sm text-muted" aria-live="polite">Ask AI is reading the page…</p>
        ) : !drafts.length ? (
          <p className="text-sm text-muted">No action items found.</p>
        ) : (
          <>
            <p className="text-sm text-muted">Ask AI suggested these. Edit or untick any before creating them.</p>
            <ul className="scrollarea max-h-[50vh] space-y-2 overflow-y-auto">
              {drafts.map((d, i) => (
                <li key={i} className={cn('rounded-md p-2 ring-1 ring-inset ring-line', !d.accept && 'opacity-60')}>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={d.accept}
                      aria-label={`Create “${d.title}”`}
                      onChange={(e) => edit(i, { accept: e.target.checked })}
                    />
                    <input
                      className={field}
                      value={d.title}
                      maxLength={200}
                      aria-label="Title"
                      onChange={(e) => edit(i, { title: e.target.value })}
                    />
                  </div>
                  <div className="mt-2 flex gap-2 pl-6">
                    <select
                      className={selectField}
                      value={d.assigneeId}
                      aria-label="Assignee"
                      onChange={(e) => edit(i, { assigneeId: e.target.value })}
                    >
                      <option value="">No assignee</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name || m.username}</option>)}
                    </select>
                    <input
                      type="date"
                      className={cn(field, 'w-44')}
                      value={d.dueAt}
                      aria-label="Due date"
                      onChange={(e) => edit(i, { dueAt: e.target.value })}
                    />
                  </div>
                  {d.sourceText && <p className="mt-1 truncate pl-6 text-xs text-faint" title={d.sourceText}>“{d.sourceText}”</p>}
                </li>
              ))}
            </ul>
            <DatabaseSelect {...db} />
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!!drafts?.length && (
            <Button variant="primary" disabled={!picked || !db.projectId || busy} onClick={create}>
              {busy ? 'Creating…' : `Create ${picked} task${picked === 1 ? '' : 's'}`}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
