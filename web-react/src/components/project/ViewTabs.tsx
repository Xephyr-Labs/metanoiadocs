/* Hallmark · component: saved view tabs · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default · hover · active · focus-visible · renaming · menu open ·
 *         adding · last view (delete refused) · overflowing (scrolls)
 */
import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays, Copy, GanttChartSquare, KanbanSquare, LayoutGrid, ListTodo,
  MoreHorizontal, Pencil, Plus, Shapes, Table2, Trash2,
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
 * assignee" — that happens to be drawn as a board. Which is why a view can be
 * renamed, duplicated and deleted, and why two of them can be boards.
 */
export function ViewTabs({
  views, activeId, kinds, onSelect, onCreate, onRename, onRetype, onDuplicate, onDelete,
}: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    <div className="scrollarea flex min-w-0 items-center gap-0.5 overflow-x-auto">
      {views.map((view) => {
        const Icon = ICON[view.kind] ?? Table2;
        const active = view.id === activeId;
        return (
          <div key={view.id} className="group/tab flex shrink-0 items-center">
            {renaming === view.id ? (
              <RenameBox
                value={view.name}
                onCommit={(name) => { setRenaming(null); if (name && name !== view.name) onRename(view.id, name); }}
                onCancel={() => setRenaming(null)}
              />
            ) : (
              <button
                type="button"
                onClick={() => (active ? setRenaming(view.id) : onSelect(view.id))}
                // The active tab renames on a second click, the way a file name
                // does — a rename nobody can find is a rename nobody makes.
                title={active ? 'Click again to rename' : undefined}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors duration-120',
                  active ? 'bg-selected font-medium text-ink' : 'text-muted hover:bg-hover hover:text-ink',
                )}
              >
                <Icon size={13} className="shrink-0" />
                <span className="max-w-[10rem] truncate">{view.name}</span>
              </button>
            )}
            {active && (
              <Menu
                align="start"
                trigger={
                  <span>
                    <IconButton size="sm" icon={<MoreHorizontal size={14} />} label={`Settings for ${view.name}`} />
                  </span>
                }
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
            )}
          </div>
        );
      })}

      <Menu
        align="start"
        trigger={<span><IconButton size="sm" icon={<Plus size={14} />} label="Add a view" /></span>}
        items={kinds.map((k) => ({ icon: ICON[k], label: VIEW_KIND_LABEL[k], onSelect: () => onCreate(k) }))}
      />
    </div>
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
      className="h-7 w-32 rounded-md bg-surface px-2 text-xs text-ink outline-none ring-1 ring-inset ring-accent"
    />
  );
}
