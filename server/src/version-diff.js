// What changed between two versions of a page — the History panel's diff.
//
// Two levels, the way a reader looks for changes: first which blocks were
// added, removed, edited or moved, then which words changed inside an edited
// block. Blocks are matched by their BlockSuite id, which an edit keeps; a page
// rebuilt wholesale (an import, a markdown replace) gets new ids, so blocks left
// over on both sides are paired by how alike their text reads. Non-text blocks
// (images, tables, databases, embeds) are compared whole and never word-diffed.
//
// Both sides are read with nothing pending accepted (extractBlocks' default),
// the same view every other consumer of the page gets.
import { extractBlocks } from './blocks.js';

const TEXT_FLAVOURS = new Set(['affine:paragraph', 'affine:list', 'affine:code']);
const isText = (b) => TEXT_FLAVOURS.has(b.flavour);

const LABELS = {
  'affine:image': 'Image',
  'affine:table': 'Table',
  'affine:database': 'Database',
  'affine:data-view': 'Database',
  'affine:attachment': 'File',
  'affine:bookmark': 'Link card',
  'affine:divider': 'Divider',
  'affine:latex': 'Equation',
  'affine:embed-linked-doc': 'Linked page',
  'affine:embed-synced-doc': 'Synced page',
  'affine:surface-ref': 'Canvas',
};
/** What a non-text block is called in the diff: "Image changed". */
function labelOf(flavour) {
  if (LABELS[flavour]) return LABELS[flavour];
  if (/^affine:embed-/.test(flavour)) return 'Embed';
  const s = String(flavour || 'block').replace(/^affine:/, '').replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── words ────────────────────────────────────────────────────────────────────

/** Words, runs of whitespace, and single punctuation marks — every char kept. */
const tokenize = (s) => s.match(/\s+|[\p{L}\p{M}\p{N}_]+|[^\s\p{L}\p{M}\p{N}_]/gu) || [];

// ponytail: Myers gives up past this many edits and calls the block rewritten
// (its trace grows as D²); a block that different reads better as old-then-new anyway.
const MAX_EDITS = 1000;

/**
 * Work a whole diff may spend in Myers' inner loops (diagonal steps + snake
 * steps), shared by every block of one request. Spent, the rest of the
 * changed blocks read as whole old-then-new: a page rewritten end to end
 * still answers in a few hundred ms, not seconds.
 */
export const WORK_BUDGET = 4_000_000;

/**
 * Myers' O(ND) shortest edit script over two token arrays, as a list of
 * ['eq'|'del'|'ins', token] in order, or null when it needs more than `maxD`
 * edits or runs `budget.left` down to nothing.
 */
function myers(a, b, maxD, budget) {
  const n = a.length, m = b.length, max = n + m, off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let found = -1;
  outer: for (let d = 0; d <= max; d++) {
    if (d > maxD || budget.left < 0) return null;
    budget.left -= d + 1;
    // Only diagonals -d..d are read on the way back: keep just that slice.
    trace.push(v.slice(off - d, off + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      const x0 = x;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      budget.left -= x - x0;
      v[off + k] = x;
      if (x >= n && y >= m) { found = d; break outer; }
    }
  }
  const out = [];
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const t = trace[d], at = (k) => t[k + d];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK), prevY = prevX - prevK;
    while (x > prevX && y > prevY) out.push(['eq', a[--x]]), y--;
    if (x === prevX) out.push(['ins', b[--y]]);
    else out.push(['del', a[--x]]);
  }
  while (x > 0) out.push(['eq', a[--x]]), y--;
  return out.reverse();
}

/**
 * The word-level diff of two strings: runs of { op: 'eq'|'del'|'ins', text }.
 * Joining the eq+del runs gives `a` back, eq+ins gives `b`; inside a change
 * the deletion comes before the insertion, so a replaced word reads
 * ~~Monday~~ Friday.
 */
export function diffWords(a, b, budget = { left: WORK_BUDGET }) {
  const ta = tokenize(a), tb = tokenize(b);
  let pre = 0;
  while (pre < ta.length && pre < tb.length && ta[pre] === tb[pre]) pre++;
  let suf = 0;
  while (suf < ta.length - pre && suf < tb.length - pre && ta[ta.length - 1 - suf] === tb[tb.length - 1 - suf]) suf++;
  const ma = ta.slice(pre, ta.length - suf), mb = tb.slice(pre, tb.length - suf);
  const mid = myers(ma, mb, MAX_EDITS, budget) ?? [...ma.map((t) => ['del', t]), ...mb.map((t) => ['ins', t])];
  const edits = [...ta.slice(0, pre).map((t) => ['eq', t]), ...mid, ...ta.slice(ta.length - suf).map((t) => ['eq', t])];

  const runs = [];
  const push = (op, text) => {
    const last = runs[runs.length - 1];
    if (last?.op === op) last.text += text;
    else runs.push({ op, text });
  };
  // Between two equal runs, all deletions first, then all insertions.
  let dels = '', inss = '';
  const flush = () => { if (dels) push('del', dels); if (inss) push('ins', inss); dels = inss = ''; };
  for (const [op, t] of edits) {
    if (op === 'eq') { flush(); push('eq', t); } else if (op === 'del') dels += t; else inss += t;
  }
  flush();
  return runs;
}

