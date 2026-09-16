import type { StoredFile } from './uploads';
import type { Filter } from './taskFilter';
import type { SortRule } from './taskSort';

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

/** A database is either a board of work, or a plain table of records. */
export type ProjectMode = 'tasks' | 'data';

export interface ProjectRow {
  id: string;
  name: string;
  icon: string;
  color: string;
  doc_id: string | null;
  position: number;
  parent_id: string | null;
  mode: ProjectMode;
  /** Per-project colours for the four fixed statuses, `{ status: colour }`.
   *  Missing keys fall back to the palette builtinProps has always drawn. */
  status_colors: Record<string, string>;
  /** Postgres count() arrives as a string. */
  total: string;
  done: string;
  overdue: string;
}

export type PropType =
  | 'text' | 'number' | 'select' | 'multi_select'
  | 'date' | 'checkbox' | 'person' | 'url' | 'email' | 'phone'
  | 'file' | 'relation' | 'formula' | 'rollup';

export const PROP_TYPES: PropType[] = [
  'text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'person',
  'url', 'email', 'phone', 'file', 'relation', 'formula', 'rollup',
];

export const PROP_TYPE_LABEL: Record<PropType, string> = {
  text: 'Text', number: 'Number', select: 'Select', multi_select: 'Multi-select',
  date: 'Date', checkbox: 'Checkbox', person: 'Person', url: 'URL',
  email: 'Email', phone: 'Phone', file: 'Files & media', relation: 'Relation',
  formula: 'Formula', rollup: 'Rollup',
};

/** Types computed from other cells rather than stored — see lib/computed.ts.
 *  Nothing writes them, so every editor renders them read-only. */
export const COMPUTED_TYPES: PropType[] = ['formula', 'rollup'];

export const isComputed = (type: PropType) => COMPUTED_TYPES.includes(type);

/** The six shapes a saved view can take. Mirrors VIEW_KINDS in server/src/views.js. */
export type ViewKind = 'backlog' | 'board' | 'table' | 'gantt' | 'calendar' | 'gallery';

export const VIEW_KINDS: ViewKind[] = ['backlog', 'board', 'table', 'gantt', 'calendar', 'gallery'];

export const VIEW_KIND_LABEL: Record<ViewKind, string> = {
  backlog: 'Backlog', board: 'Board', table: 'Table',
  gantt: 'Gantt', calendar: 'Calendar', gallery: 'Gallery',
};

/**
 * Everything a view remembers. One bag rather than six columns because the
 * toolbar reads and writes it as a unit — see server/src/views.js.
 *
 * `props` null means "never configured", which is what lets a view fall back to
 * its type's default set instead of showing nothing.
 */
export interface ViewConfig {
  filters?: Filter[];
  sort?: SortRule[];
  /** A FilterField key, or null for an ungrouped view. */
  groupBy?: string | null;
  props?: string[] | null;
  /** 'all', 'backlog', or a sprint id. */
  scope?: string;
}

export interface ViewRow {
  id: string;
  project_id: string;
  name: string;
  kind: ViewKind;
  position: number;
  config: ViewConfig;
}

export interface PropOption {
  id: string;
  label: string;
  color: string;
}

export interface PropRow {
  id: string;
  project_id: string;
  key: string;
  label: string;
  type: PropType;
  options: PropOption[];
  target_project_id: string | null;
  position: number;
  /** Type-specific settings: a formula's expression, a rollup's
   *  (relation, target, function). Empty for every other type. */
  config?: { expression?: string; relation?: string; target?: string; fn?: string };
  /** The other half of a two-way relation, if it has one. */
  paired_prop_id?: string | null;
  /** True on the generated half — its edges live under the defining property,
   *  read backwards. */
  is_inverse?: boolean;
}

/** A row in another database, as shown on a relation chip. */
export interface RelatedRow {
  id: string;
  title: string;
  project_id: string;
  project_name: string;
  doc_id: string | null;
}

/** One of the people a task is on, in the order they were put there. */
export interface Assignee {
  id: string;
  name: string;
}

export interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  status: TaskStatus;
  /** The first assignee. Kept for the narrow cells that show a single name —
   *  `assignees` is the whole list. */
  assignee_id: string | null;
  assignee_name: string | null;
  assignees: Assignee[];
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
  /** Focus areas, read from the tags on the task's own page. Empty when the
   *  task has no page yet, or its page is untagged; absent on a row that came
   *  from a cached response predating them. */
  tags?: string[];
  /** Files on the task itself. A column, not a property, so every database has
   *  them without one first having to be defined. */
  attachments?: StoredFile[];
  props: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  /** Names, resolved server-side, so "created by" can be a property without a
   *  second lookup table in the browser. */
  created_by_name?: string | null;
  updated_by_name?: string | null;
  /** Ids of the rows this one links to, keyed by relation property id.
   *  Carried on the list so a rollup can reduce them without a request per
   *  row — distinct from TaskDetail.relations, which carries whole rows. */
  relationIds?: Record<string, string[]>;
  /** Opening text of the row's own page; null when it has no page or an empty
   *  one. Shown by the gallery view — run it through previewLine() first. */
  preview: string | null;
}

