import test from 'node:test';
import assert from 'node:assert/strict';
import { writePolicy, resolveApprover } from './approval.js';

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
