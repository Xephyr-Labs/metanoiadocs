// Who hears about a comment on a page, and why.
//
// It used to be the people @-mentioned, whoever was already in the thread
// being answered, and the page's owner — nobody else. So two people who had
// both written on a page they did not own could talk past each other for days:
// neither was told the other had said anything unless they were named. Being
// involved in a page is reason enough to hear what is said on it.

/**
 * Everyone to tell about one comment, each with the reason the notification
 * gives. Ids in, a Map of id -> kind out; access and agent accounts are the
 * caller's to filter, since they need the database and this does not.
 *
 * The reasons fall in order of directness, and a person gets only the first
 * that is true of them: named in the text, then answered directly, then in the
 * thread being answered, then involved in the page some other way (owns it,
 * made it, edited it, commented on it). One comment is one notification — a
 * mention that also happens to be a reply is still told as a mention.
 *
 * The commenter is never told about their own comment, with one exception
 * kept from before: @-tagging yourself is deliberate, a reminder people leave
 * themselves, so it still lands in their inbox.
 */
export function docCommentRecipients({
  actorId,
  mentionedIds = [],
  repliedToIds = [],
  threadIds = [],
  involvedIds = [],
  isReply = false,
  isSuggestion = false,
}) {
  const out = new Map();
  const add = (id, kind) => {
    if (!id || out.has(id)) return;
    if (id === actorId && kind !== 'mention') return;
    out.set(id, kind);
  };
  for (const id of mentionedIds) add(id, 'mention');
  if (isReply) {
    for (const id of repliedToIds) add(id, 'reply_to_you');
    for (const id of threadIds) add(id, 'reply');
  }
  // A reply read by someone outside its thread is still a reply — "replied
  // in" says there is a conversation to open, "commented on" would not.
  const involved = isReply ? 'reply' : isSuggestion ? 'suggestion' : 'comment';
  for (const id of involvedIds) add(id, involved);
  return out;
}