/** A task seen from outside its own board, so it has to say where it lives. */
export interface AnyTaskRow extends TaskRow {
  project_name: string;
  project_icon: string;
}

/** What a page knows about the task it belongs to. */
export interface DocTask {
  id: string;
  title: string;
  status: TaskStatus;
  project_id: string;
  project_name: string;
  project_icon: string;
  project_mode: ProjectMode;
}

export interface TaskDetail extends TaskRow {
  relations: Record<string, RelatedRow[]>;
  backlinks: RelatedRow[];
}

export interface TaskPatch {
  title?: string;
  status?: TaskStatus;
  /** Everyone on the task. Sending it replaces the list. */
  assigneeIds?: string[];
  /** The single-assignee form, still used by the table's one-name cell. */
  assigneeId?: string | null;
  startAt?: string | null;
  dueAt?: string | null;
  priority?: number;
  progress?: number;
  points?: number | null;
  milestone?: boolean;
  attachments?: StoredFile[];
  docId?: string | null;
  position?: number;
  kind?: TaskKind;
  sprintId?: string | null;
  parentId?: string | null;
  props?: Record<string, unknown>;
}

export interface ActivityRow {
  kind: 'doc_created' | 'doc_edited' | 'comment' | 'task_created' | 'task_done';
  actor_id: string | null;
  actor_name: string | null;
  /** 'agent' when the account that did this runs on someone's behalf. */
  actor_kind: 'person' | 'agent';
  /** 'ai' when the copilot made this write inside that person's session. */
  via: 'human' | 'ai';
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

/* ---- automations ------------------------------------------------------ */

export type AutomationTrigger = 'status' | 'manual';

/** One thing a rule does. `assign` carries a list; everything else carries one
 *  value, and `null` means "clear it" — a rule that empties the sprint moves a
 *  task to the backlog, which is a real thing to want. */
export type AutomationAction =
  | { type: 'assign'; userIds: string[] }
  | { type: 'status'; value: TaskStatus }
  | { type: 'kind'; value: string }
  /** A sprint id, `'active'` for whichever sprint is running, or null for the backlog. */
  | { type: 'sprint'; value: string | null }
  | { type: 'priority'; value: number }
  | { type: 'points'; value: number | null }
  | { type: 'progress'; value: number };

export interface AutomationRow {
  id: string;
  project_id: string;
  name: string;
  trigger_kind: AutomationTrigger;
  /** The status a task has to enter, for a `status` rule. Null for a manual one. */
  trigger_value: string | null;
  actions: AutomationAction[];
  active: boolean;
  position: number;
}

/* ---- agent runs -------------------------------------------------------- */

export interface AgentRow {
  id: string;
  name: string;
  username: string | null;
  email: string;
}

export type RunStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface AgentRunRow {
  id: string;
  agent_id: string;
  agent_name: string | null;
  task_id: string | null;
  trigger: 'assign' | 'mention' | 'manual';
  status: RunStatus;
  result: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export const tasksApi = {
  home: (): Promise<HomePayload> => req('/home'),

  projects: (): Promise<ProjectRow[]> => req('/projects'),
  createProject: (b: { name: string; icon?: string; color?: string; docId?: string; parentId?: string | null; mode?: ProjectMode }): Promise<ProjectRow> =>
    req('/projects', { method: 'POST', ...body(b) }),
  patchProject: (
    id: string,
    b: Partial<{ name: string; icon: string; color: string; position: number; archived: boolean; mode: ProjectMode; statusColors: Record<string, string> }>,
  ) =>
    req(`/projects/${id}`, { method: 'PATCH', ...body(b) }),
  archiveProject: (id: string) => req(`/projects/${id}`, { method: 'DELETE' }),
  moveProject: (id: string, b: { parentId: string | null; position?: number }): Promise<ProjectRow> =>
    req(`/projects/${id}/move`, { method: 'POST', ...body(b) }),

  views: (projectId: string): Promise<ViewRow[]> => req(`/projects/${projectId}/views`),
  createView: (projectId: string, b: { name?: string; kind?: ViewKind; config?: ViewConfig }): Promise<ViewRow> =>
    req(`/projects/${projectId}/views`, { method: 'POST', ...body(b) }),
  /** `config` is MERGED server-side, so one facet can be saved without
   *  restating the rest — see the PATCH in server/src/views.js. */
  patchView: (id: string, b: Partial<{ name: string; kind: ViewKind; position: number; config: ViewConfig }>): Promise<ViewRow> =>
    req(`/views/${id}`, { method: 'PATCH', ...body(b) }),
  deleteView: (id: string) => req(`/views/${id}`, { method: 'DELETE' }),

  props: (projectId: string): Promise<PropRow[]> => req(`/projects/${projectId}/props`),
  createProp: (
    projectId: string,
    b: { label: string; type?: PropType; options?: PropOption[]; targetProjectId?: string; twoWay?: boolean; inverseLabel?: string; config?: PropRow['config'] },
  ): Promise<PropRow> => req(`/projects/${projectId}/props`, { method: 'POST', ...body(b) }),
  patchProp: (
    id: string,
    b: Partial<{ label: string; type: PropType; options: PropOption[]; position: number; targetProjectId: string | null; config: PropRow['config'] }>,
  ): Promise<PropRow> => req(`/props/${id}`, { method: 'PATCH', ...body(b) }),
  deleteProp: (id: string) => req(`/props/${id}`, { method: 'DELETE' }),

  kinds: (projectId: string): Promise<TaskKindRow[]> => req(`/projects/${projectId}/kinds`),
  createKind: (projectId: string, b: { label: string; color?: string; isGroup?: boolean }): Promise<TaskKindRow> =>
    req(`/projects/${projectId}/kinds`, { method: 'POST', ...body(b) }),
  patchKind: (id: string, b: Partial<{ label: string; color: string; isGroup: boolean; position: number }>): Promise<TaskKindRow> =>
    req(`/kinds/${id}`, { method: 'PATCH', ...body(b) }),
  /** Resolves with how many tasks were moved off the deleted type, and where. */
  deleteKind: (id: string): Promise<{ moved: number; movedTo: string }> =>
    req(`/kinds/${id}`, { method: 'DELETE' }),

  projectTasks: (id: string): Promise<TaskRow[]> => req(`/projects/${id}/tasks`),
  /** Every live task in the workspace, plus the union of the task types the
   *  projects define — what the cross-project Tasks view filters over. */
  allTasks: (): Promise<{ tasks: AnyTaskRow[]; kinds: { key: string; label: string }[] }> =>
    req('/tasks'),
  createTask: (b: { projectId: string; title: string } & TaskPatch): Promise<TaskRow> =>
    req('/tasks', { method: 'POST', ...body(b) }),
  patchTask: (id: string, b: TaskPatch): Promise<TaskRow> =>
    req(`/tasks/${id}`, { method: 'PATCH', ...body(b) }),
  deleteTask: (id: string) => req(`/tasks/${id}`, { method: 'DELETE' }),

  task: (id: string): Promise<TaskDetail> => req(`/tasks/${id}`),
  addRelation: (id: string, propId: string, toId: string) =>
    req(`/tasks/${id}/relations`, { method: 'POST', ...body({ propId, toId }) }),
  removeRelation: (id: string, propId: string, toId: string) =>
    req(`/tasks/${id}/relations`, { method: 'DELETE', ...body({ propId, toId }) }),
  /** Creates the row's page on first call, returns the same id after that. */
  taskPage: (id: string): Promise<{ docId: string }> => req(`/tasks/${id}/page`, { method: 'POST' }),
  /** The task a page belongs to, for the link back to its board. Null for the
   *  great majority of pages, which belong to no task. */
  docTask: (docId: string): Promise<{ task: DocTask | null }> => req(`/docs/${docId}/task`),

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

  automations: (projectId: string): Promise<AutomationRow[]> => req(`/projects/${projectId}/automations`),
  createAutomation: (projectId: string, b: { name?: string; trigger?: AutomationTrigger; value?: string | null; actions?: AutomationAction[] }): Promise<AutomationRow> =>
    req(`/projects/${projectId}/automations`, { method: 'POST', ...body(b) }),
  patchAutomation: (id: string, b: Partial<{ name: string; trigger: AutomationTrigger; value: string | null; actions: AutomationAction[]; active: boolean; position: number }>): Promise<AutomationRow> =>
    req(`/automations/${id}`, { method: 'PATCH', ...body(b) }),
  deleteAutomation: (id: string) => req(`/automations/${id}`, { method: 'DELETE' }),
  /** Fire a rule on one task by hand — what makes a rule a quick action. */
  runAutomation: (taskId: string, automationId: string): Promise<{ ok: true; applied: unknown[] }> =>
    req(`/tasks/${taskId}/automations/${automationId}/run`, { method: 'POST' }),

  agents: (): Promise<AgentRow[]> => req('/agents'),
  taskRuns: (taskId: string): Promise<AgentRunRow[]> => req(`/tasks/${taskId}/runs`),
  startRun: (taskId: string, agentId: string): Promise<AgentRunRow> =>
    req(`/tasks/${taskId}/runs`, { method: 'POST', ...body({ agentId }) }),
  cancelRun: (id: string): Promise<AgentRunRow> => req(`/agent/runs/${id}/cancel`, { method: 'POST' }),
};
