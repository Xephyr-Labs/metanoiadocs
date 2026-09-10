import { X } from 'lucide-react';
import { avatarFor } from '../../lib/avatar';
import { cn } from '../../lib/cn';
import type { UserRow } from '../../lib/docsApi';
import type { Assignee } from '../../lib/tasksApi';
import { selectField } from '../ui/styles';

interface Props {
  assignees: Assignee[];
  users: UserRow[];
  /** The whole list, every time — the API replaces what it is sent. */
  onChange: (ids: string[]) => void;
  /** Table cells have one line to work with; a row's page has room to breathe. */
  compact?: boolean;
}

const nameOf = (u: UserRow) => u.name || u.username;

/**
 * Everyone on a task: a chip each, and a picker that adds one more. Same shape
 * as the "Depends on" list a few fields down — chips plus a select — so there
 * is one way to build a list of things in this panel, not two.
 */
export function AssigneePicker({ assignees, users, onChange, compact }: Props) {
  const ids = assignees.map((a) => a.id);
  const free = users.filter((u) => !ids.includes(u.id));

  return (
    <div className="min-w-0">
      {assignees.length > 0 && (
        <div className={cn('flex flex-wrap gap-1', compact ? 'mb-0.5' : 'mb-1.5')}>
          {assignees.map((a) => {
            const avatar = avatarFor(a.name);
            return (
              <span
                key={a.id}
                className="flex items-center gap-1 rounded-full border border-line py-0.5 pl-0.5 pr-1.5 text-2xs text-ink"
              >
                <span
                  aria-hidden
                  className="flex h-4 w-4 items-center justify-center rounded-full text-3xs font-semibold text-white"
                  style={{ background: avatar.color }}
                >
                  {avatar.initials}
                </span>
                <span className="max-w-[120px] truncate">{a.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  className="text-faint hover:text-danger"
                  onClick={() => onChange(ids.filter((id) => id !== a.id))}
                >
                  <X size={11} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <select
        className={cn(selectField, 'cursor-pointer text-muted', compact && 'h-6 py-0 text-2xs')}
        aria-label="Add an assignee"
        value=""
        disabled={!free.length}
        onChange={(e) => e.target.value && onChange([...ids, e.target.value])}
      >
        <option value="">{assignees.length ? 'Add someone…' : 'Unassigned'}</option>
        {free.map((u) => <option key={u.id} value={u.id}>{nameOf(u)}</option>)}
      </select>
    </div>
  );
}