// ── blocks ───────────────────────────────────────────────────────────────────

/** Dice coefficient over the two texts' word multisets: 1 the same words, 0 none shared. */
function similarity(a, b) {
  if (a === b) return 1;
  // Words only: two sentences both ending in "." are not alike for it.
  const words = (s) => tokenize(s).filter((t) => /[\p{L}\p{N}]/u.test(t));
  const wa = words(a), wb = words(b);
  if (!wa.length || !wb.length) return 0;
  const counts = new Map();
  for (const w of wa) counts.set(w, (counts.get(w) || 0) + 1);
  let common = 0;
  for (const w of wb) { const c = counts.get(w); if (c) { common++; counts.set(w, c - 1); } }
  return (2 * common) / (wa.length + wb.length);
}

/** How alike two unmatched blocks are, 0..1 — only blocks of one kind can pair. */
function likeness(a, b) {
  if (isText(a) !== isText(b)) return 0;
  // A table where a table was reads as the table changed, not one gone and one new.
  if (!isText(a)) return a.flavour !== b.flavour ? 0 : a.sig === b.sig ? 1 : PAIR_AT;
  return similarity(a.text, b.text);
}
const PAIR_AT = 0.5;
// ponytail: an unmatched new block looks this far ahead among the unmatched old
// ones for its partner — linear, and enough for a rebuilt page whose order held.
const PAIR_WINDOW = 20;

const sameShape = (a, b) => a.flavour === b.flavour && (a.type ?? null) === (b.type ?? null) && !!a.checked === !!b.checked;
const sameContent = (a, b) => sameShape(a, b) && (isText(a) ? a.text === b.text : a.sig === b.sig);

/** Longest increasing subsequence of `xs`, as the set of indexes into `xs` (O(n log n)). */
function lisIndexes(xs) {
  const tails = [], prev = new Int32Array(xs.length).fill(-1);
  for (let i = 0; i < xs.length; i++) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[tails[mid]] < xs[i]) lo = mid + 1; else hi = mid; }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set();
  for (let i = tails[tails.length - 1] ?? -1; i >= 0; i = prev[i]) keep.add(i);
  return keep;
}

/** One row of the diff, shaped for the client to render as is. */
function entry(op, b, old, budget) {
  const e = { op, id: b.id, flavour: b.flavour, type: b.type ?? null, checked: !!b.checked };
  if (isText(b)) e.text = b.text;
  else e.label = labelOf(b.flavour);
  if (old && (op === 'changed' || op === 'moved')) {
    // An edited text block always carries its words (all equal on a retype);
    // a move only when the text changed on the way.
    if (isText(b) && isText(old) && (op === 'changed' || old.text !== b.text)) e.words = diffWords(old.text, b.text, budget);
    if (!sameShape(old, b)) e.was = { flavour: old.flavour, type: old.type ?? null, checked: !!old.checked };
  }
  return e;
}

/**
 * Diff two pages' block lists (extractBlocks(…, { all: true }).blocks).
 * Returns { blocks: [{ op: 'same'|'added'|'removed'|'changed'|'moved', … }], stats }
 * in reading order of the newer page, each removed block where it used to be.
 * A moved block appears once, at its new place.
 */
