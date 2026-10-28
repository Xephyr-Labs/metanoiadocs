// "Make tasks from to-dos" on a page: the call, and the database it last went to.
import type { ProjectRow } from './tasksApi';

export interface MadeTasks {
  created: { taskId: string; title: string }[];
  skipped: number;
  /** Lines left unmade after a failure partway through; the rest were made and linked. */
  failed?: number;
  error?: string;
}

export async function makeTasks(docId: string, projectId: string): Promise<MadeTasks> {
  const res = await fetch(`/api/docs/${encodeURIComponent(docId)}/make-tasks`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
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
