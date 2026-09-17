/* Hallmark · component: property visibility panel · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S4 R5 V4
 * states: default · hover · focus-visible · active · disabled (list ends) ·
 *         open · searching · empty (both sections)
 */
import { useRef, useState } from 'react';
import {
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CheckSquare,
  Eye,
  EyeOff,
  Hash,
  Link as LinkIcon,
  ListChecks,
  Mail,
  Paperclip,
  Phone,
  Sigma,
  SlidersHorizontal,
  Type,
  User,
} from 'lucide-react';
import { cn } from '../../../lib/cn';
import { useOutsideClick } from '../../../hooks/useOutsideClick';
import { isBuiltinProp } from '../../../lib/builtinProps';
import type { PropRow, PropType } from '../../../lib/tasksApi';

/** The type's icon, so a list of names is scannable by shape as well as text. */
const ICON: Record<PropType, typeof Type> = {
  text: Type,
  number: Hash,
  select: ListChecks,
  multi_select: ListChecks,
  date: CalendarDays,
  checkbox: CheckSquare,
  person: User,
  url: LinkIcon,
  email: Mail,
  phone: Phone,
  file: Paperclip,
  relation: ArrowUpRight,
  formula: Sigma,
  rollup: Sigma,
};

/**
 * Which properties this view puts on its cards.
 *
 * Per view, not per project: a calendar cell has room for two chips and a
 * gallery tile for six, so one shared list would be wrong in both places.
 * Shown properties are ordered — the order here is the order on the card,
 * which is why they can be moved rather than just ticked.
 */
export function PropertyVisibility({
  view,
  visible,
  hidden,
  onToggle,
  onMove,
  onShowAll,
  onHideAll,
}: {
  /** Named in the section headings, the way Notion says "Shown in calendar". */
  view: string;
  visible: PropRow[];
  hidden: PropRow[];
  onToggle: (id: string) => void;
  onMove: (id: string, by: -1 | 1) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useOutsideClick(box, () => setOpen(false));

  if (!visible.length && !hidden.length) return null;

  const match = (p: PropRow) => p.label.toLowerCase().includes(query.trim().toLowerCase());
  const shown = visible.filter(match);
  const off = hidden.filter(match);

  // A database can define its own "Status" beside the built-in one — they are
  // genuinely two properties holding two values, so neither can be hidden or
  // renamed away. But two identical rows in a list of toggles is a coin flip.
  // Mark them only where the clash is real: adding "Built-in" to all eleven
  // would be noise on rows nothing is competing with.
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const p of [...visible, ...hidden]) {
    const key = p.label.toLowerCase();
    if (seen.has(key)) twice.add(key);
    seen.add(key);
  }
  const ambiguous = (p: PropRow) => twice.has(p.label.toLowerCase());

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-7 items-center gap-1 rounded-md px-2 text-xs transition-colors',
          visible.length ? 'text-muted hover:bg-hover hover:text-ink' : 'text-faint hover:bg-hover hover:text-ink',
        )}
      >
        <SlidersHorizontal size={14} />
        Properties
        {visible.length > 0 && <span className="tabular-nums text-faint">{visible.length}</span>}
      </button>

      {open && (
        <div className="absolute left-0 top-8 z-30 w-72 rounded-lg border border-line bg-canvas p-1.5 shadow-pop">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a property…"
            className="mb-1 h-7 w-full rounded-md border border-line bg-surface px-2 text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none"
          />

          <Section
            title={`Shown in ${view}`}
            action={shown.length ? { label: 'Hide all', onClick: onHideAll } : undefined}
            empty="Nothing on the cards yet."
            rows={shown}
          >
            {(p, i) => (
              <Row
                key={p.id}
                prop={p}
                shown
                ambiguous={ambiguous(p)}
                canUp={i > 0}
                canDown={i < shown.length - 1}
                onMove={onMove}
                onToggle={onToggle}
              />
            )}
          </Section>

          <Section
            title={`Hidden in ${view}`}
            action={off.length ? { label: 'Show all', onClick: onShowAll } : undefined}
            empty="Everything is shown."
            rows={off}
          >
            {(p) => <Row key={p.id} prop={p} shown={false} ambiguous={ambiguous(p)} onToggle={onToggle} />}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  action,
  empty,
  rows,
  children,
}: {
  title: string;
  action?: { label: string; onClick: () => void };
  empty: string;
  rows: PropRow[];
  children: (p: PropRow, i: number) => React.ReactNode;
}) {
  return (
    <div className="mb-1">
      <div className="flex items-center justify-between px-1.5 py-1">
        <span className="text-2xs font-semibold uppercase tracking-wide text-faint">{title}</span>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="rounded px-1 text-2xs text-accent-strong hover:bg-hover"
          >
            {action.label}
          </button>
        )}
      </div>
      {rows.length ? rows.map(children) : <p className="px-1.5 pb-1 text-2xs text-faint">{empty}</p>}
    </div>
  );
}

function Row({
  prop,
  shown,
  ambiguous,
  canUp,
  canDown,
  onMove,
  onToggle,
}: {
  prop: PropRow;
  shown: boolean;
  /** Another property in this list carries the same label. */
  ambiguous?: boolean;
  canUp?: boolean;
  canDown?: boolean;
  onMove?: (id: string, by: -1 | 1) => void;
  onToggle: (id: string) => void;
}) {
  const Icon = ICON[prop.type] ?? Type;
  return (
    <div className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-hover">
      {/* Arrows rather than a drag handle: this list is at most a dozen rows,
          and two buttons are reachable by keyboard, which a drag is not. */}
      {onMove ? (
        <span className="flex w-4 shrink-0 flex-col items-center opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            disabled={!canUp}
            aria-label={`Move ${prop.label} up`}
            onClick={() => onMove(prop.id, -1)}
            className="flex h-3 w-4 items-center justify-center rounded text-faint hover:bg-hover hover:text-ink disabled:opacity-25 disabled:hover:bg-transparent"
          >
            <ChevronUp size={12} />
          </button>
          <button
            type="button"
            disabled={!canDown}
            aria-label={`Move ${prop.label} down`}
            onClick={() => onMove(prop.id, 1)}
            className="flex h-3 w-4 items-center justify-center rounded text-faint hover:bg-hover hover:text-ink disabled:opacity-25 disabled:hover:bg-transparent"
          >
            <ChevronDown size={12} />
          </button>
        </span>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <Icon size={14} className="shrink-0 text-faint" />
      <span className="min-w-0 flex-1 truncate text-xs text-ink">
        {prop.label}
        {ambiguous && (
          <span className="ml-1.5 text-2xs text-faint">
            {isBuiltinProp(prop.id) ? 'built-in' : 'yours'}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => onToggle(prop.id)}
        aria-label={`${shown ? 'Hide' : 'Show'} ${prop.label}`}
        className="shrink-0 rounded p-0.5 text-faint transition-colors hover:bg-hover hover:text-ink"
      >
        {shown ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
    </div>
  );
}
