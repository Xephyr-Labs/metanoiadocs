// Server model for inline suggestions, in plain Yjs (no BlockSuite runtime).
// Inline: Y.Text attribute `mnSugg` = { id, kind: 'ins'|'del', by, at, via? }.
// Block: block prop `prop:mnSugg` = { id, kind: 'add'|'remove'|'type', by, at, via?, from? }.
// A `type` mark's `from` = { flavour, type, checked? }: a retype, a tick or an
// untick (R13b), suggested in place on the same block.
import * as Y from 'yjs';

const KEY = 'mnSugg';
const BLOCK_KEY = 'prop:mnSugg';

const textOf = (block) => {
  const t = block instanceof Y.Map ? block.get('prop:text') : null;
  return t instanceof Y.Text ? t : null;
};

/** The runs of a Y.Text with `ins` dropped and `del` kept; a user id (`userId`) sees their own the other way. */
export function visibleOps(ytext, userId = null) {
  return ytext.toDelta().filter((op) => {
    const s = op.attributes?.[KEY];
    if (s?.kind === 'ins' && s.by !== userId) return false;
    if (s?.kind === 'del' && userId != null && s.by === userId) return false;
    return true;
  });
}

const view = (ytext, userId) =>
  visibleOps(ytext, userId).map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('');

/**
 * How a block reads with nothing pending accepted: `null` when it is absent
 * (an `add`), else its flavour, type and tick (a `type` change shows its `from`).
 * `userId` sees their own block suggestions the other way round.
 */
export function blockView(b, userId = null) {
  const bs = b.get(BLOCK_KEY);
  const flavour = b.get('sys:flavour');
  const type = b.get('prop:type');
  const checked = !!b.get('prop:checked');
  const mine = userId != null && bs?.by === userId;
  if (bs?.kind === 'add') return mine ? { flavour, type, checked } : null;
  if (bs?.kind === 'remove' && mine) return null;
  if (bs?.kind === 'type' && bs.from && !mine) {
    return { flavour: bs.from.flavour, type: bs.from.type, checked: 'checked' in bs.from ? !!bs.from.checked : checked };
  }
  return { flavour, type, checked };
}

/** Whether a `type` mark ticks (true) or unticks (false) its block; undefined when the tick is unchanged. */
export const tickOf = (b, bs) =>
  (bs?.kind === 'type' && bs.from && 'checked' in bs.from && !!bs.from.checked !== !!b.get('prop:checked')
    ? !!b.get('prop:checked') : undefined);

export const pendingText = (ytext) => view(ytext, null);
export const authorView = (ytext, userId) => view(ytext, userId);

/** Blocks in page order (depth first from the root's children). */
function orderedBlocks(doc) {
  const blocks = doc.getMap('blocks');
  const out = [];
  const seen = new Set();
  const walk = (id) => {
    const b = blocks.get(id);
    if (!(b instanceof Y.Map) || seen.has(id)) return;
    seen.add(id);
    out.push([id, b]);
    const kids = b.get('sys:children');
    if (kids instanceof Y.Array) for (const k of kids.toArray()) walk(k);
  };
  for (const [id, b] of blocks) {
    if (b instanceof Y.Map && b.get('sys:flavour') === 'affine:page') walk(id);
  }
  return out;
}

/** Positions of every suggestion run in a Y.Text: [{ at, len, s, text }]. */
function runsOf(ytext) {
  const runs = [];
  let at = 0;
  for (const op of ytext.toDelta()) {
    const len = typeof op.insert === 'string' ? op.insert.length : 1;
    const s = op.attributes?.[KEY];
    if (s && typeof op.insert === 'string') runs.push({ at, len, s, text: op.insert });
    at += len;
  }
  return runs;
}

export function listSuggestions(doc) {
  const cards = new Map();
  const card = (s, blockId, kind) => {
    let c = cards.get(s.id);
    if (!c) {
      c = { id: s.id, by: s.by, at: s.at, blockId, kind, before: '', after: '' };
      cards.set(s.id, c);
    }
    if (s.via) c.via = s.via;
    return c;
  };
  for (const [blockId, b] of orderedBlocks(doc)) {
    const t = textOf(b);
    if (t) {
      for (const { s, text } of runsOf(t)) {
        const c = card(s, blockId, s.kind === 'del' ? 'delete' : 'insert');
        if (s.kind === 'del') c.before += text; else c.after += text;
        if ((s.kind === 'del' && c.after) || (s.kind === 'ins' && c.before)) c.kind = 'replace';
      }
    }
    const bs = b.get(BLOCK_KEY);
    if (bs?.id) {
      const c = card(bs, blockId, bs.kind);
      const here = t ? t.toString() : '';
      if (bs.kind === 'add') c.after = here;
      else if (bs.kind === 'remove') c.before = here;
      else {
        c.before = bs.from?.type ?? bs.from?.flavour ?? '';
        c.after = b.get('prop:type') ?? b.get('sys:flavour') ?? '';
        const ticked = tickOf(b, bs);
        if (ticked !== undefined) { c.ticked = ticked; c.text = t ? pendingText(t) : ''; }
      }
    }
  }
  return [...cards.values()];
}

