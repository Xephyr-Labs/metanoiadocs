import { useCallback, useEffect, useState } from 'react';
import { docsApi, type UserRow } from '../../lib/docsApi';
import { tasksApi, type SprintRow, type SprintState, type TaskKindRow, type TaskPatch, type TaskRow } from '../../lib/tasksApi';

/** What a task-type mutation reports back to the dialog that asked for it. */
export type KindResult =
  | { ok: true; moved?: number; movedTo?: string }
  | { ok: false; error: string };

/**
 * One source of tasks for all views, so a drag on the board updates the
 * gantt without a second fetch. Mutations apply locally first and re-sync from
 * the server on failure — the same optimistic pattern the doc store uses.
 */
export function useProject(projectId: string | null) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [sprints, setSprints] = useState<SprintRow[]>([]);
  const [kinds, setKinds] = useState<TaskKindRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const [t, s, k] = await Promise.all([
        tasksApi.projectTasks(projectId),
        tasksApi.sprints(projectId).catch(() => [] as SprintRow[]),
        tasksApi.kinds(projectId).catch(() => [] as TaskKindRow[]),
      ]);
      setTasks(t);
      setSprints(s);
      setKinds(k);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load tasks.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  useEffect(() => {
    docsApi.users().then(setUsers).catch(() => setUsers([]));
  }, []);

  const patch = useCallback(async (id: string, body: TaskPatch) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...localShape(body, users) } : t)));
    try {
      const row = await tasksApi.patchTask(id, body);
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...row } : t)));
      // Sprint rollups (points, done counts) live server-side.
      if (body.sprintId !== undefined || body.status !== undefined || body.points !== undefined) refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that change.');
      refresh();
    }
  }, [refresh, users]);

  const create = useCallback(async (body: { title: string } & TaskPatch) => {
    if (!projectId) return null;
    try {
      const row = await tasksApi.createTask({ projectId, ...body });
      setTasks((prev) => [...prev, { ...row, deps: [] }]);
      return row;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that task.');
      return null;
    }
  }, [projectId]);

  const remove = useCallback(async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await tasksApi.deleteTask(id).catch(() => refresh());
  }, [refresh]);

  const addDep = useCallback(async (id: string, dependsOn: string) => {
    try {
      await tasksApi.addDep(id, dependsOn);
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, deps: [...t.deps, dependsOn] } : t)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not link those tasks.');
    }
  }, []);

  const removeDep = useCallback(async (id: string, dependsOn: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, deps: t.deps.filter((d) => d !== dependsOn) } : t)));
    await tasksApi.removeDep(id, dependsOn).catch(() => refresh());
  }, [refresh]);

  // The three type mutations hand their failure back to the caller instead of
  // pushing it into `error`. That banner renders inside the page column, which
  // the type editor's modal overlay covers — an error posted there during a
  // failed save is one nobody sees.
  const createKind = useCallback(async (b: { label: string; color?: string; isGroup?: boolean }): Promise<KindResult> => {
    if (!projectId) return { ok: false, error: 'No project is open.' };
    try {
      const row = await tasksApi.createKind(projectId, b);
      setKinds((prev) => [...prev, row]);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Could not add that type.' };
    }
  }, [projectId]);

  const patchKind = useCallback(async (id: string, b: Partial<{ label: string; color: string; isGroup: boolean }>): Promise<KindResult> => {
    const before = kinds;
    setKinds((prev) => prev.map((k) => (k.id === id
      ? { ...k, ...(b.label !== undefined && { label: b.label }), ...(b.color !== undefined && { color: b.color }), ...(b.isGroup !== undefined && { is_group: b.isGroup }) }
      : k)));
    try {
      const row = await tasksApi.patchKind(id, b);
      setKinds((prev) => prev.map((k) => (k.id === id ? row : k)));
      return { ok: true };
    } catch (e) {
      setKinds(before); // Roll the optimistic paint back, or the row lies.
      return { ok: false, error: e instanceof Error ? e.message : 'Could not save that type.' };
    }
  }, [kinds]);

  /** On success, reports what the server did with the tasks that held the type. */
  const deleteKind = useCallback(async (id: string): Promise<KindResult> => {
    try {
      const out = await tasksApi.deleteKind(id);
      setKinds((prev) => prev.filter((k) => k.id !== id));
      // Those tasks now carry a different type; the board and table show it.
      if (out.moved) refresh();
      return { ok: true, moved: out.moved, movedTo: out.movedTo };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Could not delete that type.' };
    }
  }, [refresh]);

  const createSprint = useCallback(async (name: string) => {
    if (!projectId) return;
    try {
      const row = await tasksApi.createSprint(projectId, { name });
      setSprints((prev) => [...prev, row]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that sprint.');
    }
  }, [projectId]);

  const patchSprint = useCallback(async (id: string, body: Partial<{ name: string; startAt: string | null; endAt: string | null; state: SprintState }>) => {
    try {
      await tasksApi.patchSprint(id, body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update that sprint.');
    }
    // State changes move tasks (complete → backlog) and reorder — resync both.
    refresh();
  }, [refresh]);

  const deleteSprint = useCallback(async (id: string) => {
    setSprints((prev) => prev.filter((s) => s.id !== id));
    setTasks((prev) => prev.map((t) => (t.sprint_id === id ? { ...t, sprint_id: null } : t)));
    await tasksApi.deleteSprint(id).catch(() => refresh());
  }, [refresh]);

  return {
    tasks, sprints, kinds, users, loading, error, setError, refresh,
    patch, create, remove, addDep, removeDep,
    createKind, patchKind, deleteKind,
    createSprint, patchSprint, deleteSprint,
  };
}

/** Map the PATCH body onto row fields so the optimistic update looks right. */
function localShape(body: TaskPatch, users: UserRow[]): Partial<TaskRow> {
  const out: Partial<TaskRow> = {};
  if (body.title !== undefined) out.title = body.title;
  if (body.status !== undefined) out.status = body.status;
  if (body.startAt !== undefined) out.start_at = body.startAt;
  if (body.dueAt !== undefined) out.due_at = body.dueAt;
  if (body.priority !== undefined) out.priority = body.priority;
  if (body.progress !== undefined) out.progress = body.progress;
  if (body.points !== undefined) out.points = body.points;
  if (body.milestone !== undefined) out.milestone = body.milestone;
  if (body.position !== undefined) out.position = body.position;
  if (body.kind !== undefined) out.kind = body.kind;
  if (body.sprintId !== undefined) out.sprint_id = body.sprintId;
  if (body.parentId !== undefined) out.parent_id = body.parentId;
  if (body.assigneeId !== undefined) {
    out.assignee_id = body.assigneeId;
    out.assignee_name = users.find((u) => u.id === body.assigneeId)?.name ?? null;
  }
  return out;
}
