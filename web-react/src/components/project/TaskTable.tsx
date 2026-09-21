/* Hallmark · component: editable task grid · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: row default · row hover · field hover · field focus · overdue due ·
 *         clipped · wrapped · empty · no columns · data mode
 * note: fields reuse the shared `input` look (ui/styles) rather than carrying
 *       their own — one hairline for the whole app beats a truer 8-state grid.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Trash2 } from 'lucide-react';
import {
  AGGREGATE_LABEL, MIN_COL, aggregatesFor, gridPrefFor, reduceColumn,
  setColumnAggregate, setColumnWidth, type Aggregate,
} from '../../lib/gridPrefs';
import type { UserRow } from '../../lib/docsApi';
import { cn } from '../../lib/cn';
import { isBuiltinProp } from '../../lib/builtinProps';
import type { PropOption, PropRow, PropType, TaskPatch, TaskRow } from '../../lib/tasksApi';
import { Menu } from '../ui/Menu';
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
  /** Which view's column widths and footers to read. Widths are per person and
   *  live in localStorage; order is shared and lives in the view's own config. */
  viewId?: string;
  /** Write a new column order. The ids are the view's `props` array, which the
   *  server already persists — so a drag here is a saved layout, not a local
   *  one. Absent on a surface with no view behind it (an embedded database). */
  onReorder?: (propIds: string[]) => void;
  /** Rows picked for a bulk action. Absent turns the checkboxes off entirely —
   *  an embedded database has no bar to act on a selection, so offering one
   *  would be a control that leads nowhere. */
  selected?: ReadonlySet<string>;
  onSelect?: (id: string, shift: boolean) => void;
  onToggleAll?: () => void;
  /** The row j/k has walked to. Drawn as a rule down the leading edge rather
   *  than a ring: a ring on a table row breaks across the frozen column, and
   *  the eye is scanning down a list, not around a box. */
  focusedId?: string | null;
}

/**
 * The reducer under one column, and the menu for changing it.
 *
 * Reads as plain text until the pointer is on it — a row of permanently
 * outlined controls under a grid is a second toolbar, and the total is the
 * thing worth seeing, not the machinery for picking it.
 */
function AggregatePicker({ type, value, result, onPick }: {
  type: PropType;
  value: Aggregate;
  result: string;
  onPick: (a: Aggregate) => void;
}) {
  return (
    <Menu
      align="end"
      trigger={
        <button
          type="button"
          className="flex h-6 w-full items-center gap-1 rounded px-2.5 text-left text-2xs
                     text-faint transition-colors duration-120 hover:bg-hover hover:text-ink"
        >
          {value === 'none' ? (
            <span className="opacity-0 transition-opacity group-focus-within/foot:opacity-100 group-hover/foot:opacity-100">Σ</span>
          ) : (
            <>
              <span className="shrink-0 text-faint">{AGGREGATE_LABEL[value]}</span>
              <span className="truncate text-ink">{result}</span>
            </>
          )}
        </button>
      }
      items={aggregatesFor(type).map((a) => ({
        label: AGGREGATE_LABEL[a],
        onSelect: () => onPick(a),
      }))}
    />
  );
}

/**
 * The drag handle on a column's trailing edge.
 *
 * Pointer events rather than mouse: a trackpad drag and a touch drag are the
 * same gesture to the browser, and setPointerCapture keeps the column being
 * dragged even when the pointer outruns it — which it will, because the header
 * is 28px tall and people drag fast.
 */
function ResizeHandle({ width, onResize, onReset }: {
  width: number;
  onResize: (next: number) => void;
  onReset: () => void;
}) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      aria-valuenow={Math.round(width)}
      aria-valuemin={MIN_COL}
      tabIndex={0}
      title="Drag to resize · arrow keys to nudge · double-click or Backspace to reset"
      className="absolute right-0 top-0 z-10 h-full w-[7px] translate-x-[3px] cursor-col-resize
                 touch-none select-none after:absolute after:inset-y-1 after:left-[3px] after:w-px
                 after:bg-transparent hover:after:bg-accent focus-visible:after:bg-accent"
      // Dragging is a pointer gesture; the same column has to be resizable
      // without one. Shift takes bigger steps, the way a nudge does everywhere.
      onKeyDown={(e) => {
        const step = e.shiftKey ? 24 : 8;
        if (e.key === 'ArrowLeft')       { e.preventDefault(); onResize(Math.max(MIN_COL, width - step)); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); onResize(width + step); }
        else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); onReset(); }
      }}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = width;
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => onResize(Math.max(MIN_COL, startW + ev.clientX - startX));
        const up = () => {
          el.releasePointerCapture(e.pointerId);
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      }}
    />
  );
}

// A value cell carries no horizontal padding of its own: every control inside
// one already insets its text by 10px (`field` / `cellField` / a chip's
// trigger), so a cell that padded as well put each column's text at a
// different place — measured against the column head, Assignees sat at +2,
// Sprint at +5, the dates at +8, Points at +10, Status at +11 and Files at
// +25. One inset, owned by the control, is what makes a column line up with
// its own heading and with the column beside it.
const cell = 'py-1.5';
// whitespace-nowrap: a two-word column name breaking onto a second line
// ("Files & / media") made the header row taller than any data row.
const head = 'px-2.5 py-1.5 whitespace-nowrap font-semibold';

