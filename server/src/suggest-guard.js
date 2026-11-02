// The server's check on a suggest-only sync connection (role `suggester`).
// Such a person writes to the live page in Suggesting mode, so each Yjs update
// they send is applied to a clone first and what it changed is held against an
// allow-list. Anything not on it is refused (the update is not applied). This
// is a permission boundary: when unsure, refuse.
//
// Allowed, for user `me` (inline-suggest.js has the data model):
// - new text carrying mnSugg { kind:'ins', by: me } (no `via`);
// - marking existing non-pending text with mnSugg { kind:'del', by: me };
//   removing or re-marking my own `del` (undo), re-marking my own `ins`;
// - deleting text of my own pending `ins`;
// - a new empty paragraph/list block marked prop:mnSugg { kind:'add', by: me },
//   inserted once into a container's children; deleting such a block again;
// - setting or withdrawing my own prop:mnSugg `remove` on any block except page
//   structure (page, note, surface) and anything inside a table or database;
// - setting, changing or withdrawing my own `type` on a paragraph/list outside
//   tables and databases (it may change flavour/type/checked in place, with
//   `from` holding what it was: R13b, ticks included).
// - folding or unfolding a heading or list item (prop:collapsed): view state
//   BlockSuite's toggle writes straight to the block; it changes no content.
// Text only in paragraph/list text outside tables and databases (R7, R12).
import { isDeepStrictEqual } from 'node:util';
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import { listSuggestions } from './inline-suggest.js';

const KEY = 'mnSugg';
const BLOCK_KEY = 'prop:mnSugg';
const TEXT_FLAVOURS = new Set(['affine:paragraph', 'affine:list']);
// Where a paragraph or list item may be added: what their schemas name as a
// parent (affine-model paragraph/list), plus the app's columns (columns-model.ts).
// Not databases (NO_SUGGEST), nor the canvas-only edgeless-text and the unused
// transcription block: Suggesting is page mode.
const CONTAINERS = new Set(['affine:note', 'affine:paragraph', 'affine:list', 'affine:callout', 'metanoia:column']);
const NO_SUGGEST = new Set(['affine:table', 'affine:database', 'metanoia:database']);
const TYPE_KEYS = new Set(['sys:flavour', 'prop:type', 'prop:checked']);
// Accepting a remove on these would drop the page's own structure.
const STRUCTURE = new Set(['affine:page', 'affine:note', 'affine:surface']);

class Refused extends Error {}
const refuse = (reason) => { throw new Refused(reason); };

const mine = (s, me, kind) => !!s && s.by === me && !s.via && (!kind || s.kind === kind);

/** A mark this user may write: exact keys, their own, no `via`, numeric `at`. */
function validMark(m, me, kinds) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  if (Object.keys(m).some((k) => !['id', 'kind', 'by', 'at', 'from'].includes(k))) return false;
  if (typeof m.id !== 'string' || !m.id || m.id.length > 200) return false;
  if (!kinds.includes(m.kind) || m.by !== me || !Number.isFinite(m.at)) return false;
  if (m.kind !== 'type') return !('from' in m);
  const f = m.from;
  if (!f || typeof f !== 'object' || typeof f.flavour !== 'string') return false;
  if (Object.keys(f).some((k) => !['flavour', 'type', 'checked'].includes(k))) return false;
  if ('type' in f && typeof f.type !== 'string') return false;
  return !('checked' in f) || typeof f.checked === 'boolean';
}

const idOf = (n, i) => `${n.id.client}:${n.id.clock + i}`;

/** Each content unit of a Y.Text: id -> { attrs, live, content }. */
function textUnits(ytext) {
  const out = new Map();
  let attrs = {};
  for (let n = ytext?._start; n; n = n.right) {
    const c = n.content;
    if (c instanceof Y.ContentFormat) {
      if (!n.deleted) {
        attrs = { ...attrs };
        if (c.value == null) delete attrs[c.key]; else attrs[c.key] = c.value;
      }
      continue;
    }
    for (let i = 0; i < n.length; i++) out.set(idOf(n, i), { attrs, live: !n.deleted, content: c });
  }
  return out;
}

