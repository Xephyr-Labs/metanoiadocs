/* Hallmark · component: bulk action bar · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default · hover · focus-visible · active · disabled (nothing to
 *         offer) · loading (applying) · error (a write failed) · success
 *         (armed delete confirmed, selection clears)
 * note: appears only with a selection, so it has no empty state — it IS the
 *       empty state's opposite. Fixed to the bottom of the canvas rather than
 *       pushed into the layout: a bar that reflows the table you are picking
 *       rows in moves the rows out from under the pointer.
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Check, Loader2, Trash2, User, X, Zap } from 'lucide-react';
import { cn } from '../../lib/cn';
import { STATUS_COLOR } from '../../lib/builtinProps';
import { swatch } from '../../lib/tagColors';
import { STATUSES, STATUS_LABEL, type SprintRow, type TaskPatch, type TaskStatus } from '../../lib/tasksApi';
import type { UserRow } from '../../lib/docsApi';
import { Menu, type MenuItem } from '../ui/Menu';

interface Props {
  count: number;
  /** The rows to act on, in the order the view shows them. */
  ids: string[];
  users: UserRow[];
  sprints: SprintRow[];
  /** A data database has no status and no sprints, only rows. */
  isData?: boolean;
  /** Apply one patch to every selected row. Resolves when all of them are in. */
  onPatch: (ids: string[], body: TaskPatch) => Promise<void>;
  onDelete: (ids: string[]) => Promise<void>;
  onClear: () => void;
}

const button =
  'flex h-7 items-center gap-1.5 rounded-md px-2 text-2xs font-medium text-ink transition-colors '
  + 'hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent '
  + 'active:bg-selected disabled:pointer-events-none disabled:opacity-40';

/**
 * What to do with the rows you just picked.
 *
 * Every action here is one the row menu already offers one at a time; the point
 * is the "at a time". Moving twenty tasks into a sprint was twenty drags, and
 * the drag is not the part anyone wanted.
 *
 * Delete arms rather than asking. A dialog for a destructive action is the
 * right call when the action is hard to describe; "Delete 6 tasks" is not, and
 * the second click is both cheaper and harder to do by accident than a dialog
 * whose confirm button lands under the pointer.
 */
