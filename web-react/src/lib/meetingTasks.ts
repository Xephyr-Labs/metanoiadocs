// "Make tasks from to-dos" and "Suggest tasks (Ask AI)" on a page: the calls,
// the proposal drafts, and the database it last went to.
import type { ProjectRow } from './tasksApi';

export interface MadeTasks {
  created: { taskId: string; title: string }[];
  /** Lines skipped by Make tasks (checked, already linked); not sent for proposals. */
  skipped?: number;
  /** Lines left unmade after a failure partway through; the rest were made and linked. */
  failed?: number;
  error?: string;
}

async function post<T>(docId: string, route: string, body: object): Promise<T> {
  const res = await fetch(`/api/docs/${encodeURIComponent(docId)}/${route}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const makeTasks = (docId: string, projectId: string) => post<MadeTasks>(docId, 'make-tasks', { projectId });

/** What Ask AI proposes; `assignee` is a member's username. Nothing is made yet. */
export interface Proposal {
  title: string;
  assignee: string | null;
  dueAt: string | null;
  sourceText: string | null;
}

export const suggestTasks = (docId: string) =>
  post<{ proposals: Proposal[] }>(docId, 'suggest-tasks', {}).then((r) => r.proposals);

export interface ProposalItem { title: string; assigneeIds: string[]; dueAt: string | null }

export const tasksFromProposals = (docId: string, projectId: string, items: ProposalItem[]) =>
  post<MadeTasks>(docId, 'tasks-from-proposals', { projectId, items });

/** A proposal as the dialog edits it: '' is "nobody" / "no date". */
export interface Draft {
  title: string;
  assigneeId: string;
  dueAt: string;
  accept: boolean;
  sourceText: string | null;
}

export function draftsFrom(proposals: Proposal[], members: { id: string; username: string }[]): Draft[] {
  const idOf = new Map(members.map((m) => [m.username.toLowerCase(), m.id]));
  return proposals.map((p) => ({
    title: p.title,
    assigneeId: (p.assignee && idOf.get(p.assignee.toLowerCase())) || '',
    dueAt: p.dueAt ?? '',
    accept: true,
    sourceText: p.sourceText,
  }));
}

/** The accepted drafts as the request's items, or what to fix first. */
export function acceptedItems(drafts: Draft[]): { items?: ProposalItem[]; error?: string } {
  const picked = drafts.filter((d) => d.accept);
  if (!picked.length) return { error: 'Pick at least one task' };
  const items = picked.map((d) => ({ title: d.title.trim(), assigneeIds: d.assigneeId ? [d.assigneeId] : [], dueAt: d.dueAt || null }));
  if (items.some((i) => !i.title)) return { error: 'Every task needs a title' };
  if (items.some((i) => i.title.length > 200)) return { error: 'Titles can be at most 200 characters' };
  if (items.some((i) => i.dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(i.dueAt))) return { error: 'A due date is not a date' };
  return { items };
}

let aiReady: Promise<boolean> | null = null;
/** Whether Ask AI is set up, asked once per tab. */
export function askAiReady(fetchConfig: () => Promise<{ enabled: boolean; keySet: boolean; baseUrl: string; model: string }>) {
  aiReady ??= fetchConfig().then((c) => c.enabled && c.keySet && !!c.baseUrl && !!c.model).catch(() => { aiReady = null; return false; });
  return aiReady;
}

/** The databases a task can go into: boards, not plain data tables. */
export const taskDatabases = (rows: ProjectRow[]) => rows.filter((p) => p.mode !== 'data');

export function madeTasksMessage({ created, skipped, failed }: MadeTasks): string {
  const n = created.length;
  const head = `Created ${n} task${n === 1 ? '' : 's'}`;
  if (failed) return `${head}, ${failed} failed — try again`;
  return skipped ? `${head} (${skipped} skipped)` : head;
}

const KEY = 'metanoia.makeTasks.projectId';

/** Last database picked on this device, or null. Storage may be blocked. */
export function lastDatabase(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function rememberDatabase(projectId: string): void {
  try { localStorage.setItem(KEY, projectId); } catch { /* storage blocked */ }
}
