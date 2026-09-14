import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { UserRow } from '../../../lib/docsApi';
import { cn } from '../../../lib/cn';
import { selectedOptions } from '../../../lib/props';
import type { StoredFile } from '../../../lib/uploads';
import type { PropRow } from '../../../lib/tasksApi';
import { Attachments } from '../../ui/Attachments';
import { field, selectField } from '../../ui/styles';

interface Props {
  prop: PropRow;
  users: UserRow[];
  value: unknown;
  onChange: (value: unknown) => void;
}

/**
 * A URL that reads as a link. It was a text box holding a string: the address
 * was stored, but nothing could be clicked, which is the only thing a URL
 * property is for. Click the link's row to edit it, the arrow to follow it.
 */
function UrlValue({ value, onChange }: { value: string; onChange: (v: unknown) => void }) {
  const [editing, setEditing] = useState(false);
  const safe = /^https?:\/\//i.test(value) ? value : '';

  if (!editing && safe) {
    return (
      <span className="flex h-8 min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Edit this address"
          className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-sm text-accent-strong underline decoration-line-strong underline-offset-2 hover:bg-hover"
        >
          {safe.replace(/^https?:\/\//i, '')}
        </button>
        <a
          href={safe}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Open in a new tab"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint transition-colors hover:bg-hover hover:text-ink"
        >
          <ExternalLink size={13} />
        </a>
      </span>
    );
  }
  return (
    <input
      // Uncontrolled so typing is not a write per keystroke, but keyed on the
      // value so an external change still lands: a save that failed and rolled
      // back must not leave the box showing what never persisted.
      key={value}
      type="url"
      inputMode="url"
      placeholder="https://"
      autoFocus={editing}
      className={field}
      defaultValue={value}
      onBlur={(e) => {
        setEditing(false);
        if (e.target.value !== value) onChange(e.target.value || null);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
    />
  );
}

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
        <select className={selectField} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Nobody</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.username}</option>)}
        </select>
      );
    case 'select':
      return (
        <select className={selectField} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)}>
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
                chosen.has(o.id) ? 'bg-accent-soft text-accent-strong' : 'text-muted hover:bg-hover',
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
      return <UrlValue value={typeof value === 'string' ? value : ''} onChange={onChange} />;
    case 'file':
      return (
        <Attachments
          compact
          files={Array.isArray(value) ? (value as StoredFile[]) : []}
          onChange={onChange}
        />
      );
    default:
      return (
        <input
          key={typeof value === 'string' ? value : ''}
          className={field}
          defaultValue={typeof value === 'string' ? value : ''}
          onBlur={(e) => e.target.value !== value && onChange(e.target.value || null)}
        />
      );
  }
}