export function BulkBar({ count, ids, users, sprints, isData, onPatch, onDelete, onClear }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
  const timers = useRef<number[]>([]);

  // Every timer this sets is cleared on the way out: the bar unmounts the
  // moment the selection empties, which is exactly when these are pending.
  useEffect(() => () => { timers.current.forEach(window.clearTimeout); }, []);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };

  // A selection that changes disarms the delete: the count on the button is a
  // promise about which rows, and it has just stopped being true.
  useEffect(() => { setArmed(false); setError(null); }, [count]);

  const apply = async (body: TaskPatch) => {
    setBusy(true);
    setError(null);
    try {
      await onPatch(ids, body);
      onClear();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Some rows did not change.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!armed) {
      setArmed(true);
      // Disarms itself: a button left reading "Delete 6?" across a coffee break
      // is a trap for whoever comes back to the keyboard.
      later(() => setArmed(false), 4000);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onDelete(ids);
      setDone(true);
      later(() => { setDone(false); onClear(); }, 450);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Some rows were not deleted.');
      setArmed(false);
    } finally {
      setBusy(false);
    }
  };

  const statusItems: MenuItem[] = STATUSES.map((s: TaskStatus) => ({
    label: STATUS_LABEL[s],
    icon: ({ className }) => (
      <span className={cn('h-2 w-2 shrink-0 rounded-full', swatch(STATUS_COLOR[s]).dot, className)} />
    ),
    onSelect: () => void apply({ status: s }),
  }));

  const assigneeItems: MenuItem[] = [
    { label: 'Nobody', onSelect: () => void apply({ assigneeIds: [] }) },
    ...users.map((u) => ({
      label: u.name || u.email,
      // Replaces the list rather than adding to it, which is what the single
      // "Assign to" reads as. Adding a person to twenty different teams of
      // assignees is a different verb, and it would need its own row.
      onSelect: () => void apply({ assigneeIds: [u.id] }),
    })),
  ];

  const sprintItems: MenuItem[] = [
    { label: 'Backlog', onSelect: () => void apply({ sprintId: null }) },
    ...sprints.map((s) => ({
      label: s.name,
      shortcut: s.state === 'active' ? 'active' : undefined,
      onSelect: () => void apply({ sprintId: s.id }),
    })),
  ];

  const noun = isData ? 'row' : 'task';

  return (
    // Centred with auto margins between two pinned edges, not with
    // `left-1/2 -translate-x-1/2`: Framer writes `transform` inline to animate
    // the rise, which overwrites the class's translate entirely. The bar was
    // starting at the middle of the screen and running off the right of it —
    // at 375px that left only "2 selected" and Status reachable.
    //
    // No AnimatePresence either. The parent renders this only while something
    // is selected, so the subtree unmounts the moment the last row is dropped
    // and `exit` never had anything to play.
    <motion.div
    initial={{ y: 12, opacity: 0 }}
    animate={{ y: 0, opacity: 1 }}
    transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
    role="toolbar"
    aria-label={`${count} ${noun}${count === 1 ? '' : 's'} selected`}
    // Wraps rather than scrolling sideways. At 375px the five controls do not
    // fit on one line, and a bar that scrolls hides its last two — which were
    // Delete and Clear, the destructive one and the way out. Two short rows
    // show everything; `w-fit` is what lets the box shrink to the cap and wrap,
    // where `w-max` sizes to the unwrapped content and defeats it.
    className="pointer-events-auto fixed inset-x-0 bottom-4 z-30 mx-auto flex w-fit
               max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-1
               rounded-lg border border-line bg-canvas px-2 py-1.5 shadow-pop"
  >
      <span className="shrink-0 whitespace-nowrap px-1 text-2xs font-semibold tabular-nums text-ink">
        {count} selected
      </span>
      <span className="mx-0.5 h-5 w-px shrink-0 bg-line" />

      {busy && <Loader2 size={14} className="mx-1 shrink-0 animate-spin text-faint" aria-label="Applying" />}

      {!isData && (
        <Menu
          align="center"
          side="top"
          items={statusItems}
          trigger={<button type="button" disabled={busy} className={cn(button, 'shrink-0')}><Zap size={13} className="text-faint" />Status</button>}
        />
      )}
      <Menu
        align="center"
        side="top"
        items={assigneeItems}
        trigger={<button type="button" disabled={busy || users.length === 0} className={cn(button, 'shrink-0')}><User size={13} className="text-faint" />Assign</button>}
      />
      {!isData && (
        <Menu
          align="center"
          side="top"
          items={sprintItems}
          trigger={
            // Disabled rather than hidden when a database has no sprints:
            // the bar keeping its shape between databases is worth more than
            // two pixels, and the greyed row says the feature exists.
            <button type="button" disabled={busy || sprints.length === 0} className={cn(button, 'shrink-0')}>Sprint</button>
          }
        />
      )}

      <span className="mx-0.5 h-5 w-px shrink-0 bg-line" />
      <button
        type="button"
        onClick={() => void remove()}
        disabled={busy}
        className={cn(
          button, 'shrink-0',
          done ? 'text-ok'
            : armed ? 'bg-danger-soft text-danger-strong hover:bg-danger-soft focus-visible:ring-danger-strong'
            : 'text-muted hover:text-danger-strong',
        )}
      >
        {done ? <Check size={13} /> : <Trash2 size={13} />}
        {done ? 'Deleted' : armed ? `Delete ${count}?` : 'Delete'}
      </button>

      <button type="button" onClick={onClear} aria-label="Clear selection" className={cn(button, 'shrink-0 px-1.5 text-faint')}>
        <X size={14} />
      </button>

      {error && (
        <span role="alert" className="flex shrink-0 items-center gap-1 whitespace-nowrap px-1 text-2xs text-danger-strong">
          <AlertCircle size={13} />{error}
        </span>
      )}
    </motion.div>
  );
}
