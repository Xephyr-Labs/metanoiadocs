import { Link2, Settings2, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { UserRow } from '../../lib/docsApi';
import { cn } from '../../lib/cn';
import { STATUSES, STATUS_LABEL, type SprintRow, type TaskPatch, type TaskRow, type TaskStatus } from '../../lib/tasksApi';
import { field } from '../ui/styles';
import { IconButton } from '../ui/IconButton';
import { Modal } from '../ui/Modal';
import { useKinds } from './kinds';
import { KindBadge } from './TaskChip';

interface Props {
  task: TaskRow | null;
  tasks: TaskRow[];
  sprints: SprintRow[];
  users: UserRow[];
  onClose: () => void;
  onPatch: (id: string, body: TaskPatch) => void;
  onDelete: (id: string) => void;
  onAddDep: (id: string, dependsOn: string) => void;
  onRemoveDep: (id: string, dependsOn: string) => void;
  /** Opens the type editor from beside the Type field, the way Notion does. */
  onManageKinds: () => void;
}

const label = 'mb-1 block text-2xs font-medium text-muted';

function Row({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className={label}>{name}</span>
      {children}
    </div>
  );
}

/** Full task editor. Bottom sheet on phones, centered card on desktop. */
export function TaskDialog({ task, tasks, sprints, users, onClose, onPatch, onDelete, onAddDep, onRemoveDep, onManageKinds }: Props) {
  const [depPick, setDepPick] = useState('');
  const kinds = useKinds();
  if (!task) return null;

  const candidates = tasks.filter((t) => t.id !== task.id && !task.deps.includes(t.id));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  // Anything of a grouping type can be a parent, so a project that renamed
  // Epic to Initiative — or added one — keeps a working parent picker.
  const groupKeys = new Set(kinds.filter((k) => k.is_group).map((k) => k.key));
  const parents = tasks.filter((t) => groupKeys.has(t.kind) && t.id !== task.id);
  const isGroup = groupKeys.has(task.kind);

  return (
    <Modal
      open
      onOpenChange={(v) => !v && onClose()}
      title={task.title || 'Task'}
      bare
      sheet
      width={560}
      className="sm:max-h-[78vh]"
    >
      <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3">
        <KindBadge kind={task.kind} />
        <input
          autoFocus={!task.title}
          aria-label="Task title"
          className="min-w-0 flex-1 bg-transparent text-md font-medium text-ink outline-none placeholder:text-faint"
          defaultValue={task.title}
          placeholder="Task title"
          onBlur={(e) => e.target.value !== task.title && onPatch(task.id, { title: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <IconButton icon={<X size={16} />} label="Close" onClick={onClose} />
      </header>

            <div className="scrollarea min-h-0 flex-1 divide-y divide-line overflow-y-auto">
              <section className="grid grid-cols-2 gap-3 p-4">
                <Row name="Type">
                  <div className="flex items-center gap-1">
                    <select className={field} value={task.kind} onChange={(e) => onPatch(task.id, { kind: e.target.value })}>
                      {/* A type deleted while this dialog is open would otherwise
                          leave the select showing the wrong row. */}
                      {!kinds.some((k) => k.key === task.kind) && <option value={task.kind}>{task.kind}</option>}
                      {kinds.map((k) => <option key={k.id} value={k.key}>{k.label}</option>)}
                    </select>
                    <IconButton icon={<Settings2 size={15} />} label="Edit task types" onClick={onManageKinds} />
                  </div>
                </Row>
                <Row name="Status">
                  <select className={field} value={task.status} onChange={(e) => onPatch(task.id, { status: e.target.value as TaskStatus })}>
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </Row>
                <Row name="Assignee">
                  <select className={field} value={task.assignee_id ?? ''} onChange={(e) => onPatch(task.id, { assigneeId: e.target.value || null })}>
                    <option value="">Unassigned</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.username}</option>)}
                  </select>
                </Row>
                <Row name="Progress %">
                  <input type="number" min={0} max={100} className={field} value={task.progress} onChange={(e) => onPatch(task.id, { progress: Number(e.target.value) })} />
                </Row>
                <Row name="Start">
                  <input type="date" className={field} value={task.start_at?.slice(0, 10) ?? ''} onChange={(e) => onPatch(task.id, { startAt: e.target.value || null })} />
                </Row>
                <Row name="Due">
                  <input type="date" className={field} value={task.due_at?.slice(0, 10) ?? ''} onChange={(e) => onPatch(task.id, { dueAt: e.target.value || null })} />
                </Row>
              </section>

              <section className="grid grid-cols-2 gap-3 p-4">
                <Row name="Sprint">
                  <select className={field} value={task.sprint_id ?? ''} onChange={(e) => onPatch(task.id, { sprintId: e.target.value || null })}>
                    <option value="">Backlog</option>
                    {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}{s.state === 'active' ? ' (active)' : ''}</option>)}
                  </select>
                </Row>
                <Row name="Points">
                  <input type="number" min={0} className={field} value={task.points ?? ''} placeholder="—" onChange={(e) => onPatch(task.id, { points: e.target.value === '' ? null : Number(e.target.value) })} />
                </Row>
                {!isGroup && parents.length > 0 && (
                  <Row name="Parent">
                    <select className={field} value={task.parent_id ?? ''} onChange={(e) => onPatch(task.id, { parentId: e.target.value || null })}>
                      <option value="">None</option>
                      {parents.map((t) => <option key={t.id} value={t.id}>{t.title || 'Untitled'}</option>)}
                    </select>
                  </Row>
                )}
                <label className={cn('flex items-center gap-2 self-end pb-1.5 text-sm text-ink', (isGroup || !parents.length) && 'col-span-2')}>
                  <input type="checkbox" checked={task.milestone} onChange={(e) => onPatch(task.id, { milestone: e.target.checked })} />
                  Milestone
                </label>
              </section>

              <section className="p-4">
                <span className={label}>Depends on</span>
                <div className="space-y-1.5">
                  {task.deps.map((d) => (
                    <div key={d} className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-sm text-ink">
                      <Link2 size={14} className="shrink-0 text-faint" />
                      <span className="min-w-0 flex-1 truncate">{byId.get(d)?.title || 'Untitled'}</span>
                      <button type="button" onClick={() => onRemoveDep(task.id, d)} className="shrink-0 text-faint hover:text-danger" aria-label="Remove dependency">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <select
                    className={cn(field, 'cursor-pointer text-muted')}
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
              </section>
            </div>

      <footer className="flex shrink-0 justify-end border-t border-line px-3 py-2.5">
        <button
          type="button"
          onClick={() => { onDelete(task.id); onClose(); }}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-faint transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 size={14} /> Delete task
        </button>
      </footer>
    </Modal>
  );
}
