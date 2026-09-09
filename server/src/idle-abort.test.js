import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idleAbort } from './idle-abort.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('aborts once the stream has been quiet for the whole window', async () => {
  const w = idleAbort(20);
  assert.equal(w.signal.aborted, false);
  await wait(50);
  assert.equal(w.signal.aborted, true);
});

test('a chunk restarts the clock, so a slow-but-live stream survives', async () => {
  const w = idleAbort(40);
  for (let i = 0; i < 5; i++) {
    await wait(20);
    w.alive();
  }
  assert.equal(w.signal.aborted, false, 'total elapsed exceeds the window, but no single gap does');
  w.done();
});

test('done() stops the watchdog firing after the stream ends', async () => {
  const w = idleAbort(20);
  w.done();
  await wait(50);
  assert.equal(w.signal.aborted, false);
});
