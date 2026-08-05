import * as Dialog from '@radix-ui/react-dialog';
import { motion } from 'framer-motion';
import { Link2, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { UserRow } from '../../lib/docsApi';
import { cn } from '../../lib/cn';
import { STATUSES, STATUS_LABEL, type TaskPatch, type TaskRow, type TaskStatus } from '../../lib/tasksApi';
import { IconButton } from '../ui/IconButton';

interface Props {
  task: TaskRow | null;
  tasks: TaskRow[];
  users: UserRow[];
  onClose: () => void;
  onPatch: (id: string, body: TaskPatch) => void;
  onDelete: (id: string) => void;
  onAddDep: (id: string, dependsOn: string) => void;
  onRemoveDep: (id: string, dependsOn: string) => void;
}

const field = 'w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent';
const label = 'mb-1 block text-2xs font-semibold uppercase tracking-wide text-faint';

/** Full task editor. Everything here also exists inline in the table; this is
 *  where the fields that don't fit a column (dependencies, notes) live. */
export function TaskDialog({ task, tasks, users, onClose, onPatch, onDelete, onAddDep, onRemoveDep }: Props) {
  const [depPick, setDepPick] = useState('');
  if (!task) return null;

  const candidates = tasks.filter((t) => t.id !== task.id && !task.deps.includes(t.id));
  const byId = new Map(tasks.map((t) => [t.id, t]));

  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" />
        </Dialog.Overlay>
        <Dialog.Content asChild aria-describedby={undefined}>
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="fixed left-1/2 top-[12vh] z-50 flex max-h-[76vh] w-[min(92vw,520px)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-line bg-canvas shadow-modal"
          >
            <header className="flex items-start gap-2 border-b border-line p-4">
              <Dialog.Title asChild>
                <input
                  className="flex-1 bg-transparent text-[15px] font-medium text-ink outline-none"
                  defaultValue={task.title}
                  placeholder="Task title"
                  onBlur={(e) => e.target.value !== task.title && onPatch(task.id, { title: e.target.value })}
                />
              </Dialog.Title>
              <IconButton icon={<X size={16} />} label="Close" onClick={onClose} />
            </header>

            <div className="scrollarea flex-1 space-y-4 overflow-y-auto p-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className={label}>Status</span>
                  <select className={field} value={task.status} onChange={(e) => onPatch(task.id, { status: e.target.value as TaskStatus })}>
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
                <div>
                  <span className={label}>Assignee</span>
                  <select className={field} value={task.assignee_id ?? ''} onChange={(e) => onPatch(task.id, { assigneeId: e.target.value || null })}>
                    <option value="">Unassigned</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.username}</option>)}
                  </select>
                </div>
                <div>
                  <span className={label}>Start</span>
                  <input type="date" className={field} value={task.start_at?.slice(0, 10) ?? ''} onChange={(e) => onPatch(task.id, { startAt: e.target.value || null })} />
                </div>
                <div>
                  <span className={label}>Due</span>
                  <input type="date" className={field} value={task.due_at?.slice(0, 10) ?? ''} onChange={(e) => onPatch(task.id, { dueAt: e.target.value || null })} />
                </div>
                <div>
                  <span className={label}>Progress %</span>
                  <input type="number" min={0} max={100} className={field} value={task.progress} onChange={(e) => onPatch(task.id, { progress: Number(e.target.value) })} />
                </div>
                <div>
                  <span className={label}>Points</span>
                  <input type="number" min={0} className={field} value={task.points ?? ''} onChange={(e) => onPatch(task.id, { points: e.target.value === '' ? null : Number(e.target.value) })} />
                </div>
              </div>

              <label className="flex items-center gap-2 text-[13px] text-ink">
                <input type="checkbox" checked={task.milestone} onChange={(e) => onPatch(task.id, { milestone: e.target.checked })} />
                Milestone
              </label>

              <div>
                <span className={label}>Depends on</span>
                <div className="space-y-1">
                  {task.deps.map((d) => (
                    <div key={d} className="flex items-center gap-2 rounded-md bg-surface px-2 py-1.5 text-[13px] text-ink">
                      <Link2 size={13} className="shrink-0 text-faint" />
                      <span className="flex-1 truncate">{byId.get(d)?.title ?? 'Unknown task'}</span>
                      <button type="button" onClick={() => onRemoveDep(task.id, d)} className="text-faint hover:text-danger" aria-label="Remove dependency">
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  <select
                    className={cn(field, 'cursor-pointer')}
                    value={depPick}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      onAddDep(task.id, e.target.value);
                      setDepPick('');
                    }}
                  >
                    <option value="">Add a dependency…</option>
                    {candidates.map((t) => <option key={t.id} value={t.id}>{t.title || 'Untitled'}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <footer className="flex justify-end border-t border-line p-3">
              <button
                type="button"
                onClick={() => { onDelete(task.id); onClose(); }}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-faint transition-colors hover:bg-hover hover:text-danger"
              >
                <Trash2 size={14} /> Delete task
              </button>
            </footer>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
