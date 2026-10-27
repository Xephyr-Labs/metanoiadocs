// When each person last opened each page — lets Home find pages someone else
// changed since you looked.
export const recordOpen = (pool, userId, docId) =>
  pool.query(
    `INSERT INTO doc_opens (user_id, doc_id) VALUES ($1, $2)
     ON CONFLICT (user_id, doc_id) DO UPDATE SET opened_at = now()`,
    [userId, docId]
  );

export function registerDocOpenRoutes(app, { requireUser, wrap, pool, grantOn }) {
  app.post('/api/docs/:id/opened', requireUser, wrap(async (req, res) => {
    if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    await recordOpen(pool, req.user.id, req.params.id);
    res.status(204).end();
  }));
}
