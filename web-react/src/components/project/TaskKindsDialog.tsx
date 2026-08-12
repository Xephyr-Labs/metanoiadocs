import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { swatch, TAG_COLORS, type TagColor } from '../../lib/tagColors';
import type { TaskKindRow, TaskRow } from '../../lib/tasksApi';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Menu } from '../ui/Menu';
import { Modal } from '../ui/Modal';
import { Tooltip } from '../ui/Tooltip';
import { field } from '../ui/styles';
import type { KindResult } from './useProject';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kinds: TaskKindRow[];
  tasks: TaskRow[];
  onCreate: (b: { label: string; color?: string; isGroup?: boolean }) => Promise<KindResult>;
  onPatch: (id: string, b: Partial<{ label: string; color: string; isGroup: boolean }>) => Promise<KindResult>;
  onDelete: (id: string) => Promise<KindResult>;
}

const PARENT_HINT = 'Tasks of this type can hold children, the way Epic does';

/** A palette dot shaped for Menu's `icon` slot. */
const dotIcon = (color: string, selected: boolean) =>
  function Dot({ className }: { className?: string }) {
    return (
      <span
        className={cn(
          'h-3.5 w-3.5 rounded-full',
          swatch(color).dot,
          // The selected colour is marked on the swatch itself. Putting a tick
          // in Menu's shortcut slot said "keyboard shortcut" in the faintest
          // ink on the surface — the wrong slot and the wrong weight for state.
          selected && 'ring-2 ring-ink/40 ring-offset-1 ring-offset-canvas',
          className,
        )}
      />
    );
  };

const colorItems = (current: string, onPick: (c: TagColor) => void) =>
  TAG_COLORS.map((c) => ({
    icon: dotIcon(c, c === current),
    label: c[0].toUpperCase() + c.slice(1),
    onSelect: () => onPick(c),
  }));

/** The colour swatch that opens the palette. Same control in both rows. */
function ColorPicker({ color, label, side, onPick }: {
  color: string;
  label: string;
  side?: 'top' | 'bottom';
  onPick: (c: TagColor) => void;
}) {
  return (
    <Menu
      align="start"
      side={side}
      width={168}
      trigger={
        <IconButton
          label={label}
          icon={<span className={cn('h-3.5 w-3.5 rounded-full', swatch(color).dot)} />}
        />
      }
      items={colorItems(color, onPick)}
    />
  );
}

