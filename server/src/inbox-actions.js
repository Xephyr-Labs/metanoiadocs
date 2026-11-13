/** Personal triage never changes the task, thread, or another recipient's feed. */
export function registerInboxActionRoutes(app, { pool, requireUser, wrap }) {
  app.post('/api/inbox/:id/action', requireUser, wrap(async (req, res) => {
    const { action, until } = req.body || {};
    if (!['archive', 'snooze', 'restore'].includes(action)) {
      return res.status(400).json({ error: 'Choose archive, snooze, or restore.' });
    }
    let instant = null;
    if (action === 'snooze') {
      const time = typeof until === 'string' ? Date.parse(until) : NaN;
      if (!Number.isFinite(time) || time <= Date.now() || time > Date.now() + 366 * 86400000) {
        return res.status(400).json({ error: 'Choose a future snooze time within the next year.' });
      }
      instant = new Date(time).toISOString();
    }
    const assignment = action === 'archive'
      ? 'archived_at = now(), snoozed_until = NULL'
      : action === 'restore' ? 'archived_at = NULL, snoozed_until = NULL'
        : 'archived_at = NULL, snoozed_until = $3::timestamptz';
    const { rows } = await pool.query(
      `UPDATE notifications SET ${assignment} WHERE id = $1 AND user_id = $2 RETURNING id, archived_at, snoozed_until`,
      action === 'snooze' ? [req.params.id, req.user.id, instant] : [req.params.id, req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Notification not found.' });
    res.json(rows[0]);
  }));
}