export function diffBlocks(before, after) {
  const budget = { left: WORK_BUDGET };
  // Match by id. The blocks kept in order form the longest run whose old
  // positions rise along the new page; any other id match was moved.
  const oldAt = new Map();
  before.forEach((b, i) => { if (b.id && !oldAt.has(b.id)) oldAt.set(b.id, i); });
  const matchOf = new Int32Array(after.length).fill(-1);
  const oldTaken = new Int32Array(before.length).fill(-1);
  after.forEach((b, j) => {
    const i = b.id != null ? oldAt.get(b.id) : undefined;
    if (i !== undefined && oldTaken[i] < 0) { matchOf[j] = i; oldTaken[i] = j; }
  });
  // Ids are not always the block's identity: a markdown replace edits blocks in
  // place by position (blocks.js diffChildren), so a deleted block's id can turn
  // up holding its neighbour's text. When an id pair's texts differ and a free
  // block on the other side reads exactly what one of them read, that block is
  // the real partner.
  const freeText = (list, taken) => {
    const m = new Map();
    list.forEach((b, i) => { if (taken[i] < 0 && isText(b) && b.text && !m.has(b.text)) m.set(b.text, i); });
    return m;
  };
  const freeOld = freeText(before, oldTaken), freeNew = freeText(after, matchOf);
  for (let j = 0; j < after.length; j++) {
    const i = matchOf[j];
    if (i < 0 || !isText(before[i]) || !isText(after[j]) || before[i].text === after[j].text) continue;
    const j2 = freeNew.get(before[i].text), i2 = freeOld.get(after[j].text);
    if (j2 === undefined && i2 === undefined) continue;
    matchOf[j] = -1; oldTaken[i] = -1;
    if (j2 !== undefined) { freeNew.delete(before[i].text); matchOf[j2] = i; oldTaken[i] = j2; }
    if (i2 !== undefined) { freeOld.delete(after[j].text); matchOf[j] = i2; oldTaken[i2] = j; }
  }
  const matchedJ = [];
  for (let j = 0; j < after.length; j++) if (matchOf[j] >= 0) matchedJ.push(j);
  const inOrder = lisIndexes(matchedJ.map((j) => matchOf[j]));
  const anchors = matchedJ.filter((_, x) => inOrder.has(x));

  const out = [];
  const stats = { added: 0, removed: 0, changed: 0, moved: 0 };
  const emit = (e) => {
    out.push(e);
    if (e.op !== 'same') stats[e.op]++;
  };

  // Walk the gaps between anchors; a gap's leftovers pair up by likeness.
  let pi = -1, pj = -1;
  for (const cj of [...anchors, after.length]) {
    const ci = cj < after.length ? matchOf[cj] : before.length;
    const olds = [];
    for (let i = pi + 1; i < ci; i++) if (oldTaken[i] < 0) olds.push(i);
    // First pair each new block with an old one, keeping their order…
    const pairOf = new Map(), pairedOld = new Set();
    let cursor = 0; // never look behind the last pair
    for (let j = pj + 1; j < cj; j++) {
      if (matchOf[j] >= 0) continue; // matched by id, but out of order: a move
      let best = -1, bestScore = PAIR_AT;
      for (let x = cursor, seen = 0; x < olds.length && seen < PAIR_WINDOW; x++, seen++) {
        const s = likeness(before[olds[x]], after[j]);
        if (s > bestScore || (best < 0 && s >= bestScore)) { best = x; bestScore = s; if (s === 1) break; }
      }
      if (best >= 0) { pairOf.set(j, olds[best]); pairedOld.add(olds[best]); cursor = best + 1; }
    }
    // …then read the gap out: an old block that is gone shows before what
    // replaced it, the way a deleted word precedes the inserted one.
    let next = 0;
    const flushRemoved = (upTo) => {
      for (; next < olds.length && olds[next] < upTo; next++) {
        if (!pairedOld.has(olds[next])) emit(entry('removed', before[olds[next]]));
      }
    };
    const nextPair = new Map();
    for (let j = cj - 1, upTo = Infinity; j > pj; j--) { if (pairOf.has(j)) upTo = pairOf.get(j); nextPair.set(j, upTo); }
    for (let j = pj + 1; j < cj; j++) {
      const b = after[j];
      if (matchOf[j] >= 0) { emit(entry('moved', b, before[matchOf[j]], budget)); continue; }
      flushRemoved(nextPair.get(j));
      const old = pairOf.has(j) ? before[pairOf.get(j)] : null;
      if (!old) emit(entry('added', b));
      else emit(sameContent(old, b) ? entry('same', b) : entry('changed', b, old, budget));
    }
    flushRemoved(Infinity);
    if (cj < after.length) {
      const old = before[ci], b = after[cj];
      emit(sameContent(old, b) ? entry('same', b) : entry('changed', b, old, budget));
    }
    pi = ci; pj = cj;
  }
  return { blocks: out, stats };
}

/**
 * Diff two doc states (doc_versions.state / doc_states.state). `before` may be
 * null — the first version of a page, where everything is new.
 * Returns diffBlocks' result plus `title`: the title's word diff, or null when
 * it held, and `titleText`: the newer side's title as it reads.
 */
export function diffStates(before, after) {
  const a = before ? extractBlocks(before, { all: true }) : { title: '', blocks: [] };
  const b = extractBlocks(after, { all: true });
  return {
    title: a.title === b.title ? null : diffWords(a.title, b.title),
    titleText: b.title,
    ...diffBlocks(a.blocks, b.blocks),
  };
}
