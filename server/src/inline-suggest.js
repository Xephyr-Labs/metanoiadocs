// Server model for inline suggestions, in plain Yjs (no BlockSuite runtime).
// Inline: Y.Text attribute `mnSugg` = { id, kind: 'ins'|'del', by, at, via? }.
// Block: block prop `prop:mnSugg` = { id, kind: 'add'|'remove'|'type', by, at, via?, from? }.
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
 * (an `add`), else its flavour and type (a `type` change shows its `from`).
 * `userId` sees their own block suggestions the other way round.
 */
export function blockView(b, userId = null) {
  const bs = b.get(BLOCK_KEY);
  const flavour = b.get('sys:flavour');
  const type = b.get('prop:type');
  const mine = userId != null && bs?.by === userId;
  if (bs?.kind === 'add') return mine ? { flavour, type } : null;
  if (bs?.kind === 'remove' && mine) return null;
  if (bs?.kind === 'type' && bs.from && !mine) return { flavour: bs.from.flavour, type: bs.from.type };
  return { flavour, type };
}

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
      }
    }
  }
  return [...cards.values()];
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
      }
    }
  });
  return changed;
}

export function decideAll(doc, verdict, { by } = {}) {
  let n = 0;
  doc.transact(() => {
    for (const c of listSuggestions(doc)) {
      if (by && c.by !== by) continue;
      if (decide(doc, c.id, verdict)) n++;
    }
  });
  return n;
}
