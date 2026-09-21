/**
 * Reading the key back out of a task title.
 *
 * The server bakes the key into `tasks.title` ("MD-14: Fix login") so that every
 * surface which reads that one column shows it — see server/src/task-key.js for
 * why. The cost is that anything wanting to *draw* the key apart from the name
 * has to take it back off, and this is the one place that knows how.
 *
 * Mirrors KEY_PREFIX in server/src/task-key.js. The server is what writes a
 * title; this only reads one. Keep the two in step if either moves.
 */
const KEY_PREFIX = /^([A-Za-z][A-Za-z0-9]{0,7}-\d+): */;

export interface SplitTitle {
  /** "MD-14", or null when the title carries no key. */
  key: string | null;
  /** The title with the key taken off. May be empty — an unnamed task has no
   *  title at all, which is what lets the UI call it Untitled. */
  text: string;
}

export function splitKey(title: string | null | undefined): SplitTitle {
  const s = String(title ?? '');
  const m = KEY_PREFIX.exec(s);
  return m ? { key: m[1], text: s.slice(m[0].length) } : { key: null, text: s };
}
