import test from 'node:test';
import assert from 'node:assert/strict';
import { needsQueries, needsDays, nextDay } from './needs.js';

// One fake pool answering each of the four lists by the table it reads.
function fakePool(rows = {}) {
  const calls = [];
  const pick = (sql) => (/FROM doc_suggestions/.test(sql) ? 'review'
    : /FROM notifications/.test(sql) ? 'mentions'
    : /FROM tasks/.test(sql) ? 'overdue'
    : 'changed');
  return {
    calls,
    sqlOf: (k) => calls.find((c) => c.k === k),
    query: async (sql, params) => {
      const k = pick(sql);
      calls.push({ k, sql, params });
      return { rows: rows[k] ?? [] };
    },
  };
}

const flat = (s) => s.replace(/\s+/g, ' ');

test('reader days: today and tomorrow follow the reader zone, not UTC', () => {
  const at = new Date('2026-10-31T12:00:00Z');
  assert.deepEqual(needsDays({ timezone: 'Pacific/Kiritimati' }, at), { today: '2026-11-01', tomorrow: '2026-11-02' });
  assert.deepEqual(needsDays({ timezone: 'America/Los_Angeles' }, new Date('2026-11-01T03:00:00Z')),
    { today: '2026-10-31', tomorrow: '2026-11-01' });
  assert.equal(nextDay('2026-12-31'), '2027-01-01');
  assert.equal(nextDay('2028-02-28'), '2028-02-29');
});

test('four queries run, each scoped to access and space', async () => {
  const pool = fakePool();
  await needsQueries(pool, { userId: 'u1', spaceId: 's1', today: '2026-10-28' });
  assert.equal(pool.calls.length, 4);
  for (const k of ['review', 'changed', 'mentions']) {
    const { sql, params } = pool.sqlOf(k);
    assert.match(sql, /LEFT JOIN doc_access a ON a\.doc_id = d\.id AND a\.user_id = \$1/, k);
    assert.match(sql, /a\.user_id IS NOT NULL OR d\.visibility = 'team'/, k);
    assert.match(sql, /d\.deleted_at IS NULL/, k);
    assert.match(sql, /d\.space_id = \$2/, k);
    assert.deepEqual(params, ['u1', 's1'], k);
    assert.match(sql, /LIMIT 20/, k);
    assert.match(sql, /count\(\*\) OVER \(\)/, k);
  }
  const o = pool.sqlOf('overdue');
  assert.deepEqual(o.params, ['u1', '2026-10-28', 's1']);
  assert.match(o.sql, /t\.due_at <= \$2::date/);
  assert.match(o.sql, /t\.status <> 'done'/);
  assert.match(o.sql, /task_assignees ta WHERE ta\.task_id = t\.id AND ta\.user_id = \$1/);
  assert.match(o.sql, /p\.archived_at IS NULL AND p\.mode <> 'data'/);
  assert.match(o.sql, /p\.space_id = \$3/);
  assert.match(o.sql, /ORDER BY t\.due_at ASC/);
});

test('without a space, every joined space', async () => {
  const pool = fakePool();
  await needsQueries(pool, { userId: 'u1', spaceId: null, today: '2026-10-28' });
  assert.match(pool.sqlOf('changed').sql, /d\.space_id IN \(SELECT space_id FROM space_members WHERE user_id = \$1\)/);
  assert.deepEqual(pool.sqlOf('changed').params, ['u1']);
  assert.deepEqual(pool.sqlOf('overdue').params, ['u1', '2026-10-28']);
});

