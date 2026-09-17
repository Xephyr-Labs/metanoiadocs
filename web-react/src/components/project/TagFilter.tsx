import { useRef, useState } from 'react';
import { Tag } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import { swatch } from '../../lib/tagColors';
import { splitValues, tagFilterOf, withTagFilter, type Filter } from '../../lib/taskFilter';
import { CheckList } from '../ui/CheckList';

/**
 * Filtering by focus area, one click away.
 *
 * It was always possible — "Focus area" is a field like any other — but it was
 * the twelfth option in a dropdown behind "+ Filter", which is the same as not
 * being there. Tags are how people ask "what is Marketing working on", so they
 * get their own button.
 *
 * This is a shortcut, not a second filter: it reads and writes the one
 * `tags is any of …` chip in the same list, so the bar still shows what is
 * narrowing the view and Clear still clears it.
 */
export function TagFilter({ tags, filters, onChange }: {
  tags: { id: string; name: string; color: string; count?: number }[];
  filters: Filter[];
  onChange: (next: Filter[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useOutsideClick(box, () => setOpen(false));

  if (!tags.length) return null;

  const current = tagFilterOf(filters);
  const chosen = current ? splitValues(current.value) : [];
  const write = (next: string[]) => onChange(withTagFilter(filters, next));

  // Tags are OR, not AND: picking Marketing and Design asks for work under
  // either, which is what clicking two tags means everywhere else.
  const toggle = (name: string) =>
    write(chosen.includes(name) ? chosen.filter((v) => v !== name) : [...chosen, name]);

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-7 items-center gap-1 rounded-md px-2 text-xs transition-colors',
          chosen.length
            ? 'bg-accent-soft text-accent-strong'
            : 'text-muted hover:bg-hover hover:text-ink',
        )}
      >
        <Tag size={14} />
        {chosen.length === 1 ? chosen[0] : chosen.length ? `${chosen.length} tags` : 'Tag'}
      </button>
      {open && (
        <CheckList
          className="absolute left-0 top-8 z-30 w-56 shadow-pop"
          options={tags.map((t) => ({
            value: t.name,
            label: t.name,
            lead: <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', swatch(t.color).dot)} />,
            trail: t.count ? <span className="shrink-0 text-2xs text-faint">{t.count}</span> : undefined,
          }))}
          chosen={chosen}
          onToggle={toggle}
          onClear={() => write([])}
          empty="No tags yet."
        />
      )}
    </div>
  );
}
