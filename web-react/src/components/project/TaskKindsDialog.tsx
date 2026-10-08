import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { type TagColor } from '../../lib/tagColors';
import { isFixedKind, KIND_ICONS } from '../../lib/taskKinds';
import type { TaskKindRow, TaskRow } from '../../lib/tasksApi';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { ColorPicker } from '../ui/ColorPicker';
import { Menu } from '../ui/Menu';
import { Modal } from '../ui/Modal';
import { Tooltip } from '../ui/Tooltip';
import { field } from '../ui/styles';
import type { KindResult } from './useProject';
import { KindIcon } from './TaskBadges';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kinds: TaskKindRow[];
  tasks: TaskRow[];
  onCreate: (b: { label: string; color?: string; isGroup?: boolean; icon?: string | null }) => Promise<KindResult>;
  onPatch: (id: string, b: Partial<{ label: string; color: string; isGroup: boolean; icon: string | null }>) => Promise<KindResult>;
  onDelete: (id: string) => Promise<KindResult>;
}

const PARENT_HINT = 'Tasks of this type can hold children, the way Epic does';

/**
 * The type's glyph, as a button that opens the icon list. Epic, Story, Task and
 * Bug keep the glyphs everyone knows from Jira, so theirs is drawn, not offered.
 */
function IconPicker({ kind, onPick }: { kind: TaskKindRow; onPick: (icon: string | null) => void }) {
  const glyph = <KindIcon kind={kind.key} row={kind} />;
  if (isFixedKind(kind.key)) return <span className="flex h-7 w-7 shrink-0 items-center justify-center">{glyph}</span>;
  return (
    <Menu
      align="start"
      width={184}
      trigger={
        <button
          type="button"
          aria-label={`${kind.label || 'New type'} icon`}
          title="Choose an icon"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-120 hover:bg-hover active:bg-selected"
        >
          {glyph}
        </button>
      }
      items={[
        { label: 'Default', checked: !kind.icon, onSelect: () => onPick(null) },
        ...Object.entries(KIND_ICONS).map(([name, { icon, label }], i) => ({
          icon,
          label,
          checked: kind.icon === name,
          separatorBefore: i === 0,
          onSelect: () => onPick(name),
        })),
      ]}
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

        {/* What the type looks like everywhere else, beside the name that
            goes with it — so a recolour or a "holds children" tick shows its
            result here, not only after the dialog closes. A custom type's
            glyph opens the icon list. */}
        <IconPicker kind={kind} onPick={(icon) => patch({ icon })} />

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
        <div className="mt-1 flex flex-wrap items-center gap-2 pl-[3.75rem] pr-1">
          <span className="min-w-0 flex-1 text-2xs text-muted">
            {count > 0
              ? `${count} ${count === 1 ? 'task becomes' : 'tasks become'} “${fallback.label}”.`
              : 'No tasks use this type.'}
          </span>
          <button
            type="button"
            onClick={() => { setConfirming(false); onDelete(); }}
            className="h-6 shrink-0 rounded-md px-2 text-2xs font-medium text-danger-strong transition-colors duration-120 hover:bg-danger-soft active:bg-danger-soft"
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

      {error && <p className="mt-1 pl-[3.75rem] text-2xs text-danger-strong">{error}</p>}
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
  const [icon, setIcon] = useState<string | null>(null);
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
    const out = await onCreate({ label: name, color, icon });
    setBusy(null);
    if (out.ok) {
      setLabel('');
      setColor('gray');
      setIcon(null);
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
          Rename, recolour or add types for this project, and click a custom type’s icon
          to change it. Mark one “Parent” to let its tasks hold children — that is all Epic is.
        </p>

        {notice && (
          <p
            role="status"
            className={cn(
              'mb-2 rounded-md px-2.5 py-1.5 text-2xs',
              notice.bad ? 'bg-danger-soft text-danger-strong' : 'bg-surface text-muted',
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
        {/* What the new type will look like, and the place to pick its icon.
            Without one it draws the generic glyph. */}
        <IconPicker
          kind={{ id: '', project_id: '', key: '', label: 'New type', color, is_group: false, position: 0, icon }}
          onPick={setIcon}
        />
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
