/* Hallmark · component: board grouping picker · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default · hover · focus-visible · open · chosen · nothing groupable
 */
import { Columns3 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { canGroupBy } from '../../lib/grouping';
import type { FilterField } from '../../lib/taskFilter';
import { Menu } from '../ui/Menu';

/**
 * What the board's columns stand for.
 *
 * It was always status, because `Board` mapped over the four statuses. "Show
 * me this sprint by assignee" is an ordinary question a kanban board is the
 * natural answer to, and it could not be asked.
 *
 * Only select-shaped fields are offered — see `canGroupBy`. A date would need
 * bucketing first (by day? week? month?) and free text would give one column
 * per row, which is a listing rather than a grouping.
 */
export function GroupBy({ fields, value, onChange }: {
  fields: FilterField[];
  value: string | null;
  onChange: (field: string | null) => void;
}) {
  const groupable = fields.filter(canGroupBy);
  if (!groupable.length) return null;
  const current = groupable.find((f) => f.key === value) ?? null;

  return (
    <Menu
      align="start"
      trigger={
        <button
          type="button"
          className={cn(
            'flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs transition-colors',
            'text-muted hover:bg-hover hover:text-ink',
          )}
        >
          <Columns3 size={13} />
          {/* The field's name, not the word "Group": the answer is more useful
              on a toolbar than the question. */}
          {current ? current.label : 'Group'}
        </button>
      }
      items={groupable.map((f) => ({
        label: f.label,
        checked: f.key === (current?.key ?? null),
        onSelect: () => onChange(f.key),
      }))}
    />
  );
}
