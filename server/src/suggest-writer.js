// A markdown write (an agent's write_doc, Ask AI) becomes inline suggestions on
// the live page: the writer's view of the page is compared with the markdown,
// block by block and then word by word, and only the differences are written,
// as the marks inline-suggest.js reads. The writer's own earlier suggestions
// are reconciled with the new text (kept, changed or withdrawn); everyone
// else's are left exactly as they are.
import crypto from 'node:crypto';
import * as Y from 'yjs';
import { blocksToMarkdown, bodyNote, buildDocState, copyTree, dropTree } from './blocks.js';
import { listSuggestions } from './inline-suggest.js';
import { renumberLists } from './suggestions.js';

const KEY = 'mnSugg';
const BLOCK_KEY = 'prop:mnSugg';
// Blocks whose text can carry inline marks. Code and LaTeX cannot (R7): a
// change there is the block removed and the new one added.
const TEXTY = new Set(['affine:paragraph', 'affine:list']);
const DELETE = Symbol('delete');

/** What markdown round trips cannot keep apart: quote and dash style, runs of whitespace. */
const foldMarks = (s) => s.replace(/[‘’‚‛′]/g, "'").replace(/[“”„‟″]/g, '"').replace(/[‐‑‒–—―]/g, '-');
const fold = (s) => foldMarks(s).replace(/\s+/g, ' ').trim();
// Block keys keep whitespace: in code it is content, and in prose the word diff absorbs it.
const blockFold = (s) => foldMarks(s).trim();

const kidsOf = (b) => {
  const k = b instanceof Y.Map ? b.get('sys:children') : null;
  return k instanceof Y.Array ? k.toArray() : [];
};

/**
 * Write `markdown` into the live `doc` as suggestions by `by` (`via: 'ai'` for
 * Ask AI). 'replace' compares it with the whole body as `by` sees it (their
 * own pending suggestions applied); 'append' adds its blocks at the end.
 * `direct` is a trusted writer's replace: the same comparison against the page
 * with nothing pending accepted, applied as plain edits, so the body changes
 * while every pending suggestion stays where it is. Call inside the caller's
 * transaction so connected editors get it as one edit.
 *
 * @returns {{ changes: number, ids: string[] }} the writer's pending suggestions
 *   this write leaves (replace: all of theirs on the page; append: the new ones), in page order.
 */
export function suggestMarkdown({ doc, markdown, mode = 'append', by, via, title = '', resolve, direct = false, at = Date.now() }) {
  const live = doc.getMap('blocks');
  const note = bodyNote(live);
  if (!note) throw new Error('no body');
  const scratchDoc = new Y.Doc();
  Y.applyUpdate(scratchDoc, buildDocState(title, markdown, resolve));
  const scratch = scratchDoc.getMap('blocks');
  const w = { live, scratch, by: direct ? null : by, via, at, direct, created: [], usedIds: new Set() };
  const incoming = kidsOf(bodyNote(scratch)).filter((id) => keyOf(scratch, id, null) != null);
  doc.transact(() => {
    let kids = note.get('sys:children');
    if (!(kids instanceof Y.Array)) { kids = new Y.Array(); note.set('sys:children', kids); }
    if (mode === 'replace') reconcileBlocks(w, kids, incoming);
    else {
      let after = kids.length ? kids.get(kids.length - 1) : null;
      for (const id of incoming) after = addBlock(w, kids, after, id);
      renumberLists(live, kids.toArray());
    }
  });
  if (direct) return { changes: 0, ids: [] };
  const ids = mode === 'replace' ? listSuggestions(doc).filter((c) => c.by === by).map((c) => c.id) : w.created;
  return { changes: ids.length, ids };
}

function mark(w, kind, keep = {}) {
  let id = keep.id;
  if (!id || w.usedIds.has(id)) id = crypto.randomUUID();
  w.usedIds.add(id);
  return { id, kind, by: w.by, at: keep.at ?? w.at, ...(w.via ? { via: w.via } : {}), ...(keep.from ? { from: keep.from } : {}) };
}

const sugg = (b) => b.get(BLOCK_KEY) || null;
const own = (w, s) => !!s && w.by != null && s.by === w.by;

/** A block as canonical markdown in `by`'s view (null: it renders to nothing). Their own removal counts as not removed, so writing the block back can withdraw it. */
function keyOf(blocks, id, by) {
  const s = sugg(blocks.get(id));
  const view = s?.kind === 'remove' && by != null && s.by === by ? null : by;
  const md = blocksToMarkdown(blocks, [id], { escape: true, resolveTitle: (pid) => pid, withPendingFor: view });
  return md ? blockFold(md) : null;
}

