/* Hallmark · component: searchable picker · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default · hover · focus-visible · open · searching · no matches ·
 *         empty list · disabled · chosen
 */
import { createPortal } from 'react-dom';
import { useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import { useOutsideClick } from '../../hooks/useOutsideClick';

export interface SearchOption {
  value: string;
  label: string;
  /** Secondary text on the right — a project name, a folder, a date. */
  hint?: string;
  lead?: ReactNode;
}

/**
 * A `<select>` for a list nobody can read at a glance.
 *
 * "Link a page" over two hundred documents, "depends on" over every task in
 * the project, "link a row" over another database — all of them were native
 * selects, which means scrolling an alphabetical list with no way to type at
 * it. The moment a workspace has more than a screenful of anything, that
 * control stops working, and these are exactly the lists that grow.
 *
 * Deliberately not a combobox that creates: choosing an existing thing and
 * making a new one are different decisions, and the places that offer both
 * (the "@" menu) say so with two groups rather than one ambiguous input.
 *
 * Three shapes, one control. `field` is a form row, `bare` a property rail or
 * a grid cell, `inline` a segment inside a chip (a filter's field, its
 * operator). The alternative was a second picker for the short lists, which is
 * how the app ended up with twenty-two native `<select>`s in the first place:
 * a menu the platform draws agrees with nothing around it, cannot be themed at
 * all once it is open, and puts its own chevron at its own distance.
 */
export function SearchSelect({
  value,
  options,
  placeholder = 'Choose…',
  empty = 'Nothing to choose from.',
  disabled,
  variant = 'field',
  searchable,
  label,
  onChange,
  className,
}: {
  value: string | null;
  options: SearchOption[];
  placeholder?: string;
  empty?: string;
  disabled?: boolean;
  /**
   * `field` — a boxed 32px form control.
   * `bare` — no box until the pointer is on it, for a property rail or a grid
   *   cell, where a permanent hairline on every row turns a list of values
   *   into a stack of empty form fields.
   * `inline` — a 24px segment sized to its own text, for the inside of a chip.
   */
  variant?: 'field' | 'bare' | 'inline';
  /** Force the search box on or off. Default: on once the list is long enough
   *  that reading it is the slower way to find something. */
  searchable?: boolean;
  /** Accessible name, where the surrounding chip is the only visible label. */
  label?: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const pop = useRef<HTMLDivElement>(null);
  const inline = variant === 'inline';
  const { anchor, style } = useAnchoredPopover(open, inline ? 200 : 260);
  useOutsideClick(pop, () => setOpen(false), open);

  // Six or fewer is faster to read than to type at, and a search box over four
  // operators is furniture.
  const search = searchable ?? options.length > 6;

  const q = query.trim().toLowerCase();
  const matches = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q))
    : options;
  const chosen = options.find((o) => o.value === value) ?? null;

  const choose = (next: string) => {
    onChange(next);
    setQuery('');
    setOpen(false);
  };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => { setQuery(''); setOpen((v) => !v); }}
        className={cn(
          'group/ss flex min-w-0 items-center text-left transition-shadow duration-120',
          'focus:outline-none disabled:opacity-50',
          variant === 'field' && 'h-8 w-full gap-1.5 rounded-md bg-surface px-2.5 text-sm ring-1 ring-inset ring-line focus:ring-2 focus:ring-accent',
          variant === 'bare' && 'h-7 w-full gap-1.5 rounded bg-transparent px-2.5 text-sm ring-1 ring-inset ring-transparent hover:ring-line focus:ring-2 focus:ring-accent',
          inline && 'h-6 max-w-[10rem] gap-1 rounded bg-transparent px-1 text-xs hover:bg-hover focus:bg-canvas focus:ring-1 focus:ring-accent',
          className,
        )}
      >
        {chosen?.lead}
        <span className={cn('min-w-0 flex-1 truncate', chosen ? 'text-ink' : 'text-faint')}>
          {chosen?.label ?? placeholder}
        </span>
        {/* On a rail the chevron is the only thing saying a plain line of text
            is a control, so it shows on hover rather than never — but a rail
            of fourteen permanent chevrons is the noise this avoids. */}
        <ChevronDown
          size={inline ? 12 : 14}
          className={cn(
            'shrink-0 text-faint',
            variant === 'bare' && 'opacity-0 transition-opacity duration-120 group-hover/ss:opacity-100 group-focus/ss:opacity-100',
          )}
        />
      </button>

      {open && style && createPortal(
        <div
          ref={pop}
          style={style}
          className="scrollarea z-50 flex flex-col overflow-hidden rounded-lg border border-line bg-canvas p-1.5 shadow-pop"
        >
          {search && (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
                if (e.key === 'Enter' && matches[0]) { e.preventDefault(); choose(matches[0].value); }
              }}
              placeholder="Search…"
              className="mb-1 h-7 w-full shrink-0 rounded-md bg-surface px-2 text-xs text-ink outline-none ring-1 ring-inset ring-line placeholder:text-faint focus:ring-2 focus:ring-accent"
            />
          )}
          <div className="scrollarea min-h-0 flex-1 overflow-y-auto">
            {matches.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => choose(o.value)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-hover"
              >
                {o.lead}
                <span className="min-w-0 flex-1 truncate text-xs text-ink">{o.label}</span>
                {o.hint && <span className="shrink-0 truncate text-2xs text-faint">{o.hint}</span>}
                {o.value === value && <Check size={14} className="shrink-0 text-accent-strong" />}
              </button>
            ))}
            {!matches.length && (
              <p className="px-2 py-2 text-2xs text-faint">{options.length ? 'Nothing matches.' : empty}</p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
