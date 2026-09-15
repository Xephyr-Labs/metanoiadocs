/* Hallmark · component: editable task grid · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: row default · row hover · field hover · field focus · overdue due ·
 *         clipped · wrapped · empty · data mode (work columns hidden)
 * note: fields reuse the shared `input` look (ui/styles) rather than carrying
 *       their own — one hairline for the whole app beats a truer 8-state grid.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { UserRow } from '../../lib/docsApi';
import { cn } from '../../lib/cn';
import { STATUSES, STATUS_LABEL, type ProjectMode, type PropRow, type TaskPatch, type TaskRow, type TaskStatus } from '../../lib/tasksApi';
import { SegmentedControl } from '../ui/SegmentedControl';
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

const cell = 'px-2 py-1.5';
// whitespace-nowrap: a two-word column name breaking onto a second line
// ("Files & / media") made the header row taller than any data row.
const head = 'whitespace-nowrap font-semibold';

const STORE_KEY = 'mn-table-wrap';

/** Reading it can throw in a locked-down browser, and no stored answer is not
 *  an error. Clip is the default: it is the density the grid was drawn for. */
function storedWrap(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) === 'wrap';
  } catch {
    return false;
  }
}

/**
 * The task title.
 *
 * A textarea rather than an input, because an input is a single line by
 * definition — a long title in one could only ever be scrolled, which is the
 * complaint this answers. It grows to its content when wrapping is on and
 * stays exactly one line, scrolling sideways, when it is off.
 *
 * Height is set from scrollHeight in a layout effect: `field-sizing: content`
 * would do this in CSS but is not in Safari or Firefox yet, and a row that
 * measures itself after paint visibly jumps.
 */
function TitleCell({ value, wrap, onCommit, onOpen }: {
  value: string;
  wrap: boolean;
  onCommit: (v: string) => void;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (!wrap) {
      el.style.height = '';
      return;
    }
    // Collapse first, or the box can only ever grow.
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [wrap]);

  useLayoutEffect(fit, [fit, value]);

  return (
    <textarea
      ref={ref}
      key={value}
      rows={1}
      spellCheck={false}
      defaultValue={value}
      onInput={fit}
      onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
      onDoubleClick={onOpen}
      onKeyDown={(e) => {
        // Enter commits rather than inserting a newline — a task title is one
        // line of text, and the row below is where the eye goes next.
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { e.currentTarget.value = value; e.currentTarget.blur(); }
      }}
      className={cn(
        input,
        'block resize-none overflow-hidden py-1 leading-5',
        // Not overflow-x-auto when clipping: a textarea with a horizontal
        // scrollbar spends 15 of its 28 pixels drawing the bar, which left a
        // grey strip where the title should be. Hidden cuts the line the way
        // a spreadsheet does, and the caret still scrolls it while editing.
        wrap ? 'whitespace-pre-wrap break-words' : 'h-7 whitespace-nowrap',
      )}
    />
  );
}

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
  const work = mode !== 'data';
  const [wrap, setWrap] = useState(storedWrap);

  const pick = (next: boolean) => {
    setWrap(next);
    try {
      localStorage.setItem(STORE_KEY, next ? 'wrap' : 'clip');
    } catch {
      /* private mode, quota — the choice still holds for this session */
    }
  };

  // Both modes size columns to their content and let the grid scroll
  // sideways, the way a spreadsheet does. `table-fixed` was tried first and
  // is wrong here: it splits the leftover width evenly, which is what cut
  // "Ravi Menon" to "Ravi Me" and a status to "In p". Each column carries its
  // own minimum instead, below — a select in an auto table reports almost no
  // intrinsic width, so without one it collapses to its chevron.
  //
  // Clip keeps every cell on one line and hides the overflow; wrap lets the
  // row grow as tall as its tallest cell. `[&_.flex-wrap]:flex-nowrap` is what
  // holds a multi-select's chips on that one line — white-space does not
  // reach flex children.
  const text = wrap
    ? 'whitespace-normal break-words align-top'
    : 'max-w-0 truncate align-middle [&_.flex-wrap]:flex-nowrap [&_.flex-wrap]:overflow-hidden';

  return (
    <div className="scrollarea flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-end gap-2 px-4 pt-3">
        <SegmentedControl
          aria-label="Long text"
          value={wrap ? 'wrap' : 'clip'}
          onChange={(v) => pick(v === 'wrap')}
          segments={[{ value: 'clip', label: 'Clip' }, { value: 'wrap', label: 'Wrap' }]}
        />
      </div>

      <div className="scrollarea flex-1 overflow-auto p-4">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-2xs text-muted">
            <th className={cn(cell, head, 'w-[38%] min-w-[240px]')}>{work ? 'Task' : 'Name'}</th>
            {work && <th className={cn(cell, head, 'min-w-[120px]')}>Status</th>}
            {work && <th className={cn(cell, head, 'min-w-[150px]')}>Assignee</th>}
            {work && <th className={cn(cell, head, 'min-w-[88px]')}>Start</th>}
            {work && <th className={cn(cell, head, 'min-w-[88px]')}>Due</th>}
            {work && <th className={cn(cell, head, 'min-w-[84px]')}>Progress</th>}
            {props.map((p) => (
              <th key={p.id} className={cn(cell, head, 'min-w-[140px]')}>{p.label}</th>
            ))}
            <th className={cn(cell, 'w-8')} />
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className="group border-b border-line last:border-0 hover:bg-hover">
              <td className={cn(cell, wrap ? 'align-top' : 'align-middle')}>
                <TitleCell
                  value={t.title}
                  wrap={wrap}
                  onCommit={(v) => onPatch(t.id, { title: v })}
                  onOpen={() => onOpen(t)}
                />
              </td>
              {work && (
                <>
                <td className={cn(cell, text)}>
                  <select
                    className={cn(input, 'mn-select cursor-pointer pr-6')}
                    value={t.status}
                    onChange={(e) => onPatch(t.id, { status: e.target.value as TaskStatus })}
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </td>
                <td className={cn(cell, text)}>
                  <AssigneePicker
                    compact
                    assignees={t.assignees ?? []}
                    users={users}
                    onChange={(assigneeIds) => onPatch(t.id, { assigneeIds })}
                  />
                </td>
                <td className={cn(cell, wrap ? 'align-top' : 'align-middle')}>
                  <DateCell value={t.start_at} onChange={(v) => onPatch(t.id, { startAt: v })} />
                </td>
                <td className={cn(cell, wrap ? 'align-top' : 'align-middle')}>
                  <DateCell value={t.due_at} danger={isOverdue(t)} onChange={(v) => onPatch(t.id, { dueAt: v })} />
                </td>
                <td className={cn(cell, wrap ? 'align-top' : 'align-middle')}>
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
                <td key={p.id} className={cn(cell, text)}>
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
              <td className={cn(cell, wrap ? 'align-top' : 'align-middle')}>
                <button
                  type="button"
                  onClick={() => onDelete(t.id)}
                  className="flex h-6 w-6 items-center justify-center rounded text-faint opacity-0 transition-opacity hover:bg-hover hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
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
    </div>
  );
}
