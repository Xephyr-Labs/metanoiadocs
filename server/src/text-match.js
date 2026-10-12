// Finding a comment's quote in a block's text.
//
// A quote is stored the way the selection read it, with every run of
// whitespace collapsed to one space — a selection across a line break, a
// double space or a non-breaking space all read back that way. The text it
// came from was not collapsed, so a plain indexOf missed exactly those quotes.
// This searches a collapsed copy and maps the hit back to the raw offsets.
// web-react/src/lib/textMatch.ts is the same function for the browser.

/** Collapse whitespace runs to one space, as quotes are stored. */
export const normalizeQuote = (q) => String(q || '').replace(/\s+/g, ' ').trim();

/**
 * Where `quote` sits in `raw`, as raw offsets, or null.
 * `occurrence` picks among repeats (0 = first).
 */
export function findQuote(raw, quote, occurrence = 0) {
  const q = normalizeQuote(quote);
  if (!q) return null;
  let norm = '';
  const map = [];
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

/**
 * The passage's start and end as sent by the editor (encoded Yjs relative
 * positions), or nulls. Both or neither: half a range pins nothing.
 */
export function commentAnchors(body) {
  const ok = (v) => typeof v === 'string' && v.length <= 200 && /^[A-Za-z0-9+/=]+$/.test(v);
  return ok(body?.anchorStart) && ok(body?.anchorEnd) ? [body.anchorStart, body.anchorEnd] : [null, null];
}
