// AI and agent edits that need a person's approval land in a draft beside the
// page (a doc_suggestions row), never on the page itself. Its approver, or for
// an agent's draft anyone who can edit the page, reviews it block by block.
import crypto from 'node:crypto';
import * as Y from 'yjs';
import { appendMarkdownToDoc, lossyBlocks, replaceBodyKeepingIds } from './blocks.js';
import { computeChanges, docFromState, draftName, pending } from './suggestions.js';

const OPEN = `SELECT * FROM doc_suggestions
  WHERE doc_id = $1 AND author_id = $2 AND status <> 'closed'
    AND approver_id IS NOT DISTINCT FROM $3 AND writer_via IS NOT DISTINCT FROM $4`;

/** The open draft this writer keeps for this approver on this page, or null. */
export async function openDraftFor({ pool, docId, authorId, approverId, writerVia }) {
  const { rows } = await pool.query(OPEN, [docId, authorId, approverId ?? null, writerVia ?? null]);
  return rows[0] ?? null;
}

/**
 * The draft a suggesting writer's markdown READ should show: its exact draft
 * for this approver, else its one open AI draft on the page — so an agent
 * still builds on drafts made back when its edits named an approver. Two or more and no exact match: null (the live page).
 * Writes keep the exact key (openDraftFor).
 */
export async function draftToRead({ pool, docId, authorId, approverId, writerVia }) {
  if (approverId) {
    const exact = await openDraftFor({ pool, docId, authorId, approverId, writerVia });
    if (exact) return exact;
  }
  const { rows } = await pool.query(
    `SELECT * FROM doc_suggestions
      WHERE doc_id = $1 AND author_id = $2 AND status <> 'closed' AND writer_via IS NOT NULL`,
    [docId, authorId]
  );
  return rows.length === 1 ? rows[0] : null;
}

/**
 * Write `markdown` into the writer's draft of `docId` for `approverId`, making
 * the draft (submitted, from the page as it is now) if there isn't one.
 * mode 'append' adds to the draft's body; 'replace' rewrites it keeping ids.
 *
 * @returns {{ sid: string, created: boolean, changes: number }} changes = still undecided.
 */
export async function writeToDraft({ pool, hocuspocus, pageState, docId, title, authorId, approverId, writerVia, markdown, mode, resolve, notify }) {
  const key = { pool, docId, authorId, approverId, writerVia };
  let row = await openDraftFor(key);
  let created = false;
  if (!row) {
    const state = await pageState(docId);
    if (!state) throw new Error('no page state');
    try {
      ({ rows: [row] } = await pool.query(
        `INSERT INTO doc_suggestions (id, doc_id, author_id, approver_id, writer_via, base_state, state, status, submitted_at, message)
         VALUES ($1, $2, $3, $4, $5, $6, $6, 'submitted', now(), NULL) RETURNING *`,
        [crypto.randomUUID(), docId, authorId, approverId ?? null, writerVia ?? null, state]
      ));
      created = true;
    } catch (e) {
      // Two writes at once: the unique open-draft index lets one in; use its draft.
      row = await openDraftFor(key);
      if (!row) throw e;
    }
  }

  const name = draftName(docId, row.id);
  let draftState;
  try {
    const conn = await hocuspocus.openDirectConnection(name, { docId: name, user: { id: authorId } });
    try {
      let wrote = false;
      await conn.transact((doc) => {
        wrote = mode === 'replace'
          ? replaceBodyKeepingIds(doc, title, markdown, resolve)
          : appendMarkdownToDoc(doc, markdown, resolve) || replaceBodyKeepingIds(doc, title, markdown, resolve);
      });
      if (!wrote) throw new Error('no body');
      draftState = Y.encodeStateAsUpdate(conn.document);
    } finally {
      // Disconnecting saves the draft: the draft `store` hook writes doc_suggestions.state.
      await conn.disconnect();
    }
  } catch (e) {
    // A draft that never took its first write would be reused forever, so the
    // approver would never be told and an empty-page draft would refuse every
    // later write. Drop it; the next write starts afresh.
    if (created) await pool.query('DELETE FROM doc_suggestions WHERE id = $1', [row.id]);
    throw e;
  }

  const changes = pending(
    computeChanges(docFromState(row.base_state), docFromState(draftState), docFromState(await pageState(docId))),
    row.decisions || {},
  ).length;
  // Ask AI shows its review link in the panel; only an agent's draft needs a heads-up.
  if (created && writerVia !== 'ai') {
    // The draft is saved either way; a failed heads-up must not fail the write.
    try {
      await notify({ userId: approverId ?? null, kind: 'ai_suggestion', docId, suggestionId: row.id });
    } catch (e) { console.error('[notify] ai suggestion:', e.message); }
  }
  return { sid: row.id, created, changes };
}

/** The refusal for a replace that would delete what markdown cannot carry. */
export const lossyRefusal = (lossy) => ({
  error: `This page holds content markdown cannot carry (${lossy.join(', ')}); replacing it would delete that. Append instead, or leave a comment.`,
  lossy,
});

/**
 * Where a markdown write from POST /api/docs/:id/content goes. Null: straight
 * onto the page (a trusted writer, a task page, or a page with no body yet).
 * Otherwise the response to send — a refusal, or the draft it landed in.
 * `approver()` resolves who reviews, as `{ id, name }`, or null for any editor.
 */
export async function draftEdit({ policy, kind, via, pageState, approver, pool, hocuspocus, docId, title, authorId, markdown, mode, resolve, notify }) {
  if (policy === 'direct' || kind === 'task') return null;
  const state = await pageState(docId);
  if (!state || !docFromState(state).getMap('blocks').size) return null;
  // Before anything else: a refused replace must not leave a draft behind.
  const lossy = mode === 'replace' ? lossyBlocks(state) : [];
  if (lossy.length) return { status: 409, body: lossyRefusal(lossy) };
  // No approver (an agent's edit): anyone who can edit the page decides it.
  const who = await approver();
  let out;
  try {
    out = await writeToDraft({
      pool, hocuspocus, pageState, docId, title, authorId, approverId: who?.id ?? null,
      writerVia: via === 'ai' ? 'ai' : 'agent', markdown, mode, resolve, notify,
    });
  } catch (e) {
    // A page with blocks but no text body (canvas only): nothing to draft against.
    if (e.message === 'no body') return { status: 409, body: { error: 'This page has no text body to suggest changes to. Leave a comment instead.' } };
    throw e;
  }
  const { sid, changes } = out;
  return {
    status: 200,
    body: { ok: true, suggested: true, suggestionId: sid, reviewUrl: `/d/${docId}?review=${sid}`, approverName: who?.name ?? null, changes },
  };
}
