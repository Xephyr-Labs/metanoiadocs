import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexable, planDrive, transient } from './external.js';

const DOC = 'application/vnd.google-apps.document';
const file = (id, modified_at, extra = {}) => ({ id, name: id, mime_type: DOC, size: null, modified_at, ...extra });

test('planDrive reads new and changed files, newest first, and skips unchanged ones', () => {
  const files = [
    file('same', '2026-10-01T00:00:00Z'),
    file('changed', '2026-10-03T00:00:00Z'),
    file('new', '2026-10-02T00:00:00Z'),
  ];
  const indexed = new Map([['same', '2026-10-01T00:00:00.000Z'], ['changed', '2026-09-01T00:00:00.000Z']]);
  const plan = planDrive(files, indexed, 10);
  assert.deepEqual(plan.read.map((f) => f.id), ['changed', 'new']);
  assert.deepEqual(plan.remove, []);
  // The cap holds the newest.
  assert.deepEqual(planDrive(files, indexed, 1).read.map((f) => f.id), ['changed']);
});

test('planDrive drops what left the drive or can no longer be read', () => {
  const files = [
    file('kept', '2026-10-01T00:00:00Z'),
    file('nowImage', '2026-10-01T00:00:00Z', { mime_type: 'image/png' }),
    file('nowHuge', '2026-10-01T00:00:00Z', { mime_type: 'application/pdf', size: String(30 * 1024 * 1024) }),
  ];
  const indexed = new Map(['kept', 'trashed', 'nowImage', 'nowHuge'].map((id) => [id, '2026-10-01T00:00:00.000Z']));
  const plan = planDrive(files, indexed, 10);
  assert.deepEqual(plan.read, []);
  assert.deepEqual(plan.remove.sort(), ['nowHuge', 'nowImage', 'trashed']);
  // Disconnected: the mirror is empty, so everything goes.
  assert.deepEqual(planDrive([], indexed, 10).remove.length, 4);
});

test('indexable follows what read_drive_file can read', () => {
  assert.equal(indexable(file('a', null)), true);
  assert.equal(indexable({ mime_type: 'text/markdown', size: '10' }), true);
  assert.equal(indexable({ mime_type: 'application/vnd.google-apps.folder' }), false);
  assert.equal(indexable({ mime_type: 'video/mp4', size: '10' }), false);
});

test('transient: retry a refused key, a rate limit, an outage or no network; not a refusal of the file', () => {
  assert.equal(transient(Object.assign(new Error('x'), { auth: true })), true);
  assert.equal(transient(Object.assign(new Error('x'), { status: 429 })), true);
  assert.equal(transient(Object.assign(new Error('x'), { status: 503 })), true);
  assert.equal(transient(new TypeError('fetch failed')), true);
  assert.equal(transient(Object.assign(new Error('x'), { status: 403 })), false);
  assert.equal(transient(new Error('bad PDF')), false);
});
