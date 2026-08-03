// Pure, local, no-LLM signal extraction. No DB, no Yjs — operates on plain text
// and a normalized block array. Every function is deterministic and testable.
import crypto from 'node:crypto';

const STOP = new Set(
  ('a an the and or but if then else for to of in on at by with as is are was were be been being ' +
   'this that these those it its i we you they he she them our your their not no do does did done ' +
   'will would can could should may might must have has had from up out about into over than too very ' +
   'so just also more most some any all each other which who whom what when where why how')
    .split(/\s+/),
);

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
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

export function extractSignals(blocks) {
  const tasks = [];
  const decisions = [];
  const risks = [];
  const deadlines = [];
  for (const b of blocks) {
    const text = String(b.text || '').trim();
    if (!text) continue;
    if (b.flavour === 'affine:list' && b.type === 'todo') {
      tasks.push({ text, checked: !!b.checked });
      continue;
    }
    if (/\b(todo|action item|action:)\b/i.test(text) || /@\w+\s+to\s+/i.test(text)) {
      tasks.push({ text, checked: false });
    }
    if (/\bdecided\b|\bdecision\b|\bwe (?:will|chose|agreed)\b|\bconclusion\b/i.test(text)) {
      decisions.push({ text, unresolved: /\b(tbd|pending)\b|\?/i.test(text) });
    }
    if (/\b(risk|blocker|blocked|concern|threat)\b/i.test(text)) {
      risks.push({ text });
    }
    if (/\b(due|deadline|by)\b/i.test(text) && DATE_RE.test(text)) {
      deadlines.push({ text, date: firstDate(text) });
    } else if (DATE_RE.test(text) && /\b(due|deadline|launch|ship|deliver)\b/i.test(text)) {
      deadlines.push({ text, date: firstDate(text) });
    }
  }
  return { tasks, decisions, risks, deadlines };
}

export function findMentions(text, titles) {
  const hay = String(text || '').toLowerCase();
  const out = [];
  for (const { id, title } of titles) {
    const t = String(title || '').trim();
    if (t.length < 4) continue;
    const needle = t.toLowerCase();
    let count = 0;
    let idx = hay.indexOf(needle);
    while (idx !== -1) { count++; idx = hay.indexOf(needle, idx + needle.length); }
    if (count > 0) out.push({ id, title: t, count });
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
