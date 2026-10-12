import * as Y from 'yjs';

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

// ---- anchors
// A thread also records where its passage starts and ends as Yjs relative
// positions in its block's text. They stay on the selected characters through
// later edits, which a quote and an occurrence count cannot: type another copy
// of the words in front, or delete the chosen one, and the count points at a
// different copy. server/src/suggestions.js resolves them the same way.

/** A position in `t` (base64), kept by the character after it, or with
 *  `assoc` -1 by the one before it. */
export const encodeAnchor = (t: Y.Text, index: number, assoc = 0) =>
  btoa(String.fromCharCode(...Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(t, index, assoc))));

/**
 * Which copy of `quote` in `t` a thread's anchors point at now, or null when
 * the anchored passage no longer reads as the quote — the server refuses to
 * apply it then, so it is detached rather than shown on another copy. Undefined
 * when the anchors have nothing left to point into (their text was replaced
 * wholesale, as a version restore does): the quote is then matched as before.
 */
export function anchoredOccurrence(t: Y.Text, quote: string, start: string, end: string): number | null | undefined {
  const doc = t.doc;
  if (!doc) return undefined;
  const at = (s: string) => {
    try {
      return Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Uint8Array.from(atob(s), (c) => c.charCodeAt(0))), doc);
    } catch { return null; }
  };
  const a = at(start);
  const b = at(end);
  // The text the anchors were taken in is gone — a version restore rewrites
  // every block into new text objects, same words and all. Nothing to pin
  // to: the caller finds the quote the way it did before anchors existed.
  const gone = (p: typeof a) => !p || !!(p.type as unknown as { _item?: { deleted?: boolean } | null })._item?.deleted;
  if (gone(a) || gone(b)) return undefined;
  if (a!.type !== t || b!.type !== t || b!.index <= a!.index) return null;
  const raw = t.toString();
  if (normalizeQuote(raw.slice(a!.index, b!.index)) !== normalizeQuote(quote)) return null;
  let n = 0;
  while (n < 1000) {
    const hit = findQuote(raw, quote, n);
    if (!hit || hit.index >= a!.index) break;
    n++;
  }
  return n;
}