/** What a Y.Array's update added and removed (moves show as both). */
function arrayDiff(before, after) {
  const was = new Map();
  for (let n = before?._start; n; n = n.right) for (let i = 0; i < n.length; i++) was.set(idOf(n, i), !n.deleted);
  const added = [], removed = [];
  for (let n = after._start; n; n = n.right) {
    const vals = n.content.getContent();
    for (let i = 0; i < n.length; i++) {
      const live = was.get(idOf(n, i));
      if (live === undefined && !n.deleted) added.push(vals[i]);
      else if (live && n.deleted) removed.push(vals[i]);
    }
  }
  return { added, removed };
}

function checkText(before, after, ctx) {
  const was = textUnits(before);
  for (const [id, a] of textUnits(after)) {
    const p = was.get(id);
    if (!p) {
      if (!a.live) continue; // added and removed in the same update
      if (!(a.content instanceof Y.ContentString || a.content instanceof Y.ContentEmbed)) refuse('inserted something that is not text');
      if (!validMark(a.attrs[KEY], ctx.me, ['ins'])) refuse('inserted text is not marked as your suggestion');
      ctx.claim(a.attrs[KEY].id);
      continue;
    }
    if (!p.live) continue;
    if (!a.live) {
      if (!mine(p.attrs[KEY], ctx.me, 'ins')) refuse('deleted text that is not your own pending insertion');
      continue;
    }
    const { [KEY]: s0, ...f0 } = p.attrs;
    const { [KEY]: s1, ...f1 } = a.attrs;
    if (!isDeepStrictEqual(f0, f1)) refuse('changed formatting');
    if (isDeepStrictEqual(s0, s1)) continue;
    const allowed = (!s0 && validMark(s1, ctx.me, ['del']))
      || (mine(s0, ctx.me, 'del') && (s1 == null || validMark(s1, ctx.me, ['del'])))
      || (mine(s0, ctx.me, 'ins') && validMark(s1, ctx.me, ['ins']));
    if (!allowed) refuse('changed a suggestion that is not yours, or marked pending text');
    if (s1) ctx.claim(s1.id);
  }
}

const vals = (b) => ({ flavour: b.get('sys:flavour'), type: b.get('prop:type'), checked: !!b.get('prop:checked') });

/** A new block: an empty-children paragraph/list marked as my `add`; its text is all my `ins`. */
function checkNewBlock(id, b, ctx) {
  if (!(b instanceof Y.Map)) refuse('a block that is not a block');
  if (!TEXT_FLAVOURS.has(b.get('sys:flavour'))) refuse('only a paragraph or list item can be suggested');
  if (!validMark(b.get(BLOCK_KEY), ctx.me, ['add'])) refuse('a new block is not marked as your suggestion');
  ctx.claim(b.get(BLOCK_KEY).id);
  for (const [k, v] of b.entries()) {
    if (k === 'sys:id') { if (v !== id) refuse('block id mismatch'); }
    else if (k === 'sys:flavour' || k === BLOCK_KEY) continue;
    else if (k === 'sys:version') { if (!Number.isFinite(v)) refuse('bad block version'); }
    else if (k === 'sys:children') { if (!(v instanceof Y.Array) || v.length) refuse('a new block cannot hold other blocks'); }
    else if (k === 'prop:text') { if (!(v instanceof Y.Text)) refuse('bad block text'); checkText(null, v, ctx); }
    else if (!k.startsWith('prop:') || !(v === null || ['string', 'number', 'boolean'].includes(typeof v))) refuse(`a new block cannot set ${k}`);
  }
}

