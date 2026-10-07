import test from 'node:test';
import assert from 'node:assert/strict';
import { docCommentRecipients } from './comment-recipients.js';

test('anyone involved in the page hears about a new comment, unnamed', () => {
  // The reported gap: Rima commented, Ada answers elsewhere on the page.
  const out = docCommentRecipients({ actorId: 'ada', involvedIds: ['owner', 'rima', 'editor'] });
  assert.deepEqual([...out], [['owner', 'comment'], ['rima', 'comment'], ['editor', 'comment']]);
});

test('nobody hears about their own comment', () => {
  const out = docCommentRecipients({
    actorId: 'me', isReply: true, repliedToIds: ['me'], threadIds: ['me'], involvedIds: ['me'],
  });
  assert.equal(out.size, 0);
});

test('a self-tag still lands, as before', () => {
  const out = docCommentRecipients({ actorId: 'me', mentionedIds: ['me'], involvedIds: ['me'] });
  assert.deepEqual([...out], [['me', 'mention']]);
});

test('one comment is one notification, told by its most direct reason', () => {
  const out = docCommentRecipients({
    actorId: 'ada',
    isReply: true,
    mentionedIds: ['rima'],
    repliedToIds: ['rima', 'sam'],
    threadIds: ['rima', 'sam', 'lee'],
    involvedIds: ['rima', 'sam', 'lee', 'owner'],
  });
  assert.deepEqual([...out], [
    ['rima', 'mention'], ['sam', 'reply_to_you'], ['lee', 'reply'], ['owner', 'reply'],
  ]);
});

test('a top-level comment is nobody\'s reply, whatever ids came with it', () => {
  const out = docCommentRecipients({ actorId: 'ada', repliedToIds: ['rima'], threadIds: ['rima'] });
  assert.equal(out.size, 0);
});

test('a suggestion reads as one to everyone involved', () => {
  const out = docCommentRecipients({ actorId: 'ada', isSuggestion: true, involvedIds: ['owner'] });
  assert.deepEqual([...out], [['owner', 'suggestion']]);
});

test('a guest has no id, so nobody is skipped as the author', () => {
  const out = docCommentRecipients({ actorId: null, involvedIds: [null, 'owner'] });
  assert.deepEqual([...out], [['owner', 'comment']]);
});

test('every editor of the page is told, not only the last to save it', () => {
  // involvedIds as createCommentNotifications builds it: owner, creator, then
  // doc_editors and past commenters, with the overlaps that union produces.
  const out = docCommentRecipients({
    actorId: 'cleo', involvedIds: ['owner', 'ada', 'ada', 'bea', 'owner'],
  });
  assert.deepEqual([...out], [['owner', 'comment'], ['ada', 'comment'], ['bea', 'comment']]);
});

test('an editor who comments is not told about it, and one who is tagged hears it as a mention', () => {
  const out = docCommentRecipients({
    actorId: 'ada', mentionedIds: ['bea'], involvedIds: ['ada', 'bea', 'cleo'],
  });
  assert.deepEqual([...out], [['bea', 'mention'], ['cleo', 'comment']]);
});
