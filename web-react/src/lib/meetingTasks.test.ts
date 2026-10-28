import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acceptedItems, draftsFrom, lastDatabase, makeTasks, madeTasksMessage, rememberDatabase, suggestTasks, taskDatabases, tasksFromProposals,
} from './meetingTasks';
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
    expect(madeTasksMessage({ created: [{ taskId: 't', title: 'a' }], skipped: 0, failed: 1, error: 'x' }))
      .toBe('Created 1 task, 1 failed — try again');
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

describe('suggest tasks', () => {
  const members = [{ id: 'u1', username: 'Farhanaj' }, { id: 'u2', username: 'sajjad' }];
  it('turns proposals into editable drafts, accepted by default', () => {
    expect(draftsFrom([
      { title: 'Send deck', assignee: 'farhanaj', dueAt: '2026-10-30', sourceText: 'deck by fri' },
      { title: 'Ghost', assignee: 'ghost', dueAt: null, sourceText: null },
    ], members)).toEqual([
      { title: 'Send deck', assigneeId: 'u1', dueAt: '2026-10-30', accept: true, sourceText: 'deck by fri' },
      { title: 'Ghost', assigneeId: '', dueAt: '', accept: true, sourceText: null },
    ]);
  });
  it('sends only the accepted drafts, trimmed, with no date as null', () => {
    const d = (o: object) => ({ title: 't', assigneeId: '', dueAt: '', accept: true, sourceText: null, ...o });
    expect(acceptedItems([d({ title: ' a ', assigneeId: 'u1', dueAt: '2026-10-30' }), d({ accept: false }), d({ title: 'b' })]))
      .toEqual({ items: [{ title: 'a', assigneeIds: ['u1'], dueAt: '2026-10-30' }, { title: 'b', assigneeIds: [], dueAt: null }] });
  });
  it('says what is wrong with the drafts', () => {
    const d = (o: object) => ({ title: 't', assigneeId: '', dueAt: '', accept: true, sourceText: null, ...o });
    expect(acceptedItems([d({ accept: false })]).error).toBe('Pick at least one task');
    expect(acceptedItems([d({ title: '  ' })]).error).toBe('Every task needs a title');
    expect(acceptedItems([d({ title: 'x'.repeat(201) })]).error).toMatch(/200/);
    expect(acceptedItems([d({ dueAt: '30/10/2026' })]).error).toMatch(/date/);
  });
  it('calls the two routes', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ proposals: [] }) }));
    vi.stubGlobal('fetch', f);
    expect(await suggestTasks('d 1')).toEqual([]);
    expect(f).toHaveBeenCalledWith('/api/docs/d%201/suggest-tasks', expect.objectContaining({ method: 'POST' }));
    f.mockImplementation(async () => ({ ok: true, json: async () => ({ created: [] }) }) as never);
    await tasksFromProposals('d', 'p1', [{ title: 'a', assigneeIds: [], dueAt: null }]);
    expect(f).toHaveBeenLastCalledWith('/api/docs/d/tasks-from-proposals', expect.objectContaining({
      body: '{"projectId":"p1","items":[{"title":"a","assigneeIds":[],"dueAt":null}]}',
    }));
  });
});
