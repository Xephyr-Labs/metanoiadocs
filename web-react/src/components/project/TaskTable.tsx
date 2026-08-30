import { Trash2 } from 'lucide-react';
import type { UserRow } from '../../lib/docsApi';
import { cn } from '../../lib/cn';
import { STATUSES, STATUS_LABEL, type PropRow, type TaskPatch, type TaskRow, type TaskStatus } from '../../lib/tasksApi';
import { PropertyValue } from './props/PropertyValue';
import { isOverdue } from './TaskChip';

interface Props {
  tasks: TaskRow[];
  users: UserRow[];
  props: PropRow[];
  onPatch: (id: string, body: TaskPatch) => void;
  onOpen: (t: TaskRow) => void;
  onDelete: (id: string) => void;
  onSetProp: (taskId: string, propId: string, value: unknown) => void;
}

const cell = 'px-2 py-1.5 align-middle';
const input =
  'w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-ink outline-none hover:border-line focus:border-accent focus:bg-canvas';

/** Dense editable grid. Every field writes straight through on change. */
export function TaskTable({ tasks, users, props, onPatch, onOpen, onDelete, onSetProp }: Props) {
  return (
    <div className="scrollarea h-full overflow-auto p-4">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-2xs uppercase tracking-wide text-faint">
            <th className={cn(cell, 'w-[38%] font-semibold')}>Task</th>
            <th className={cn(cell, 'font-semibold')}>Status</th>
            <th className={cn(cell, 'font-semibold')}>Assignee</th>
            <th className={cn(cell, 'font-semibold')}>Start</th>
            <th className={cn(cell, 'font-semibold')}>Due</th>
            <th className={cn(cell, 'w-[90px] font-semibold')}>Progress</th>
            {props.map((p) => (
              <th key={p.id} className={cn(cell, 'font-semibold')}>{p.label}</th>
            ))}
            <th className={cn(cell, 'w-8')} />
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className="group border-b border-line last:border-0 hover:bg-hover">
              <td className={cell}>
                {/* Keyed on the title: this input is uncontrolled, so a title
                    changed elsewhere — typed into the row's own page, say —
                    would otherwise sit here stale until the next remount, and
                    a stray blur would write that stale value back over it. */}
                <input
                  key={t.title}
                  className={input}
                  defaultValue={t.title}
                  onBlur={(e) => e.target.value !== t.title && onPatch(t.id, { title: e.target.value })}
                  onDoubleClick={() => onOpen(t)}
                />
              </td>
              <td className={cell}>
                <select
                  className={cn(input, 'cursor-pointer')}
                  value={t.status}
                  onChange={(e) => onPatch(t.id, { status: e.target.value as TaskStatus })}
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </td>
              <td className={cell}>
                <select
                  className={cn(input, 'cursor-pointer')}
                  value={t.assignee_id ?? ''}
                  onChange={(e) => onPatch(t.id, { assigneeId: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.username}</option>)}
                </select>
              </td>
              <td className={cell}>
                <input
                  type="date"
                  className={input}
                  value={t.start_at?.slice(0, 10) ?? ''}
                  onChange={(e) => onPatch(t.id, { startAt: e.target.value || null })}
                />
              </td>
              <td className={cell}>
                <input
                  type="date"
                  className={cn(input, isOverdue(t) && 'text-danger')}
                  value={t.due_at?.slice(0, 10) ?? ''}
                  onChange={(e) => onPatch(t.id, { dueAt: e.target.value || null })}
                />
              </td>
              <td className={cell}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className={input}
                  value={t.progress}
                  onChange={(e) => onPatch(t.id, { progress: Number(e.target.value) })}
                />
              </td>
              {props.map((p) => (
                <td key={p.id} className={cell}>
                  {p.type === 'relation' ? (
                    <button type="button" onClick={() => onOpen(t)} className="text-2xs text-muted hover:text-accent">
                      Open row
                    </button>
                  ) : (
                    <PropertyValue
                      prop={p}
                      users={users}
                      value={t.props?.[p.id] ?? null}
                      onChange={(v) => onSetProp(t.id, p.id, v)}
                    />
                  )}
                </td>
              ))}
              <td className={cell}>
                <button
                  type="button"
                  onClick={() => onDelete(t.id)}
                  className="flex h-6 w-6 items-center justify-center rounded text-faint opacity-0 transition-opacity hover:bg-hover hover:text-danger group-hover:opacity-100"
                  aria-label="Delete task"
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!tasks.length && <p className="py-10 text-center text-sm text-faint">No tasks yet.</p>}
    </div>
  );
}
