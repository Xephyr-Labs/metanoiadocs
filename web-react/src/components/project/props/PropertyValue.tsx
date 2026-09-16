import { useState } from 'react';
import { cn } from '../../../lib/cn';
import { ExternalLink } from 'lucide-react';
import type { UserRow } from '../../../lib/docsApi';
import type { StoredFile } from '../../../lib/uploads';
import type { PropOption, PropRow } from '../../../lib/tasksApi';
import { Attachments } from '../../ui/Attachments';
import { AssigneePicker } from '../AssigneePicker';
import { cellField, field } from '../../ui/styles';
import { SelectValue } from './SelectValue';

interface Props {
  prop: PropRow;
  users: UserRow[];
  value: unknown;
  onChange: (value: unknown) => void;
  /** Persist a change to the property's own option list. Given, the select
   *  menu can also make, rename, recolour and delete options; omitted, it is
   *  a picker over whatever already exists. */
  onEditOptions?: (options: PropOption[]) => void;
  /** Draw a date in the danger colour — a due date that has passed. */
  danger?: boolean;
  /** The option set cannot grow or shrink, only be recoloured. */
  fixedOptions?: boolean;
  /**
   * Drawn inside a grid cell or the peek's property rail rather than a form:
   * no box until the pointer is on it, and the same 10px inset every other
   * control in that rail uses. See `cellField`.
   */
  dense?: boolean;
}

/**
 * A date the way the rest of the app writes one ("Sep 10"), opening the native
 * picker on click.
 *
 * A bare `<input type="date">` writes `mm/dd/yyyy` into every empty cell and
 * `09/10/2026` into the full ones — two formats the board and the calendar
 * beside it never use, and in a grid the placeholder alone is louder than the
 * data. This lived in TaskTable, which is why only the table's two built-in
 * date columns got it and every date *property* stayed raw.
 */
function DateValue({ value, danger, onChange }: {
  value: string | null;
  danger?: boolean;
  onChange: (v: string | null) => void;
}) {
  const iso = value?.slice(0, 10) ?? '';
  // "Sep 14", the way every other date in the app is written — a full date in
  // a grid next to a board that says "Sep 14" reads as a different kind of
  // value rather than the same one. The year is in the picker this opens.
  const label = iso
    ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';
  return (
    <label
      className={[
        'relative flex h-7 cursor-pointer items-center rounded px-2.5 text-sm ring-1 ring-inset ring-transparent',
        'transition-shadow hover:ring-line focus-within:ring-2 focus-within:ring-accent',
        danger ? 'text-danger-strong' : iso ? 'text-ink' : 'text-faint',
      ].join(' ')}
    >
      <span className="block truncate">{label || '—'}</span>
      <input
        type="date"
        aria-label={danger ? 'Date (overdue)' : 'Date'}
        className="absolute inset-0 w-full cursor-pointer opacity-0"
        value={iso}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </label>
  );
}

/**
 * A URL that reads as a link. It was a text box holding a string: the address
 * was stored, but nothing could be clicked, which is the only thing a URL
 * property is for. Click the link's row to edit it, the arrow to follow it.
 */