function KindRow({ kind, count, fallback, busy, onPatch, onDelete }: {
  kind: TaskKindRow;
  count: number;
  /** Where this type's tasks land if it goes; null when it is the last one. */
  fallback: TaskKindRow | null;
  busy: boolean;
  onPatch: Props['onPatch'];
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = async (b: Parameters<Props['onPatch']>[1]) => {
    const out = await onPatch(kind.id, b);
    setError(out.ok ? null : out.error);
  };

  return (
    // No hover fill: the row itself does nothing when clicked, and a highlight
    // that follows the pointer across dead space reads as an affordance.
    <div className={cn('rounded-lg px-1.5 py-1', busy && 'pointer-events-none opacity-60')}>
      <div className="flex items-center gap-2">
        <ColorPicker
          color={kind.color}
          label={`${kind.label} colour`}
          onPick={(color) => patch({ color })}
        />

        <input
          aria-label="Type name"
          defaultValue={kind.label}
          // Commit on blur/Enter rather than per keystroke: one row is one PATCH.
          onBlur={(e) => {
            const label = e.target.value.trim();
            if (label && label !== kind.label) patch({ label });
            else e.target.value = kind.label;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') { e.currentTarget.value = kind.label; e.currentTarget.blur(); }
          }}
          className={cn(field, 'h-7 min-w-0 flex-1')}
        />

        <Tooltip label={PARENT_HINT} side="top">
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap text-2xs text-muted">
            <input
              type="checkbox"
              checked={kind.is_group}
              onChange={(e) => patch({ isGroup: e.target.checked })}
              className="accent-accent"
            />
            Parent
          </label>
        </Tooltip>

        {fallback ? (
          <IconButton
            icon={<Trash2 size={14} />}
            label={`Delete ${kind.label}`}
            tone="danger"
            active={confirming}
            onClick={() => setConfirming((c) => !c)}
          />
        ) : (
          // The last type has no delete: the server refuses it, so offering the
          // control would only ever produce an error.
          <span className="h-7 w-7 shrink-0" />
        )}
      </div>

      {confirming && fallback && (
        <div className="mt-1 flex flex-wrap items-center gap-2 pl-9 pr-1">
          <span className="min-w-0 flex-1 text-2xs text-muted">
            {count > 0
              ? `${count} ${count === 1 ? 'task becomes' : 'tasks become'} “${fallback.label}”.`
              : 'No tasks use this type.'}
          </span>
          <button
            type="button"
            onClick={() => { setConfirming(false); onDelete(); }}
            className="h-6 shrink-0 rounded-md px-2 text-2xs font-medium text-danger transition-colors duration-120 hover:bg-danger/10 active:bg-danger/20"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="h-6 shrink-0 rounded-md px-2 text-2xs text-muted transition-colors duration-120 hover:bg-hover active:bg-selected"
          >
            Cancel
          </button>
        </div>
      )}

      {error && <p className="mt-1 pl-9 text-2xs text-danger">{error}</p>}
    </div>
  );
}

/**
 * Per-project task types. Every field here is editable by anyone who can open
 * the project — types are content, not configuration.
 */
export function TaskKindsDialog({ open, onOpenChange, kinds, tasks, onCreate, onPatch, onDelete }: Props) {
  const [label, setLabel] = useState('');
  const [color, setColor] = useState<TagColor>('gray');
  // One line for both outcomes: "4 tasks moved to Epic" and "that name is
  // taken" belong in the same place, at the top, where they are read without
  // scrolling and without hunting for the row that moved.
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const count = (key: string) => tasks.filter((t) => t.kind === key).length;

  const add = async () => {
    const name = label.trim();
    if (!name || busy) return;
    setBusy('new');
    setNotice(null);
    const out = await onCreate({ label: name, color });
    setBusy(null);
    if (out.ok) {
      setLabel('');
      setColor('gray');
    } else {
      // Keep what they typed — retyping a lost label is the worst part of a
      // failed save.
      setNotice({ text: out.error, bad: true });
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    setNotice(null);
    const out = await onDelete(id);
    setBusy(null);
    if (!out.ok) setNotice({ text: out.error, bad: true });
    else if (out.moved) {
      setNotice({ text: `${out.moved} ${out.moved === 1 ? 'task' : 'tasks'} moved to “${out.movedTo}”.` });
    }
  };

  return (
    <Modal
      open={open}
      // Drop the notice on the way out, or it greets whoever opens this next
      // as though it had just happened.
      onOpenChange={(v) => { if (!v) setNotice(null); onOpenChange(v); }}
      title="Task types"
      width={480}
      className="max-h-[80vh]"
    >
      <div className="scrollarea min-h-0 flex-1 overflow-y-auto p-2">
        <p className="px-1.5 pb-2 text-2xs leading-4 text-faint">
          Rename, recolour or add types for this project. Mark one “Parent” to let its
          tasks hold children — that is all Epic is.
        </p>

        {notice && (
          <p
            role="status"
            className={cn(
              'mb-2 rounded-md px-2.5 py-1.5 text-2xs',
              notice.bad ? 'bg-danger/10 text-danger' : 'bg-surface text-muted',
            )}
          >
            {notice.text}
          </p>
        )}

        <div className="space-y-0.5">
          {kinds.map((k, i) => (
            <KindRow
              key={k.id}
              kind={k}
              count={count(k.key)}
              // Mirrors what the server does: tasks land on the first surviving
              // type in position order.
              fallback={kinds.length > 1 ? kinds[i === 0 ? 1 : 0] : null}
              busy={busy === k.id}
              onPatch={onPatch}
              onDelete={() => remove(k.id)}
            />
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2.5">
        <ColorPicker color={color} label="New type colour" side="top" onPick={setColor} />
        <input
          aria-label="New type name"
          placeholder="New type…"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          disabled={busy === 'new'}
          className={cn(field, 'h-7 min-w-0 flex-1')}
        />
        <Button
          size="sm"
          variant="primary"
          leftIcon={<Plus size={14} />}
          disabled={!label.trim() || busy === 'new'}
          onClick={add}
        >
          {busy === 'new' ? 'Adding…' : 'Add'}
        </Button>
      </div>
    </Modal>
  );
}
