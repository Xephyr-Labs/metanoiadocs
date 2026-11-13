import test from 'node:test';
import assert from 'node:assert/strict';
import { registerInboxActionRoutes } from './inbox-actions.js';
function setup(rows = [{ id: 'n1' }]) {
  const routes = {}, calls = [];
  registerInboxActionRoutes({ post(path, ...handlers) { routes[path] = handlers.at(-1); } }, {
    requireUser() {}, wrap: fn => fn, pool: { async query(sql, params) { calls.push({ sql, params }); return { rows }; } },
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  return { calls, res, run: body => routes['/api/inbox/:id/action']({ user: { id: 'u1' }, params: { id: 'n1' }, body }, res) };
}
test('archive is scoped to the recipient and returns persisted state', async () => {
  const s = setup(); await s.run({ action: 'archive' });
  assert.match(s.calls[0].sql, /user_id = \$2/); assert.deepEqual(s.calls[0].params.slice(0, 2), ['n1', 'u1']);
  assert.match(s.calls[0].sql, /archived_at = now\(\)/); assert.equal(s.res.code, 200);
});
test('undo restores a notification to the active inbox', async () => {
  const s = setup(); await s.run({ action: 'restore' });
  assert.match(s.calls[0].sql, /archived_at = NULL, snoozed_until = NULL/);
});
test('snooze accepts only a future instant within a year', async () => {
  for (const until of ['invalid', '2000-01-01', '2100-01-01', 42]) {
    const s = setup(); await s.run({ action: 'snooze', until }); assert.equal(s.res.code, 400); assert.equal(s.calls.length, 0);
  }
  const s = setup(); const until = new Date(Date.now() + 3600000).toISOString();
  await s.run({ action: 'snooze', until }); assert.equal(s.res.code, 200); assert.equal(s.calls[0].params[2], until);
});
test('unknown actions never write and another recipient cannot act', async () => {
  const s = setup(); await s.run({ action: 'delete' }); assert.equal(s.res.code, 400); assert.equal(s.calls.length, 0);
  const missing = setup([]); await missing.run({ action: 'archive' }); assert.equal(missing.res.code, 404);
});
