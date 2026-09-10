import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../../lib/cn';
import { PROP_TYPES, PROP_TYPE_LABEL, type PropRow, type PropType, type ProjectRow } from '../../../lib/tasksApi';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { Modal } from '../../ui/Modal';
import { field, selectField } from '../../ui/styles';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  props: PropRow[];
  projects: ProjectRow[];
  onCreate: (b: { label: string; type: PropType; targetProjectId?: string }) => Promise<string | null>;
  onPatch: (id: string, b: Partial<{ label: string; type: PropType; options: PropRow['options'] }>) => void;
  onDelete: (id: string) => void;
  /** Swap a property with its neighbour; `by` is -1 for up, 1 for down. */
  onReorder: (id: string, by: -1 | 1) => void;
}

/**
 * The types a property can be switched to without its stored values becoming
 * unreadable — the client-side twin of canChangeType in the server's props.js.
 * Text and URL are the same string either way; a select's ids are still ids in
 * a multi-select. Everything else keeps only its current type.
 */
const COMPATIBLE: PropType[][] = [['text', 'url'], ['select', 'multi_select']];

function changeableTo(type: PropType): PropType[] {
  return COMPATIBLE.find((pair) => pair.includes(type)) ?? [type];
}

/**
 * Option rows are keyed by id, never by label — a rename must never mint a
 * new id, or every task that stored the old id renders blank (the value is
 * still in `tasks.props`, but nothing in `prop.options` matches it anymore).
 */
function OptionsEditor({ prop, onPatch }: { prop: PropRow; onPatch: Props['onPatch'] }) {
  const [draft, setDraft] = useState('');

  const setOptions = (options: PropRow['options']) => onPatch(prop.id, { options });

  const addOption = () => {
    const label = draft.trim();
    if (label && !prop.options.some((o) => o.label === label)) {
      setOptions([...prop.options, { id: crypto.randomUUID(), label, color: 'gray' }]);
    }
    setDraft('');
  };

  return (
    <div className="ml-9 flex flex-col gap-1 pb-1.5">
      {prop.options.map((o) => (
        <div key={o.id} className="flex items-center gap-2">
          <input
            className={field}
            defaultValue={o.label}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next && next !== o.label) {
                setOptions(prop.options.map((opt) => (opt.id === o.id ? { ...opt, label: next } : opt)));
              } else {
                e.target.value = o.label;
              }
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <IconButton
            icon={<Trash2 size={14} />}
            label={`Delete option ${o.label}`}
            onClick={() => setOptions(prop.options.filter((opt) => opt.id !== o.id))}
          />
        </div>
      ))}
      <input
        className={field}
        placeholder="Add option…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && addOption()}
      />
    </div>
  );
}

/** Per-project custom properties. Modelled on TaskKindsDialog. */
export function PropsDialog({ open, onOpenChange, props, projects, onCreate, onPatch, onDelete, onReorder }: Props) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<PropType>('text');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const err = await onCreate({ label, type, ...(type === 'relation' ? { targetProjectId: target } : {}) });
    if (err) return setError(err);
    setLabel('');
    setError(null);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Properties" width={520}>
      <div className="space-y-2 p-4">
        {props.map((p, i) => (
          <div key={p.id}>
            <div className="flex items-center gap-2">
              <div className="flex shrink-0 flex-col">
                <IconButton
                  icon={<ChevronUp size={13} />}
                  label={`Move ${p.label} up`}
                  disabled={i === 0}
                  onClick={() => onReorder(p.id, -1)}
                />
                <IconButton
                  icon={<ChevronDown size={13} />}
                  label={`Move ${p.label} down`}
                  disabled={i === props.length - 1}
                  onClick={() => onReorder(p.id, 1)}
                />
              </div>
              <input
                className={field}
                defaultValue={p.label}
                onBlur={(e) => e.target.value !== p.label && onPatch(p.id, { label: e.target.value })}
              />
              {/* Only the changes that keep the stored values readable are
                  offered — the server refuses the rest, and a menu that offers
                  what will be refused is worse than one that doesn't. */}
              <select
                className={cn(selectField, 'w-32 shrink-0')}
                aria-label={`Type of ${p.label}`}
                value={p.type}
                disabled={changeableTo(p.type).length < 2}
                onChange={(e) => onPatch(p.id, { type: e.target.value as PropType })}
              >
                {changeableTo(p.type).map((t) => (
                  <option key={t} value={t}>{PROP_TYPE_LABEL[t]}</option>
                ))}
              </select>
              <IconButton icon={<Trash2 size={14} />} label={`Delete ${p.label}`} onClick={() => onDelete(p.id)} />
            </div>
            {(p.type === 'select' || p.type === 'multi_select') && <OptionsEditor prop={p} onPatch={onPatch} />}
          </div>
        ))}
        {!props.length && <p className="text-sm text-faint">No custom properties yet.</p>}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <input
            className={field}
            placeholder="Property name…"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <select className={selectField} value={type} onChange={(e) => setType(e.target.value as PropType)}>
            {PROP_TYPES.map((t) => <option key={t} value={t}>{PROP_TYPE_LABEL[t]}</option>)}
          </select>
          {type === 'relation' && (
            <select className={selectField} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Link to…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={add}>Add</Button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