function UrlValue({ value, scheme, dense, onChange }: {
  value: string;
  /** 'mailto:' or 'tel:' for the address types; absent means a web address. */
  scheme?: 'mailto:' | 'tel:';
  dense?: boolean;
  onChange: (v: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);
  // Only http(s) is followed for a plain URL — a stored `javascript:` address
  // would otherwise become a click target. mailto and tel are built from the
  // value rather than read out of it, so they carry no scheme to smuggle.
  const safe = scheme ? (value.trim() ? value.trim() : '') : (/^https?:\/\//i.test(value) ? value : '');
  const href = scheme ? `${scheme}${encodeURIComponent(safe)}` : safe;

  if (!editing && safe) {
    return (
      <span className="flex h-7 min-w-0 items-center gap-1 pl-2.5">
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Edit this address"
          className="min-w-0 flex-1 truncate rounded py-0.5 text-left text-sm text-accent-strong underline decoration-line-strong underline-offset-2 hover:bg-hover"
        >
          {scheme ? safe : safe.replace(/^https?:\/\//i, '')}
        </button>
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Open in a new tab"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint transition-colors hover:bg-hover hover:text-ink"
        >
          <ExternalLink size={13} />
        </a>
      </span>
    );
  }
  return (
    <input
      // Uncontrolled so typing is not a write per keystroke, but keyed on the
      // value so an external change still lands: a save that failed and rolled
      // back must not leave the box showing what never persisted.
      key={value}
      type={scheme === 'mailto:' ? 'email' : scheme === 'tel:' ? 'tel' : 'url'}
      inputMode={scheme === 'mailto:' ? 'email' : scheme === 'tel:' ? 'tel' : 'url'}
      placeholder={scheme === 'mailto:' ? 'name@example.com' : scheme === 'tel:' ? '+1 555 0100' : 'https://'}
      autoFocus={editing}
      className={dense ? cellField : field}
      defaultValue={value}
      onBlur={(e) => {
        setEditing(false);
        if (e.target.value !== value) onChange(e.target.value || null);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
    />
  );
}

/**
 * A person property holds one user id; the built-in Assignees column holds a
 * list. Both are drawn by the same picker, so the single one is read as a list
 * of one and written back as the last name chosen.
 */
function asAssignees(value: unknown, users: UserRow[]): { id: string; name: string }[] {
  const ids = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : typeof value === 'string' && value ? [value] : [];
  return ids.map((id) => {
    const u = users.find((x) => x.id === id);
    return { id, name: u ? (u.name || u.username) : 'Unknown' };
  });
}

export function PropertyValue({ prop, users, value, onChange, onEditOptions, danger, fixedOptions, dense }: Props) {
  const box = dense ? cellField : field;
  switch (prop.type) {
    case 'number':
      return (
        <input
          type="number"
          className={cn(box, 'tabular-nums')}
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'checkbox':
      return (
        // Wrapped, not bare: a 14px box dropped straight into a 10px-inset
        // column sat two pixels left of every value above it.
        <label className="flex h-7 items-center px-2.5">
          <input
            type="checkbox"
            className="h-4 w-4 accent-accent"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
          />
        </label>
      );
    case 'date':
      return <DateValue value={typeof value === 'string' ? value : null} danger={danger} onChange={onChange} />;
    // The same picker the built-in Assignees column uses: chips, a search, a
    // "+". A native select here was the one control in the grid the platform
    // drew, so it agreed with nothing around it in either theme.
    case 'person':
      return (
        <AssigneePicker
          assignees={asAssignees(value, users)}
          users={users}
          onChange={(ids) => onChange(prop.id === 'sys:assignees' ? ids : ids[ids.length - 1] ?? null)}
        />
      );
    // Both go through the same menu: it is the only place an option can be
    // made without leaving the row, and the only place its colour is set
    // beside the chip that wears it.
    case 'select':
    case 'multi_select':
      return (
        <SelectValue
          prop={prop}
          value={value}
          multi={prop.type === 'multi_select'}
          onChange={onChange}
          onEditOptions={onEditOptions}
          fixed={fixedOptions}
        />
      );
    case 'url':
      return <UrlValue value={typeof value === 'string' ? value : ''} dense={dense} onChange={onChange} />;
    // An address and a number are text with a scheme: the input keyboard and
    // the tap-to-act are the whole difference, and both matter on a phone.
    case 'email':
      return <UrlValue value={typeof value === 'string' ? value : ''} scheme="mailto:" dense={dense} onChange={onChange} />;
    case 'phone':
      return <UrlValue value={typeof value === 'string' ? value : ''} scheme="tel:" dense={dense} onChange={onChange} />;
    // Computed every time they are read, so there is nothing to type at. The
    // value is still worth showing — and a formula's own error message is the
    // only place whoever wrote it will see what is wrong.
    case 'formula':
    case 'rollup': {
      const shown = value === null || value === undefined || value === '' ? '—' : String(value);
      const broken = shown.startsWith('⚠');
      return (
        <span
          title={broken ? shown : `${prop.label} is computed`}
          className={cn('flex h-7 items-center truncate px-2.5 text-sm tabular-nums', broken ? 'text-danger-strong' : 'text-muted')}
        >
          {shown}
        </span>
      );
    }
    case 'file':
      return (
        <Attachments
          compact
          files={Array.isArray(value) ? (value as StoredFile[]) : []}
          onChange={onChange}
        />
      );
    default:
      return (
        <input
          key={typeof value === 'string' ? value : ''}
          className={box}
          defaultValue={typeof value === 'string' ? value : ''}
          onBlur={(e) => e.target.value !== value && onChange(e.target.value || null)}
        />
      );
  }
}
