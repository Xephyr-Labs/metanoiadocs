/**
 * The one definition of what an @-handle looks like.
 *
 * Two notifiers read it — a comment body and a page body — and they must agree,
 * or the same text would mean a mention in one place and nothing in the other.
 */
export function mentionHandles(text) {
  return [...new Set(
    [...String(text ?? '').matchAll(/@([a-z0-9][a-z0-9._-]*)/gi)]
      // A handle at the end of a sentence keeps its full stop otherwise:
      // "ask @lamisa." must find lamisa, not "lamisa.".
      .map((m) => m[1].replace(/[.]+$/, '').toLowerCase())
      .filter(Boolean)
  )];
}
