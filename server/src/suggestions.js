// Suggesting mode, and the suggestion cards that hang off comments.
//
// A suggestion card proposes new text for one quoted passage; accepting it is a
// single text replacement (applyTextSuggestion). Suggesting mode is bigger: the
// suggester edits a private draft of the whole page, and whoever can edit the
// page reviews it change by change.
//
// The draft starts as a byte copy of the page, so it shares the page's Yjs
// history. Changes are always "draft against the page as it was when the draft
// began" (base) — never draft against the page now — so an edit the owner made
// in the meantime is not shown as something the suggester did. Accepting a
// change copies that block's content from the draft into the live page as an
// ordinary edit; nothing is merged wholesale, which is what lets each change be
// taken or left on its own.
import crypto from 'node:crypto';
import * as Y from 'yjs';
import { cloneValue } from './restore.js';
import { findQuote } from './text-match.js';

// ── suggestion cards ───────────────────────────────────────────────────────

/** Formatting in force at `index`, so a replacement keeps the look of the text it replaces. */
function attributesAt(text, index) {
  let pos = 0;
  for (const op of text.toDelta()) {
    const len = typeof op.insert === 'string' ? op.insert.length : 1;
    if (index < pos + len) return op.attributes ? { ...op.attributes } : {};
    pos += len;
  }
  return {};
}

/**
 * Replace `quote` inside block `blockId` with `replacement`. False when the
 * block or the quoted text is no longer there — the page moved on, and the
 * suggestion can't be applied blind.
 */
export function applyTextSuggestion(doc, blockId, quote, replacement, occurrence = 0) {
  const block = doc.getMap('blocks').get(blockId);
  if (!(block instanceof Y.Map)) return false;
  const text = block.get('prop:text');
  if (!(text instanceof Y.Text)) return false;
  const raw = text.toString();
  // The copy that was selected. If edits since have left fewer copies, only
  // an unambiguous single one is still safe to change.
  let hit = findQuote(raw, quote, occurrence);
  if (!hit && occurrence > 0 && !findQuote(raw, quote, 1)) hit = findQuote(raw, quote);
  if (!hit) return false;
  const attrs = attributesAt(text, hit.index);
  text.delete(hit.index, hit.length);
  if (replacement) text.insert(hit.index, replacement, attrs);
  return true;
}

// ── reading a page's blocks ────────────────────────────────────────────────

/** Containers and canvas plumbing: never shown as a change of their own. */
const STRUCTURAL = new Set(['affine:surface', 'affine:note']);

const LABELS = {
  'affine:page': 'Title',
  'affine:paragraph': 'Paragraph',
  'affine:list': 'List item',
  'affine:code': 'Code',
  'affine:image': 'Image',
  'affine:divider': 'Divider',
  'affine:table': 'Table',
  'affine:database': 'Database',
  'affine:callout': 'Callout',
  'affine:bookmark': 'Link card',
  'affine:attachment': 'File',
  'affine:latex': 'Equation',
};
const labelFor = (flavour) => LABELS[flavour] || (String(flavour).split(':').pop() || 'Block').replace(/^\w/, (c) => c.toUpperCase());

export const docFromState = (state) => {
  const d = new Y.Doc();
  if (state) Y.applyUpdate(d, new Uint8Array(state));
  return d;
};

function valueSig(v) {
  if (v instanceof Y.Text) return JSON.stringify(v.toDelta());
  if (v instanceof Y.AbstractType) return JSON.stringify(v.toJSON());
  if (v instanceof Uint8Array) return `bin:${Buffer.from(v).toString('base64')}`;
  return JSON.stringify(v ?? null);
}

/** Everything about a block except where it sits — the part a change is made of. */
function blockSig(block) {
  const parts = [];
  for (const [k, v] of block) {
    if (k === 'sys:children' || k === 'sys:id' || k === 'sys:version') continue;
    parts.push([k, valueSig(v)]);
  }
  parts.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return JSON.stringify(parts);
}

/** What a block reads as, for the review list. */
function blockText(block) {
  if (!(block instanceof Y.Map)) return '';
  const flavour = block.get('sys:flavour');
  const key = flavour === 'affine:page' ? 'prop:title' : 'prop:text';
  const t = block.get(key);
  if (t instanceof Y.Text) return t.toString();
  const caption = block.get('prop:caption');
  if (typeof caption === 'string' && caption) return caption;
  return '';
}