test('review: submitted, not mine, approver or editor on a plain draft', async () => {
  const pool = fakePool();
  await needsQueries(pool, { userId: 'u1', spaceId: null, today: '2026-10-28' });
  const sql = flat(pool.sqlOf('review').sql);
  assert.match(sql, /s\.status = 'submitted'/);
  assert.match(sql, /s\.approver_id = \$1 OR \(s\.author_id <> \$1 AND s\.approver_id IS NULL AND s\.writer_via IS NULL AND/);
  assert.match(sql, /a\.role IN \('editor', 'owner'\)/);
  assert.match(sql, /d\.is_template/);
});

test('review: an Ask AI draft I authored still shows when I am its approver', async () => {
  const pool = fakePool();
  await needsQueries(pool, { userId: 'u1', spaceId: null, today: '2026-10-28' });
  const sql = flat(pool.sqlOf('review').sql);
  // The author exclusion lives only inside the plain-draft branch, never before the approver branch.
  assert.doesNotMatch(sql, /author_id <> \$1 AND \(s\.approver_id/);
  assert.doesNotMatch(sql, /s\.status = 'submitted' AND s\.author_id/);
  assert.match(sql, /AND \(s\.approver_id = \$1 OR \(s\.author_id <> \$1/);
});

test('changed: someone else changed it since I last opened it', async () => {
  const pool = fakePool();
  await needsQueries(pool, { userId: 'u1', spaceId: null, today: '2026-10-28' });
  const sql = flat(pool.sqlOf('changed').sql);
  assert.match(sql, /d\.updated_by IS NOT NULL AND d\.updated_by <> \$1/);
  assert.match(sql, /d\.kind <> 'task'/);
  assert.match(sql, /d\.updated_at > coalesce\(o\.opened_at, CASE WHEN d\.created_by = \$1 THEN d\.created_at END\)/);
  assert.match(sql, /FROM doc_editors/);
  assert.match(sql, /FROM favorites/);
});

test('mentions: open threads I have not answered since', async () => {
  const pool = fakePool();
  await needsQueries(pool, { userId: 'u1', spaceId: null, today: '2026-10-28' });
  const sql = flat(pool.sqlOf('mentions').sql);
  assert.match(sql, /n\.kind IN \('mention', 'reply', 'reply_to_you'\)/);
  assert.match(sql, /coalesce\(c\.parent_id, c\.id\)/);
  assert.match(sql, /NOT r\.resolved/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM comments m WHERE coalesce\(m\.parent_id, m\.id\) = r\.id AND m\.author_id = \$1 AND m\.created_at > n\.created_at\)/);
  assert.match(sql, /DISTINCT ON \(r\.id\)/);
  assert.match(sql, /t\.deleted_at IS NULL/);
});

test('maps rows and counts as numbers', async () => {
  const pool = fakePool({
    review: [{ id: 's1', doc_id: 'd1', doc_title: 'Plan', author_name: 'Ann', writer_via: null, submitted_at: 'x', total: '3' }],
    overdue: [
      { id: 't1', title: 'Late', project_id: 'p1', project_name: 'P', due_at: new Date(2026, 9, 20), total: '2' },
      { id: 't2', title: 'Now', project_id: 'p1', project_name: 'P', due_at: '2026-10-28', total: '2' },
    ],
    mentions: [{ notification_id: 'n1', comment_id: 'c2', thread_id: 'c1', doc_id: 'd1', task_id: null, title: 'Plan',
      author_name: 'Bo', snippet: 'hi', created_at: 'y', can_resolve: true, total: '41' }],
  });
  const out = await needsQueries(pool, { userId: 'u1', spaceId: null, today: '2026-10-28' });
  assert.deepEqual(out.counts, { review: 3, overdue: 2, mentions: 41, changed: 0 });
  assert.equal(out.today, '2026-10-28');
  assert.equal(out.tomorrow, '2026-10-29');
  assert.deepEqual(out.review[0], { suggestionId: 's1', docId: 'd1', docTitle: 'Plan', authorName: 'Ann', writerVia: null, submittedAt: 'x' });
  assert.deepEqual(out.overdue.map((t) => [t.taskId, t.dueAt, t.today]), [['t1', '2026-10-20', false], ['t2', '2026-10-28', true]]);
  assert.deepEqual(out.mentions[0], { notificationId: 'n1', commentId: 'c2', threadId: 'c1', docId: 'd1', taskId: null, title: 'Plan',
    authorName: 'Bo', snippet: 'hi', createdAt: 'y', canResolve: true });
  assert.deepEqual(out.changed, []);
});
