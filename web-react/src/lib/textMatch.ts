// Finding a comment's quote in text. The browser half of
// server/src/text-match.js — see there for why whitespace is collapsed.

/** Collapse whitespace runs to one space, as quotes are stored. */
export const normalizeQuote = (q: string | null | undefined) => String(q || '').replace(/\s+/g, ' ').trim();

/** Where `quote` sits in `raw`, as raw offsets, or null. */
export function findQuote(raw: string, quote: string, occurrence = 0): { index: number; length: number } | null {
  const q = normalizeQuote(quote);
  if (!q) return null;
  let norm = '';
  const map: number[] = [];
  let inSpace = false;
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i])) {
      if (!inSpace) { norm += ' '; map.push(i); inSpace = true; }
    } else {
      norm += raw[i];
      map.push(i);
      inSpace = false;
    }
  }
  let at = -1;
  for (let n = 0; n <= occurrence; n++) {
    at = norm.indexOf(q, at + 1);
    if (at < 0) return null;
  }
  const start = map[at];
  const end = map[at + q.length - 1] + 1;
  return { index: start, length: end - start };
}
