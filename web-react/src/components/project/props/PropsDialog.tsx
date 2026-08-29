import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PROP_TYPES, PROP_TYPE_LABEL, type PropRow, type PropType, type ProjectRow } from '../../../lib/tasksApi';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { Modal } from '../../ui/Modal';
import { field } from '../../ui/styles';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  props: PropRow[];
  projects: ProjectRow[];
  onCreate: (b: { label: string; type: PropType; targetProjectId?: string }) => Promise<string | null>;
  onPatch: (id: string, b: Partial<{ label: string; options: PropRow['options'] }>) => void;
  onDelete: (id: string) => void;
}

/** Per-project custom properties. Modelled on TaskKindsDialog. */
export function PropsDialog({ open, onOpenChange, props, projects, onCreate, onPatch, onDelete }: Props) {
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
        {props.map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <input
              className={field}
              defaultValue={p.label}
              onBlur={(e) => e.target.value !== p.label && onPatch(p.id, { label: e.target.value })}
            />
            <span className="w-28 shrink-0 text-2xs text-muted">{PROP_TYPE_LABEL[p.type]}</span>
            {(p.type === 'select' || p.type === 'multi_select') && (
              <input
                className={field}
                placeholder="Options, comma separated"
                defaultValue={p.options.map((o) => o.label).join(', ')}
                onBlur={(e) => onPatch(p.id, {
                  options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).map((labelText) => {
                    const existing = p.options.find((o) => o.label === labelText);
                    return existing ?? { id: crypto.randomUUID(), label: labelText, color: 'gray' };
                  }),
                })}
              />
            )}
            <IconButton icon={<Trash2 size={14} />} label={`Delete ${p.label}`} onClick={() => onDelete(p.id)} />
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
          <select className={field} value={type} onChange={(e) => setType(e.target.value as PropType)}>
            {PROP_TYPES.map((t) => <option key={t} value={t}>{PROP_TYPE_LABEL[t]}</option>)}
          </select>
          {type === 'relation' && (
            <select className={field} value={target} onChange={(e) => setTarget(e.target.value)}>
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
