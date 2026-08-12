// Client for the projects/tasks endpoints and the home dashboard payload.
// Same-origin and cookie-authed, matching docsApi.

async function req(path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: opts.body ? { 'Content-Type': 'application/json', ...(opts.headers || {}) } : opts.headers,
    ...opts,
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const d = await res.json();
      if (d?.error) msg = d.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

const body = (v: unknown) => ({ body: JSON.stringify(v) });

export type TaskStatus = 'todo' | 'doing' | 'review' | 'done';
export const STATUSES: TaskStatus[] = ['todo', 'doing', 'review', 'done'];
export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  doing: 'In progress',
  review: 'Review',
  done: 'Done',
};

/**
 * A task's type is the `key` of one of its project's `TaskKindRow`s — a plain
 * string, not a closed union, because anyone can add a type from the UI.
 * Resolve it to a row with `useKind` before drawing a label or colour.
 */
export type TaskKind = string;

export interface TaskKindRow {
  id: string;
  project_id: string;
  key: string;
  label: string;
  color: string;
  /** Holds children, the way Epic does. Drives the parent picker and rollups. */
  is_group: boolean;
  position: number;
}

export type SprintState = 'planned' | 'active' | 'done';

export interface SprintRow {
  id: string;
  project_id: string;
  name: string;
  start_at: string | null;
  end_at: string | null;
  state: SprintState;
  /** Postgres aggregates arrive as strings. */
  total: string;
  done: string;
  points: string;
  points_done: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  icon: string;
  color: string;
  doc_id: string | null;
  position: number;
  /** Postgres count() arrives as a string. */
  total: string;
  done: string;
  overdue: string;
}

export interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  status: TaskStatus;
  assignee_id: string | null;
  assignee_name: string | null;
  start_at: string | null;
  due_at: string | null;
  priority: number;
  progress: number;
  points: number | null;
  milestone: boolean;
  doc_id: string | null;
  parent_id: string | null;
  kind: TaskKind;
  sprint_id: string | null;
  position: number;
  done_at: string | null;
  deps: string[];
}

export interface TaskPatch {
  title?: string;
  status?: TaskStatus;
  assigneeId?: string | null;
  startAt?: string | null;
  dueAt?: string | null;
  priority?: number;
  progress?: number;
  points?: number | null;
  milestone?: boolean;
  docId?: string | null;
  position?: number;
  kind?: TaskKind;
  sprintId?: string | null;
  parentId?: string | null;
}

export interface ActivityRow {
  kind: 'doc_created' | 'doc_edited' | 'comment' | 'task_created' | 'task_done';
  actor_id: string | null;
  actor_name: string | null;
  at: string;
  doc_id: string | null;
  project_id: string | null;
  title: string;
  icon: string;
  task_id: string | null;
  body: string | null;
}

export interface MyTask {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: string | null;
  priority: number;
  progress: number;
  project_id: string;
  project_name: string;
  project_icon: string;
  bucket: 'overdue' | 'today' | 'week' | 'later';
}

export interface HomePayload {
  stats: { my_open: string; my_overdue: string; my_week: string; docs_week: string };
  myTasks: Record<'overdue' | 'today' | 'week' | 'later', MyTask[]>;
  recentDocs: { id: string; title: string; icon: string; updated_at: string; updated_by_name: string | null }[];
  activity: ActivityRow[];
  projects: ProjectRow[];
}

export const tasksApi = {
  home: (): Promise<HomePayload> => req('/home'),

  projects: (): Promise<ProjectRow[]> => req('/projects'),
  createProject: (b: { name: string; icon?: string; color?: string; docId?: string }): Promise<ProjectRow> =>
    req('/projects', { method: 'POST', ...body(b) }),
  patchProject: (id: string, b: Partial<{ name: string; icon: string; color: string; position: number }>) =>
    req(`/projects/${id}`, { method: 'PATCH', ...body(b) }),
  archiveProject: (id: string) => req(`/projects/${id}`, { method: 'DELETE' }),

  kinds: (projectId: string): Promise<TaskKindRow[]> => req(`/projects/${projectId}/kinds`),
  createKind: (projectId: string, b: { label: string; color?: string; isGroup?: boolean }): Promise<TaskKindRow> =>
    req(`/projects/${projectId}/kinds`, { method: 'POST', ...body(b) }),
  patchKind: (id: string, b: Partial<{ label: string; color: string; isGroup: boolean; position: number }>): Promise<TaskKindRow> =>
    req(`/kinds/${id}`, { method: 'PATCH', ...body(b) }),
  /** Resolves with how many tasks were moved off the deleted type, and where. */
  deleteKind: (id: string): Promise<{ moved: number; movedTo: string }> =>
    req(`/kinds/${id}`, { method: 'DELETE' }),

  projectTasks: (id: string): Promise<TaskRow[]> => req(`/projects/${id}/tasks`),
  createTask: (b: { projectId: string; title: string } & TaskPatch): Promise<TaskRow> =>
    req('/tasks', { method: 'POST', ...body(b) }),
  patchTask: (id: string, b: TaskPatch): Promise<TaskRow> =>
    req(`/tasks/${id}`, { method: 'PATCH', ...body(b) }),
  deleteTask: (id: string) => req(`/tasks/${id}`, { method: 'DELETE' }),

  sprints: (projectId: string): Promise<SprintRow[]> => req(`/projects/${projectId}/sprints`),
  createSprint: (projectId: string, b: { name: string; startAt?: string | null; endAt?: string | null }): Promise<SprintRow> =>
    req(`/projects/${projectId}/sprints`, { method: 'POST', ...body(b) }),
  patchSprint: (id: string, b: Partial<{ name: string; startAt: string | null; endAt: string | null; state: SprintState }>): Promise<SprintRow> =>
    req(`/sprints/${id}`, { method: 'PATCH', ...body(b) }),
  deleteSprint: (id: string) => req(`/sprints/${id}`, { method: 'DELETE' }),

  addDep: (id: string, dependsOn: string) =>
    req(`/tasks/${id}/deps`, { method: 'POST', ...body({ dependsOn }) }),
  removeDep: (id: string, dependsOn: string) =>
    req(`/tasks/${id}/deps/${dependsOn}`, { method: 'DELETE' }),
};