const childrenOf = (block) => {
  const kids = block instanceof Y.Map ? block.get('sys:children') : null;
  return kids instanceof Y.Array ? kids.toArray() : [];
};

/** Page block id, tree order and parent of every block reachable from the page. */
function walk(blocks) {
  let pageId = null;
  for (const [id, b] of blocks) {
    if (b instanceof Y.Map && b.get('sys:flavour') === 'affine:page') { pageId = id; break; }
  }
  const order = new Map();
  const parent = new Map();
  if (!pageId) return { pageId, order, parent };
  const visit = (id, depth) => {
    if (order.has(id) || depth > 200) return;
    order.set(id, order.size);
    for (const kid of childrenOf(blocks.get(id))) {
      if (!blocks.has(kid)) continue;
      parent.set(kid, id);
      visit(kid, depth + 1);
    }
  };
  visit(pageId, 0);
  return { pageId, order, parent };
}

// ── the changes in a draft ─────────────────────────────────────────────────

/**
 * The changes `draft` makes to `base`, in reading order, each with what it
 * would do to `main` (the page as it is now).
 *
 * @returns {{id, kind: 'added'|'removed'|'modified', flavour, label, type, before, after, sig, mainChanged, gone}[]}
 *   `sig` identifies this exact version of the change, so a decision on it can
 *   be told apart from a later, different edit to the same block. `mainChanged`
 *   says the page's own copy of the block was edited since the draft began —
 *   accepting overwrites that. `gone` says the block no longer exists on the
 *   page at all.
 */
export function computeChanges(baseDoc, draftDoc, mainDoc) {
  const base = baseDoc.getMap('blocks');
  const draft = draftDoc.getMap('blocks');
  const main = mainDoc.getMap('blocks');
  const bw = walk(base);
  const dw = walk(draft);
  const changes = [];

  const describe = (block, fallbackFlavour) => {
    const flavour = (block instanceof Y.Map && block.get('sys:flavour')) || fallbackFlavour;
    const type = block instanceof Y.Map ? block.get('prop:type') ?? null : null;
    return { flavour, label: labelFor(flavour), type: typeof type === 'string' ? type : null };
  };

  for (const [id, pos] of dw.order) {
    const d = draft.get(id);
    const flavour = d.get('sys:flavour');
    if (STRUCTURAL.has(flavour)) continue;
    const b = base.get(id);
    const m = main.get(id);
    if (!(b instanceof Y.Map) || !bw.order.has(id)) {
      // New in the draft. Already on the page means it arrived some other way.
      if (m instanceof Y.Map) continue;
      const sig = blockSig(d);
      changes.push({ id, kind: 'added', ...describe(d), before: '', after: blockText(d), sig, mainChanged: false, gone: false, pos });
      continue;
    }
    const sig = blockSig(d);
    if (sig === blockSig(b)) continue;
    const gone = !(m instanceof Y.Map);
    changes.push({
      id, kind: 'modified', ...describe(d),
      before: blockText(b), after: blockText(d), sig,
      mainChanged: !gone && blockSig(m) !== blockSig(b), gone, pos,
    });
  }

  // Taken out in the draft. Placed after whatever preceded it in the base, so
  // the review reads in page order.
  for (const [id] of bw.order) {
    if (dw.order.has(id)) continue;
    const b = base.get(id);
    const flavour = b.get('sys:flavour');
    if (STRUCTURAL.has(flavour) || flavour === 'affine:page') continue;
    const m = main.get(id);
    if (!(m instanceof Y.Map)) continue; // already gone from the page too
    let pos = 0;
    const p = bw.parent.get(id);
    if (p) {
      const sibs = childrenOf(base.get(p));
      for (let i = sibs.indexOf(id) - 1; i >= 0; i--) {
        if (dw.order.has(sibs[i])) { pos = dw.order.get(sibs[i]) + 0.5; break; }
      }
      if (!pos && dw.order.has(p)) pos = dw.order.get(p) + 0.25;
    }
    changes.push({
      id, kind: 'removed', ...describe(b), before: blockText(b), after: '',
      sig: `removed:${blockSig(b)}`, mainChanged: blockSig(m) !== blockSig(b), gone: false, pos,
    });
  }

  changes.sort((a, b) => a.pos - b.pos);
  return changes.map(({ pos, ...c }) => c);
}

// ── applying a change ──────────────────────────────────────────────────────

