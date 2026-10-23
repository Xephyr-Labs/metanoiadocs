import crypto from 'node:crypto';
import { pool } from './db.js';
import { spaceInput } from './spaces.js';

const ids = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string'))] : []);

/** Adds existing users to a space, each at the bottom of their own sidebar. Already-members are left alone. */
const addMembers = (db, spaceId, userIds) =>
  db.query(
    `INSERT INTO space_members (space_id, user_id, position)
     SELECT $1, u.id, COALESCE((SELECT MAX(position) + 1 FROM space_members m WHERE m.user_id = u.id), 0)
       FROM users u WHERE u.id = ANY($2)
     ON CONFLICT DO NOTHING`,
    [spaceId, userIds]
  );

export function registerSpaceRoutes(app, { requireUser, wrap }) {
  const getSpace = async (id) => (await pool.query('SELECT * FROM spaces WHERE id = $1', [id])).rows[0];
  const canManage = (s, user) => s.created_by === user.id || user.role === 'admin';

  app.get('/api/spaces', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.icon, s.description, s.is_default, s.created_by,
              (SELECT count(*)::int FROM space_members c WHERE c.space_id = s.id) AS member_count,
              (me.user_id IS NOT NULL) AS joined, COALESCE(me.position, 0) AS position
         FROM spaces s LEFT JOIN space_members me ON me.space_id = s.id AND me.user_id = $1
        ORDER BY (me.user_id IS NULL), me.position, s.name`,
      [req.user.id]
    );
    res.json(rows);
  }));

  app.post('/api/spaces', requireUser, wrap(async (req, res) => {
    const input = spaceInput(req.body);
    if (input.error) return res.status(400).json({ error: input.error });
    const id = crypto.randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      try {
        await client.query(
          'INSERT INTO spaces (id, name, icon, description, created_by) VALUES ($1,$2,$3,$4,$5)',
          [id, input.name, input.icon, input.description, req.user.id]
        );
        await addMembers(client, id, [req.user.id, ...ids(req.body?.memberIds)]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    } finally {
      client.release();
    }
    res.status(201).json(await getSpace(id));
  }));

  app.patch('/api/spaces/:id', requireUser, wrap(async (req, res) => {
    const s = await getSpace(req.params.id);
    if (!s) return res.status(404).json({ error: 'space not found' });
    if (!canManage(s, req.user)) return res.status(403).json({ error: 'forbidden' });
    const b = req.body || {};
    // Only the fields sent change; merge over the stored row and reuse the create validation.
    const input = spaceInput({
      name: 'name' in b ? b.name : s.name,
      icon: 'icon' in b ? b.icon : s.icon,
      description: 'description' in b ? b.description : s.description,
    });
    if (input.error) return res.status(400).json({ error: input.error });
    await pool.query('UPDATE spaces SET name=$2, icon=$3, description=$4 WHERE id=$1', [s.id, input.name, input.icon, input.description]);
    res.json(await getSpace(s.id));
  }));

  app.delete('/api/spaces/:id', requireUser, wrap(async (req, res) => {
    const s = await getSpace(req.params.id);
    if (!s) return res.status(404).json({ error: 'space not found' });
    if (!canManage(s, req.user)) return res.status(403).json({ error: 'forbidden' });
    if (s.is_default) return res.status(409).json({ error: "The default space can't be deleted." });
    // No deleted_at filter: a trashed row would dangle on restore.
    const { rowCount } = await pool.query(
      `SELECT 1 FROM docs WHERE space_id = $1 UNION ALL SELECT 1 FROM folders WHERE space_id = $1
       UNION ALL SELECT 1 FROM projects WHERE space_id = $1 LIMIT 1`,
      [s.id]
    );
    if (rowCount) return res.status(409).json({ error: 'This space still has pages, folders or databases.' });
    await pool.query('DELETE FROM spaces WHERE id = $1', [s.id]);
    res.json({ ok: true });
  }));

  app.post('/api/spaces/:id/join', requireUser, wrap(async (req, res) => {
    if (!(await getSpace(req.params.id))) return res.status(404).json({ error: 'space not found' });
    await addMembers(pool, req.params.id, [req.user.id]);
    res.json({ ok: true });
  }));

  app.post('/api/spaces/:id/leave', requireUser, wrap(async (req, res) => {
    if (!(await getSpace(req.params.id))) return res.status(404).json({ error: 'space not found' });
    await pool.query('DELETE FROM space_members WHERE space_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  }));

  // Same columns as GET /api/users, which every signed-in user can already read.
  app.get('/api/spaces/:id/members', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.username, u.kind FROM space_members m JOIN users u ON u.id = m.user_id
        WHERE m.space_id = $1 ORDER BY u.name`,
      [req.params.id]
    );
    res.json(rows);
  }));

  app.post('/api/spaces/:id/members', requireUser, wrap(async (req, res) => {
    if (!(await getSpace(req.params.id))) return res.status(404).json({ error: 'space not found' });
    const me = await pool.query('SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!me.rowCount) return res.status(403).json({ error: 'forbidden' });
    await addMembers(pool, req.params.id, ids(req.body?.userIds));
    res.json({ ok: true });
  }));

  app.put('/api/spaces/order', requireUser, wrap(async (req, res) => {
    await pool.query(
      `UPDATE space_members m SET position = t.ord::int - 1
         FROM unnest($1::text[]) WITH ORDINALITY AS t(id, ord)
        WHERE m.space_id = t.id AND m.user_id = $2`,
      [ids(req.body?.ids), req.user.id]
    );
    res.json({ ok: true });
  }));
}
