// POST /api/docs/:id/edits — edit_doc's targeted edits:
// `{ edits: [{ find, replace, occurrence?, under? }] }`, each replacing one
// passage of text inside one block (suggest-writer.js suggestEdits). Decided
// like /content (`draftWrite`, i.e. draftEdit): a reviewed writer's edits
// become suggestions (or go into their open legacy draft); a trusted writer's
// land directly, through a live direct connection, so open editors see them.
// They touch only what they match, so a page markdown cannot fully carry still
// takes them. All or nothing: any edit not applied is a 409 and nothing changes.
// Every body carries applied, suggested, notFound, ambiguous and skipped (R15).
import * as Y from 'yjs';
import { extractText, pageLinksOf } from './blocks.js';
import { editFields, editMiss } from './ai-drafts.js';
import { suggestEdits } from './suggest-writer.js';
import { markStale } from './verify.js';

export function registerDocEditRoutes(app, { requireUser, wrap, editGrant, pool, getHocuspocus, draftWrite, storeLinks }) {
  app.post('/api/docs/:id/edits', requireUser, wrap(async (req, res) => {
    const docId = req.params.id;
    if (!(await editGrant(docId, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    const raw = req.body?.edits;
    if (!Array.isArray(raw) || !raw.length || raw.length > 100) {
      return res.status(400).json({ error: 'edits must be a list of 1 to 100 { find, replace }' });
    }
    const edits = raw.map((e) => ({
      find: String(e?.find ?? ''),
      replace: String(e?.replace ?? ''),
      ...(Number.isInteger(e?.occurrence) && e.occurrence > 0 ? { occurrence: e.occurrence } : {}),
      ...(e?.under ? { under: String(e.under) } : {}),
    }));
    if (edits.some((e) => !e.find)) return res.status(400).json({ error: 'every edit needs a non-empty find' });
    const d = await pool.query('SELECT title, kind FROM docs WHERE id = $1 AND deleted_at IS NULL', [docId]);
    if (!d.rows[0]) return res.status(404).json({ error: 'not found' });

    const drafted = await draftWrite(req, docId, d.rows[0], { edits });
    if (drafted) return res.status(drafted.status).json(drafted.body);

    let out;
    let state;
    const conn = await getHocuspocus().openDirectConnection(docId, { docId, user: req.user });
    try {
      await conn.transact((doc) => {
        out = suggestEdits({ doc, edits, by: req.user.id, direct: true });
        state = Buffer.from(Y.encodeStateAsUpdate(doc));
      });
    } finally {
      await conn.disconnect();
    }
    const miss = editMiss(out);
    if (miss) return res.status(409).json(miss);
    // As /content: a headless write refreshes the search text and links itself.
    try {
      const { text } = extractText(state);
      await pool.query(`UPDATE docs SET search_text = $1, updated_at = now(), updated_by = $3, updated_via = $4, ${markStale(3)} WHERE id = $2`, [text.slice(0, 100000), docId, req.user.id, req.via]);
    } catch { /* an odd state still saves; only the search text goes stale */ }
    await storeLinks(docId, pageLinksOf(state));
    res.json({ ok: true, suggested: false, ...editFields(out) });
  }));
}