/**
 * Rewrite `target` to read like `source`, touching only the part that differs —
 * a reviewer accepting one word must not move everyone else's caret to the end
 * of the paragraph. Falls back to a whole rewrite when only formatting differs.
 */
export function syncText(target, source) {
  const a = target.toString();
  const b = source.toString();
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  if (a.length - p - s > 0) target.delete(p, a.length - p - s);
  let pos = 0;
  let at = p;
  const end = b.length - s;
  for (const op of source.toDelta()) {
    if (typeof op.insert !== 'string') continue;
    const str = op.insert;
    const from = Math.max(p, pos);
    const to = Math.min(end, pos + str.length);
    if (to > from) {
      target.insert(at, str.slice(from - pos, to - pos), op.attributes ? { ...op.attributes } : {});
      at += to - from;
    }
    pos += str.length;
  }
  if (JSON.stringify(target.toDelta()) !== JSON.stringify(source.toDelta())) {
    target.delete(0, target.length);
    target.applyDelta(source.toDelta(), { sanitize: false });
  }
}

function parentIn(blocks, id) {
  for (const [pid, b] of blocks) {
    if (childrenOf(b).includes(id)) return pid;
  }
  return null;
}

function removeTree(blocks, id, depth = 0) {
  const b = blocks.get(id);
  if (!(b instanceof Y.Map) || depth > 200) return;
  for (const kid of childrenOf(b)) removeTree(blocks, kid, depth + 1);
  blocks.delete(id);
}

/** The first note under the page: where a block lands when its parent is gone. */
function fallbackParent(blocks) {
  const { pageId } = walk(blocks);
  if (!pageId) return null;
  return childrenOf(blocks.get(pageId)).find((k) => blocks.get(k)?.get?.('sys:flavour') === 'affine:note') ?? null;
}

/**
 * Apply one change (from computeChanges) to `mainDoc`. Call inside a
 * transaction on the live page. Returns false when there is nothing it can do
 * (the block it edits was deleted from the page meanwhile).
 */
export function applyChange(mainDoc, draftDoc, baseDoc, change) {
  const main = mainDoc.getMap('blocks');
  const draft = draftDoc.getMap('blocks');
  const base = baseDoc.getMap('blocks');
  const { id } = change;

  if (change.kind === 'removed') {
    // Only the block itself goes. Whatever sits inside it on the page now —
    // children the draft moved out before deleting it, children added since,
    // children whose own removal the reviewer hasn't accepted — moves up into
    // its place. Each child's own removal, if the draft made one, is a change
    // of its own to accept or decline.
    const block = main.get(id);
    const survivors = childrenOf(block).filter((k) => main.has(k));
    const pid = parentIn(main, id);
    if (pid) {
      const kids = main.get(pid).get('sys:children');
      const i = kids.toArray().indexOf(id);
      if (i >= 0) {
        kids.delete(i, 1);
        if (survivors.length) kids.insert(i, survivors);
      }
      main.delete(id);
    } else {
      removeTree(main, id); // detached already: nowhere to move its children to
    }
    return true;
  }

  const d = draft.get(id);
  if (!(d instanceof Y.Map)) return false;

  if (change.kind === 'modified') {
    const m = main.get(id);
    if (!(m instanceof Y.Map)) return false;
    const b = base.get(id);
    for (const [k, v] of d) {
      if (k === 'sys:children' || k === 'sys:id') continue;
      const before = b instanceof Y.Map ? b.get(k) : undefined;
      if (valueSig(v) === valueSig(before)) continue; // the suggester didn't touch this
      const cur = m.get(k);
      if (v instanceof Y.Text && cur instanceof Y.Text) syncText(cur, v);
      else m.set(k, cloneValue(v));
    }
    if (b instanceof Y.Map) {
      for (const [k] of b) if (!d.has(k) && k !== 'sys:children') m.delete(k);
    }
    return true;
  }

  // added
  if (main.has(id)) return true;
  const copy = new Y.Map();
  for (const [k, v] of d) {
    if (k === 'sys:children') continue;
    copy.set(k, cloneValue(v));
  }
  const kids = new Y.Array();
  kids.push(childrenOf(d).filter((k) => main.has(k)));
  copy.set('sys:children', kids);
  main.set(id, copy);

  const dParent = parentIn(draft, id);
  let pid = dParent && main.has(dParent) ? dParent : fallbackParent(main);
  if (!pid) return false;
  const siblings = main.get(pid).get('sys:children');
  let index = dParent === pid ? 0 : siblings.length;
  if (dParent === pid) {
    // After the nearest earlier sibling (in the draft) that the page also has.
    const draftSibs = childrenOf(draft.get(dParent));
    const cur = siblings.toArray();
    for (let i = draftSibs.indexOf(id) - 1; i >= 0; i--) {
      const at = cur.indexOf(draftSibs[i]);
      if (at >= 0) { index = at + 1; break; }
    }
  }
  siblings.insert(index, [id]);
  return true;
}

