import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrieveWorkspaceEvidence, WORKSPACE_EVIDENCE_POLICY } from './workspace-evidence.js';

test('retrieves accessible document, task and comment evidence with citations and forwards no writes', async () => {
  const seen = [];
  const api = async (path) => {
    seen.push(path);
    if (path.startsWith('/search')) return [{ id: 'd1', title: 'Launch', snippet: 'Awaiting approval' }, { id: 'drive1', kind: 'drive' }];
    if (path === '/tasks?spaces=all') return { tasks: [{ id: 't1', title: 'Launch QA', status: 'blocked', project_id: 'p1' }] };
    if (path.endsWith('/comments')) return [{ id: 'c1', body: 'Blocked on legal', resolved: false }];
    throw new Error('private');
  };
  const result = await retrieveWorkspaceEvidence(api, 'launch');
  assert.deepEqual(result.sources.map(s => s.kind).sort(), ['comment', 'comment', 'document', 'task']);
  assert.ok(result.sources.every(s => s.url && s.excerpt));
  assert.ok(seen.includes('/docs/d1/comments'));
  assert.match(WORKSPACE_EVIDENCE_POLICY, /never invent/i);
});

test('empty results require abstention; failures remain explicit rather than claiming no blockers', async () => {
  const result = await retrieveWorkspaceEvidence(async () => { throw new Error('denied'); }, 'launch');
  assert.equal(result.sources.length, 0);
  assert.equal(result.insufficientEvidence, true);
  assert.equal(result.partial, true);
});

test('blocker evidence names unfinished dependencies and opens the actual task', async () => {
  const result = await retrieveWorkspaceEvidence(async path => {
    if (path.startsWith('/search')) return [];
    if (path.startsWith('/tasks?')) return { tasks: [
      { id: 'work', title: 'Ship', status: 'doing', project_id: 'p1', deps: ['wait', 'done'] },
      { id: 'wait', title: 'Legal approval', status: 'review', project_id: 'p1', deps: [] },
      { id: 'done', title: 'QA', status: 'done', project_id: 'p1', deps: [] },
      { id: 'clear', title: 'Ready', status: 'todo', project_id: 'p1', deps: ['done'] },
    ] };
    return [];
  }, 'What is blocking our work? Cite sources.');
  const task = result.sources.find(s => s.id === 'work');
  assert.equal(task?.url, '/db/p1?task=work');
  assert.match(task?.excerpt || '', /Legal approval.*review/);
  assert.equal(result.sources.some(s => s.id === 'clear'), false);
});
test('discussion citations use supported task navigation, not ignored comment query parameters', async () => {
  const result = await retrieveWorkspaceEvidence(async path => path.startsWith('/search') ? [] : path.startsWith('/tasks?') ? { tasks: [{ id: 't1', title: 'Launch', project_id: 'p1', status: 'todo', deps: ['unlisted'] }] } : [{ id: 'c1', body: 'Waiting on legal', resolved: false }], 'launch');
  assert.equal(result.sources.find(s => s.kind === 'comment')?.url, '/db/p1?task=t1');
  assert.equal(result.partial, true, 'unlisted dependency state cannot be declared complete');
});
test('mixed REST search results do not masquerade task hits as private pages and sources stay within stream budget', async () => {
  const seen = [];
  const result = await retrieveWorkspaceEvidence(async path => {
    seen.push(path);
    if (path.startsWith('/search')) return [{ kind: 'task', id: 't1', title: 'Launch', projectId: 'p1' }, ...Array.from({ length: 6 }, (_, i) => ({ kind: 'doc', id: `d${i}`, title: 'D'.repeat(200), snippet: 'S'.repeat(2000) }))];
    if (path.startsWith('/tasks?')) return { tasks: Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, title: 'Launch', status: 'todo', project_id: 'p1', deps: [] })) };
    return Array.from({ length: 5 }, (_, i) => ({ id: `${path}-${i}`, body: 'Q'.repeat(2000), resolved: i === 4 }));
  }, 'launch');
  assert.equal(seen.includes('/docs/t1/comments'), false);
  assert.ok(JSON.stringify(result).length < 18000);
  assert.equal(result.partial, true);
  assert.equal(result.sources.some(s => s.kind === 'comment' && s.id.endsWith('-4')), false);
});
