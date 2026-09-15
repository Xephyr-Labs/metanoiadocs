/* Hallmark · component: select / multi-select value editor · genre: modern-minimal
 * theme: project tokens (index.css) + tag palette (lib/tagColors)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default · hover · focus-visible · open · searching · creating ·
 *         recolouring · empty (no options) · read-only (no editor passed)
 */
import { createPortal } from 'react-dom';
import { useRef, useState } from 'react';
import { Check, Palette, Plus, Trash2, X } from 'lucide-react';
import { cn } from '../../../lib/cn';
import { useAnchoredPopover } from '../../../hooks/useAnchoredPopover';
import { useOutsideClick } from '../../../hooks/useOutsideClick';
import { selectedOptions } from '../../../lib/props';
import { swatch, TAG_COLORS, type TagColor } from '../../../lib/tagColors';
import type { PropOption, PropRow } from '../../../lib/tasksApi';

/**
 * Picking, making and colouring an option, in the one place the value lives.
 *
 * A bare `<select>` could only ever offer what the property already had, so
 * adding an option meant leaving the row, opening Properties, typing it,
 * closing, and coming back — which is why in practice nobody added one and
 * every select stayed on the three values it was born with. The colour field
 * had the same problem one level down: it existed, in a dialog, behind a
 * different door from the chip it paints.
 *
 * So the menu that sets the value also creates, renames, recolours and deletes
 * the options. `onEditOptions` is what turns that half on — a built-in whose
 * options come from somewhere else (a project's task types, its sprints) hands
 * its own editor instead, and this stays a picker.
 */
