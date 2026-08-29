import type { UserRow } from '../../../lib/docsApi';
import { cn } from '../../../lib/cn';
import { selectedOptions } from '../../../lib/props';
import type { PropRow } from '../../../lib/tasksApi';
import { field } from '../../ui/styles';

interface Props {
  prop: PropRow;
  users: UserRow[];
  value: unknown;
  onChange: (value: unknown) => void;
}

/** One editor per property type, except `relation` — the peek renders that. */
export function PropertyValue({ prop, users, value, onChange }: Props) {
  switch (prop.type) {
    case 'number':
      return (
        <input
          type="number"
          className={field}
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'checkbox':
      return (
        <input
          type="checkbox"
          className="h-4 w-4 accent-accent"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case 'date':
      return (
        <input
          type="date"
          className={field}
          value={typeof value === 'string' ? value.slice(0, 10) : ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case 'person':
      return (
        <select className={field} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Nobody</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.username}</option>)}
        </select>
      );
    case 'select':
      return (
        <select className={field} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Empty</option>
          {prop.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      );
    case 'multi_select': {
      const chosen = new Set(selectedOptions(prop, value).map((o) => o.id));
      return (
        <div className="flex flex-wrap gap-1">
          {prop.options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                const next = new Set(chosen);
                if (next.has(o.id)) next.delete(o.id); else next.add(o.id);
                onChange([...next]);
              }}
              className={cn(
                'rounded-full border border-line px-2 py-0.5 text-2xs',
                chosen.has(o.id) ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover',
              )}
            >
              {o.label}
            </button>
          ))}
          {!prop.options.length && <span className="text-2xs text-faint">No options yet.</span>}
        </div>
      );
    }
    case 'url':
      return (
        <input
          type="url"
          placeholder="https://"
          className={field}
          defaultValue={typeof value === 'string' ? value : ''}
          onBlur={(e) => e.target.value !== value && onChange(e.target.value || null)}
        />
      );
    default:
      return (
        <input
          className={field}
          defaultValue={typeof value === 'string' ? value : ''}
          onBlur={(e) => e.target.value !== value && onChange(e.target.value || null)}
        />
      );
  }
}