/** What docs.pending_suggestions holds (Home's To review): each pending suggestion, in page order. */
export const pendingIndex = (doc) =>
  listSuggestions(doc).map(({ id, by, at, via }) => ({ id, by, at, ...(via ? { via } : {}) }));

/**
 * pendingIndex as JSON for docs.pending_suggestions, from a Y.Doc or a stored
 * state; null when it cannot be read, so a save keeps the column as it was
 * (`coalesce($n::jsonb, pending_suggestions)`) instead of failing.
 */
export function pendingJson(docOrState) {
  try {
    let doc = docOrState;
    if (!(doc instanceof Y.Doc)) { doc = new Y.Doc(); Y.applyUpdate(doc, new Uint8Array(docOrState)); }
    return JSON.stringify(pendingIndex(doc));
  } catch {
    return null;
  }
}

/**
 * The suggestion ids a Yjs `update` writes with `by === userId`: the `mnSugg`
 * of text it inserts or formats (Y.Text keeps attributes as format items) and
 * the `prop:mnSugg` it sets on blocks. Whoever sent the update is the only
 * user its suggestions may be credited to (the update's mnSugg.by alone is
 * whatever the sender wrote there).
 *
 * `seen` (per doc, kept until it unloads) holds every id any earlier update
 * mentioned: the first update to mention an id decides it. Typing or formatting
 * beside or inside a run makes Yjs write a closing format item restoring the
 * neighbouring attribute, so B's own update can carry someone else's run — a
 * spoof by A claiming to be B's, too. Every id here is added to `seen`.
 */
export function creditedSuggestions(update, userId, seen = new Set()) {
  const ids = new Set();
  const mentioned = new Set();
  for (const item of Y.decodeUpdate(update).structs) {
    const c = item.content;
    let v;
    if (c instanceof Y.ContentFormat && c.key === KEY) v = c.value;
    else if (item.parentSub === BLOCK_KEY && c instanceof Y.ContentAny) v = c.arr[0];
    if (!v?.id) continue;
    mentioned.add(v.id);
    if (userId && v.by === userId && !seen.has(v.id)) ids.add(v.id);
  }
  for (const id of mentioned) seen.add(id);
  return [...ids];
}

/**
 * The suggestions in `doc` that are not in `known` (ids seen at the last look)
 * and whose id `credits` (id -> user, from creditedSuggestions) gives to their
 * own `by` — so only what an author's own socket wrote; not Ask AI on their behalf,
 * which notifies its own way. Keyed by author: { ids, text } with `text` what
 * they add (where @mentions are looked for). Empty without a baseline.
 */
export function newSuggestionsBy(known, doc, credits) {
  const out = new Map();
  if (!known) return out;
  for (const c of listSuggestions(doc)) {
    if (known.has(c.id) || c.via || credits.get(c.id) !== c.by) continue;
    const e = out.get(c.by) ?? { ids: [], text: '' };
    e.ids.push(c.id);
    e.text += ` ${c.after}`;
    out.set(c.by, e);
  }
  return out;
}

function dropBlock(doc, id) {
  const blocks = doc.getMap('blocks');
  const b = blocks.get(id);
  if (!(b instanceof Y.Map)) return;
  for (const [, p] of blocks) {
    const kids = p instanceof Y.Map ? p.get('sys:children') : null;
    if (!(kids instanceof Y.Array)) continue;
    for (let i = kids.length - 1; i >= 0; i--) if (kids.get(i) === id) kids.delete(i, 1);
  }
  const kids = b.get('sys:children');
  if (kids instanceof Y.Array) for (const k of kids.toArray()) dropBlock(doc, k);
  blocks.delete(id);
}

/** Accept or reject the suggestion `id`. True if anything changed. */
export function decide(doc, id, verdict) {
  if (verdict !== 'accept' && verdict !== 'reject') throw new Error(`unknown verdict: ${verdict}`);
  const accept = verdict === 'accept';
  let changed = false;
  doc.transact(() => {
    for (const [blockId, b] of orderedBlocks(doc)) {
      const t = textOf(b);
      if (t) {
        // Back to front so earlier offsets stay valid.
        for (const { at, len, s } of runsOf(t).filter((r) => r.s.id === id).reverse()) {
          if ((s.kind === 'ins') === accept) t.format(at, len, { [KEY]: null });
          else t.delete(at, len);
          changed = true;
        }
      }
      const bs = b.get(BLOCK_KEY);
      if (bs?.id !== id) continue;
      changed = true;
      b.delete(BLOCK_KEY);
      if (bs.kind === 'add' ? !accept : bs.kind === 'remove' ? accept : false) dropBlock(doc, blockId);
      else if (bs.kind === 'type' && !accept && bs.from) {
        b.set('sys:flavour', bs.from.flavour);
        if (bs.from.type === undefined) b.delete('prop:type'); else b.set('prop:type', bs.from.type);
        if ('checked' in bs.from) b.set('prop:checked', !!bs.from.checked);
      }
    }
  });
  return changed;
}

export function decideAll(doc, verdict, { by } = {}) {
  if (verdict !== 'accept' && verdict !== 'reject') throw new Error(`unknown verdict: ${verdict}`);
  let n = 0;
  doc.transact(() => {
    for (const c of listSuggestions(doc)) {
      if (by && c.by !== by) continue;
      if (decide(doc, c.id, verdict)) n++;
    }
  });
  return n;
}
