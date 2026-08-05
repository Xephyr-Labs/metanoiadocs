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

  projectTasks: (id: string): Promise<TaskRow[]> => req(`/projects/${id}/tasks`),
  createTask: (b: { projectId: string; title: string } & TaskPatch): Promise<TaskRow> =>
    req('/tasks', { method: 'POST', ...body(b) }),
  patchTask: (id: string, b: TaskPatch): Promise<TaskRow> =>
    req(`/tasks/${id}`, { method: 'PATCH', ...body(b) }),
  deleteTask: (id: string) => req(`/tasks/${id}`, { method: 'DELETE' }),

  addDep: (id: string, dependsOn: string) =>
    req(`/tasks/${id}/deps`, { method: 'POST', ...body({ dependsOn }) }),
  removeDep: (id: string, dependsOn: string) =>
    req(`/tasks/${id}/deps/${dependsOn}`, { method: 'DELETE' }),
};
