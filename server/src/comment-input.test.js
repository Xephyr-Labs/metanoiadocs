import test from 'node:test';
import assert from 'node:assert/strict';
import { commentInput } from './comment-input.js';

const note = { key: 'a'.repeat(64), name: 'Voice note 2026-10-22 14.03.webm', mime: 'audio/webm', size: 1200 };

test('text only', () => {
  assert.deepEqual(commentInput({ body: ' hi ' }), { body: 'hi', attachments: [], notifyText: 'hi' });
});

test('voice only reads as a voice note in notifications', () => {
  const out = commentInput({ body: '', attachments: [note] });
  assert.equal(out.body, '');
  assert.equal(out.attachments.length, 1);
  assert.equal(out.notifyText, '🎤 Voice note');
});

test('neither is empty', () => {
  assert.deepEqual(commentInput({ body: '  ', attachments: [] }), { error: 'empty comment' });
});

test('a malformed file refuses the whole comment', () => {
  assert.deepEqual(commentInput({ body: 'x', attachments: [{ key: '../etc' }] }), { error: 'bad attachments' });
});

test('body capped at 4000', () => {
  assert.equal(commentInput({ body: 'x'.repeat(5000) }).body.length, 4000);
});
