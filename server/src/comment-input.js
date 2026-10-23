// What a posted comment carries, checked once for both kinds of thread.
//
// A comment used to be text and nothing else, so "empty" meant an empty body.
// A voice note is a comment with no words in it, which made that check refuse
// exactly the comment someone had just recorded. Now it is text or a file, and
// the notification for a file-only comment says what it is rather than nothing.
import { coerceFiles } from './props.js';

const MAX_BODY = 4000;

export function commentInput(raw) {
  const body = String(raw?.body || '').trim().slice(0, MAX_BODY);
  const attachments = coerceFiles(raw?.attachments);
  if (!attachments) return { error: 'bad attachments' };
  if (!body && !attachments.length) return { error: 'empty comment' };
  return { body, attachments, notifyText: body || '🎤 Voice note' };
}
