// "Make tasks from to-dos" on a page: the call, and the database it last went to.
import type { ProjectRow } from './tasksApi';

export interface MadeTasks {
  created: { taskId: string; title: string }[];
  skipped: number;
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

export function madeTasksMessage({ created, skipped }: MadeTasks): string {
  const n = created.length;
  const head = `Created ${n} task${n === 1 ? '' : 's'}`;
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
