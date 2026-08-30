/** Longest preview a gallery card shows before it is cut on a word boundary. */
const MAX = 180;

/**
 * The one line of page text a gallery card shows under its cover area.
 *
 * The server sends `left(docs.search_text, 240)`, which is the block text of
 * the row's own page joined with newlines — so it arrives with the document's
 * whitespace still in it and, usually, the title as its first line.
 *
 * Returns null for "nothing worth showing", which the card renders as its
 * empty state rather than as a blank strip.
 */
export function previewLine(text: string | null | undefined, title?: string): string | null {
  if (!text) return null;

  let body = text;
  if (title) {
    const firstBreak = body.indexOf('\n');
    const firstLine = (firstBreak === -1 ? body : body.slice(0, firstBreak)).trim();
    if (firstLine === title.trim()) body = firstBreak === -1 ? '' : body.slice(firstBreak + 1);
  }

  const flat = body.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  if (flat.length <= MAX) return flat;

  const cut = flat.slice(0, MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > MAX / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
