import { afterEach, describe, expect, it, vi } from 'vitest';
import { lastDatabase, makeTasks, madeTasksMessage, rememberDatabase, taskDatabases } from './meetingTasks';
import type { ProjectRow } from './tasksApi';

afterEach(() => vi.unstubAllGlobals());

describe('meetingTasks', () => {
  it('posts the database to the page', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ created: [], skipped: 0 }) }));
    vi.stubGlobal('fetch', f);
    expect(await makeTasks('d 1', 'p1')).toEqual({ created: [], skipped: 0 });
    expect(f).toHaveBeenCalledWith('/api/docs/d%201/make-tasks', expect.objectContaining({ method: 'POST', body: '{"projectId":"p1"}' }));
  });
  it('throws the server error', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, json: async () => ({ error: 'no such database' }) }));
    await expect(makeTasks('d', 'p')).rejects.toThrow('no such database');
  });
  it('says what happened', () => {
    expect(madeTasksMessage({ created: [{ taskId: 't', title: 'a' }], skipped: 0 })).toBe('Created 1 task');
    expect(madeTasksMessage({ created: [], skipped: 2 })).toBe('Created 0 tasks (2 skipped)');
  });
  it('lists only task databases', () => {
    const rows = [{ id: 'a', mode: 'tasks' }, { id: 'b', mode: 'data' }] as ProjectRow[];
    expect(taskDatabases(rows).map((p) => p.id)).toEqual(['a']);
  });
  it('remembers the last database, and survives blocked storage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    rememberDatabase('p1');
    expect(lastDatabase()).toBe('p1');
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(() => rememberDatabase('p2')).not.toThrow();
    expect(lastDatabase()).toBeNull();
  });
});
