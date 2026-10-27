import test from 'node:test';
import assert from 'node:assert/strict';
import { writePolicy, resolveApprover, untrusted, refuseUntrusted, pageSyncRole } from './approval.js';

test('writePolicy: person direct, Ask AI and untrusted agent suggest, trusted agent direct', () => {
  const person = { kind: 'person' }, agent = { kind: 'agent' };
  assert.equal(writePolicy({ user: person, via: 'human', token: null }), 'direct');
  assert.equal(writePolicy({ user: person, via: 'human', token: { trusted: true } }), 'direct');
  assert.equal(writePolicy({ user: person, via: 'ai', token: null }), 'suggest');
  assert.equal(writePolicy({ user: agent, via: 'human', token: { trusted: false } }), 'suggest');
  assert.equal(writePolicy({ user: agent, via: 'human', token: null }), 'suggest'); // agent on a cookie: still gated
  assert.equal(writePolicy({ user: agent, via: 'human', token: { trusted: true } }), 'direct');
  assert.equal(writePolicy({ user: agent, via: 'ai', token: { trusted: true } }), 'suggest'); // Ask AI never trusted
});

const members = {
  'farhanaj@x': { id: 'farhanaj', kind: 'person' }, 'viewer@x': { id: 'viewer', kind: 'person' },
  'stranger@x': { id: 'stranger', kind: 'person' }, andy: { id: 'andy', kind: 'agent' },
};
const roles = { farhanaj: 'editor', viewer: 'viewer', andy: 'owner', owner1: 'owner' };
const deps = {
  lookupMember: async (k) => members[k] ?? null,
  roleOn: async (_d, u) => roles[u] ?? null,
  ownerOf: async () => 'owner1',
};
const agent = { id: 'andy', kind: 'agent' };

test('Ask AI: the signed-in person approves, whatever onBehalfOf says', async () => {
  assert.equal(await resolveApprover({ via: 'ai', user: { id: 'u1' }, onBehalfOf: 'other@x', ...deps }), 'u1');
});
test('agent: a named member who can edit approves (trimmed)', async () => {
  assert.equal(await resolveApprover({ via: 'human', user: agent, onBehalfOf: ' farhanaj@x ', docId: 'd', ...deps }), 'farhanaj');
});
test('agent: unknown, missing, an agent, or someone without edit rights → the owner', async () => {
  for (const who of ['nobody@x', undefined, '', '   ', 'andy', 'viewer@x', 'stranger@x']) {
    assert.equal(await resolveApprover({ via: 'human', user: agent, onBehalfOf: who, docId: 'd', ...deps }), 'owner1');
  }
});
test('no owner → null; blank requester never hits lookupMember', async () => {
  let called = false;
  const d = { ...deps, lookupMember: async () => { called = true; return null; }, ownerOf: async () => null };
  assert.equal(await resolveApprover({ via: 'human', user: agent, onBehalfOf: '  ', docId: 'd', ...d }), null);
  assert.equal(called, false);
});

test('an agent that owns the page it wrote never approves its own edit', async () => {
  const own = { ...deps, ownerOf: async () => 'andy' };
  assert.equal(await resolveApprover({ via: 'human', user: agent, onBehalfOf: undefined, docId: 'd', ...own }), null);
  assert.equal(await resolveApprover({ via: 'human', user: agent, onBehalfOf: 'andy', docId: 'd', ...own }), null);
});

test('untrusted: the callers whose writes only become suggestions', () => {
  assert.equal(untrusted({ user: { kind: 'agent' }, via: 'human', token: { trusted: false } }), true);
  assert.equal(untrusted({ user: { kind: 'person' }, via: 'ai', token: null }), true);
  assert.equal(untrusted({ user: { kind: 'agent' }, via: 'human', token: { trusted: true } }), false);
  assert.equal(untrusted({ user: { kind: 'person' }, via: 'human', token: null }), false);
});

test('refuseUntrusted: an untrusted agent or Ask AI gets 403 (cannot switch approval off); a person or trusted agent passes', () => {
  const run = (req) => {
    let status = null, nexted = false;
    const res = { status(c) { status = c; return { json: () => {} }; } };
    refuseUntrusted(req, res, () => { nexted = true; });
    return { status, nexted };
  };
  assert.deepEqual(run({ user: { kind: 'agent', role: 'admin' }, via: 'human', token: { trusted: false } }), { status: 403, nexted: false });
  assert.deepEqual(run({ user: { kind: 'agent', role: 'admin' }, via: 'human', token: null }), { status: 403, nexted: false });
  assert.deepEqual(run({ user: { kind: 'person', role: 'admin' }, via: 'ai', token: null }), { status: 403, nexted: false });
  assert.deepEqual(run({ user: { kind: 'person', role: 'admin' }, via: 'human', token: null }), { status: null, nexted: true });
  assert.deepEqual(run({ user: { kind: 'agent', role: 'admin' }, via: 'human', token: { trusted: true } }), { status: null, nexted: true });
});

test('pageSyncRole: an agent session on a live page reads and comments but never edits', () => {
  const agent = { kind: 'agent' }, person = { kind: 'person' };
  assert.equal(pageSyncRole('owner', agent), 'commenter');
  assert.equal(pageSyncRole('editor', agent), 'commenter');
  assert.equal(pageSyncRole('suggester', agent), 'suggester');
  assert.equal(pageSyncRole('viewer', agent), 'viewer');
  assert.equal(pageSyncRole(null, agent), null); // no grant stays no grant (canEdit(null) would throw)
  assert.equal(pageSyncRole(undefined, agent), undefined);
  assert.equal(pageSyncRole('editor', person), 'editor');
  assert.equal(pageSyncRole('owner', {}), 'owner');
});

test('Ask AI called with an agent token has no approver (→ 409): no one could use one', async () => {
  assert.equal(await resolveApprover({ via: 'ai', user: { id: 'andy', kind: 'agent' }, ...deps }), null);
  assert.equal(await resolveApprover({ via: 'ai', user: { id: 'u1', kind: 'person' }, ...deps }), 'u1');
});
