import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflow, registerWorkflowTemplateRoutes } from './workflow-templates.js';
function database(fail = false) {
  const calls = [];
  const client = { query: async (sql, args) => { calls.push({ sql, args }); if (fail && /INSERT INTO tasks/.test(sql)) throw new Error('write failed'); return { rows: [{ id: 'space' }], rowCount: 1 }; }, release() { calls.push({ sql: 'release' }); } };
  return { calls, pool: { connect: async () => client } };
}
test('connected workflow commits brief, project, milestones and private meeting notes together', async () => {
  const { pool, calls } = database();
  const result = await createWorkflow(pool, { templateId: 'launch', name: 'Spring', spaceId: 'space', userId: 'me' });
  assert.ok(result.projectId && result.briefId && result.notesId);
  assert.equal(calls.filter(c => /INSERT INTO tasks/.test(c.sql)).length, 3);
  assert.equal(calls.filter(c => /INSERT INTO docs/.test(c.sql)).length, 2);
  assert.ok(calls.some(c => /INSERT INTO docs/.test(c.sql) && c.args.includes('private')));
  assert.equal(calls.at(-2).sql, 'COMMIT');
});
test('partial workflow failure rolls back every record and releases connection', async () => {
  const { pool, calls } = database(true);
  await assert.rejects(createWorkflow(pool, { templateId: 'onboarding', name: 'Alex', spaceId: 'space', userId: 'me' }), /write failed/);
  assert.equal(calls.at(-2).sql, 'ROLLBACK');
  assert.ok(!calls.some(c => c.sql === 'COMMIT'));
});
test('unknown templates and blank names are rejected before acquiring a transaction', async () => {
  const pool = { connect: () => { throw new Error('must not connect'); } };
  await assert.rejects(createWorkflow(pool, { templateId: 'evil', name: 'x' }), /Unknown workflow/);
  await assert.rejects(createWorkflow(pool, { templateId: 'launch', name: ' ' }), /name/);
});
test('routes require signed-in person for writes and reject malformed input', async () => {
  const routes = {}; const auth = () => {}; const person = () => {};
  registerWorkflowTemplateRoutes({ get() {}, post(path, ...handlers) { routes[path] = handlers; } }, { requireUser: auth, needsPerson: person, wrap: f => f, pool: {} });
  const handlers = routes['/api/workflow-templates/:id/use'];
  assert.equal(handlers[0], auth); assert.equal(handlers[1], person);
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await handlers.at(-1)({ params: { id: 'launch' }, body: { name: 123 }, user: { id: 'me' } }, res);
  assert.equal(res.code, 400);
});

test('project names cannot inject extra links into the connected brief', async () => {
  const { pool, calls } = database();
  await createWorkflow(pool, { templateId: 'launch', name: 'Name](https://evil.test)', spaceId: 'space', userId: 'me' });
  const body = calls.find(c => /INSERT INTO docs/.test(c.sql)).args.at(-1);
  assert.doesNotMatch(body, /\[Name\]\(https:\/\/evil/);
});
