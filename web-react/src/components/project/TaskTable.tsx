/* Hallmark · component: editable task grid · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: row default · row hover · field hover · field focus · overdue due ·
 *         clipped · wrapped · empty · no columns · data mode
 * note: fields reuse the shared `input` look (ui/styles) rather than carrying
 *       their own — one hairline for the whole app beats a truer 8-state grid.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { UserRow } from '../../lib/docsApi';
import { cn } from '../../lib/cn';
import { isBuiltinProp } from '../../lib/builtinProps';
import type { PropOption, PropRow, PropType, TaskPatch, TaskRow } from '../../lib/tasksApi';
import { SegmentedControl } from '../ui/SegmentedControl';
import { PropertyCell } from './props/PropertyCell';

interface Props {
  tasks: TaskRow[];
  /**
   * Every property this view shows, in display order — the built-in fields
   * (status, assignees, dates, points, sprint…) and the database's own,
   * already merged and filtered by the visibility panel. The table used to
   * hard-code six columns and append the custom ones, which is why Points,
   * Sprint, Type, Milestone and Files could not be edited from a grid at all.
   */
  props: PropRow[];
  users: UserRow[];
  onPatch: (id: string, body: TaskPatch) => void;
  onOpen: (t: TaskRow) => void;
  onDelete: (id: string) => void;
  onSetProp: (taskId: string, propId: string, value: unknown) => void;
  /** Persist a change to a property's own option list. */
  onEditOptions?: (prop: PropRow, options: PropOption[]) => void;
  /** Re-read the rows after a focus area is added or removed — those live on
   *  the task's page, so the task list does not hear about them by itself. */
  onTagsChanged?: () => void;
  /** 'Name' rather than 'Task' for the first column, in a data database. */
  rowLabel?: string;
  /** Let the grid grow to its content instead of scrolling inside a fixed
   *  box — what an embedded database wants, so the page scrolls, not the
   *  block. See the two-scrollbar note in EmbeddedDatabase. */
  auto?: boolean;
}

const cell = 'px-2 py-1.5';
// whitespace-nowrap: a two-word column name breaking onto a second line
// ("Files & / media") made the header row taller than any data row.
const head = 'whitespace-nowrap font-semibold';

/** How much room a column needs before its control starts lying about itself.
 *  A select in an auto-width table reports almost no intrinsic width, so
 *  without a floor it collapses to its chevron. */
const MIN_WIDTH: Record<PropType, number> = {
  text: 160,
  number: 90,
  select: 150,
  multi_select: 170,
  date: 116,
  checkbox: 84,
  person: 150,
  url: 160,
  file: 120,
  relation: 96,
};

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

const input =
  'w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-ink outline-none hover:border-line focus:border-accent focus:bg-canvas';

/** Dense editable grid. Every field writes straight through on change. */
export function TaskTable({
  tasks, props, users, onPatch, onOpen, onDelete, onSetProp, onEditOptions, onTagsChanged,
  rowLabel = 'Task', auto,
}: Props) {
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
  // own minimum instead — see MIN_WIDTH.
  //
  // Clip keeps every cell on one line and hides the overflow; wrap lets the
  // row grow as tall as its tallest cell. `[&_.flex-wrap]:flex-nowrap` is what
  // holds a multi-select's chips on that one line — white-space does not
  // reach flex children.
  // Labels carried by more than one property in this view — see the header.
  const twice = new Set(
    props
      .map((p) => p.label.toLowerCase())
      .filter((label, i, all) => all.indexOf(label) !== i),
  );

  const text = wrap
    ? 'whitespace-normal break-words align-top'
    : 'max-w-0 truncate align-middle [&_.flex-wrap]:flex-nowrap [&_.flex-wrap]:overflow-hidden';

  return (
    <div className={cn('scrollarea flex flex-col', auto ? 'min-w-0' : 'h-full overflow-hidden')}>
      <div className="flex items-center justify-end gap-2 px-4 pt-3">
        <SegmentedControl
          aria-label="Long text"
          value={wrap ? 'wrap' : 'clip'}
          onChange={(v) => pick(v === 'wrap')}
          segments={[{ value: 'clip', label: 'Clip' }, { value: 'wrap', label: 'Wrap' }]}
        />
      </div>

      {/* overflow-x only when the grid is allowed to grow: an embedded table
          that scrolls vertically inside the page is the second scrollbar
          nobody asked for. */}
      <div className={cn('scrollarea p-4', auto ? 'overflow-x-auto' : 'flex-1 overflow-auto')}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-2xs text-muted">
            <th className={cn(cell, head, 'w-[38%] min-w-[240px]')}>{rowLabel}</th>
            {props.map((p) => (
              <th key={p.id} className={cn(cell, head)} style={{ minWidth: MIN_WIDTH[p.type] ?? 140 }}>
                {p.label}
                {/* A database may define its own "Status" beside the built-in
                    one — two real properties holding two values. Two identical
                    column heads is a coin flip, so say which is which, and only
                    where the clash is real. */}
                {twice.has(p.label.toLowerCase()) && (
                  <span className="ml-1 font-normal text-faint">{isBuiltinProp(p.id) ? 'built-in' : 'yours'}</span>
                )}
              </th>
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
              {props.map((p) => (
                <td key={p.id} className={cn(cell, text)}>
                  <PropertyCell
                    prop={p}
                    task={t}
                    users={users}
                    onPatch={onPatch}
                    onSetProp={onSetProp}
                    onEditOptions={onEditOptions}
                    onTagsChanged={onTagsChanged}
                    onOpenRow={() => onOpen(t)}
                  />
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
      {!tasks.length && <p className="py-10 text-center text-sm text-faint">No rows yet.</p>}
      {/* Hiding every column leaves a list of titles, which is a legitimate
          thing to want — but it looks identical to a grid that failed to
          load, so it says which it is. */}
      {!props.length && !!tasks.length && (
        <p className="px-2 py-3 text-2xs text-faint">Every property is hidden in this view.</p>
      )}
      </div>
    </div>
  );
}