// The header rides the vertical scroll and the title column rides the
// horizontal one. Both paint an opaque ground: a transparent sticky cell shows
// the rows sliding underneath it, which reads as a rendering fault.
const sticky = 'sticky top-0 bg-canvas after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-line';
const frozen = 'sticky left-0';

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
  email: 170,
  phone: 130,
  file: 120,
  relation: 96,
  formula: 140,
  rollup: 110,
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
  // The row's way in. The title is a text field, so a click has to put the
  // caret in it — which left double-click as the only way to open a row, and
  // nothing on screen said so. Every other view opens on a single click; this
  // is the grid's equivalent, and the double-click still works for anyone who
  // learned it.
  const open = (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${value || 'this row'}`}
      className={cn(
        'absolute right-0 top-1/2 flex h-6 -translate-y-1/2 items-center gap-1 rounded px-1.5',
        'bg-canvas text-2xs font-medium text-muted opacity-0 shadow-subtle ring-1 ring-line',
        'transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100',
      )}
    >
      <Maximize2 size={12} /> Open
    </button>
  );

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
    <span className="relative block pr-2.5">
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
    {open}
    </span>
  );
}

const input =
  'w-full rounded border border-transparent bg-transparent px-2.5 py-0.5 text-sm text-ink outline-none hover:border-line focus:border-accent focus:bg-canvas';

/**
 * The box that picks a row.
 *
 * A real checkbox, not a styled div: it is announced, it is reachable by Tab,
 * and Space works on it without a line of code. `onPick` carries the shift key
 * because a range is what a shift-click means everywhere else.
 *
 * Hidden until the row is hovered or something is already picked — a column of
 * empty boxes down the left of every table is a permanent invitation to a
 * gesture almost nobody is making.
 */
function RowCheck({ checked, label, always, className, onPick }: {
  checked: boolean;
  label: string;
  always?: boolean;
  className?: string;
  onPick: (shift: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      aria-label={label}
      onChange={() => { /* onClick owns it: only the click knows about shift. */ }}
      onClick={(e) => { e.stopPropagation(); onPick(e.shiftKey); }}
      className={cn(
        'h-3.5 w-3.5 shrink-0 cursor-pointer accent-accent-strong transition-opacity',
        'focus-visible:opacity-100 group-hover:opacity-100',
        checked || always ? 'opacity-100' : 'opacity-0',
        className,
      )}
    />
  );
}

/** Dense editable grid. Every field writes straight through on change. */
export function TaskTable({
  tasks, props, users, onPatch, onOpen, onDelete, onSetProp, onEditOptions, onTagsChanged,
  viewId, onReorder, selected, onSelect, onToggleAll, focusedId,
  rowLabel = 'Task', auto,
}: Props) {
  const picking = !!onSelect;
  const allPicked = picking && tasks.length > 0 && tasks.every((t) => selected?.has(t.id));
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

  // Per-person layout, read once per view and kept in state so a drag repaints
  // without going back to localStorage on every pointermove.
  const prefKey = viewId ?? 'default';
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [aggs, setAggs] = useState<Record<string, Aggregate>>({});
  useEffect(() => {
    const pref = gridPrefFor(prefKey);
    setWidths(pref.widths ?? {});
    setAggs(pref.aggregates ?? {});
  }, [prefKey]);

  const resize = (propId: string, next: number) => {
    setWidths((w) => ({ ...w, [propId]: next }));
    setColumnWidth(prefKey, propId, next);
  };
  const resetWidth = (propId: string) => {
    setWidths((w) => { const n = { ...w }; delete n[propId]; return n; });
    setColumnWidth(prefKey, propId, null);
  };
  const setAgg = (propId: string, agg: Aggregate) => {
    setAggs((a) => { const n = { ...a }; if (agg === 'none') delete n[propId]; else n[propId] = agg; return n; });
    setColumnAggregate(prefKey, propId, agg);
  };

  // Drag-to-reorder. The id being dragged lives in state so the header it is
  // over can show where it would land; the drop writes the view's props array.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const drop = (targetId: string) => {
    if (!onReorder || !dragId || dragId === targetId) return;
    const ids = props.map((p) => p.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    onReorder(ids);
    setDragId(null);
    setOverId(null);
  };

  // Values down each column, for the reducers under them.
    const columnValues = useMemo(
    () => new Map(props.map((p) => [p.id, tasks.map((t) => (t.props ?? {})[p.id])])),
    [props, tasks],
  );

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
          {/* sticky: the column names are the only thing telling you what a
              value means, and they used to scroll away at row twenty. */}
          <tr className="text-left text-2xs text-muted">
            <th
              className={cn(head, sticky, frozen, 'w-[38%] min-w-[240px] z-30')}
              style={{ width: widths.__title, minWidth: widths.__title ? 0 : undefined }}
            >
              <span className="relative flex items-center gap-1.5">
                {picking && (
                  <RowCheck
                    checked={allPicked}
                    label={allPicked ? 'Clear the selection' : 'Select every row'}
                    // The header box is always visible once picking is on:
                    // it is the only thing that says the column is there.
                    always
                    onPick={() => onToggleAll?.()}
                  />
                )}
                {rowLabel}
                <ResizeHandle
                  width={widths.__title ?? 320}
                  onResize={(n) => resize('__title', n)}
                  onReset={() => resetWidth('__title')}
                />
              </span>
            </th>
            {props.map((p) => (
              <th
                key={p.id}
                className={cn(head, sticky, 'z-20', overId === p.id && 'bg-accent-soft')}
                style={{
                  width: widths[p.id],
                  minWidth: widths[p.id] ? 0 : (MIN_WIDTH[p.type] ?? 140),
                }}
                draggable={!!onReorder}
                onDragStart={() => setDragId(p.id)}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(p.id); } }}
                onDragLeave={() => setOverId((c) => (c === p.id ? null : c))}
                onDrop={(e) => { e.preventDefault(); drop(p.id); }}
                onDragEnd={() => { setDragId(null); setOverId(null); }}
              >
                <span className={cn('relative flex items-center', onReorder && 'cursor-grab active:cursor-grabbing')}>
                  <span className="truncate">{p.label}</span>
                  {/* A database may define its own "Status" beside the built-in
                      one — two real properties holding two values. Two identical
                      column heads is a coin flip, so say which is which, and only
                      where the clash is real. */}
                  {twice.has(p.label.toLowerCase()) && (
                    <span className="ml-1 shrink-0 font-normal text-faint">{isBuiltinProp(p.id) ? 'built-in' : 'yours'}</span>
                  )}
                  <ResizeHandle
                    width={widths[p.id] ?? MIN_WIDTH[p.type] ?? 140}
                    onResize={(n) => resize(p.id, n)}
                    onReset={() => resetWidth(p.id)}
                  />
                </span>
              </th>
            ))}
            <th className={cn(cell, sticky, 'w-10 z-20')} />
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr
              key={t.id}
              data-task-row={t.id}
              className={cn(
                'group border-b border-line last:border-0 hover:bg-hover',
                selected?.has(t.id) && 'bg-selected hover:bg-selected',
                focusedId === t.id && 'outline outline-2 -outline-offset-2 outline-accent',
              )}
            >
              <td className={cn(
                cell, frozen,
                // The frozen cell paints its own ground, so a selected row has
                // to repaint it here too or the title column alone stays white
                // while the rest of the row is tinted.
                selected?.has(t.id) ? 'bg-selected' : 'bg-canvas group-hover:bg-hover',
                wrap ? 'align-top' : 'align-middle',
              )}>
                <span className="flex items-start gap-1.5">
                  {picking && (
                    <RowCheck
                      checked={!!selected?.has(t.id)}
                      label={`Select ${t.title || 'this row'}`}
                      always={!!selected?.size}
                      className="mt-1"
                      onPick={(shift) => onSelect?.(t.id, shift)}
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <TitleCell
                      value={t.title}
                      wrap={wrap}
                      onCommit={(v) => onPatch(t.id, { title: v })}
                      onOpen={() => onOpen(t)}
                    />
                  </span>
                </span>
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
              <td className={cn(cell, 'px-2', wrap ? 'align-top' : 'align-middle')}>
                <button
                  type="button"
                  onClick={() => onDelete(t.id)}
                  className="flex h-6 w-6 items-center justify-center rounded text-faint opacity-0 transition-opacity hover:bg-hover hover:text-danger-strong focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label="Delete task"
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {/* Always rendered, even with nothing summarised: the control for
              choosing a reducer lives in this row, so gating the row on having
              one already was a door locked from the inside. Empty columns show
              a Σ on hover and nothing at rest. */}
          {/* Pinned to the bottom edge for the same reason the head is pinned
                to the top: a total you have to scroll to find is a total you
                stop reading. */}
            <tr className="group/foot text-2xs text-muted">
              <td className={cn(cell, frozen, 'sticky bottom-0 bg-canvas before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-line', 'z-20 px-2.5 font-medium')}>
                {tasks.length} {tasks.length === 1 ? 'row' : 'rows'}
              </td>
              {props.map((p) => (
                <td key={p.id} className={cn(cell, 'sticky bottom-0 bg-canvas before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-line', 'px-0 tabular-nums')}>
                  <AggregatePicker
                    type={p.type}
                    value={aggs[p.id] ?? 'none'}
                    result={aggs[p.id] ? reduceColumn(columnValues.get(p.id) ?? [], aggs[p.id]) : ''}
                    onPick={(a) => setAgg(p.id, a)}
                  />
                </td>
              ))}
              <td className={cn(cell, 'sticky bottom-0 bg-canvas before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-line')} />
            </tr>
        </tfoot>
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
