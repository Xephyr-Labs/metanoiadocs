import { ExternalLink, Link2, Settings2, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { UserRow } from '../../lib/docsApi';
import { cn } from '../../lib/cn';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import {
  STATUSES, STATUS_LABEL, tasksApi,
  type PropRow, type RelatedRow, type SprintRow, type TaskDetail, type TaskPatch, type TaskRow, type TaskStatus,
} from '../../lib/tasksApi';
import { LazyEditor } from '../../editor/LazyEditor';
import { field } from '../ui/styles';
import { IconButton } from '../ui/IconButton';
import { useKinds } from './kinds';
import { KindBadge } from './TaskChip';
import { PropertyValue } from './props/PropertyValue';

interface Props {
  task: TaskRow | null;
  tasks: TaskRow[];
  props: PropRow[];
  sprints: SprintRow[];
  users: UserRow[];
  onClose: () => void;
  onPatch: (id: string, body: TaskPatch) => void;
  onSetProp: (taskId: string, propId: string, value: unknown) => void;
  onDelete: (id: string) => void;
  onAddDep: (id: string, dependsOn: string) => void;
  onRemoveDep: (id: string, dependsOn: string) => void;
  /** Opens the type editor from beside the Type field, the way Notion does. */
  onManageKinds: () => void;
}

const label = 'mb-1 block text-2xs font-medium text-muted';

function Row({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className={label}>{name}</span>
      {children}
    </div>
  );
}

/**
 * A row's page: properties on top, its BlockSuite document underneath. Replaces
 * the old centered TaskDialog — a row is no longer a record you edit and close,
 * it's a page you can write in, reachable at /d/<id> like any other document.
 */
export function TaskPeek({
  task, tasks, props, sprints, users, onClose, onPatch, onSetProp, onDelete, onAddDep, onRemoveDep, onManageKinds,
}: Props) {
  const ws = useWorkspace();
  const auth = useAuth();
  const kinds = useKinds();
  const [depPick, setDepPick] = useState('');
  const [docId, setDocId] = useState<string | null>(task?.doc_id ?? null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);

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
  const groupKeys = new Set(kinds.filter((k) => k.is_group).map((k) => k.key));
  const parents = tasks.filter((t) => groupKeys.has(t.kind) && t.id !== task.id);
  const isGroup = groupKeys.has(task.kind);

  return (
    <aside className="fixed right-0 top-0 z-40 flex h-full w-full max-w-[560px] flex-col border-l border-line bg-canvas shadow-modal">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3">
        <KindBadge kind={task.kind} />
        <input
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
        <IconButton icon={<X size={16} />} label="Close" onClick={onClose} />
      </header>

      <div className="scrollarea min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        <section className="grid grid-cols-2 gap-3 p-4">
          <Row name="Type">
            <div className="flex items-center gap-1">
              <select className={field} value={task.kind} onChange={(e) => onPatch(task.id, { kind: e.target.value })}>
                {!kinds.some((k) => k.key === task.kind) && <option value={task.kind}>{task.kind}</option>}
                {kinds.map((k) => <option key={k.id} value={k.key}>{k.label}</option>)}
              </select>
              <IconButton icon={<Settings2 size={15} />} label="Edit task types" onClick={onManageKinds} />
            </div>
          </Row>
          <Row name="Status">
            <select className={field} value={task.status} onChange={(e) => onPatch(task.id, { status: e.target.value as TaskStatus })}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </Row>
          <Row name="Assignee">
            <select className={field} value={task.assignee_id ?? ''} onChange={(e) => onPatch(task.id, { assigneeId: e.target.value || null })}>
              <option value="">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.username}</option>)}
            </select>
          </Row>
          <Row name="Progress %">
            <input type="number" min={0} max={100} className={field} value={task.progress} onChange={(e) => onPatch(task.id, { progress: Number(e.target.value) })} />
          </Row>
          <Row name="Start">
            <input type="date" className={field} value={task.start_at?.slice(0, 10) ?? ''} onChange={(e) => onPatch(task.id, { startAt: e.target.value || null })} />
          </Row>
          <Row name="Due">
            <input type="date" className={field} value={task.due_at?.slice(0, 10) ?? ''} onChange={(e) => onPatch(task.id, { dueAt: e.target.value || null })} />
          </Row>
        </section>

        <section className="grid grid-cols-2 gap-3 p-4">
          <Row name="Sprint">
            <select className={field} value={task.sprint_id ?? ''} onChange={(e) => onPatch(task.id, { sprintId: e.target.value || null })}>
              <option value="">Backlog</option>
              {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}{s.state === 'active' ? ' (active)' : ''}</option>)}
            </select>
          </Row>
          <Row name="Points">
            <input type="number" min={0} className={field} value={task.points ?? ''} placeholder="—" onChange={(e) => onPatch(task.id, { points: e.target.value === '' ? null : Number(e.target.value) })} />
          </Row>
          {!isGroup && parents.length > 0 && (
            <Row name="Parent">
              <select className={field} value={task.parent_id ?? ''} onChange={(e) => onPatch(task.id, { parentId: e.target.value || null })}>
                <option value="">None</option>
                {parents.map((t) => <option key={t.id} value={t.id}>{t.title || 'Untitled'}</option>)}
              </select>
            </Row>
          )}
          <label className={cn('flex items-center gap-2 self-end pb-1.5 text-sm text-ink', (isGroup || !parents.length) && 'col-span-2')}>
            <input type="checkbox" checked={task.milestone} onChange={(e) => onPatch(task.id, { milestone: e.target.checked })} />
            Milestone
          </label>
        </section>

        <section className="p-4">
          <span className={label}>Depends on</span>
          <div className="space-y-1.5">
            {task.deps.map((d) => (
              <div key={d} className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-sm text-ink">
                <Link2 size={14} className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate">{byId.get(d)?.title || 'Untitled'}</span>
                <button type="button" onClick={() => onRemoveDep(task.id, d)} className="shrink-0 text-faint hover:text-danger" aria-label="Remove dependency">
                  <X size={14} />
                </button>
              </div>
            ))}
            <select
              className={cn(field, 'cursor-pointer text-muted')}
              value={depPick}
              onChange={(e) => {
                if (!e.target.value) return;
                onAddDep(task.id, e.target.value);
                setDepPick('');
              }}
            >
              <option value="">Add a dependency…</option>
              {candidates.map((t) => <option key={t.id} value={t.id}>{t.title || 'Untitled'}</option>)}
            </select>
          </div>
        </section>

        {props.length > 0 && (
          <section className="space-y-3 p-4">
            {props.map((p) => (
              <div key={p.id} className="grid grid-cols-[120px_1fr] items-center gap-3">
                <span className="text-2xs font-medium text-muted">{p.label}</span>
                {p.type === 'relation'
                  ? <RelationField task={task} prop={p} detail={detail} onChanged={setDetail} />
                  : <PropertyValue prop={p} users={users} value={task.props?.[p.id] ?? null} onChange={(v) => onSetProp(task.id, p.id, v)} />}
              </div>
            ))}
          </section>
        )}

        {!!detail?.backlinks.length && (
          <section className="p-4">
            <h3 className="mb-2 text-2xs font-semibold uppercase text-muted">Linked from</h3>
            <ul className="space-y-1">
              {detail.backlinks.map((r) => (
                <li key={r.id} className="truncate text-sm text-ink">
                  <span className="text-faint">{r.project_name} · </span>{r.title || 'Untitled'}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          {docId && (
            <LazyEditor
              docId={docId}
              title={task.title}
              mode="page"
              userName={auth.user?.name ?? 'You'}
              fullWidth
              onTitle={(t) => ws.applyTitleFromEditor(docId, t)}
            />
          )}
        </section>
      </div>

      <footer className="flex shrink-0 justify-end border-t border-line px-3 py-2.5">
        <button
          type="button"
          onClick={() => { onDelete(task.id); onClose(); }}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-faint transition-colors hover:bg-hover hover:text-danger"
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
      <div className="mb-1 flex flex-wrap gap-1">
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
      <select
        className={field}
        value=""
        onChange={(e) => e.target.value && tasksApi.addRelation(task.id, prop.id, e.target.value).then(refresh)}
      >
        <option value="">Link a row…</option>
        {choices
          .filter((c) => !linked.some((l) => l.id === c.id))
          .map((c) => <option key={c.id} value={c.id}>{c.title || 'Untitled'}</option>)}
      </select>
    </div>
  );
}
