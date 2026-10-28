import { useEffect, useState } from 'react';
import { lastDatabase, makeTasks, madeTasksMessage, rememberDatabase, taskDatabases } from '../../lib/meetingTasks';
import { toast } from '../../lib/toast';
import { useWorkspace } from '../../store/workspace';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { selectField } from '../ui/styles';

/** Pick a database, then turn the page's open to-do lines into tasks in it. */
export function MakeTasksDialog({ docId, open, onOpenChange }: { docId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const ws = useWorkspace();
  const dbs = taskDatabases(ws.projects);
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const last = lastDatabase();
    setProjectId(dbs.some((p) => p.id === last) ? last! : dbs[0]?.id ?? '');
    // Only on open: a refresh of the list must not undo the person's pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const run = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const made = await makeTasks(docId, projectId);
      rememberDatabase(projectId);
      toast(madeTasksMessage(made));
      onOpenChange(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not make tasks');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Make tasks from to-dos" width={420}>
      <div className="space-y-3 p-4">
        <p className="text-sm text-muted">
          Each open to-do line becomes a task: an @name assigns it, a date like “tomorrow” or
          “by Friday” sets when it is due. Lines already linked to a task are skipped.
        </p>
        {dbs.length ? (
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Database</span>
            <select className={selectField} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {dbs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        ) : (
          <p className="text-sm text-faint">No task database yet — make one first.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!projectId || busy} onClick={run}>
            {busy ? 'Making tasks…' : 'Make tasks'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