/**
 * Make the live `children` say what scratch `newIds` say, as suggestions.
 * diffChildren's shape: LCS on block keys keeps equal blocks; between
 * matches, blocks of the same kind are paired and diffed inside; the rest of
 * the old run is suggested removed and the rest of the new run suggested added.
 */
function reconcileBlocks(w, children, newIds) {
  const { live, scratch, by } = w;
  // Others' additions are not on the page the writer read, and blocks that
  // render to nothing (empty lines, databases) are not in any markdown: both
  // stay exactly where they are.
  const old = children.toArray().filter((id) => {
    const b = live.get(id);
    if (!(b instanceof Y.Map)) return false;
    const s = sugg(b);
    if (s?.kind === 'add' && !own(w, s)) return false;
    return keyOf(live, id, by) != null;
  });
  const ok = old.map((id) => keyOf(live, id, by));
  const nk = newIds.map((id) => keyOf(scratch, id, null));
  // ponytail: O(n·m) LCS like diffChildren; fine for page-sized bodies.
  const n = ok.length, m = nk.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    L[i][j] = ok[i] === nk[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  let i = 0, j = 0, after = null;
  const flush = (iEnd, jEnd) => {
    while (i < iEnd && j < jEnd) {
      if (pairable(w, old[i], newIds[j])) {
        pairBlocks(w, old[i], newIds[j]);
        after = old[i];
      } else break;
      i++; j++;
    }
    for (; i < iEnd; i++) after = removeBlock(w, children, old[i]) ?? after;
    for (; j < jEnd; j++) after = addBlock(w, children, after, newIds[j]);
  };
  let a = 0, b = 0;
  while (a < n && b < m) {
    if (ok[a] === nk[b]) {
      flush(a, b);
      const s = sugg(live.get(old[a]));
      if (s?.kind === 'remove' && own(w, s)) live.get(old[a]).delete(BLOCK_KEY); // written back: withdrawn
      after = old[a];
      i++; j++; a++; b++;
    } else if (L[a + 1][b] >= L[a][b + 1]) a++;
    else b++;
  }
  flush(n, m);
  renumberLists(live, children.toArray());
}

const checkedOf = (b) => !!b.get('prop:checked');

/** Someone else's retype stays theirs; the type the writer read is the one it came from. */
const baseType = (w, o) => {
  const s = sugg(o);
  return s?.kind === 'type' && !own(w, s) ? s.from?.type : o.get('prop:type');
};

function pairable(w, oid, nid) {
  const o = w.live.get(oid), nb = w.scratch.get(nid);
  const s = sugg(o);
  // The writer's own added block is simplest withdrawn and added again as it
  // now reads. Someone else's block suggestion is theirs to keep: a suggester
  // leaves a block they suggested removing alone, and edits only the text of
  // one they retyped or ticked; a trusted writer edits it under their mark.
  if (s && (s.kind === 'add' || (!own(w, s) && !w.direct && s.kind !== 'type'))) return false;
  const fl = o.get('sys:flavour');
  if (!TEXTY.has(fl) || fl !== nb.get('sys:flavour')) return false;
  if (baseType(w, o) === nb.get('prop:type')) return true;
  // ponytail: a retype pairs only when the text is unchanged; retype + edit is remove + add.
  // (A tick alone keeps the type, so it always pairs.)
  const t = o.get('prop:text'), nt = nb.get('prop:text');
  return fold(viewText(w, t)) === fold(nt instanceof Y.Text ? nt.toString() : '');
}

const viewText = (w, t) => (t instanceof Y.Text
  ? t.toDelta().filter((op) => {
    const s = op.attributes?.[KEY];
    return !(s?.kind === 'ins' && !own(w, s)) && !(s?.kind === 'del' && own(w, s));
  }).map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('')
  : '');

function pairBlocks(w, oid, nid) {
  const o = w.live.get(oid), nb = w.scratch.get(nid);
  let s = sugg(o);
  if (s?.kind === 'remove' && own(w, s)) { o.delete(BLOCK_KEY); s = null; } // edited, so wanted after all
  // A retype, a tick and an untick are one in-place `type` mark (R13b): the
  // block takes the new type and tick, `from` keeps them as everyone else reads them.
  const list = o.get('sys:flavour') === 'affine:list';
  const type = nb.get('prop:type');
  const checked = checkedOf(nb);
  const differs = (f) => f.type !== type || (list && f.checked !== checked);
  if (s && !own(w, s)) {
    // ponytail: a suggester's own type/tick wish on a block someone else already retyped or ticked is not written; their mark stands.
    // Direct: the base under their mark moves, the mark stays.
    if (w.direct && s.kind === 'type' && s.from) {
      const base = { type: s.from.type, checked: 'checked' in s.from ? !!s.from.checked : checkedOf(o) };
      if (differs(base)) {
        const from = { ...s.from, type, ...(list ? { checked } : {}) };
        if (!differs({ type: o.get('prop:type'), checked: checkedOf(o) })) o.delete(BLOCK_KEY);
        else o.set(BLOCK_KEY, { ...s, from });
      }
    }
  } else if (differs({ type: o.get('prop:type'), checked: checkedOf(o) })) {
    const from = s?.kind === 'type' ? { ...s.from } : { flavour: o.get('sys:flavour'), type: o.get('prop:type') };
    if (list && !('checked' in from)) from.checked = checkedOf(o);
    if (o.get('prop:type') !== type) o.set('prop:type', type);
    if (list && checkedOf(o) !== checked) o.set('prop:checked', checked);
    if (w.direct || !differs({ type: from.type, checked: !!from.checked })) o.delete(BLOCK_KEY);
    else o.set(BLOCK_KEY, mark(w, 'type', { ...(s?.kind === 'type' ? s : {}), from }));
  }
  const t = o.get('prop:text'), nt = nb.get('prop:text');
  if (t instanceof Y.Text && nt instanceof Y.Text) reconcileText(w, t, nt);
  const nk = kidsOf(nb).filter((id) => keyOf(w.scratch, id, null) != null);
  if (nk.length || kidsOf(o).length) {
    if (!(o.get('sys:children') instanceof Y.Array)) o.set('sys:children', new Y.Array());
    reconcileBlocks(w, o.get('sys:children'), nk);
  }
}

/** Returns the id when the block stays in `children` (to insert after), else null. */
function removeBlock(w, children, id) {
  const b = w.live.get(id);
  const s = sugg(b);
  if (w.direct || (s?.kind === 'add' && own(w, s))) {
    const at = children.toArray().indexOf(id);
    if (at >= 0) children.delete(at, 1);
    dropTree(w.live, id);
    return null;
  }
  if (!s) b.set(BLOCK_KEY, mark(w, 'remove'));
  return id;
}

function addBlock(w, children, after, sid) {
  const id = copyTree(w.scratch, w.live, sid);
  if (!w.direct) {
    const m = mark(w, 'add');
    w.live.get(id).set(BLOCK_KEY, m);
    w.created.push(m.id);
  }
  children.insert(after == null ? 0 : children.toArray().indexOf(after) + 1, [id]);
  return id;
}

// ── inside a block ──────────────────────────────────────────────────────────

/** Formatting markdown carries; anything else on the page is not the writer's to compare. */
const fmtOf = (a = {}) => JSON.stringify([!!a.bold, !!a.italic, !!a.strike, !!a.underline, !!a.code,
  a.link ?? null, a.color ?? null, a.background ?? null, a.reference?.pageId ?? null]);

/** A Y.Text as one entry per unit: { ch, insert, attrs (no mnSugg), s }. */
function unitsOf(t) {
  const out = [];
  for (const op of t.toDelta()) {
    const { [KEY]: s = null, ...attrs } = op.attributes || {};
    if (typeof op.insert === 'string') for (const ch of op.insert.split('')) out.push({ ch, insert: ch, attrs, s });
    else out.push({ ch: '￼', insert: op.insert, attrs, s });
  }
  return out;
}

/** Word tokens over units, never across a formatting change: [{ s, e, k }]. */
function tokens(units) {
  const out = [];
  let i = 0;
  while (i < units.length) {
    const f = fmtOf(units[i].attrs);
    let e = i;
    while (e < units.length && fmtOf(units[e].attrs) === f) e++;
    const str = units.slice(i, e).map((u) => u.ch).join('');
    for (const m of str.matchAll(/\s+|[\p{L}\p{N}_]+|[\s\S]/gu)) {
      const s = i + m.index;
      out.push({ s, e: s + m[0].length, k: /^\s+$/.test(m[0]) ? ' ' : `${foldMarks(m[0])}\u0001${f}` });
    }
    i = e;
  }
  return out;
}

const STOP = new Set(('a an the and or but nor so of to in on at by for with from as into onto than then '
  + 'is are was were be been am it its this that these those we you they he she i our your their his her').split(' '));
const isWord = (str) => /[\p{L}\p{N}]/u.test(str);
// ponytail: sentence ends at . ! ? before a space; abbreviations ("e.g. x") split early, which only means two cards.
const endsSentence = (T, x, units) => /^[.!?]$/.test(units[T[x].s].ch) && (x + 1 >= T.length || units[T[x + 1].s].ch.trim() === '');

/**
 * Hunks between base and next as unit ranges: [{ bs, be, ns, ne }]. One
 * suggestion per thought, not per word: inside a sentence, changes joined only
 * by stopwords, or covering much of the sentence, become one replace from the
 * first change to the last. Changes in different sentences stay apart.
 * Whitespace-only hunks are dropped, and none keeps an unchanged space at an edge.
 */
function hunks(base, next) {
  const A = tokens(base), B = tokens(next);
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    L[i][j] = A[i].k === B[j].k ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  // Token ranges first: { ai, aj, bi, bj }.
  const raw = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i].k === B[j].k) { i++; j++; continue; }
    const i0 = i, j0 = j;
    while ((i < n || j < m) && !(i < n && j < m && A[i].k === B[j].k)) {
      if (j >= m || (i < n && L[i + 1][j] >= L[i][j + 1])) i++; else j++;
    }
    raw.push({ ai: i0, aj: i, bi: j0, bj: j });
  }
  const text = (T, us, x, y) => T.slice(x, y).map((t) => us.slice(t.s, t.e).map((u) => u.ch).join(''));
  const words = (T, us, x, y) => text(T, us, x, y).filter(isWord);
  // Sentence index of each base token, and the base words in each sentence.
  const sent = [];
  const sentWords = [];
  for (let x = 0, k = 0; x < n; x++) {
    sent.push(k);
    sentWords[k] = (sentWords[k] || 0) + (isWord(text(A, base, x, x + 1)[0]) ? 1 : 0);
    if (endsSentence(A, x, base)) k++;
  }
  const sentOf = (h) => (n ? sent[Math.min(h.ai, n - 1)] : 0);
  const out = [];
  for (const h of raw) {
    const prev = out[out.length - 1];
    const between = prev && sentOf(prev) === sentOf(h) ? words(A, base, prev.aj, h.ai) : null;
    if (between && between.every((w) => STOP.has(w.toLowerCase()))) Object.assign(prev, { aj: h.aj, bj: h.bj });
    else out.push({ ...h });
  }
  // A sentence most of whose words change is rewritten, not edited: one change.
  const merged = [];
  for (const h of out) {
    const prev = merged[merged.length - 1];
    if (prev && sentOf(prev) === sentOf(h)) prev.parts.push(h);
    else merged.push({ ...h, parts: [h] });
  }
  const final = merged.flatMap((g) => {
    if (g.parts.length < 2) return g.parts;
    const changed = g.parts.reduce((c, h) => c + Math.max(words(A, base, h.ai, h.aj).length, words(B, next, h.bi, h.bj).length), 0);
    if (changed < 0.4 * (sentWords[sentOf(g)] || 1)) return g.parts;
    const last = g.parts[g.parts.length - 1];
    return [{ ai: g.ai, aj: last.aj, bi: g.bi, bj: last.bj }];
  });
  const at = (T, x, len) => (x < T.length ? T[x].s : len);
  const blank = (us) => !us.some((u) => u.ch.trim());
  return final.map((h) => {
    const r = { bs: at(A, h.ai, base.length), be: at(A, h.aj, base.length), ns: at(B, h.bi, next.length), ne: at(B, h.bj, next.length) };
    // A space on both sides of an edge is unchanged: leave it out of the change.
    while (r.be > r.bs && r.ne > r.ns && !base[r.be - 1].ch.trim() && !next[r.ne - 1].ch.trim()) { r.be--; r.ne--; }
    while (r.be > r.bs && r.ne > r.ns && !base[r.bs].ch.trim() && !next[r.ns].ch.trim()) { r.bs++; r.ns++; }
    return r;
  }).filter((h) => !(blank(base.slice(h.bs, h.be)) && blank(next.slice(h.ns, h.ne))));
}

