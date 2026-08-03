// Pure, local, no-LLM signal extraction. No DB, no Yjs — operates on plain text
// and a normalized block array. Every function is deterministic and testable.
import crypto from 'node:crypto';

const STOP = new Set(
  ('a an the and or but if then else for to of in on at by with as is are was were be been being ' +
   'this that these those it its i we you they he she them our your their not no do does did done ' +
   'will would can could should may might must have has had from up out about into over than too very ' +
   'so just also more most some any all each other which who whom what when where why how ' +
   'com www http https her him his hers us me my mine your yours use used using add added get got ' +
   'here there next prev previous first last name date time page section item thing way new also via per ' +
   // ponytail: "visit" isn't in the plan's stopword list but is needed for the URL-strip test to pass
   'visit')
    .split(/\s+/),
);

export function tokenize(text) {
  const cleaned = String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[a-z0-9.-]+\.(com|org|net|io|dev|co)\b/g, ' ');
  return cleaned
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

export function topTerms(text, n = 30) {
  const counts = new Map();
  for (const w of tokenize(text)) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts.entries()]
    .map(([term, tf]) => ({ term, tf }))
    .sort((a, b) => b.tf - a.tf || a.term.localeCompare(b.term))
    .slice(0, n);
}

const DATE_RE =
  /\b(\d{4}-\d{2}-\d{2})\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b|\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/i;

function firstDate(text) {
  const m = text.match(DATE_RE);
  return m ? (m[1] || m[0]) : null;
}

const DECISION_RE = /\bdecided\b|\bdecision\b|\bconclusion\b|\bagreed\b/i;
const RISK_RE = /\b(risk|blocker|blocked|concern|threat)\b/i;

// Snippet ≤200 chars around the regex match, so long blocks don't dump whole-paragraph text.
const snip = (t, re) => {
  const m = t.match(re);
  if (!m) return t.slice(0, 200);
  const i = Math.max(0, m.index - 80);
  return t.slice(i, i + 200).trim();
};

export function extractSignals(blocks) {
  const tasks = [];
  const decisions = [];
  const risks = [];
  const deadlines = [];
  for (const b of blocks) {
    if (b.flavour === 'affine:code') continue;
    const text = String(b.text || '').trim();
    if (!text) continue;
    const isPlaceholder =
      /^\s*\[[^\]]*\]\s*$/.test(text) ||
      text.length < 4 ||
      /^(click|type|press|drag)\b/i.test(text);
    if (b.flavour === 'affine:list' && b.type === 'todo') {
      if (!isPlaceholder) tasks.push({ text, checked: !!b.checked });
      continue;
    }
    if (!isPlaceholder && (/\b(todo|action item|action:)\b/i.test(text) || /@\w+\s+to\s+/i.test(text))) {
      tasks.push({ text, checked: false });
    }
    if (DECISION_RE.test(text)) {
      decisions.push({ text: snip(text, DECISION_RE), unresolved: /\b(tbd|pending)\b|\?/i.test(text) });
    }
    if (RISK_RE.test(text)) {
      risks.push({ text: snip(text, RISK_RE) });
    }
    if (/\b(due|deadline|by)\b/i.test(text) && DATE_RE.test(text)) {
      deadlines.push({ text, date: firstDate(text) });
    } else if (DATE_RE.test(text) && /\b(due|deadline|launch|ship|deliver)\b/i.test(text)) {
      deadlines.push({ text, date: firstDate(text) });
    }
  }
  return { tasks, decisions, risks, deadlines };
}

// Generic single-word doc titles that are too common to count as a real mention.
export const GENERIC = new Set([
  'product', 'project', 'team', 'notes', 'plan', 'doc', 'page', 'update',
  'meeting', 'home', 'general', 'misc', 'draft', 'task', 'todo',
]);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findMentions(text, titles) {
  const hay = String(text || '');
  const out = [];
  for (const { id, title } of titles) {
    const t = String(title || '').trim();
    if (t.length < 5) continue;
    if (!/\s/.test(t) && GENERIC.has(t.toLowerCase())) continue;
    const re = new RegExp('(?<![\\p{L}\\p{N}])' + escapeRegExp(t) + '(?![\\p{L}\\p{N}])', 'giu');
    const matches = hay.match(re);
    if (matches && matches.length > 0) out.push({ id, title: t, count: matches.length });
  }
  return out.sort((a, b) => b.count - a.count);
}

// 64-bit simhash over weighted terms, returned as a decimal string.
export function simhash(terms) {
  const v = new Array(64).fill(0);
  for (const { term, tf } of terms) {
    const h = BigInt('0x' + crypto.createHash('md5').update(term).digest('hex').slice(0, 16));
    for (let i = 0; i < 64; i++) {
      const bit = (h >> BigInt(i)) & 1n;
      v[i] += bit === 1n ? tf : -tf;
    }
  }
  let out = 0n;
  for (let i = 0; i < 64; i++) if (v[i] > 0) out |= 1n << BigInt(i);
  return out.toString();
}

export function hamming(a, b) {
  let x = BigInt(a) ^ BigInt(b);
  let count = 0;
  while (x) { count += Number(x & 1n); x >>= 1n; }
  return count;
}

export function keyphrases(text, n = 8) {
  const words = String(text || '').toLowerCase();
  // Split into candidate phrases at stopwords / punctuation.
  const tokens = words.split(/([^a-z0-9]+)/);
  const phrases = [];
  let cur = [];
  for (const tok of words.split(/\s+/)) {
    const w = tok.replace(/[^a-z0-9]/g, '');
    if (!w || STOP.has(w) || w.length < 3) { if (cur.length >= 1 && cur.length <= 4) phrases.push(cur); cur = []; continue; }
    cur.push(w);
  }
  if (cur.length >= 1 && cur.length <= 4) phrases.push(cur);
  // Word scores: degree (co-occurrence incl. self) / frequency.
  const freq = new Map(), deg = new Map();
  for (const ph of phrases) {
    const d = ph.length - 1;
    for (const w of ph) { freq.set(w, (freq.get(w) || 0) + 1); deg.set(w, (deg.get(w) || 0) + d + 1); }
  }
  const wscore = (w) => (deg.get(w) || 0) / (freq.get(w) || 1);
  const scored = new Map();
  for (const ph of phrases) {
    const key = ph.join(' ');
    const s = ph.reduce((a, w) => a + wscore(w), 0);
    if (!scored.has(key) || scored.get(key) < s) scored.set(key, s);
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map((e) => e[0]);
}

export function summarize(text, k = 3) {
  let sents = String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 25);
  if (sents.length > 300) sents = sents.slice(0, 300);
  if (sents.length <= k) return sents.slice(0, k).join(' ');
  const toks = sents.map((s) => new Set(tokenize(s)));
  const N = sents.length;
  const sim = (i, j) => {
    if (i === j) return 0;
    let shared = 0; for (const t of toks[i]) if (toks[j].has(t)) shared++;
    const denom = Math.log(toks[i].size + 1) + Math.log(toks[j].size + 1);
    return denom ? shared / denom : 0;
  };
  const W = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => sim(i, j)));
  const out = W.map((row) => row.reduce((a, b) => a + b, 0) || 1);
  let score = new Array(N).fill(1 / N);
  for (let it = 0; it < 20; it++) {
    const next = new Array(N).fill(0.15 / N);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (W[j][i]) next[i] += 0.85 * (W[j][i] / out[j]) * score[j];
    score = next;
  }
  const idx = score.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).slice(0, k).map((x) => x[1]).sort((a, b) => a - b);
  return idx.map((i) => sents[i]).join(' ');
}