export function SelectValue({
  prop,
  value,
  multi,
  onChange,
  onEditOptions,
  fixed,
  placeholder = 'Empty',
}: {
  prop: PropRow;
  value: unknown;
  /** Several at once. Single-pick closes on choice; multi stays open. */
  multi: boolean;
  onChange: (value: unknown) => void;
  /** Persist a change to the property's own option list. Omit to hide the
   *  create/rename/recolour/delete affordances entirely. */
  onEditOptions?: (options: PropOption[]) => void;
  /** The set of options is fixed — only their colour can change. The four task
   *  statuses are the case: every board column, filter and rollup in the app is
   *  written against those four ids, so they can be repainted but not invented
   *  or removed. */
  fixed?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Which option is showing its palette. One at a time: two open palettes in a
  // 240px menu is 18 dots and no way to tell which row you are painting.
  const [painting, setPainting] = useState<string | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  // Portalled and fixed: this control lives in a table cell inside a scrolling
  // grid, and an absolutely positioned menu is clipped by that scroll box —
  // which is how the options of the last visible row became unreachable.
  const { anchor, style } = useAnchoredPopover(open);
  useOutsideClick(pop, () => setOpen(false), open);

  const chosen = selectedOptions(prop, value);
  const chosenIds = new Set(chosen.map((o) => o.id));
  const q = query.trim();
  const matches = prop.options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  const exact = prop.options.some((o) => o.label.toLowerCase() === q.toLowerCase());

  const setOptions = (next: PropOption[]) => onEditOptions?.(next);
  const canAdd = !!onEditOptions && !fixed;

  const pick = (id: string) => {
    if (!multi) {
      onChange(chosenIds.has(id) ? null : id);
      setOpen(false);
      return;
    }
    const next = new Set(chosenIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  /** A new option lands on the task that asked for it, not just in the list. */
  const create = () => {
    if (!q || exact || !canAdd) return;
    const option: PropOption = { id: crypto.randomUUID(), label: q, color: nextColor(prop.options) };
    setOptions([...prop.options, option]);
    setQuery('');
    if (multi) onChange([...chosenIds, option.id]);
    else {
      onChange(option.id);
      setOpen(false);
    }
  };

  const recolour = (id: string, color: TagColor) =>
    setOptions(prop.options.map((o) => (o.id === id ? { ...o, color } : o)));

  /** Renaming keeps the id, so every task already holding it keeps its chip. */
  const rename = (id: string, label: string) => {
    const next = label.trim();
    if (!next) return;
    setOptions(prop.options.map((o) => (o.id === id ? { ...o, label: next } : o)));
  };

  const remove = (id: string) => {
    setOptions(prop.options.filter((o) => o.id !== id));
    if (chosenIds.has(id)) onChange(multi ? [...chosenIds].filter((x) => x !== id) : null);
  };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-7 w-full min-w-0 items-center gap-1 rounded border border-transparent px-2.5 text-left text-sm',
          'transition-colors hover:border-line focus:border-accent focus:outline-none',
        )}
      >
        {chosen.length ? (
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {chosen.map((o) => (
              <span key={o.id} className={cn('truncate rounded px-1.5 py-0.5 text-2xs', swatch(o.color).chip)}>
                {o.label}
              </span>
            ))}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-faint">{placeholder}</span>
        )}
      </button>

      {open && style && createPortal(
        <div
          ref={pop}
          style={style}
          className="z-50 flex flex-col overflow-hidden rounded-lg border border-line bg-canvas p-1.5 shadow-pop"
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); create(); }
              if (e.key === 'Escape') setOpen(false);
            }}
            placeholder={canAdd ? 'Search or create…' : 'Search…'}
            className="mb-1 h-7 w-full shrink-0 rounded-md bg-surface px-2 text-xs text-ink outline-none ring-1 ring-inset ring-line placeholder:text-faint focus:ring-2 focus:ring-accent"
          />

          <div className="scrollarea min-h-0 flex-1 overflow-y-auto">
            {matches.map((o) => (
              <div key={o.id} className="group/opt rounded-md hover:bg-hover">
                <div className="flex items-center gap-1 px-1 py-0.5">
                  <button
                    type="button"
                    onClick={() => pick(o.id)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-0.5 py-1 text-left"
                  >
                    <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', swatch(o.color).dot)} />
                    {canAdd ? (
                      // The label edits in place. A rename that minted a new id
                      // would blank the property on every task holding the old
                      // one, so this writes through `rename`, which keeps it.
                      <input
                        defaultValue={o.label}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => { if (e.target.value.trim() !== o.label) rename(o.id, e.target.value); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none"
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-xs text-ink">{o.label}</span>
                    )}
                    {chosenIds.has(o.id) && <Check size={13} className="shrink-0 text-accent-strong" />}
                  </button>
                  {onEditOptions && (
                    <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/opt:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        aria-label={`Colour of ${o.label}`}
                        onClick={() => setPainting((p) => (p === o.id ? null : o.id))}
                        className="flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-hover hover:text-ink"
                      >
                        <Palette size={12} />
                      </button>
                      {canAdd && (
                        <button
                          type="button"
                          aria-label={`Delete option ${o.label}`}
                          onClick={() => remove(o.id)}
                          className="flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-hover hover:text-danger"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </span>
                  )}
                </div>
                {/* The palette is drawn inline rather than in a nested menu: a
                    second portal inside this one would count as a click
                    outside and close the whole thing on the first swatch. */}
                {painting === o.id && (
                  <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5">
                    {TAG_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={c}
                        onClick={() => { recolour(o.id, c); setPainting(null); }}
                        className={cn(
                          'h-4 w-4 rounded-full',
                          swatch(c).dot,
                          c === o.color && 'ring-2 ring-ink ring-offset-1 ring-offset-canvas',
                        )}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}

            {canAdd && q && !exact && (
              <button
                type="button"
                onClick={create}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs text-ink hover:bg-hover"
              >
                <Plus size={13} className="shrink-0 text-faint" />
                Create
                <span className={cn('rounded px-1.5 py-0.5 text-2xs', swatch(nextColor(prop.options)).chip)}>{q}</span>
              </button>
            )}

            {!matches.length && !(canAdd && q) && (
              <p className="px-2 py-2 text-2xs text-faint">
                {prop.options.length ? 'Nothing matches.' : canAdd ? 'No options yet — type to make one.' : 'No options yet.'}
              </p>
            )}
          </div>

          {chosen.length > 0 && (
            <button
              type="button"
              onClick={() => { onChange(multi ? [] : null); if (!multi) setOpen(false); }}
              className="mt-1 flex w-full shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-2xs text-faint hover:bg-hover hover:text-ink"
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * Colour for the next option: the first one not already in use, else round the
 * palette. Every option used to be minted grey, so a select of six read as six
 * identical chips.
 */
export function nextColor(options: PropOption[]): TagColor {
  const used = new Set(options.map((o) => o.color));
  return TAG_COLORS.find((c) => !used.has(c)) ?? TAG_COLORS[options.length % TAG_COLORS.length];
}
