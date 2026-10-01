import test from 'node:test';
import assert from 'node:assert/strict';
import { canComment, connectionRole, guestName, shareRole } from './guest.js';

test('only an edit link writes to the document', () => {
  assert.equal(connectionRole('edit'), 'editor');
  assert.equal(connectionRole('comment'), 'viewer');
  assert.equal(connectionRole('view'), 'viewer');
  // A row from before roles existed, or a typo, must not grant more.
  assert.equal(connectionRole(null), 'viewer');
  assert.equal(connectionRole('owner'), 'viewer');
});

test('comment and edit links may comment, a view link may not', () => {
  assert.equal(canComment('comment'), true);
  assert.equal(canComment('edit'), true);
  assert.equal(canComment('view'), false);
  assert.equal(canComment(undefined), false);
  assert.equal(shareRole('nonsense'), 'view');
});

test('a guest always reads as a guest', () => {
  assert.equal(guestName('Rahim'), 'Rahim (guest)');
  assert.equal(guestName('  Rahim \n  Uddin '), 'Rahim Uddin (guest)');
  assert.equal(guestName(''), 'Guest (guest)');
  assert.equal(guestName(undefined), 'Guest (guest)');
  // Not doubled when the client already added it.
  assert.equal(guestName('Rahim (guest)'), 'Rahim (guest)');
  assert.equal(guestName('Ra\u0000him​'), 'Rahim (guest)');
  assert.equal(guestName('x'.repeat(100)).length, 40 + ' (guest)'.length);
});
