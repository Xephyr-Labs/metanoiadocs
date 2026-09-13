import { Trash2 } from 'lucide-react';
import type { UserRow } from '../../lib/docsApi';
import { cn } from '../../lib/cn';
import { STATUSES, STATUS_LABEL, type ProjectMode, type PropRow, type TaskPatch, type TaskRow, type TaskStatus } from '../../lib/tasksApi';
import { AssigneePicker } from './AssigneePicker';
import { PropertyValue } from './props/PropertyValue';
import { isOverdue } from './TaskChip';

interface Props {
  tasks: TaskRow[];
  /** A data database has no status, assignee, dates or progress to show. */
  mode: ProjectMode;
  users: UserRow[];
  props: PropRow[];
  onPatch: (id: string, body: TaskPatch) => void;
  onOpen: (t: TaskRow) => void;
  onDelete: (id: string) => void;
  onSetProp: (taskId: string, propId: string, value: unknown) => void;
}

const cell = 'px-2 py-1.5 align-middle';

/** A date the way the rest of the app writes one ("Sep 10"), that opens the
 *  native picker on click. The bare <input type="date"> wrote `mm/dd/yyyy` into
 *  every empty cell and `09/10/2026` into the full ones — two formats the board
 *  and calendar beside it never use. */
function DateCell({ value, onChange, danger }: { value: string | null | undefined; onChange: (v: string | null) => void; danger?: boolean }) {
  const iso = value?.slice(0, 10) ?? '';
  const label = iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  return (
    <label className={cn('relative block', input, 'cursor-pointer', danger && 'text-danger', !iso && 'text-faint')}>
      <span className="block truncate">{label || '—'}</span>
      {/* The real control is on top and transparent, so a click lands on it and
          the keyboard reaches it; the label underneath is what people read. */}
      <input
        type="date"
        aria-label={danger ? 'Due date (overdue)' : 'Date'}
        className="absolute inset-0 w-full cursor-pointer opacity-0"
        value={iso}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </label>
  );
}
const input =
  'w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-ink outline-none hover:border-line focus:border-accent focus:bg-canvas';

/** Dense editable grid. Every field writes straight through on change. */
export function TaskTable({ tasks, mode, users, props, onPatch, onOpen, onDelete, onSetProp }: Props) {
  // A data database's rows are records: no status, assignee, dates or progress.
  const work = mode !== 'data';
  return (
    <div className="scrollarea h-full overflow-auto p-4">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-2xs text-muted">
            <th className={cn(cell, 'w-[38%] font-semibold')}>{work ? 'Task' : 'Name'}</th>
            {work && <th className={cn(cell, 'w-[128px] font-semibold')}>Status</th>}
            {work && <th className={cn(cell, 'font-semibold')}>Assignee</th>}
            {work && <th className={cn(cell, 'font-semibold')}>Start</th>}
            {work && <th className={cn(cell, 'font-semibold')}>Due</th>}
            {work && <th className={cn(cell, 'w-[90px] font-semibold')}>Progress</th>}
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
              {work && (
                <>
                <td className={cell}>
                  <select
                    className={cn(input, 'mn-select cursor-pointer pr-6')}
                    value={t.status}
                    onChange={(e) => onPatch(t.id, { status: e.target.value as TaskStatus })}
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </td>
                <td className={cell}>
                  <AssigneePicker
                    compact
                    assignees={t.assignees ?? []}
                    users={users}
                    onChange={(assigneeIds) => onPatch(t.id, { assigneeIds })}
                  />
                </td>
                <td className={cell}>
                  <DateCell value={t.start_at} onChange={(v) => onPatch(t.id, { startAt: v })} />
                </td>
                <td className={cell}>
                  <DateCell value={t.due_at} danger={isOverdue(t)} onChange={(v) => onPatch(t.id, { dueAt: v })} />
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
                </>
              )}
              {props.map((p) => (
                <td key={p.id} className={cell}>
                  {p.type === 'relation' ? (
                    <button type="button" onClick={() => onOpen(t)} className="text-2xs text-muted hover:text-accent-strong">
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
