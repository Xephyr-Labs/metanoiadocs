import { useCallback, useEffect, useState } from 'react';
import { docsApi, type UserRow } from '../../lib/docsApi';
import { tasksApi, type TaskPatch, type TaskRow } from '../../lib/tasksApi';

/**
 * One source of tasks for all four views, so a drag on the board updates the
 * gantt without a second fetch. Mutations apply locally first and re-sync from
 * the server on failure — the same optimistic pattern the doc store uses.
 */
export function useProject(projectId: string | null) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      setTasks(await tasksApi.projectTasks(projectId));
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

  return { tasks, users, loading, error, setError, refresh, patch, create, remove, addDep, removeDep };
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
  if (body.assigneeId !== undefined) {
    out.assignee_id = body.assigneeId;
    out.assignee_name = users.find((u) => u.id === body.assigneeId)?.name ?? null;
  }
  return out;
}
