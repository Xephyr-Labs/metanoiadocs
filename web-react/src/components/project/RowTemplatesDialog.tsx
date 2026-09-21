/* Hallmark · component: row templates · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H4 E5 S4 R5 V4
 * states: loading · empty (none yet) · list · editing · saving · failed ·
 *         confirming a delete
 */
import { useEffect, useState } from 'react';
import { ChevronLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { UserRow } from '../../lib/docsApi';
import { isAuditProp, isBuiltinProp } from '../../lib/builtinProps';
import { tasksApi, type PropRow, type RowTemplateRow, type TaskPatch, type TaskRow } from '../../lib/tasksApi';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { field } from '../ui/styles';
import { PropertyCell } from './props/PropertyCell';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Built-ins and the database's own, exactly as the table draws them. */
  props: PropRow[];
  users: UserRow[];
  /** What this database calls a row, so the dialog is titled the way the menu
   *  that opened it was. */
  noun: 'task' | 'row';
  /** The list changed — the New menu is built from it. */
  onChanged: () => void;
}

/**
 * A draft row, shaped like a task so the app's own property controls can edit
 * it.
 *
 * This is the trick that keeps this dialog small: a template is a set of values
 * for the same properties a row has, so rather than building a second editor
 * for every type, it fabricates a task that exists only in this component's
 * state and hands it to `PropertyCell` — the same control the table, the peek
 * and an embedded database all use. Nothing is written until Save.
 */
function draftOf(template: RowTemplateRow | null, projectId: string): TaskRow {
  const f = (template?.fields ?? {}) as Record<string, unknown>;
  return {
    id: 'draft',
    project_id: projectId,
    num: 0,
    title: typeof f.title === 'string' ? f.title : '',
    status: (f.status as TaskRow['status']) ?? 'todo',
    priority: typeof f.priority === 'number' ? f.priority : 0,
    progress: 0,
    points: typeof f.points === 'number' ? f.points : null,
    estimate_h: typeof f.estimateH === 'number' ? f.estimateH : null,
    repeat_rule: typeof f.repeatRule === 'string' ? f.repeatRule : null,
    milestone: f.milestone === true,
    kind: typeof f.kind === 'string' ? f.kind : 'task',
    start_at: null,
    due_at: null,
    sprint_id: null,
    assignees: [],
    tags: [],
    attachments: [],
    props: { ...(template?.props ?? {}) },
  } as unknown as TaskRow;
}

/** The draft back as the two bags the server stores. */
function fieldsOf(draft: TaskRow): Record<string, unknown> {
  return {
    title: draft.title || undefined,
    status: draft.status,
    priority: draft.priority || undefined,
    kind: draft.kind,
    points: draft.points ?? undefined,
    estimateH: draft.estimate_h ?? undefined,
    repeatRule: draft.repeat_rule ?? undefined,
    milestone: draft.milestone || undefined,
    assigneeIds: draft.assignees?.length ? draft.assignees.map((a) => a.id) : undefined,
  };
}

/**
 * Named starting points for a row.
 *
 * A bug report always begins as a bug, high priority, with the same three
 * headings on its page; a weekly sync always begins on Monday's agenda. That is
 * a template, and without one it is retyped every time or copied from whichever
 * old row somebody can find.
 *
 * What a template is *not* is a row: it lives in its own table, so it can never
 * turn up on a board, in a count, or in a sweep.
 */
