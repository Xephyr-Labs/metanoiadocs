// Restoring a version in place, the way Affine does it.
//
// A snapshot is an *ancestor* of the live document — the very bytes this doc
// once encoded — so `Y.applyUpdate(live, snapshot)` is a no-op: Yjs already has
// every one of those operations. Rolling back is therefore not a merge, it is
// an edit: delete what is there now and write the snapshot's content back as
// new operations. That keeps every connected editor convergent (they receive a
// normal update) instead of forking the document.
import * as Y from 'yjs';

/**
 * Yjs origin for the restore transaction.
 *
 * Hocuspocus ignores updates with a falsy origin for persistence
 * (`handleDocumentUpdate` returns early), while still broadcasting them to
 * every connection. So a restore applied with no origin would reach the other
 * editors and never reach Postgres. This string is what makes the write stick.
 */
export const RESTORE_ORIGIN = 'metanoia-restore';

/** Deep-copy a Yjs value into a form that can be inserted into another doc.
 *  A live Y type belongs to exactly one document, so it cannot be re-parented —
 *  it has to be rebuilt. Primitives, plain objects and Uint8Arrays are stored
 *  by value by Yjs, so they pass straight through. */
export function cloneValue(v) {
  if (v instanceof Y.Text) {
    const t = new Y.Text();
    // Deltas carry marks and embeds, which toString()/toJSON() would drop.
    t.applyDelta(v.toDelta(), { sanitize: false });
    return t;
  }
  if (v instanceof Y.Array) {
    const a = new Y.Array();
    a.push(v.toArray().map(cloneValue));
    return a;
  }
  if (v instanceof Y.Map) {
    const m = new Y.Map();
    for (const [k, val] of v) m.set(k, cloneValue(val));
    return m;
  }
  if (v instanceof Y.AbstractType) {
    // Better to fail the restore than to silently drop part of a document.
    throw new Error(`cannot clone Yjs type ${v.constructor?.name || 'unknown'}`);
  }
  return v;
}

/**
 * Replace `target`'s content with the content encoded in `snapshotState`.
 *
 * BlockSuite 0.22 space docs carry exactly one root — the `blocks` map (verified
 * across this workspace's stored states). If a future flavour introduces a
 * second root, extend the rewrite here; a root left untouched would survive the
 * rollback and desynchronise the document.
 *
 * @param {Y.Doc} target        the live document (or one decoded from doc_states)
 * @param {Buffer|Uint8Array} snapshotState  the archived doc_versions.state
 * @returns {Y.Doc} target, rewritten
 */
export function rewriteDoc(target, snapshotState) {
  const snap = new Y.Doc();
  Y.applyUpdate(snap, new Uint8Array(snapshotState));
  const from = snap.getMap('blocks');
  if (from.size === 0) throw new Error('snapshot has no blocks');

  const into = target.getMap('blocks');
  target.transact(() => {
    // One transaction: subscribers see a single update, so no editor ever
    // renders the half-second where the document has no page block.
    into.clear();
    for (const [id, block] of from) into.set(id, cloneValue(block));
  }, RESTORE_ORIGIN);
  return target;
}
