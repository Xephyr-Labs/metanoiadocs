import test from 'node:test';
import assert from 'node:assert/strict';
import { baseMime } from './media.js';

test('drops codec parameters a recorder adds', () => {
  assert.equal(baseMime('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(baseMime('Audio/MP4; codecs="mp4a.40.2"'), 'audio/mp4');
});

test('missing or blank is an octet-stream', () => {
  assert.equal(baseMime(undefined), 'application/octet-stream');
  assert.equal(baseMime('  '), 'application/octet-stream');
});