/** Deleting a block: only my own `add`, holding nothing but my own `ins`. */
function checkRemovedBlock(b, ctx) {
  if (!(b instanceof Y.Map)) refuse('removed something that is not a block');
  if (!mine(b.get(BLOCK_KEY), ctx.me, 'add')) refuse('deleted a block that is not your own suggested addition');
  const kids = b.get('sys:children');
  if (kids instanceof Y.Array && kids.length) refuse('deleted a block that holds other blocks');
  for (const u of textUnits(b.get('prop:text')).values()) {
    if (u.live && !mine(u.attrs[KEY], ctx.me, 'ins')) refuse('deleted a block with text that is not your own suggestion');
  }
}

/** Block-level marks on an existing block: my own `remove` or `type`, never anyone else's or an `add`. */
function checkBlockMark(id, bb, ba, keys, ctx) {
  if (keys.has('prop:collapsed')) {
    // Shared view state, as an editor's fold is; refusing it reloaded the suggester's tab and lost their unsynced typing.
    if (!TEXT_FLAVOURS.has(ba.get('sys:flavour')) || !['boolean', 'undefined'].includes(typeof ba.get('prop:collapsed'))) refuse('cannot change prop:collapsed');
    keys = new Set([...keys].filter((k) => k !== 'prop:collapsed'));
    if (!keys.size) return;
  }
  for (const k of keys) if (k !== BLOCK_KEY && !TYPE_KEYS.has(k)) refuse(`cannot change ${k}`);
  const prev = bb.get(BLOCK_KEY);
  const next = ba.get(BLOCK_KEY);
  if (prev && !mine(prev, ctx.me)) refuse('changed a block suggestion that is not yours');
  if (prev?.kind === 'add') refuse('your own added block can only be edited in its text or deleted');
  const v0 = vals(bb), v1 = vals(ba);
  if (typeof v1.flavour !== 'string' || !['string', 'undefined'].includes(typeof ba.get('prop:type'))
    || !['boolean', 'undefined'].includes(typeof ba.get('prop:checked'))) refuse('bad block values');
  const origin = prev?.kind === 'type' && prev.from
    ? { flavour: prev.from.flavour, type: prev.from.type, checked: 'checked' in prev.from ? !!prev.from.checked : v0.checked }
    : v0;
  if (!next) {
    if (!prev || !isDeepStrictEqual(v1, origin)) refuse('changed a block without suggesting it');
    return;
  }
  if (!validMark(next, ctx.me, ['remove', 'type'])) refuse('a block mark that is not your suggestion');
  ctx.claim(next.id);
  if (STRUCTURE.has(v0.flavour)) refuse('page structure cannot be suggested away');
  if (ctx.underNoSuggest(id)) refuse('tables and databases cannot be suggested in');
  if (next.kind === 'remove') {
    if (prev?.kind === 'type' || !isDeepStrictEqual(v1, v0)) refuse('a remove suggestion changes nothing else');
    return;
  }
  if (prev?.kind === 'remove') refuse('withdraw the remove suggestion first');
  const f = next.from;
  if (f.flavour !== origin.flavour || f.type !== origin.type) refuse('a type suggestion must say what the block was');
  if ('checked' in f ? f.checked !== origin.checked : v1.checked !== origin.checked) refuse('a type suggestion must say what the block was');
  if (!TEXT_FLAVOURS.has(v1.flavour) || !TEXT_FLAVOURS.has(origin.flavour)) refuse('only a paragraph or list item can be suggested');
}

/** Where an item lives: its block id and the key path inside that block ([] = the block itself). */
function locate(item, root) {
  const path = [];
  let cur = item;
  while (cur.parent !== root) {
    path.unshift(cur.parentSub);
    cur = cur.parent?._item;
    if (!cur) refuse('changes outside the page blocks');
  }
  return { id: cur.parentSub, path };
}