// ── routes ─────────────────────────────────────────────────────────────────

/** The sync document name of a draft: the page id, a marker, the draft id. */
export const DRAFT_MARK = '~draft~';
export const draftName = (docId, sid) => `${docId}${DRAFT_MARK}${sid}`;
export function parseDraftName(name) {
  const i = String(name || '').indexOf(DRAFT_MARK);
  if (i <= 0) return null;
  return { docId: name.slice(0, i), sid: name.slice(i + DRAFT_MARK.length) };
}

/**
 * @param {object} deps
 * @param {() => import('@hocuspocus/server').Hocuspocus} deps.getHocuspocus
 *   A getter: the sync server is constructed after the routes are registered.
 */
export function registerSuggestionRoutes(app, { requireUser, wrap, pool, grantOn, canEdit, canSuggest, getHocuspocus, notifyUser }) {
  const liveState = (name) => {
    const live = getHocuspocus().documents.get(name);
    return live ? Buffer.from(Y.encodeStateAsUpdate(live)) : null;
  };
  const pageState = async (docId) => {
    const live = liveState(docId);
    if (live) return live;
    const { rows } = await pool.query('SELECT state FROM doc_states WHERE doc_id = $1', [docId]);
    return rows[0]?.state ?? null;
  };
  const draftState = (row) => liveState(draftName(row.doc_id, row.id)) || row.state;

  /** Tell an open draft it is finished, then cut it off. Without the message
   *  its author's editor retried forever and kept their typing only locally. */
  const closeDraft = (docId, sid) => {
    const name = draftName(docId, sid);
    try { getHocuspocus().documents.get(name)?.broadcastStateless(JSON.stringify({ type: 'draft-closed' })); } catch { /* nobody had it open */ }
    // A beat for the message to go out before the socket does.
    setTimeout(() => { try { getHocuspocus().closeConnections(name); } catch { /* gone already */ } }, 250);
  };

  /** The draft, when this person may look at it: its author, or anyone who can edit the page. */
  async function visible(sid, user) {
    const { rows: [row] } = await pool.query(
      `SELECT s.*, u.name AS author_name, u.email AS author_email
         FROM doc_suggestions s JOIN users u ON u.id = s.author_id WHERE s.id = $1`,
      [sid]
    );
    if (!row) return null;
    const role = await grantOn(row.doc_id, user.id);
    if (!role) return null;
    const mine = row.author_id === user.id;
    if (!mine && !canEdit(role)) return null;
    return { row, role, mine, reviewer: canEdit(role) };
  }

  const pending = (changes, decisions) => changes.filter((c) => decisions?.[c.id]?.sig !== c.sig);

  const summary = (row) => ({
    id: row.id,
    docId: row.doc_id,
    authorId: row.author_id,
    authorName: row.author_name || row.author_email || 'Someone',
    status: row.status,
    message: row.message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    draft: draftName(row.doc_id, row.id),
  });

  /** Drafts on a page: your own, plus everyone's submitted ones if you can edit it. */
  app.get('/api/docs/:id/suggestions', requireUser, wrap(async (req, res) => {
    const role = await grantOn(req.params.id, req.user.id);
    if (!role) return res.status(403).json({ error: 'forbidden' });
    const { rows } = await pool.query(
      `SELECT s.id, s.doc_id, s.author_id, s.status, s.message, s.created_at, s.updated_at, s.submitted_at,
              u.name AS author_name, u.email AS author_email
         FROM doc_suggestions s JOIN users u ON u.id = s.author_id
        WHERE s.doc_id = $1 AND s.status <> 'closed'
          AND (s.author_id = $2 OR ($3 AND s.status = 'submitted'))
        ORDER BY s.updated_at DESC`,
      [req.params.id, req.user.id, canEdit(role)]
    );
    res.json(rows.map(summary));
  }));

  /** Start Suggesting: your open draft of this page, made now if there isn't one. */
  app.post('/api/docs/:id/suggestions', requireUser, wrap(async (req, res) => {
    const docId = req.params.id;
    if (!canSuggest(await grantOn(docId, req.user.id))) {
      return res.status(403).json({ error: 'You can read this page, but not suggest changes to it.' });
    }
    const open = await pool.query(
      `SELECT s.*, u.name AS author_name FROM doc_suggestions s JOIN users u ON u.id = s.author_id
        WHERE s.doc_id = $1 AND s.author_id = $2 AND s.status <> 'closed'`,
      [docId, req.user.id]
    );
    if (open.rows[0]) return res.json(summary(open.rows[0]));
    const state = await pageState(docId);
    if (!state) return res.status(400).json({ error: 'Open the page once before suggesting changes to it.' });
    const id = crypto.randomUUID();
    try {
      const { rows: [row] } = await pool.query(
        `INSERT INTO doc_suggestions (id, doc_id, author_id, base_state, state)
         VALUES ($1, $2, $3, $4, $4) RETURNING *`,
        [id, docId, req.user.id, state]
      );
      res.json(summary({ ...row, author_name: req.user.name || req.user.email }));
    } catch (e) {
      // Two tabs starting at once: the unique index lets one in; hand the other the same draft.
      const again = await pool.query(
        `SELECT s.*, u.name AS author_name FROM doc_suggestions s JOIN users u ON u.id = s.author_id
          WHERE s.doc_id = $1 AND s.author_id = $2 AND s.status <> 'closed'`,
        [docId, req.user.id]
      );
      if (!again.rows[0]) throw e;
      res.json(summary(again.rows[0]));
    }
  }));

  /** A draft and the changes it still waits on a decision for. */
  app.get('/api/suggestions/:sid', requireUser, wrap(async (req, res) => {
    const v = await visible(req.params.sid, req.user);
    if (!v) return res.status(404).json({ error: 'not found' });
    const main = await pageState(v.row.doc_id);
    const changes = computeChanges(docFromState(v.row.base_state), docFromState(draftState(v.row)), docFromState(main));
    const decisions = v.row.decisions || {};
    const open = pending(changes, decisions);
    const decided = Object.values(decisions);
    res.json({
      ...summary(v.row),
      canReview: v.reviewer,
      mine: v.mine,
      changes: open,
      accepted: decided.filter((d) => d.d === 'accepted').length,
      rejected: decided.filter((d) => d.d === 'rejected').length,
    });
  }));

  /** Hand the draft to the page's editors. */
  app.post('/api/suggestions/:sid/submit', requireUser, wrap(async (req, res) => {
    const v = await visible(req.params.sid, req.user);
    if (!v || !v.mine) return res.status(404).json({ error: 'not found' });
    if (v.row.status === 'closed') return res.status(409).json({ error: 'This draft is closed.' });
    const message = String(req.body?.message || '').trim().slice(0, 1000) || null;
    await pool.query(
      `UPDATE doc_suggestions SET status = 'submitted', message = $2, submitted_at = now(), updated_at = now() WHERE id = $1`,
      [v.row.id, message]
    );
    // Everyone who could act on it: the page's owner and its explicit editors.
    const { rows: reviewers } = await pool.query(
      `SELECT user_id FROM doc_access WHERE doc_id = $1 AND role IN ('owner', 'editor') AND user_id <> $2`,
      [v.row.doc_id, req.user.id]
    );
    for (const r of reviewers) {
      notifyUser({
        userId: r.user_id, actor: req.user, docId: v.row.doc_id, kind: 'review_requested',
        body: message || 'Suggested changes are ready for your review.',
      }).catch((e) => console.error('[notify] review request:', e.message));
    }
    res.json({ ok: true });
  }));

  /**
   * Accept and reject changes. Body: { accept?: ids[], reject?: ids[] } or
   * { all: 'accept' | 'reject' }. Accepted changes are written to the live page
   * in one transaction, through the sync server.
   */
  app.post('/api/suggestions/:sid/decide', requireUser, wrap(async (req, res) => {
    const v = await visible(req.params.sid, req.user);
    if (!v) return res.status(404).json({ error: 'not found' });
    if (!v.reviewer) return res.status(403).json({ error: 'Only people who can edit this page can review changes to it.' });
    if (v.row.status === 'closed') return res.status(409).json({ error: 'This draft is closed.' });
    const docId = v.row.doc_id;
    const baseDoc = docFromState(v.row.base_state);
    const draftDoc = docFromState(draftState(v.row));
    const decisions = { ...(v.row.decisions || {}) };
    // A decision is about the version of a change the reviewer was shown. Each
    // entry is { id, sig }; "all" carries every change the review listed, in
    // `seen`. A change the suggester has edited since has a different sig and
    // is left for another look rather than applied sight unseen.
    const entries = (list) => (Array.isArray(list) ? list : [])
      .map((e) => (typeof e === 'string' ? { id: e, sig: null } : { id: String(e?.id), sig: e?.sig ?? null }));
    const seen = entries(req.body?.seen);
    const all = req.body?.all;
    const acceptList = all === 'accept' ? seen : entries(req.body?.accept);
    const rejectList = all === 'reject' ? seen : entries(req.body?.reject);
    const acceptIds = new Map(acceptList.map((e) => [e.id, e.sig]));
    const rejectIds = new Map(rejectList.map((e) => [e.id, e.sig]));
    // "all" with no `seen` list (a direct API call, not the review page) means
    // every change open right now.
    const allNow = all && !Array.isArray(req.body?.seen) ? all : null;
    const matches = (map, c) => map.has(c.id) && (map.get(c.id) === null || map.get(c.id) === c.sig);

    let applied = 0;
    let skipped = 0;
    let stale = 0;
    let remaining = 0;
    const conn = await getHocuspocus().openDirectConnection(docId, { docId, user: req.user });
    try {
      await conn.transact((mainDoc) => {
        const open = pending(computeChanges(baseDoc, draftDoc, mainDoc), decisions);
        for (const c of open) {
          const accept = allNow === 'accept' || matches(acceptIds, c);
          const reject = !accept && (allNow === 'reject' || matches(rejectIds, c));
          if (!accept && !reject && (acceptIds.has(c.id) || rejectIds.has(c.id))) stale++;
          if (accept) {
            if (applyChange(mainDoc, draftDoc, baseDoc, c)) { applied++; decisions[c.id] = { d: 'accepted', sig: c.sig }; }
            else { skipped++; decisions[c.id] = { d: 'rejected', sig: c.sig, reason: 'gone' }; }
          } else if (reject) {
            decisions[c.id] = { d: 'rejected', sig: c.sig };
          } else {
            remaining++;
          }
        }
      });
    } finally {
      await conn.disconnect();
    }

    // Reviewed in full: the draft is done, and its author hears how it went.
    const done = remaining === 0;
    await pool.query(
      `UPDATE doc_suggestions SET decisions = $2, updated_at = now(),
              status = CASE WHEN $3 THEN 'closed' ELSE status END,
              closed_at = CASE WHEN $3 THEN now() ELSE closed_at END,
              closed_by = CASE WHEN $3 THEN $4 ELSE closed_by END
        WHERE id = $1`,
      [v.row.id, JSON.stringify(decisions), done, req.user.id]
    );
    if (applied) {
      await pool.query('UPDATE docs SET updated_at = now(), updated_by = $2 WHERE id = $1', [docId, req.user.id]);
    }
    if (done) {
      closeDraft(docId, v.row.id);
      if (v.row.author_id !== req.user.id) {
        const total = Object.values(decisions);
        const ok = total.filter((d) => d.d === 'accepted').length;
        notifyUser({
          userId: v.row.author_id, actor: req.user, docId, kind: 'review_done',
          body: `${ok} of ${total.length} suggested change${total.length === 1 ? '' : 's'} accepted.`,
        }).catch((e) => console.error('[notify] review done:', e.message));
      }
    }
    res.json({ ok: true, applied, skipped, stale, remaining, closed: done });
  }));

  /** Discard a draft (its author), or close it unreviewed (an editor). */
  app.delete('/api/suggestions/:sid', requireUser, wrap(async (req, res) => {
    const v = await visible(req.params.sid, req.user);
    if (!v) return res.status(404).json({ error: 'not found' });
    if (!v.mine && !v.reviewer) return res.status(403).json({ error: 'forbidden' });
    await pool.query(
      `UPDATE doc_suggestions SET status = 'closed', closed_at = now(), closed_by = $2, updated_at = now() WHERE id = $1`,
      [v.row.id, req.user.id]
    );
    closeDraft(v.row.doc_id, v.row.id);
    res.json({ ok: true });
  }));
}