const sameMark = (a, b) => (a == null ? b == null : b != null && a.id === b.id && a.kind === b.kind && a.at === b.at);

/**
 * Make live text `t` read like `src` in the writer's view. The base is the text
 * with nothing pending inserted (every deletion still in): the writer's own
 * pending deletions and insertions are what the base→src difference says they
 * should be now; anyone else's are not touched. Ops are planned in page order
 * and applied back to front, so each one's offset still holds when it runs.
 */
function reconcileText(w, t, src) {
  const units = unitsOf(t);
  const next = unitsOf(src);
  const baseAt = [];
  units.forEach((u, i) => { if (u.s?.kind !== 'ins') baseAt.push(i); });
  const base = baseAt.map((i) => units[i]);
  // Someone else's pending deletion is theirs: a change that, without it, only
  // drops a space (deleting text they already suggested deleting) is no change.
  const blank = (us) => !us.some((x) => x.ch.trim());
  const hs = hunks(base, next).filter((h) => w.direct || !blank(next.slice(h.ns, h.ne))
    || !blank(base.slice(h.bs, h.be).filter((x) => !x.s || own(w, x.s))));

  const wantDel = new Array(base.length).fill(null);
  const wantIns = new Map(); // gap index → { hunk, units }
  for (const h of hs) {
    // Keep the id of the writer's suggestion this change continues, if any.
    const gapStart = h.be ? baseAt[h.be - 1] + 1 : 0;
    const gapEnd = h.be < base.length ? baseAt[h.be] : units.length;
    const prior = [...base.slice(h.bs, h.be), ...units.slice(gapStart, gapEnd)].find((u) => own(w, u.s))?.s;
    h.mark = { id: prior?.id, at: prior?.at };
    for (let g = h.bs; g < h.be; g++) wantDel[g] = h;
    if (h.ne > h.ns) wantIns.set(h.be, { h, units: next.slice(h.ns, h.ne) });
  }
  for (const h of hs) h.mark = w.direct ? null : mark(w, 'del', h.mark);
  const insMark = (h) => (w.direct ? null : { ...h.mark, kind: 'ins' });

  const ops = []; // page order: { at, del } | { at, len, fmt } | { at, ins }
  const push = (op) => {
    const p = ops[ops.length - 1];
    if (p && op.del && p.del && p.at + p.del === op.at) p.del += op.del;
    else if (p && op.fmt !== undefined && p.fmt !== undefined && p.at + p.len === op.at && sameMark(p.fmt, op.fmt)) p.len += op.len;
    else ops.push(op);
  };
  let u = 0;
  for (let g = 0; g <= base.length; g++) {
    const end = g < base.length ? baseAt[g] : units.length;
    // The gap before base unit g: inserted text, the writer's own and others'.
    const mine = [];
    for (; u < end; u++) if (own(w, units[u].s)) mine.push(u);
    const want = wantIns.get(g);
    const same = want && mine.length === want.units.length
      && mine.every((x, k) => units[x].ch === want.units[k].ch && fmtOf(units[x].attrs) === fmtOf(want.units[k].attrs));
    if (same) {
      for (const x of mine) if (!sameMark(units[x].s, insMark(want.h))) push({ at: x, len: 1, fmt: insMark(want.h) });
    } else {
      for (const x of mine) push({ at: x, del: 1 });
      if (want) ops.push({ at: end, ins: want.units, mark: insMark(want.h) });
    }
    if (g === base.length) break;
    // Base unit g: plain, or pending deletion (the writer's or someone else's).
    const cur = base[g].s;
    const h = wantDel[g];
    if (h && w.direct) push({ at: end, del: 1 });
    else if (h && (!cur || own(w, cur))) { if (!sameMark(cur, h.mark)) push({ at: end, len: 1, fmt: h.mark }); }
    else if (!h && own(w, cur)) push({ at: end, len: 1, fmt: null }); // no longer wanted: withdrawn
    u = end + 1;
  }

  for (let k = ops.length - 1; k >= 0; k--) {
    const op = ops[k];
    if (op.del) t.delete(op.at, op.del);
    else if (op.ins) {
      const runs = [];
      for (const x of op.ins) {
        const p = runs[runs.length - 1];
        if (p && typeof p.insert === 'string' && typeof x.insert === 'string' && JSON.stringify(p.attrs) === JSON.stringify(x.attrs)) p.insert += x.insert;
        else runs.push({ insert: x.insert, attrs: x.attrs });
      }
      // Back to front at one offset, so each run lands before the one after it.
      for (let r = runs.length - 1; r >= 0; r--) {
        const x = runs[r];
        const attrs = { ...x.attrs, [KEY]: op.mark };
        if (typeof x.insert === 'string') t.insert(op.at, x.insert, attrs);
        else t.insertEmbed(op.at, x.insert, attrs);
      }
    } else t.format(op.at, op.len, { [KEY]: op.fmt });
  }
}
