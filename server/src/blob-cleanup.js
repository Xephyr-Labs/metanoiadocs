// Deleting a voice note's bytes once nothing points at them any more.
//
// Blobs are content-addressed and shared: the same key can sit in a page, a
// version, a suggestion draft, a property, a task's attachments and any number
// of comments at once. So a file is only removed after every one of those has
// been asked, and only audio — the voice notes this exists for. Images and
// other uploads stay with the admin's blob list, where a person decides.
import { pool } from './db.js';

/**
 * Delete the given audio blobs that nothing uses. `uploader` limits it to
 * files that person put there (removing their own pending note); without it,
 * any unused audio among `keys` goes (a deleted comment's notes).
 *
 * ponytail: scans every page, version and draft state for the key — fine for
 * the occasional delete; an index of blob references if this ever runs hot.
 */
export async function deleteUnusedAudio(keys, { uploader } = {}) {
  const wanted = [...new Set((keys || []).filter((k) => typeof k === 'string' && k))];
  if (!wanted.length) return 0;
  const { rowCount } = await pool.query(
    `DELETE FROM blobs b
      WHERE b.key = ANY($1::text[]) AND b.mime LIKE 'audio/%'
        AND ($2::text IS NULL OR b.created_by = $2)
        AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.attachments @> jsonb_build_array(jsonb_build_object('key', b.key)))
        AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.attachments @> jsonb_build_array(jsonb_build_object('key', b.key))
                                              OR position(b.key IN t.props::text) > 0)
        AND NOT EXISTS (SELECT 1 FROM docs d WHERE position(b.key IN d.props::text) > 0)
        AND NOT EXISTS (SELECT 1 FROM doc_states s WHERE position(convert_to(b.key, 'UTF8') IN s.state) > 0)
        AND NOT EXISTS (SELECT 1 FROM doc_versions v WHERE position(convert_to(b.key, 'UTF8') IN v.state) > 0)
        AND NOT EXISTS (SELECT 1 FROM doc_suggestions g WHERE position(convert_to(b.key, 'UTF8') IN g.state) > 0
                                                       OR position(convert_to(b.key, 'UTF8') IN g.base_state) > 0)`,
    [wanted, uploader ?? null]
  );
  return rowCount;
}
