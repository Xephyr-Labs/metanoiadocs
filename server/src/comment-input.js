// What a posted comment carries, checked once for both kinds of thread.
//
// A comment used to be text and nothing else, so "empty" meant an empty body.
// A voice note is a comment with no words in it, which made that check refuse
// exactly the comment someone had just recorded. Now it is text or a file, and
// the notification for a file-only comment says what it is rather than nothing.
import { coerceFiles } from './props.js';

const MAX_BODY = 4000;

/** What a comment says wherever only text fits — an inbox row, an email, an
 *  agent's read of the thread: its words, or that it is a voice note. */
export function commentText(body, attachments) {
  return body || (attachments?.length ? '🎤 Voice note' : '');
}

/**
 * A comment's words and files from a request body, or `{ error, status? }`.
 * A `kind: 'suggestion'` body is refused with 410: suggesting a change to a
 * passage is Suggesting mode on the page now (inline suggestions), as the
 * retired drafts route says.
 */
export function commentInput(raw) {
  if (raw?.kind === 'suggestion') {
    return { status: 410, error: 'Comment suggestions are retired: turn on Suggesting mode to suggest changes in the page itself.' };
  }
  const body = String(raw?.body || '').trim().slice(0, MAX_BODY);
  const attachments = coerceFiles(raw?.attachments);
  if (!attachments) return { error: 'bad attachments' };
  if (!body && !attachments.length) return { error: 'empty comment' };
  return { body, attachments, notifyText: commentText(body, attachments) };
}
