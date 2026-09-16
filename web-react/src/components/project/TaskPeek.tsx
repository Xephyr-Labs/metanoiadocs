/* Hallmark · component: row detail panel · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: opening · loaded · data mode · no page yet · dependency added ·
 *         dependency removed · backlinked · empty property · deleting
 */
import { ExternalLink, Link2, MoreHorizontal, Plus, Settings2, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { UserRow } from '../../lib/docsApi';
import { cn } from '../../lib/cn';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import { builtinProps, isAuditProp } from '../../lib/builtinProps';
import {
  tasksApi,
  type ProjectMode, type PropOption, type PropRow, type RelatedRow, type SprintRow, type TaskDetail, type TaskPatch, type TaskRow,
} from '../../lib/tasksApi';
import { LazyEditor } from '../../editor/LazyEditor';
import { IconButton } from '../ui/IconButton';
import { Menu } from '../ui/Menu';
import { useDocLinking } from '../../hooks/useDocLinking';
import { useMoveToFolder } from '../../hooks/useMoveToFolder';
import { SearchSelect } from '../ui/SearchSelect';
import { useKinds } from './kinds';
import { KindBadge } from './TaskChip';
import { PropertyCell } from './props/PropertyCell';
import { TaskAgents } from './TaskAgents';

interface Props {
  task: TaskRow | null;
  tasks: TaskRow[];
  /** A data database's rows carry no status, assignee, dates or dependencies. */
  mode: ProjectMode;
  props: PropRow[];
  sprints: SprintRow[];
  users: UserRow[];
  /** The project's own colours for the four statuses, so the chip here is the
   *  colour the board and the table paint. */
  statusColors?: Record<string, string>;
  onClose: () => void;
  onPatch: (id: string, body: TaskPatch) => void;
  onSetProp: (taskId: string, propId: string, value: unknown) => void;
  onDelete: (id: string) => void;
  onAddDep: (id: string, dependsOn: string) => void;
  onRemoveDep: (id: string, dependsOn: string) => void;
  /** Opens the type editor from beside the Type field, the way Notion does. */
  onManageKinds: () => void;
  /** Opens the property editor, for adding one without leaving the task. */
  onManageProps: () => void;
  /** Persist a new/renamed/recoloured option made from a select's own menu. */
  onEditOptions?: (prop: PropRow, options: PropOption[]) => void;
  /** Re-read the row after its page tags change — focus areas live on the page,
   *  so the task list does not hear about them by itself. */
  onTagsChanged?: () => void;
}

/**
 * One property: its name on a fixed rail, its value beside it.
 *
 * The panel used to run two layouts at once — the built-in fields as labels
 * stacked above 32px boxes in a two-column grid, the database's own as a left
 * rail — so the same panel had two value columns at two different x positions,
 * and half of every section was blank while the panel scrolled for 1600px. One
 * row per property, name left, value right, is both the shorter shape and the
 * only one that lines up.
 */
function Row({ name, note, action, children }: {
  name: string;
  /** "built-in" / "yours", where two properties share a label. */
  note?: string;
  /** A control that belongs beside the value, not inside it (the Type gear). */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="group/row grid grid-cols-[148px_minmax(0,1fr)] items-start gap-2">
      <span className="flex min-h-7 items-center py-0.5 text-xs text-muted">
        <span className="truncate" title={name}>{name}</span>
        {note && <span className="ml-1 shrink-0 text-faint">{note}</span>}
      </span>
      {action ? (
        <div className="flex min-w-0 items-center gap-1">
          <div className="min-w-0 flex-1">{children}</div>
          {action}
        </div>
      ) : (
        <div className="min-w-0">{children}</div>
      )}
    </div>
  );
}

/**
 * A row's page: properties on top, its BlockSuite document underneath. Replaces
 * the old centered TaskDialog — a row is no longer a record you edit and close,
 * it's a page you can write in, reachable at /d/<id> like any other document.
 *
 * The fields are not written out here. They come from `builtinProps()` and the
 * database's own list, both rendered through `PropertyCell` — the same call the
 * table makes for the same task. Hand-coding eleven fields here is what let the
 * peek and the grid drift apart: a date read `09/14/2026` in one and `Sep 14`
 * in the other, a status was a native select here and a coloured chip there.
 */
export function TaskPeek({
  task, mode, tasks, props, sprints, users, statusColors, onClose, onPatch, onSetProp, onDelete, onAddDep, onRemoveDep,
  onManageKinds, onManageProps, onEditOptions, onTagsChanged,
}: Props) {
  const ws = useWorkspace();
  const auth = useAuth();
  const kinds = useKinds();
  const [depPick, setDepPick] = useState('');
  const [docId, setDocId] = useState<string | null>(task?.doc_id ?? null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  // A task's page is a page like any other, so it can be filed in a folder
  // straight from here rather than being hunted down in the sidebar first.
  const moveTo = useMoveToFolder(docId);
  // Without these the notes editor installs no link extensions at all, so
  // every page reference in a task's notes rendered as "Deleted page" and
  // clicked through to nothing. See useDocLinking.
  const { pages: linkTargets, createPage: createLinkedPage } = useDocLinking();

  // Every field the panel draws, built-in and database-defined alike. The four
  // audit columns are left out for the same reason the table leaves them out
  // of its default: worth having, not worth four rows before anyone asks.
  const fields = useMemo(() => {
    const builtins = builtinProps(mode, kinds, sprints, statusColors).filter((p) => !isAuditProp(p.id));
    return [...builtins, ...props];
  }, [mode, kinds, sprints, statusColors, props]);

  // Labels carried by more than one property — a database may define its own
  // "Status" beside the built-in one. Two identical rows is a coin flip.
  const twice = useMemo(() => new Set(
    fields.map((p) => p.label.toLowerCase()).filter((l, i, all) => all.indexOf(l) !== i),
  ), [fields]);

  // Opening the row is what creates its page — importing a thousand rows must
  // not create a thousand empty documents.
  useEffect(() => {
    if (!task) return;
    let alive = true;
    setDocId(task.doc_id);
    tasksApi.taskPage(task.id).then((r) => {
      if (!alive) return;
      setDocId(r.docId);
      // A brand-new row page isn't in the workspace's doc list yet — without this
      // the ↗ button would navigate to a document the sidebar/editor can't find.
      if (!ws.pages[r.docId]) ws.refresh();
    }).catch(() => {});
    tasksApi.task(task.id).then((d) => alive && setDetail(d)).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  // Esc closes the peek — the same reflex every other overlay in the app answers
  // to. No backdrop and no Modal here on purpose: a click outside must still
  // reach the board underneath.
  useEffect(() => {
    if (!task) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [task, onClose]);

  if (!task) return null;

  const candidates = tasks.filter((t) => t.id !== task.id && !task.deps.includes(t.id));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  // Pages a task can be moved onto: ordinary documents, not other tasks' pages
  // (which belong to a row already) and not designs.
  const linkable = Object.values(ws.pages)
    .filter((p) => p.kind === 'doc' && p.id !== docId)
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, 200);
  const groupKeys = new Set(kinds.filter((k) => k.is_group).map((k) => k.key));
  const parents = tasks.filter((t) => groupKeys.has(t.kind) && t.id !== task.id);
  const isGroup = groupKeys.has(task.kind);

  return (
    <aside className="fixed right-0 top-0 z-40 flex h-full w-full max-w-[560px] flex-col border-l border-line bg-canvas shadow-modal">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3">
        {mode !== 'data' && <KindBadge kind={task.kind} />}
        {/* Same reason as the table's title cell: uncontrolled, so it is keyed
            on the title to pick up a change made in the document body. */}
        <input
          key={task.title}
          autoFocus={!task.title}
          aria-label="Task title"
          className="min-w-0 flex-1 bg-transparent text-md font-medium text-ink outline-none placeholder:text-faint"
          defaultValue={task.title}
          placeholder="Task title"
          onBlur={(e) => e.target.value !== task.title && onPatch(task.id, { title: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <IconButton
          icon={<ExternalLink size={16} />}
          label="Open as page"
          disabled={!docId}
          onClick={() => { if (docId) { ws.select(docId); onClose(); } }}
        />
        {moveTo && (
          <Menu
            align="end"
            items={[moveTo]}
            trigger={<span><IconButton icon={<MoreHorizontal size={16} />} label="Task page actions" /></span>}
          />
        )}
        <IconButton icon={<X size={16} />} label="Close" onClick={onClose} />
      </header>

      <div className="scrollarea min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        <section className="space-y-0.5 px-4 py-3">
          {fields.map((p) => (
            <Row
              key={p.id}
              name={p.label}
              note={twice.has(p.label.toLowerCase()) ? (p.id.startsWith('sys:') ? 'built-in' : 'yours') : undefined}
              // The type editor opens from beside the Type field, the way the
              // property editor opens from the bottom of this list.
              action={p.id === 'sys:kind'
                ? (
                  <IconButton
                    size="sm"
                    icon={<Settings2 size={14} />}
                    label="Edit task types"
                    onClick={onManageKinds}
                    className="opacity-0 transition-opacity duration-120 group-hover/row:opacity-100 focus-visible:opacity-100"
                  />
                )
                : undefined}
            >
              {/* A relation's choices live in another database and its writes
                  are their own endpoints, so the generic cell cannot draw it —
                  in the grid it is a link to this panel, and this panel is
                  where it is actually edited. */}
              {p.type === 'relation'
                ? <RelationField task={task} prop={p} detail={detail} onChanged={setDetail} />
                : (
                  <PropertyCell
                    prop={p}
                    task={task}
                    users={users}
                    onPatch={onPatch}
                    onSetProp={onSetProp}
                    onEditOptions={onEditOptions}
                    onTagsChanged={onTagsChanged}
                  />
                )}
            </Row>
          ))}

          {/* Not properties: a parent, a dependency and a page are edges
              between rows, not values on one. They keep the rail so the panel
              still reads as a single list. */}
          {mode !== 'data' && !isGroup && parents.length > 0 && (
            <Row name="Parent">
              <SearchSelect
                variant="bare"
                value={task.parent_id ?? null}
                placeholder="None"
                empty="No group rows in this database."
                options={parents.map((t) => ({ value: t.id, label: t.title || 'Untitled' }))}
                onChange={(id) => onPatch(task.id, { parentId: id || null })}
              />
            </Row>
          )}

          {mode !== 'data' && (
            <Row name="Depends on">
              <div className="space-y-1">
                {task.deps.map((d) => (
                  <div key={d} className="flex items-center gap-2 rounded-md border border-line px-2 py-1 text-sm text-ink">
                    <Link2 size={13} className="shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 truncate">{byId.get(d)?.title || 'Untitled'}</span>
                    <button type="button" onClick={() => onRemoveDep(task.id, d)} className="shrink-0 text-faint hover:text-danger-strong" aria-label="Remove dependency">
                      <X size={13} />
                    </button>
                  </div>
                ))}
                {/* Searchable: a project's task list is the kind of list a
                    native select stops working on at about thirty rows. */}
                <SearchSelect
                  variant="bare"
                  value={depPick || null}
                  placeholder="Empty"
                  empty="Nothing else in this project yet."
                  options={candidates.map((t) => ({ value: t.id, label: t.title || 'Untitled' }))}
                  onChange={(id) => { onAddDep(task.id, id); setDepPick(''); }}
                />
              </div>
            </Row>
          )}

          {/* The page this task is written on. Every task gets one of its own;
              linking an existing page instead is how a task and a document that
              were made separately are brought together. */}
          <Row
            name="Page"
            action={(
              <IconButton
                size="sm"
                icon={<ExternalLink size={14} />}
                label="Open this page"
                disabled={!docId}
                onClick={() => { if (docId) { ws.select(docId); onClose(); } }}
              />
            )}
          >
            <SearchSelect
              variant="bare"
              value={docId}
              placeholder="Pick a page…"
              empty="No other pages to link."
              options={[
                ...(docId
                  ? [{ value: docId, label: ws.pages[docId]?.title || task.title || 'This task’s page' }]
                  : []),
                ...linkable.map((pg) => ({ value: pg.id, label: pg.title || 'Untitled' })),
              ]}
              onChange={(next) => {
                if (next === docId) return;
                setDocId(next);
                onPatch(task.id, { docId: next });
              }}
            />
          </Row>

          {/* Properties belong to the whole database, but this is where people
              notice one is missing — so the editor opens from here too, the way
              the type editor does from beside the Type field. */}
          <button
            type="button"
            onClick={onManageProps}
            className="flex items-center gap-1.5 rounded-md py-1 pl-0.5 pr-2 text-xs font-medium text-faint transition-colors hover:bg-hover hover:text-ink"
          >
            <Plus size={13} /> Add a property
          </button>
        </section>

        {/* A data database's rows are records, not work — nothing to hand over
            and no status for a rule to fire on. */}
        {mode !== 'data' && (
          <TaskAgents
            taskId={task.id}
            projectId={task.project_id}
            // A quick action writes the row on the server, so the list has to
            // be re-read rather than patched locally — the same "something
            // changed this row from outside" refresh a page tag needs.
            onChanged={() => onTagsChanged?.()}
          />
        )}

        {!!detail?.backlinks.length && (
          <section className="px-4 py-3">
            <h3 className="mb-1.5 text-2xs font-semibold uppercase text-muted">Linked from</h3>
            <ul className="space-y-0.5">
              {detail.backlinks.map((r) => (
                <li key={r.id}>
                  {/* A list of names you cannot click is a dead end: the row
                      that links to this one is precisely the row you now want
                      to read. Its page if it has one, its board if it does
                      not — a row created by an import has no page yet. */}
                  <button
                    type="button"
                    onClick={() => {
                      if (r.doc_id) ws.select(r.doc_id);
                      else ws.openProject(r.project_id, r.id);
                      onClose();
                    }}
                    className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm text-ink transition-colors hover:bg-hover"
                  >
                    <Link2 size={13} className="shrink-0 text-faint" />
                    <span className="shrink-0 text-faint">{r.project_name}</span>
                    <span className="min-w-0 flex-1 truncate">{r.title || 'Untitled'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* The panel header is already the title field, so the document's own
            title block is hidden here (mn-peek-editor in index.css) — two
            titles, one of them a 36px display line inside a 560px panel, was
            the loudest thing in the panel and said nothing new. */}
        <section className="mn-peek-editor">
          {/* Without the document's own title the body starts on blank canvas,
              which reads as a rendering fault rather than an empty page. */}
          <p className="px-4 pt-3 text-xs text-muted">Notes</p>
          {docId && (
            <LazyEditor
              docId={docId}
              title={task.title}
              mode="page"
              userName={auth.user?.name ?? 'You'}
              fullWidth
              // Typing into the page's own title block writes docs.title (and,
              // server-side, tasks.title) but never touches this component's
              // `tasks` list — onPatch is what keeps that cache in step, the
              // same call the header input below makes. Without this, reopening
              // the row in the same session hands mountEditor a stale title,
              // which would overwrite the very edit that was just typed.
              onTitle={(t) => { ws.applyTitleFromEditor(docId, t); if (t !== task.title) onPatch(task.id, { title: t }); }}
              pages={linkTargets}
              createPage={createLinkedPage}
              onOpenDoc={(id) => { ws.select(id); onClose(); }}
            />
          )}
        </section>
      </div>

      <footer className="flex shrink-0 justify-end border-t border-line px-3 py-2.5">
        <button
          type="button"
          onClick={() => { onDelete(task.id); onClose(); }}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-faint transition-colors hover:bg-hover hover:text-danger-strong"
        >
          <Trash2 size={14} /> Delete task
        </button>
      </footer>
    </aside>
  );
}

/** A picker over the target database's rows, plus a chip list of what's linked. */
function RelationField({ task, prop, detail, onChanged }: {
  task: TaskRow;
  prop: PropRow;
  detail: TaskDetail | null;
  onChanged: (d: TaskDetail) => void;
}) {
  const [choices, setChoices] = useState<TaskRow[]>([]);
  const linked: RelatedRow[] = detail?.relations[prop.id] ?? [];

  useEffect(() => {
    if (!prop.target_project_id) return;
    tasksApi.projectTasks(prop.target_project_id).then(setChoices).catch(() => setChoices([]));
  }, [prop.target_project_id]);

  const refresh = () => tasksApi.task(task.id).then(onChanged).catch(() => {});

  return (
    <div className="min-w-0">
      <div className={cn('flex flex-wrap gap-1', linked.length && 'mb-1')}>
        {linked.map((r) => (
          <button
            key={r.id}
            type="button"
            title="Remove this link"
            onClick={() => tasksApi.removeRelation(task.id, prop.id, r.id).then(refresh)}
            className="rounded-full border border-line px-2 py-0.5 text-2xs text-ink hover:bg-hover"
          >
            {r.title || 'Untitled'} ×
          </button>
        ))}
      </div>
      <SearchSelect
        variant="bare"
        value={null}
        placeholder="Empty"
        empty="That database has no rows yet."
        options={choices
          .filter((c) => !linked.some((l) => l.id === c.id))
          .map((c) => ({ value: c.id, label: c.title || 'Untitled' }))}
        onChange={(id) => tasksApi.addRelation(task.id, prop.id, id).then(refresh)}
      />
    </div>
  );
}
