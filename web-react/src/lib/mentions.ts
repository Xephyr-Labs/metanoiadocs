import type { UserRow } from './docsApi';

/**
 * The handle being typed, if the caret is inside one.
 *
 * Only the run of characters after the last `@` on the line, and only while it
 * still looks like a handle — a space ends it, so "@ada replied" stops
 * suggesting after "ada". Returns null when there is nothing to complete,
 * which is the common case and the one that must cost nothing.
 *
 * Exported for its test: the menu opening at the wrong moment is the whole
 * failure mode of an @-picker, and it needs no DOM to check.
 */
export function mentionQuery(text: string): string | null {
  const at = text.lastIndexOf('@');
  if (at < 0) return null;
  // A handle starts a word: an email address typed into a comment is not one.
  if (at > 0 && !/\s/.test(text[at - 1])) return null;
  const rest = text.slice(at + 1);
  return /^[a-z0-9._-]*$/i.test(rest) ? rest.toLowerCase() : null;
}

/** Replace the handle being typed with the one that was picked. */
export function applyMention(text: string, username: string): string {
  return `${text.slice(0, text.lastIndexOf('@'))}@${username} `;
}

/** The teammates a handle being typed could mean, best first, at most six. */
export function matchPeople(people: UserRow[], query: string): UserRow[] {
  return people
    .filter((u) => u.username && `${u.username} ${u.name ?? ''}`.toLowerCase().includes(query))
    .slice(0, 6);
}