function check(doc, update, me) {
  if (!me) refuse('no user');
  const clone = new Y.Doc({ gc: false });
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(doc));
  // What the doc waits on (structs whose dependencies it lacks). The live doc
  // may already wait on someone's out-of-order frame; an update that adds to
  // that would integrate later, unchecked, so it is refused.
  const pendingNow = () => [clone.store.pendingStructs?.update ?? null, clone.store.pendingDs ?? null];
  const pending0 = pendingNow();
  const sv0 = Y.decodeStateVector(Y.encodeStateVector(clone));
  const trs = [];
  clone.on('afterTransaction', (t) => trs.push(t));
  Y.applyUpdate(clone, update);
  const pending1 = pendingNow();
  if ((pending1[0] || pending1[1]) && !isDeepStrictEqual(pending0, pending1)) refuse('depends on changes the server does not have');

  const root = clone.getMap('blocks');
  const touched = new Map(); // block id -> { entry, keys, inner, deep }
  const touch = (item) => {
    if (!(item instanceof Y.Item)) return; // GC/skip fillers carry no content
    const { id, path } = locate(item, root);
    if (!touched.has(id)) touched.set(id, { entry: false, keys: new Set(), inner: new Set(), deep: false });
    const t = touched.get(id);
    if (path.length === 0) t.entry = true;
    else if (path.length === 1) t.keys.add(path[0]);
    else if (path.length === 2) t.inner.add(path[0]);
    else t.deep = true;
  };
  for (const [client, structs] of clone.store.clients) {
    const from = sv0.get(client) ?? 0;
    // `clock + length`: Yjs merges a new item into its left neighbour of the
    // same client, and the merged struct keeps the neighbour's (old) clock.
    for (let i = structs.length - 1; i >= 0 && structs[i].id.clock + structs[i].length > from; i--) touch(structs[i]);
  }
  for (const t of trs) Y.iterateDeletedStructs(t, t.deleteSet, touch);
  if (!touched.size) return;

  let foreign = null;
  const ctx = {
    me,
    // A new mark may not reuse an id someone else's suggestion has (it would join their card).
    claim(id) {
      foreign ??= new Set(listSuggestions(doc).filter((c) => c.by !== me).map((c) => c.id));
      if (foreign.has(id)) refuse('reused the id of someone else\'s suggestion');
    },
  };
  const before = doc.getMap('blocks');
  let parents = null;
  const underNoSuggest = (id) => {
    if (!parents) {
      parents = new Map();
      for (const [pid, b] of root) {
        const kids = b instanceof Y.Map ? b.get('sys:children') : null;
        if (kids instanceof Y.Array) for (const k of kids.toArray()) parents.set(k, pid);
      }
    }
    const seen = new Set();
    for (let p = parents.get(id); p && !seen.has(p); p = parents.get(p)) {
      seen.add(p);
      if (NO_SUGGEST.has(root.get(p)?.get?.('sys:flavour'))) return true;
    }
    return false;
  };
  ctx.underNoSuggest = underNoSuggest;

  const added = new Set(), removed = new Set();
  const inserted = [], dropped = [];
  for (const [id, t] of touched) {
    const bb = before.get(id);
    const ba = root.get(id);
    const sameBlock = bb instanceof Y.Map && ba instanceof Y.Map && Y.compareIDs(bb._item.id, ba._item.id);
    if (bb !== undefined && !sameBlock) { checkRemovedBlock(bb, ctx); removed.add(id); }
    if (ba !== undefined && !sameBlock) { checkNewBlock(id, ba, ctx); added.add(id); }
    if (!sameBlock) continue;
    if (t.deep) refuse('changed something deep inside a block');
    if (t.keys.size) checkBlockMark(id, bb, ba, t.keys, ctx);
    for (const k of t.inner) {
      if (t.keys.has(k)) refuse(`replaced ${k}`);
      const flavour = ba.get('sys:flavour');
      if (underNoSuggest(id)) refuse('tables and databases cannot be suggested in');
      if (k === 'prop:text') {
        if (!TEXT_FLAVOURS.has(flavour) || !TEXT_FLAVOURS.has(bb.get('sys:flavour'))) refuse('only paragraph and list text can be suggested');
        checkText(bb.get(k), ba.get(k), ctx);
      } else if (k === 'sys:children') {
        if (!CONTAINERS.has(flavour)) refuse('blocks cannot be suggested here');
        const d = arrayDiff(bb.get(k), ba.get(k));
        inserted.push(...d.added);
        dropped.push(...d.removed);
      } else refuse(`cannot change ${k}`);
    }
  }
  // Every added block is placed exactly once and nothing else moves; every
  // removed block leaves its parent and nothing else does.
  const same = (list, set) => list.length === set.size && list.every((x) => set.has(x));
  if (!same(inserted, added)) refuse('moved or misplaced a block');
  if (!same(dropped, removed)) refuse('removed a block from the page');
}

