/* Hallmark · component: assignee picker · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E5 S5 R5 V4
 * states: default · hover · focus-visible · open · searching · no matches ·
 *         nobody in the workspace · empty · chosen · removing
 */
import { createPortal } from 'react-dom';
import { useRef, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { avatarFor } from '../../lib/avatar';
import { cn } from '../../lib/cn';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import type { UserRow } from '../../lib/docsApi';
import type { Assignee } from '../../lib/tasksApi';

interface Props {
  assignees: Assignee[];
  users: UserRow[];
  /** The whole list, every time — the API replaces what it is sent. */
  onChange: (ids: string[]) => void;
}

const nameOf = (u: UserRow) => u.name || u.username;

/**
 * Everyone on a task: a chip each, and a menu that adds one more.
 *
 * This used to be a native `<select>` sitting under the chips — a whole 32px
 * row spent on an empty control in the peek, and in a table cell a 28px-wide
 * stub showing nothing but a chevron, because its only label ("+") lived
 * inside an `<option>` the platform never draws. Both looked like a rendering
 * fault rather than a control.
 *
 * So it is the same shape as every other multi-value cell in the app (see
 * SelectValue, TagsCell): the value IS the trigger, chips are drawn in place,
 * and a "+" at the end of them says another name can go here. One grammar for
 * the grid, which is also what makes the column line up with its neighbours.
 */
export function AssigneePicker({ assignees, users, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const pop = useRef<HTMLDivElement>(null);
  // Portalled and fixed: this opens inside a scrolling grid and inside the
  // peek panel, both of which clip an absolutely positioned menu.
  const { anchor, style } = useAnchoredPopover(open);
  useOutsideClick(pop, () => setOpen(false), open);

  const ids = assignees.map((a) => a.id);
  const chosen = new Set(ids);
  const q = query.trim().toLowerCase();
  const matches = q ? users.filter((u) => nameOf(u).toLowerCase().includes(q)) : users;

  const toggle = (id: string) => onChange(chosen.has(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Assignees"
        onClick={() => { setQuery(''); setOpen((v) => !v); }}
        className={cn(
          'group/asg flex h-7 w-full min-w-0 items-center gap-1 rounded border border-transparent px-2.5 text-left text-sm',
          'transition-colors hover:border-line focus:border-accent focus:outline-none',
        )}
      >
        {assignees.length ? (
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {assignees.map((a) => <Chip key={a.id} name={a.name} />)}
            {/* The affordance the old stub select was trying to be. It rides
                at the end of the chips instead of on a row of its own. */}
            <Plus
              size={12}
              className="shrink-0 text-faint opacity-0 transition-opacity duration-120 group-hover/asg:opacity-100 group-focus/asg:opacity-100"
            />
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-faint">Empty</span>
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
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'Enter' && matches[0]) { e.preventDefault(); toggle(matches[0].id); }
            }}
            placeholder="Search people…"
            className="mb-1 h-7 w-full shrink-0 rounded-md bg-surface px-2 text-xs text-ink outline-none ring-1 ring-inset ring-line placeholder:text-faint focus:ring-2 focus:ring-accent"
          />
          <div className="scrollarea min-h-0 flex-1 overflow-y-auto">
            {matches.map((u) => {
              const name = nameOf(u);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggle(u.id)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-hover"
                >
                  <Avatar name={name} />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">{name}</span>
                  {chosen.has(u.id) && <Check size={14} className="shrink-0 text-accent-strong" />}
                </button>
              );
            })}
            {!matches.length && (
              <p className="px-2 py-2 text-2xs text-faint">
                {users.length ? 'Nobody matches.' : 'Nobody else in this workspace yet.'}
              </p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function Avatar({ name, size = 16 }: { name: string; size?: number }) {
  const a = avatarFor(name);
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ background: a.color, width: size, height: size, fontSize: size <= 16 ? 8 : 9 }}
    >
      {a.initials}
    </span>
  );
}

/** A name as it reads in a cell. Removal happens in the menu, where the whole
 *  list is visible — an × on a chip inside the trigger would be a button
 *  nested in a button. */
function Chip({ name }: { name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1 rounded-full border border-line py-0.5 pl-0.5 pr-1.5 text-2xs text-ink">
      <Avatar name={name} />
      <span className="max-w-[120px] truncate">{name}</span>
    </span>
  );
}