export function RowTemplatesDialog({ open, onOpenChange, projectId, props, users, noun, onChanged }: Props) {
  const [rows, setRows] = useState<RowTemplateRow[]>([]);
  // Three states, not two: the list, an existing template, and one being made.
  // `null` alone cannot say the difference between "no template is open" and
  // "a new, empty one is" — which is why New template did nothing at first.
  const [editing, setEditing] = useState<RowTemplateRow | 'new' | null>(null);
  const [draft, setDraft] = useState<TaskRow>(() => draftOf(null, projectId));
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📋');
  const [body, setBody] = useState('');
  const [state, setState] = useState<'loading' | 'idle' | 'saving'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [arming, setArming] = useState<string | null>(null);

  /**
   * What a template is allowed to preset.
   *
   * The database's own properties, plus the built-ins the server will actually
   * store (TEMPLATE_FIELDS in server/src/templates.js). Dates, sprint, progress,
   * tags and attachments are left out on purpose and not merely dropped on
   * save: a dialog that offers a due date and then discards it is worse than
   * one that never offered it. A date that always means the same day is wrong
   * the day after the template is written, which is why the server refuses it.
   */
  const PRESETTABLE = new Set(['sys:status', 'sys:assignees', 'sys:kind', 'sys:points', 'sys:estimate', 'sys:repeat', 'sys:milestone']);
  const editable = props.filter((p) => (
    isBuiltinProp(p.id)
      ? PRESETTABLE.has(p.id)
      : !isAuditProp(p.id) && p.type !== 'relation' && p.type !== 'formula' && p.type !== 'rollup'
  ));

  const load = async () => {
    setState('loading');
    try {
      setRows(await tasksApi.rowTemplates(projectId));
      setError(null);
    } catch {
      setError('Could not read this database’s templates.');
    } finally {
      setState('idle');
    }
  };

  useEffect(() => {
    if (!open) return;
    setEditing(null);
    setArming(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  const edit = (row: RowTemplateRow | null) => {
    setEditing(row ?? 'new');
    setDraft(draftOf(row, projectId));
    setName(row?.name ?? '');
    setIcon(row?.icon ?? '📋');
    setBody(row?.body ?? '');
    setError(null);
  };

  const save = async () => {
    setState('saving');
    setError(null);
    const payload = {
      name: name.trim() || 'Untitled',
      icon: icon.trim() || '📋',
      fields: fieldsOf(draft),
      props: draft.props ?? {},
      body: body.trim() ? body : null,
    };
    try {
      if (editing && editing !== 'new') await tasksApi.patchRowTemplate(editing.id, payload);
      else await tasksApi.createRowTemplate(projectId, payload);
      await load();
      onChanged();
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that template.');
    } finally {
      setState('idle');
    }
  };

  const remove = async (id: string) => {
    setArming(null);
    try {
      await tasksApi.deleteRowTemplate(id);
      await load();
      onChanged();
    } catch {
      setError('Could not delete that template.');
    }
  };

  /**
   * The draft is edited in place: PropertyCell writes through the same two
   * callbacks a real row uses, and here they land in state instead of the API.
   *
   * A patch is not a row, though — it speaks the API's camelCase (`estimateH`,
   * `assigneeIds`) where a row holds columns (`estimate_h`, `assignees`). The
   * spread that looks right here silently writes keys nothing reads back, so
   * each one is translated.
   */
  const patchDraft = (_id: string, patch: TaskPatch) => {
    setDraft((d) => {
      const next: TaskRow = { ...d };
      if (patch.status !== undefined) next.status = patch.status;
      if (patch.kind !== undefined) next.kind = patch.kind;
      if (patch.points !== undefined) next.points = patch.points;
      if (patch.estimateH !== undefined) next.estimate_h = patch.estimateH;
      if (patch.repeatRule !== undefined) next.repeat_rule = patch.repeatRule;
      if (patch.milestone !== undefined) next.milestone = patch.milestone;
      if (patch.assigneeIds !== undefined) {
        next.assignees = patch.assigneeIds.map((id) => ({
          id,
          name: users.find((u) => u.id === id)?.name ?? '',
        }));
      }
      return next;
    });
  };
  const setDraftProp = (_taskId: string, propId: string, value: unknown) => {
    setDraft((d) => ({ ...d, props: { ...(d.props ?? {}), [propId]: value } }));
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={noun === 'task' ? 'Task templates' : 'Row templates'} width={520} focusPanel>
      <div className="px-4 py-3.5">
        {state === 'loading' ? (
          <p className="py-6 text-center text-sm text-faint">Checking…</p>
        ) : editing === null ? (
          <>
            <p className="text-sm leading-6 text-muted">
              A named starting point for a new {noun}: the values it begins with, and what its
              page says. Adding one puts it on the New button.
            </p>

            {rows.length === 0 ? (
              <p className="mt-3 rounded border border-dashed border-line px-3 py-4 text-center text-2xs text-faint">
                No templates yet.
              </p>
            ) : (
              <ul className="mt-3 overflow-hidden rounded border border-line">
                {rows.map((row) => (
                  <li key={row.id} className="flex items-center gap-2 border-b border-line px-2.5 py-1.5 last:border-b-0">
                    <span aria-hidden="true" className="w-5 shrink-0 text-center">{row.icon}</span>
                    <button
                      type="button"
                      onClick={() => edit(row)}
                      className="min-w-0 flex-1 truncate text-left text-xs text-ink hover:underline"
                    >
                      {row.name}
                    </button>
                    {arming === row.id ? (
                      <>
                        <button type="button" onClick={() => void remove(row.id)} className="text-3xs font-medium text-danger-strong">
                          Delete
                        </button>
                        <button type="button" onClick={() => setArming(null)} className="text-3xs text-muted">Keep</button>
                      </>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Delete ${row.name}`}
                        onClick={() => setArming(row.id)}
                        className="text-faint transition-colors hover:text-danger-strong"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3.5">
              <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => edit(null)}>New template</Button>
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="mb-2.5 flex items-center gap-1 text-2xs text-muted hover:text-ink"
            >
              <ChevronLeft size={13} /> All templates
            </button>

            <div className="flex items-center gap-2">
              <input
                aria-label="Icon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                maxLength={4}
                className={cn(field, 'w-12 text-center')}
              />
              <input
                aria-label="Template name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Bug report"
                maxLength={120}
                className={cn(field, 'flex-1')}
              />
            </div>

            <p className="mb-1.5 mt-3.5 text-2xs font-medium text-muted">What a {noun} starts as</p>
            <div className="overflow-hidden rounded border border-line">
              {editable.map((prop) => (
                <div key={prop.id} className="flex min-h-[32px] items-center gap-2 border-b border-line px-2.5 py-1 last:border-b-0">
                  <span className="w-28 shrink-0 truncate text-2xs text-muted">{prop.label}</span>
                  <div className="min-w-0 flex-1">
                    <PropertyCell
                      prop={prop}
                      task={draft}
                      users={users}
                      onPatch={patchDraft}
                      onSetProp={setDraftProp}
                    />
                  </div>
                </div>
              ))}
            </div>

            <label className="mb-1.5 mt-3.5 block text-2xs font-medium text-muted" htmlFor="rt-body">
              What its page says <span className="font-normal text-faint">— markdown, optional</span>
            </label>
            <textarea
              id="rt-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              maxLength={20000}
              placeholder={'## Steps to reproduce\n\n1. \n\n## What happened'}
              className={cn(field, 'h-auto resize-y py-2 font-mono text-2xs leading-5')}
            />

            <div className="mt-3.5 flex items-center gap-2 border-t border-line pt-3">
              <Button variant="primary" size="sm" disabled={state === 'saving'} onClick={() => void save()}>
                {state === 'saving' ? 'Saving…' : editing === 'new' ? 'Add template' : 'Save'}
              </Button>
              <Button size="sm" onClick={() => setEditing(null)}>Cancel</Button>
              {state === 'saving' && <Loader2 size={14} className="animate-spin text-faint" />}
            </div>
          </>
        )}

        {error && <p role="alert" className="mt-2.5 text-2xs text-danger-strong">{error}</p>}
      </div>
    </Modal>
  );
}
