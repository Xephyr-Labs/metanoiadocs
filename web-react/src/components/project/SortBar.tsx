/* Hallmark · component: sort rules · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default · hover · focus-visible · open · empty · one rule · several
 */
import { useRef, useState } from 'react';
import { ArrowDownNarrowWide, ArrowUpNarrowWide, ArrowUpDown, Plus, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import { SearchSelect } from '../ui/SearchSelect';
import { newSortRule, type SortRule } from '../../lib/taskSort';
import type { FilterField } from '../../lib/taskFilter';

interface Props {
  fields: FilterField[];
  sort: SortRule[];
  onChange: (next: SortRule[]) => void;
}

/**
 * How the rows are ordered, as a row of chips.
 *
 * There was no sort at all: every view drew the list in whatever order the
 * server returned, which is the manual board order — fine for a board, useless
 * for a table of forty rows. Several rules in sequence, because "by status,
 * then by due date" is the ordinary ask and two separate controls cannot
 * express it.
 *
 * Deliberately beside the filter bar and shaped like it: they answer the same
 * question about the same list, and a second idiom for the second half of that
 * question is one more thing to learn.
 */
export function SortBar({ fields, sort, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useOutsideClick(box, () => setOpen(false), open);

  const add = (field: FilterField) => {
    onChange([...sort, newSortRule(field)]);
    setOpen(false);
  };

  const set = (id: string, patch: Partial<SortRule>) =>
    onChange(sort.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  // A field already sorted on is not offered again: two rules on one field is
  // the second one never being consulted.
  const used = new Set(sort.map((s) => s.field));
  const free = fields.filter((f) => !used.has(f.key));

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {sort.map((rule) => {
        const field = fields.find((f) => f.key === rule.field);
        if (!field) return null;
        return (
          <span
            key={rule.id}
            className="flex h-7 shrink-0 items-center gap-0.5 rounded-md border border-line bg-surface px-1 text-xs"
          >
            {/* The same inline picker the filter chips use — this was the one
                native select left in the toolbar, so the two bars sitting
                inches apart drew two different menus. */}
            <SearchSelect
              variant="inline"
              label="Sort by"
              value={rule.field}
              options={[field, ...free].map((f) => ({ value: f.key, label: f.label }))}
              onChange={(key) => set(rule.id, { field: key })}
            />
            <button
              type="button"
              aria-label={rule.dir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
              onClick={() => set(rule.id, { dir: rule.dir === 'asc' ? 'desc' : 'asc' })}
              className="flex h-5 items-center gap-1 rounded px-1 text-2xs text-muted hover:bg-hover hover:text-ink"
            >
              {rule.dir === 'asc' ? <ArrowUpNarrowWide size={12} /> : <ArrowDownNarrowWide size={12} />}
              {/* The words, not only the arrow: which way an arrow points is a
                  coin flip for dates and a guess for text. */}
              {orderWords(field)[rule.dir === 'asc' ? 0 : 1]}
            </button>
            <button
              type="button"
              aria-label={`Remove sort by ${field.label}`}
              onClick={() => onChange(sort.filter((s) => s.id !== rule.id))}
              className="flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-hover hover:text-danger"
            >
              <X size={12} />
            </button>
          </span>
        );
      })}

      <div ref={box} className="relative shrink-0">
        <button
          type="button"
          aria-expanded={open}
          disabled={!free.length}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex h-7 items-center gap-1 rounded-md px-2 text-xs transition-colors disabled:opacity-40',
            sort.length ? 'text-muted hover:bg-hover hover:text-ink' : 'text-faint hover:bg-hover hover:text-ink',
          )}
        >
          {sort.length ? <Plus size={13} /> : <ArrowUpDown size={13} />}
          Sort
          {sort.length > 0 && <span className="tabular-nums text-faint">{sort.length}</span>}
        </button>
        {open && (
          <div className="scrollarea absolute left-0 top-8 z-30 max-h-64 w-56 overflow-y-auto rounded-lg border border-line bg-canvas p-1 shadow-pop">
            {free.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => add(f)}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs text-ink hover:bg-hover"
              >
                {f.label}
              </button>
            ))}
            {!free.length && <p className="px-2 py-2 text-2xs text-faint">Everything is sorted already.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/** What ascending and descending mean for this kind of field, in words. */
function orderWords(field: FilterField): [string, string] {
  switch (field.kind) {
    case 'date': return ['oldest first', 'newest first'];
    case 'number': return ['lowest first', 'highest first'];
    case 'checkbox': return ['unchecked first', 'checked first'];
    case 'select':
    case 'multi_select': return ['in order', 'reversed'];
    default: return ['A → Z', 'Z → A'];
  }
}