/**
 * Whether user `userId`, on a suggest-only connection, may apply `update` to
 * `doc`. Never throws; never changes `doc`.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkSuggesterUpdate(doc, update, userId) {
  try {
    check(doc, update, userId);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Refused ? e.message : 'unreadable update' };
  }
}

/**
 * The Yjs update a Hocuspocus message carries into the document: a Sync (0) or
 * SyncReply (4) message of subtype step 2 (1) or update (2), the only two that
 * MessageReceiver.readSyncMessage applies. Anything else (step 1, awareness,
 * stateless, auth) is null. Throws on a message too short to read.
 */
export function syncUpdateOf(data) {
  const d = decoding.createDecoder(data);
  decoding.readVarString(d); // document name
  const type = decoding.readVarUint(d);
  if (type !== 0 && type !== 4) return null;
  const sub = decoding.readVarUint(d);
  return sub === 1 || sub === 2 ? decoding.readVarUint8Array(d) : null;
}

/**
 * Hocuspocus extension: every update from a connection whose `context.role` is
 * `role` must pass checkSuggesterUpdate, as `context.user.id`.
 *
 * The update is checked and applied here, in one synchronous step, so the next
 * message is checked against a document that already has this one: Hocuspocus
 * runs each message's hook chain in microtasks, so a burst of frames from one
 * socket runs their hooks before their applies. MessageReceiver then applies
 * the same update again, a no-op in Yjs.
 *
 * A refused update is not applied: a throw here makes Connection.handleMessage
 * skip MessageReceiver and close the connection with Forbidden (4403), which
 * the provider does not retry. First the client is sent a stateless
 * `suggestion-refused`, telling it to drop its local copy and reload from the
 * server: a Yjs peer cannot be made to forget an update any other way. Every
 * later message on that connection is refused too.
 */
export const suggestGuard = (role) => ({
  async beforeHandleMessage({ connection, context, document, update }) {
    if (context?.role !== role) return;
    let reason = connection.mnRefused;
    if (!reason) {
      let change = null;
      try { change = syncUpdateOf(update); } catch { reason = 'unreadable message'; }
      if (change) {
        const r = checkSuggesterUpdate(document, change, context.user?.id);
        if (r.ok) Y.applyUpdate(document, change, connection);
        else reason = r.reason;
      }
    }
    if (!reason) return;
    if (!connection.mnRefused) {
      connection.mnRefused = reason;
      console.warn('[sync] refused a suggester update', context.user?.id, document.name, reason);
      connection.sendStateless(JSON.stringify({ type: 'suggestion-refused', reason }));
    }
    throw Object.assign(new Error(`suggestion refused: ${reason}`), { reason: 'suggestion refused' });
  },
});

/**
 * Hocuspocus extension (R18): no client may send BroadcastStateless (6).
 * MessageReceiver relays one to every connection on the document unchecked
 * (MessageReceiver.ts:88–93), so any viewer or share-link guest could make
 * every open editor remount ('doc-restored') or act on anything else the
 * server says that way. Only the server broadcasts; the app's clients never
 * send stateless messages. Refused like a bad update: closed with 4403.
 */
export const noClientBroadcast = {
  async beforeHandleMessage({ update }) {
    let type = -1;
    try {
      const d = decoding.createDecoder(update);
      decoding.readVarString(d);
      type = decoding.readVarUint(d);
    } catch { return; /* unreadable: MessageReceiver refuses it */ }
    if (type === 6) throw Object.assign(new Error('clients may not broadcast stateless messages'), { reason: 'broadcast refused' });
  },
};
