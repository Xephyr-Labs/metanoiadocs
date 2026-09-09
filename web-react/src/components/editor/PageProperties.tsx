import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { docsApi, type DocPropRow, type UserRow } from '../../lib/docsApi';
import { emptyValue } from '../../lib/props';
import type { PropRow } from '../../lib/tasksApi';
import { PROP_TYPE_LABEL } from '../../lib/tasksApi';
import type { Page } from '../../lib/types';
import { useWorkspace } from '../../store/workspace';
import { Menu } from '../ui/Menu';
import { PropertyValue } from '../project/props/PropertyValue';
import { field, rowAction } from '../ui/styles';

/** The types a page property can have — a relation needs a database to point at. */
const TYPES: DocPropRow['type'][] = [
  'text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'person', 'url',
];

/**
 * PropertyValue is written against a database's PropRow. A page property is the
 * same thing without the two database-only fields, so it is widened here rather
 * than the editor being duplicated for a second, near-identical shape.
 */
const asPropRow = (p: DocPropRow): PropRow =>
  ({ ...p, project_id: '', target_project_id: null }) as PropRow;

function NewProperty({ pageId, onDone }: { pageId: string; onDone: () => void }) {
  const ws = useWorkspace();
  const [label, setLabel] = useState('');
  const [type, setType] = useState<DocPropRow['type']>('text');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!label.trim() || busy) return;
    setBusy(true);
    try {
      const row = await ws.createDocProp(label.trim(), type);
      // Put it on this page too: someone naming a property here means it to
      // appear here, not merely to exist in the workspace.
      await ws.setPageProp(pageId, row.id, emptyValue(type));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that property.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1">
      <input
        autoFocus
        aria-label="Property name"
        placeholder="Property name"
        className={cn(field, 'h-7 w-40 text-xs')}
        value={label}
        onChange={(e) => { setLabel(e.target.value); setError(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') create();
          if (e.key === 'Escape') onDone();
        }}
      />
      <select
        aria-label="Property type"
        className={cn(field, 'h-7 w-auto text-xs')}
        value={type}
        onChange={(e) => setType(e.target.value as DocPropRow['type'])}
      >
        {TYPES.map((t) => <option key={t} value={t}>{PROP_TYPE_LABEL[t]}</option>)}
      </select>
      <button
        type="button"
        onClick={create}
        disabled={!label.trim() || busy}
        className="h-7 rounded-md bg-accent px-2.5 text-xs font-medium text-white disabled:opacity-50"
      >
        Add
      </button>
      <button type="button" onClick={onDone} className="h-7 rounded-md px-2 text-xs text-muted hover:bg-hover">
        Cancel
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

/**
 * Notion-style page properties, directly under the title.
 *
 * The definitions are workspace-wide, so "Status" means one thing everywhere;
 * a page shows only the ones it actually sets, plus the affordance to add
 * another. Same portal trick as DocMetaBand — BlockSuite owns the title, so
 * this cannot simply be rendered above the editor. It mounts after the meta
 * band on purpose, which is why this component is rendered after it.
 */
export function PageProperties({ editor, page }: { editor: Element | null; page: Page }) {
  const ws = useWorkspace();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const title = editor?.querySelector('doc-title');
    if (!title) return;
    const el = document.createElement('div');
    el.className = 'mn-doc-props';
    // After the metadata band when it is there, so the order under the title
    // reads: who touched it, then what it is.
    const anchor = title.parentElement?.querySelector('.mn-doc-meta') ?? title;
    anchor.insertAdjacentElement('afterend', el);
    setHost(el);
    return () => { el.remove(); setHost(null); };
  }, [editor]);

  // Only fetched when a person property actually exists, so an ordinary page
  // costs no extra request.
  const needsUsers = ws.docProps.some((p) => p.type === 'person');
  // Guarded on a tried-once flag, not on users.length: a workspace where nobody
  // has a username, or a /users that fails, leaves the list empty, and guarding
  // on emptiness would re-fetch on every render.
  useEffect(() => {
    if (!needsUsers || usersLoaded) return;
    docsApi.users()
      .then(setUsers)
      .catch(() => {})
      .finally(() => setUsersLoaded(true));
  }, [needsUsers, usersLoaded]);

  const shown = useMemo(
    () => ws.docProps.filter((p) => p.id in (page.props ?? {})),
    [ws.docProps, page.props],
  );
  const available = ws.docProps.filter((p) => !(p.id in (page.props ?? {})));
  const readOnly = page.role === 'viewer';

  if (!host) return null;

  return createPortal(
    <div className="mb-4 mt-1">
      {shown.map((prop) => (
        <div key={prop.id} className="group/prop flex items-start gap-2 py-[3px]">
          <span className="mt-1.5 w-32 shrink-0 truncate text-xs text-muted" title={prop.label}>
            {prop.label}
          </span>
          {/* Capped, not full measure: a value field spanning the whole reading
              width reads as a form, not as metadata. */}
          <span className="min-w-0 max-w-[22rem] flex-1">
            <PropertyValue
              prop={asPropRow(prop)}
              users={users}
              value={page.props?.[prop.id] ?? null}
              onChange={(v) => ws.setPageProp(page.id, prop.id, v)}
            />
          </span>
          {!readOnly && (
            <Menu
              align="end"
              trigger={
                <button
                  type="button"
                  aria-label={`Options for ${prop.label}`}
                  className={cn(rowAction, 'mt-1.5 opacity-0 group-hover/prop:opacity-100')}
                >
                  <X size={13} />
                </button>
              }
              items={[
                {
                  icon: X,
                  label: 'Remove from this page',
                  onSelect: () => ws.clearPageProp(page.id, prop.id),
                },
                {
                  icon: Trash2,
                  label: 'Delete everywhere',
                  danger: true,
                  separatorBefore: true,
                  onSelect: () => ws.deleteDocProp(prop.id),
                },
              ]}
            />
          )}
        </div>
      ))}

      {!readOnly && (adding ? (
        <NewProperty pageId={page.id} onDone={() => setAdding(false)} />
      ) : (
        <Menu
          align="start"
          trigger={
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-faint transition-colors hover:bg-hover hover:text-ink"
            >
              <Plus size={13} /> Add a property
            </button>
          }
          items={[
            ...available.map((p) => ({
              label: p.label,
              // Writing the type's empty value is what puts the row on the page;
              // there is no separate "this page uses that property" table.
              onSelect: () => ws.setPageProp(page.id, p.id, emptyValue(p.type)),
            })),
            {
              icon: Plus,
              label: 'New property…',
              separatorBefore: available.length > 0,
              onSelect: () => setAdding(true),
            },
          ]}
        />
      ))}
    </div>,
    host,
  );
}
