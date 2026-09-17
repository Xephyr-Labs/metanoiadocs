/* Hallmark · component: saved view tabs · genre: modern-minimal
 * pre-emit critique: P5 H5 E5 S5 R5 V4
 * theme: project tokens (index.css)
 * states: default · hover · active · focus-visible · renaming · menu open ·
 *         adding · last view (delete refused) · overflowing (scrolls)
 * note: every tab reserves the same chrome, so switching never moves the strip.
 */
import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays, ChevronDown, Copy, GanttChartSquare, KanbanSquare, LayoutGrid,
  ListTodo, Pencil, Plus, PieChart, Shapes, Table2, Trash2,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import { VIEW_KIND_LABEL, type ViewKind, type ViewRow } from '../../lib/tasksApi';
import { IconButton } from '../ui/IconButton';
import { Menu } from '../ui/Menu';

const ICON: Record<ViewKind, typeof Table2> = {
  backlog: ListTodo,
  board: KanbanSquare,
  table: Table2,
  gantt: GanttChartSquare,
  calendar: CalendarDays,
  gallery: LayoutGrid,
  dashboard: PieChart,
};

interface Props {
  views: ViewRow[];
  activeId: string | null;
  /** Kinds this database can show. A data database has no status, people or
   *  schedule, so three of the six would draw nothing. */
  kinds: ViewKind[];
  onSelect: (id: string) => void;
  onCreate: (kind: ViewKind) => void;
  onRename: (id: string, name: string) => void;
  onRetype: (id: string, kind: ViewKind) => void;
  onDuplicate: (view: ViewRow) => void;
  onDelete: (id: string) => void;
}

/**
 * The saved views, as tabs.
 *
 * This replaces a six-segment control over the six view *types*. The
 * difference is the whole point: a type was a way of looking at everything,
 * and a view is a saved question — "This sprint", "Blocked", "Mine, by
 * assignee" — that happens to be drawn as a board.
 *
 * The active tab IS its own menu button: clicking a tab you are not on selects
 * it, clicking the one you are on opens its settings. That is one control
 * rather than a tab plus a ⋯ beside it — and the ⋯ beside it was the bug. It
 * rendered only while a tab was active, inside the strip's flow, so switching
 * views shifted every tab to its right by 24px and the second click of a
 * double-click landed on a different tab than the first. The chevron slot is
 * drawn on every tab, transparent until it means something, so the strip's
 * geometry never depends on which view is open.
 */
export function ViewTabs({
  views, activeId, kinds, onSelect, onCreate, onRename, onRetype, onDuplicate, onDelete,
}: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    // gap-2 between tabs against gap-1.5 inside one: proximity has to say that
    // an icon belongs to the label beside it and not to the tab after it.
    // At 2px they read as a single run of words.
    <div className="scrollarea flex min-w-0 items-center gap-2 overflow-x-auto pr-1">
      {views.map((view) => {
        const active = view.id === activeId;

        if (renaming === view.id) {
          return (
            <RenameBox
              key={view.id}
              value={view.name}
              onCommit={(name) => { setRenaming(null); if (name && name !== view.name) onRename(view.id, name); }}
              onCancel={() => setRenaming(null)}
            />
          );
        }

        const tab = (
          <button
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={active ? undefined : () => onSelect(view.id)}
            className={cn(
              'flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors duration-120',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              active ? 'bg-selected font-medium text-ink' : 'text-muted hover:bg-hover hover:text-ink',
            )}
          >
            <TabIcon kind={view.kind} />
            <span className="max-w-[10rem] truncate">{view.name}</span>
            {/* Always in the layout, visible only on the tab it acts on. A
                control that appears and disappears inside a flex row is a
                control that moves everything after it. */}
            <ChevronDown
              size={12}
              aria-hidden
              className={cn('shrink-0 transition-opacity', active ? 'opacity-60' : 'opacity-0')}
            />
          </button>
        );

        // Clicking the tab you are already on opens its settings — so the
        // chevron is a promise the control keeps, and rename has one home.
        return active ? (
          <Menu
            key={view.id}
            align="start"
            trigger={tab}
            items={[
              { icon: Pencil, label: 'Rename', onSelect: () => setRenaming(view.id) },
              {
                icon: Shapes,
                label: 'Change type',
                items: kinds.map((k) => ({
                  icon: ICON[k],
                  label: VIEW_KIND_LABEL[k],
                  checked: k === view.kind,
                  onSelect: () => onRetype(view.id, k),
                })),
              },
              // A copy carries the filters — which is how you keep one and
              // try a different question on the other.
              { icon: Copy, label: 'Duplicate', onSelect: () => onDuplicate(view) },
              {
                icon: Trash2,
                label: 'Delete view',
                danger: true,
                separatorBefore: true,
                onSelect: () => onDelete(view.id),
              },
            ]}
          />
        ) : (
          <span key={view.id} className="shrink-0">{tab}</span>
        );
      })}

      {/* ml-1 on top of the row gap: a new-view button is not a seventh view,
          and at the same spacing it read as one. */}
      <span className="ml-1 shrink-0">
        <Menu
          align="start"
          trigger={<span><IconButton size="sm" icon={<Plus size={14} />} label="Add a view" /></span>}
          items={kinds.map((k) => ({ icon: ICON[k], label: VIEW_KIND_LABEL[k], onSelect: () => onCreate(k) }))}
        />
      </span>
    </div>
  );
}

/**
 * The view's icon, nudged up a pixel.
 *
 * Geometric centring measures exactly right and looks wrong: a 13px glyph
 * centred on an 18px line box sits below the text's cap height, which is where
 * the eye reads the line. Optical centring is a pixel, and it is the
 * difference between "aligned" and "slightly off" without anyone being able to
 * say why.
 */
/**
 * The icon, in a box that centres on whole pixels.
 *
 * It used to be a bare 13px glyph with `-translate-y-px` for optical balance.
 * Both halves of that were the bug: 13 is odd, so centring it in a 28px row
 * put its top edge on x.5, and the nudge moved it to another half pixel rather
 * than off one. Where a half pixel lands depends on where the strip itself
 * starts, and that moves the moment the task panel opens and the column
 * narrows — so the icons looked aligned, then didn't, for no reason anyone
 * could see from the markup.
 *
 * A 14px glyph in a fixed 14px box divides into the row evenly, and the
 * optical correction, if it is ever wanted again, belongs on the box as a
 * whole-pixel margin — never on a transform.
 */
function TabIcon({ kind }: { kind: ViewKind }) {
  const Icon = ICON[kind] ?? Table2;
  return (
    <span aria-hidden className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      <Icon size={14} />
    </span>
  );
}

/** Renaming in place. Escape abandons, Enter and blur commit — the same three
 *  keys every other inline rename in the app answers to. */
function RenameBox({ value, onCommit, onCancel }: {
  value: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.select(); }, []);
  return (
    <input
      ref={ref}
      autoFocus
      defaultValue={value}
      onBlur={(e) => onCommit(e.target.value.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { e.currentTarget.value = value; onCancel(); }
      }}
      aria-label="View name"
      className="h-7 w-32 shrink-0 rounded-md bg-surface px-2 text-xs text-ink outline-none ring-1 ring-inset ring-accent"
    />
  );
}
