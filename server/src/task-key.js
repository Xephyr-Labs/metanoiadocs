// JIRA-style task keys: MD-14.
//
// A number per project, never reused, so it survives a rename, a move between
// columns and a re-sort — which is the whole point of being able to say "MD-14
// is blocked" in a chat message and have everyone find the same row.
//
// The number lives in tasks.num, the project's short name in projects.key, and
// the two are baked into tasks.title. Baking them in rather than rendering them
// beside the title is deliberate: forty-odd places already read that column —
// board cards, table cells, the gantt, exports, the task's own page, every
// webhook payload — and a key that only some of them show is worse than no key
// at all.
//
// The cost of baking in is that the prefix comes back on the next edit, so an
// edit of "MD-14: Fix login" would otherwise save "MD-14: MD-14: Fix login".
// stripKey is what stands in the way, and every write to a title goes through
// withKey rather than setting the column directly.

/**
 * A leading key, written as a pattern both `RegExp` and Postgres' regexp_replace
 * read the same way — the backfill rewrites titles in SQL, and a second copy of
 * this in another dialect is how the two would drift apart.
 *
 * Eight characters is the whole key, matching the length a key is validated to.
 */
export const KEY_PREFIX = '^[A-Za-z][A-Za-z0-9]{0,7}-[0-9]+: *';

/** What a key is allowed to be when someone types their own. */
export const KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,7}$/;

const STRIP = new RegExp(KEY_PREFIX);

/** The title without its key, whether or not it had one. */
export function stripKey(title) {
  return String(title ?? '').replace(STRIP, '');
}

/**
 * A title as it is stored. Idempotent: the key it ends up with is the one
 * passed in, not whatever the incoming string happened to be carrying, so
 * re-saving an unchanged title is a no-op and a project that changes its key
 * renames its tasks rather than accumulating both.
 *
 * Falls back to the bare title while a project has no key or a task no number,
 * which is only the moment between the column being added and the backfill
 * filling it.
 */
export function withKey(key, num, title) {
  const bare = stripKey(title);
  // An unnamed task keeps an empty title, so the UI's own "Untitled" still
  // shows. Every task is created with `title: ''` and named a moment later in
  // the peek; prefixing that emptiness gave the board a row reading "LAT-65:"
  // with nothing after the colon. The number is already claimed and stored in
  // `num`, so nothing is lost by waiting — the key appears with the name.
  // Trimmed, to agree with the SQL that does the same job in bulk — that uses
  // btrim, and a title of three spaces must not come out keyed in one path and
  // empty in the other.
  if (!bare.trim()) return '';
  return key && num ? `${key}-${num}: ${bare}` : bare;
}

/**
 * A key guessed from a project's name: initials if it has several words,
 * otherwise the first three letters. "Metanoia Docs" → MD, "Backend" → BAC.
 *
 * Only a starting point — it is stored in a column and can be edited, because
 * no rule short of asking gets this right for every name.
 */
export function deriveKey(name) {
  const words = String(name ?? '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  const raw = words.length > 1
    ? words.slice(0, 4).map((w) => w[0]).join('')
    : (words[0] ?? '').slice(0, 3);
  const key = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  // A key has to start with a letter: a name that is all digits, or written in
  // a script this has no initials for, still needs one.
  return KEY_RE.test(key) ? key : `P${key}`.slice(0, 8);
}

/**
 * `base`, or the first numbered variant of it nobody is using. Two projects
 * called "Metanoia Docs" and "Marketing Dept" both want MD; the second gets MD2.
 *
 * The digits eat into the base rather than extending it, so the result is
 * always a key the column will accept.
 */
export function uniqueKey(base, taken) {
  const used = new Set([...taken].map((k) => String(k).toUpperCase()));
  if (!used.has(base)) return base;
  for (let n = 2; n < 10000; n++) {
    const suffix = String(n);
    const candidate = base.slice(0, 8 - suffix.length) + suffix;
    if (!used.has(candidate)) return candidate;
  }
  // Ten thousand projects whose names all reduce to the same three letters.
  // Louder than silently handing back a key the unique index will reject.
  throw new Error(`no free key left around "${base}"`);
}

/**
 * Is there a title here once the key comes off?
 *
 * The trap this names: `withKey` strips a leading "MD-14: " before storing,
 * because the key lives inside the title. So a string that is non-empty on
 * arrival can be empty once stored — "MD-14:" is the whole of it. Anywhere a
 * title is *required*, this is the check, not `!!title`.
 *
 * The app's own creates deliberately pass an empty title (the UI shows
 * "Untitled" until you name it in the peek), so this is for the doors where a
 * name is the point: the public intake form is the one that had the hole.
 */
export function usableTitle(title) {
  return stripKey(title).trim().length > 0;
}

/**
 * A search query that *names* a task rather than describing one: "MD-14",
 * "md-14", "MD 14", "md14". Returns the key and number, or null.
 *
 * This is what a key is for. People paste "MD-14" into a chat message, and the
 * person who reads it types those six characters into the palette — so that
 * query has to land on the task itself rather than on whatever pages happen to
 * mention it.
 *
 * A trailing colon is tolerated because the title carries one, so half a
 * pasted title ("MD-14:") is a key too.
 */
export function parseKeyQuery(q) {
  const m = /^([A-Za-z][A-Za-z0-9]{0,7}?)[\s-]*([0-9]+)$/.exec(
    String(q ?? '').trim().replace(/:$/, ''),
  );
  return m ? { key: m[1].toUpperCase(), num: Number(m[2]) } : null;
}
