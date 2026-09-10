import { useRef, useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import {
  isMultiOp,
  needsValue,
  newFilter,
  OP_LABEL,
  OPS,
  splitValues,
  type Filter,
  type FilterField,
  type FilterOp,
} from '../../lib/taskFilter';

interface Props {
  fields: FilterField[];
  filters: Filter[];
  onChange: (next: Filter[]) => void;
}

/** Bare controls: the chip already draws the one hairline around them. */
const pill =
  'h-6 max-w-[9rem] cursor-pointer rounded bg-transparent px-1 text-xs text-ink outline-none ' +
  'hover:bg-hover focus:bg-canvas';

/**
 * The checkbox list behind "is any of". A row of chips would be the obvious
 * thing and is exactly what does not scale — twenty labels is a wall — so the
 * chip stays one word wide and the list opens under it, scrolling past ten.
 */
function ValueChecklist({ field, filter, onChange }: {
  field: FilterField;
  filter: Filter;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useOutsideClick(box, () => setOpen(false));

  const chosen = splitValues(filter.value);
  const options = field.options ?? [];
  const label = chosen.length === 0
    ? 'Choose…'
    : chosen.length === 1
      ? options.find((o) => o.value === chosen[0])?.label ?? '1 selected'
      : `${chosen.length} selected`;

  const toggle = (value: string) => {
    const next = chosen.includes(value) ? chosen.filter((v) => v !== value) : [...chosen, value];
    onChange(next.join(','));
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label="Value"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(pill, 'flex items-center gap-1', !chosen.length && 'text-muted')}
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={12} className="shrink-0 text-faint" />
      </button>
      {open && (
        <div className="scrollarea absolute left-0 top-7 z-30 max-h-64 w-56 overflow-y-auto rounded-lg border border-line bg-canvas p-1 shadow-pop">
          {options.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink hover:bg-hover"
            >
              <input type="checkbox" checked={chosen.includes(o.value)} onChange={() => toggle(o.value)} />
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
            </label>
          ))}
          {!options.length && <p className="px-2 py-1.5 text-2xs text-faint">Nothing to choose from yet.</p>}
          {chosen.length > 0 && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="mt-1 w-full rounded px-2 py-1.5 text-left text-2xs text-faint hover:bg-hover hover:text-ink"
            >
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ValueInput({
  field,
  filter,
  onChange,
}: {
  field: FilterField;
  filter: Filter;
  onChange: (value: string) => void;
}) {
  if (isMultiOp(filter.op)) return <ValueChecklist field={field} filter={filter} onChange={onChange} />;
  const common = { className: pill, value: filter.value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) };
  if (field.kind === 'checkbox') {
    return (
      <select {...common} aria-label="Value">
        <option value="true">Checked</option>
        <option value="false">Unchecked</option>
      </select>
    );
  }
  if (field.options && ['select', 'multi_select', 'person'].includes(field.kind)) {
    return (
      <select {...common} aria-label="Value">
        <option value="">Choose…</option>
        {field.options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }
  const type = field.kind === 'date' ? 'date' : field.kind === 'number' ? 'number' : 'text';
  return (
    <input
      {...common}
      type={type}
      aria-label="Value"
      placeholder="Value"
      className={cn(pill, 'w-24 cursor-text')}
    />
  );
}

/**
 * Notion-style filter chips over the whole project, not just the table — the
 * board, gantt, calendar and gallery all draw the list this narrows.
 */
export function FilterBar({ fields, filters, onChange }: Props) {
  const byKey = (key: string) => fields.find((f) => f.key === key);
  const add = () => fields[0] && onChange([...filters, newFilter(fields[0])]);
  const patch = (id: string, next: Partial<Filter>) =>
    onChange(filters.map((f) => (f.id === id ? { ...f, ...next } : f)));

  // Changing the field resets the rest of the chip: an operator or a value from
  // the old field would not mean anything against the new one.
  const setField = (id: string, key: string) => {
    const field = byKey(key);
    if (!field) return;
    patch(id, { field: key, op: OPS[field.kind][0], value: field.kind === 'checkbox' ? 'true' : '' });
  };

  if (!filters.length) {
    return (
      <button
        type="button"
        onClick={add}
        className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted transition-colors hover:bg-hover hover:text-ink"
      >
        <Plus size={13} /> Filter
      </button>
    );
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-1.5">
      {filters.map((f) => {
        const field = byKey(f.field);
        if (!field) return null;
        return (
          <div
            key={f.id}
            className="flex items-center gap-0.5 rounded-md bg-surface px-1 py-0.5 ring-1 ring-inset ring-line"
          >
            <select
              className={cn(pill, 'font-medium')}
              aria-label="Field"
              value={f.field}
              onChange={(e) => setField(f.id, e.target.value)}
            >
              {fields.map((x) => (
                <option key={x.key} value={x.key}>{x.label}</option>
              ))}
            </select>
            <select
              className={cn(pill, 'text-muted')}
              aria-label="Condition"
              value={f.op}
              onChange={(e) => {
                const op = e.target.value as FilterOp;
                // A single value and a list read the same string differently;
                // keep the value only when the shape does not change.
                const keep = isMultiOp(op) === isMultiOp(f.op);
                patch(f.id, { op, ...(keep ? {} : { value: '' }) });
              }}
            >
              {OPS[field.kind].map((op) => (
                <option key={op} value={op}>{OP_LABEL[op]}</option>
              ))}
            </select>
            {needsValue(f.op) && (
              <ValueInput field={field} filter={f} onChange={(value) => patch(f.id, { value })} />
            )}
            <button
              type="button"
              aria-label="Remove filter"
              onClick={() => onChange(filters.filter((x) => x.id !== f.id))}
              className="flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-hover hover:text-danger"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        className="flex h-6 items-center gap-1 rounded px-1.5 text-xs text-muted hover:bg-hover hover:text-ink"
      >
        <Plus size={12} /> Add
      </button>
      <button
        type="button"
        onClick={() => onChange([])}
        className="h-6 rounded px-1.5 text-xs text-faint hover:bg-hover hover:text-ink"
      >
        Clear
      </button>
    </div>
  );
}
