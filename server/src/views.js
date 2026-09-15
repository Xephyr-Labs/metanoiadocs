// Saved views: many named views over one database.
//
// A project used to have exactly one view per type, with its filters kept in
// the browser's localStorage under the *project's* id — so two differently
// filtered boards could not both exist, and an embedded database could not
// differ from the project screen it mirrored. A view is a row now, which is
// also what lets a database block point at one.
import crypto from 'node:crypto';
import { pool } from './db.js';

export const VIEW_KINDS = ['backlog', 'board', 'table', 'gantt', 'calendar', 'gallery'];

/** The views a database starts with: the six tabs it has always shown, now as
 *  real rows so each can be filtered, sorted and grouped on its own. A data
 *  database has no status, people or schedule, so three of them would be
 *  empty furniture. */
const SEED = {
  tasks: ['backlog', 'board', 'table', 'gantt', 'calendar', 'gallery'],
  data: ['table', 'calendar', 'gallery'],
};

const LABEL = {
  backlog: 'Backlog',
  board: 'Board',
  table: 'Table',
  gantt: 'Gantt',
  calendar: 'Calendar',
  gallery: 'Gallery',
};

const isKind = (k) => VIEW_KINDS.includes(k);

/**
 * A view's settings, with anything unrecognised dropped.
 *
 * Written whole by the client, so this is a trust boundary: it is stored as
 * JSONB and read straight back into the filter/sort engines. Shapes are checked
 * rather than contents — a filter naming a property that has since been deleted
 * is pruned client-side (`pruneUnresolvable`), because only the client knows
 * what the current property list is.
 */
export function cleanConfig(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  const str = (v) => (typeof v === 'string' ? v.slice(0, 400) : '');

  if (Array.isArray(value.filters)) {
    out.filters = value.filters
      .filter((f) => f && typeof f === 'object' && typeof f.field === 'string')
      .slice(0, 50)
      .map((f) => ({ id: str(f.id) || crypto.randomUUID(), field: str(f.field), op: str(f.op), value: str(f.value) }));
  }
  if (Array.isArray(value.sort)) {
    out.sort = value.sort
      .filter((s) => s && typeof s === 'object' && typeof s.field === 'string')
      .slice(0, 10)
      .map((s) => ({ id: str(s.id) || crypto.randomUUID(), field: str(s.field), dir: s.dir === 'desc' ? 'desc' : 'asc' }));
  }
  // null is meaningful — "grouped by nothing" — and distinct from absent.
  if (value.groupBy !== undefined) out.groupBy = value.groupBy === null ? null : str(value.groupBy);
  if (value.props !== undefined) {
    out.props = Array.isArray(value.props) ? value.props.filter((p) => typeof p === 'string').slice(0, 200) : null;
  }
  if (value.scope !== undefined) out.scope = str(value.scope) || 'all';
  return out;
}

export function registerViewRoutes(app, { requireUser, wrap }) {
  /**
   * A project's views, seeding the defaults the first time it is asked.
   *
   * Seeding here rather than at project creation means every database that
   * already existed gets its tabs too, without a migration that has to guess
   * what each one's mode was at the time.
   */
  app.get('/api/projects/:id/views', requireUser, wrap(async (req, res) => {
    const projectId = req.params.id;
    const { rows: project } = await pool.query(
      'SELECT mode FROM projects WHERE id = $1 AND archived_at IS NULL', [projectId],
    );
    if (!project[0]) return res.status(404).json({ error: 'not found' });

    const read = () => pool.query(
      'SELECT * FROM db_views WHERE project_id = $1 ORDER BY position ASC, created_at ASC', [projectId],
    );
    let { rows } = await read();
    if (!rows.length) {
      const kinds = SEED[project[0].mode] ?? SEED.tasks;
      // ON CONFLICT DO NOTHING on the primary key: two tabs opening the same
      // project at once would otherwise both seed, and the loser's INSERT
      // would fail the whole request rather than losing a race harmlessly.
      await pool.query(
        `INSERT INTO db_views (id, project_id, name, kind, position, created_by)
         SELECT unnest($1::text[]), $2, unnest($3::text[]), unnest($4::text[]), generate_series(0, $5), $6
         ON CONFLICT DO NOTHING`,
        [
          kinds.map(() => crypto.randomUUID()),
          projectId,
          kinds.map((k) => LABEL[k]),
          kinds,
          kinds.length - 1,
          req.user.id,
        ],
      );
      ({ rows } = await read());
    }
    res.json(rows);
  }));

  app.post('/api/projects/:id/views', requireUser, wrap(async (req, res) => {
    const kind = isKind(req.body?.kind) ? req.body.kind : 'table';
    const config = cleanConfig(req.body?.config);
    if (config === null) return res.status(400).json({ error: 'bad config' });
    const { rows: last } = await pool.query(
      'SELECT coalesce(max(position), -1) AS p FROM db_views WHERE project_id = $1', [req.params.id],
    );
    const { rows } = await pool.query(
      `INSERT INTO db_views (id, project_id, name, kind, position, config, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        crypto.randomUUID(),
        req.params.id,
        String(req.body?.name || LABEL[kind] || 'View').slice(0, 120),
        kind,
        Number(last[0].p) + 1,
        JSON.stringify(config ?? {}),
        req.user.id,
      ],
    );
    res.json(rows[0]);
  }));

  app.patch('/api/views/:id', requireUser, wrap(async (req, res) => {
    const sets = [];
    const vals = [];
    if (req.body?.name !== undefined) {
      vals.push(String(req.body.name).slice(0, 120) || 'View');
      sets.push(`name = $${vals.length}`);
    }
    if (req.body?.kind !== undefined) {
      if (!isKind(req.body.kind)) return res.status(400).json({ error: 'bad kind' });
      vals.push(req.body.kind);
      sets.push(`kind = $${vals.length}`);
    }
    if (req.body?.position !== undefined) {
      vals.push(Number(req.body.position) || 0);
      sets.push(`position = $${vals.length}`);
    }
    if (req.body?.config !== undefined) {
      const config = cleanConfig(req.body.config);
      if (config === null) return res.status(400).json({ error: 'bad config' });
      // Merged, not replaced: the toolbar saves one facet at a time — a sort
      // change must not blank the filters the same view is carrying.
      vals.push(JSON.stringify(config));
      sets.push(`config = config || $${vals.length}::jsonb`);
    }
    if (!sets.length) return res.json({ ok: true });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE db_views SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals,
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  }));

  /** A database must keep at least one view, or it has no way to show itself. */
  app.delete('/api/views/:id', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT project_id FROM db_views WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    const { rows: count } = await pool.query(
      'SELECT count(*)::int AS n FROM db_views WHERE project_id = $1', [rows[0].project_id],
    );
    if (count[0].n <= 1) return res.status(400).json({ error: 'a database needs at least one view' });
    await pool.query('DELETE FROM db_views WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  }));
}
