import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { writePolicy, resolveApprover, untrusted, needsPerson, isPerson, pageSyncRole } from './approval.js';

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

test('needsPerson: any agent (trusted or not) or Ask AI gets 403; only a person passes', () => {
  const run = (req) => {
    let status = null, nexted = false;
    const res = { status(c) { status = c; return { json: () => {} }; } };
    needsPerson(req, res, () => { nexted = true; });
    return { status, nexted };
  };
  assert.deepEqual(run({ user: { kind: 'agent', role: 'admin' }, via: 'human', token: { trusted: false } }), { status: 403, nexted: false });
  assert.deepEqual(run({ user: { kind: 'agent', role: 'admin' }, via: 'human', token: null }), { status: 403, nexted: false });
  assert.deepEqual(run({ user: { kind: 'person', role: 'admin' }, via: 'ai', token: null }), { status: 403, nexted: false });
  // A trusted token writes pages directly, but may never hand out trust: else the everyday token becomes trusted for good.
  assert.deepEqual(run({ user: { kind: 'agent', role: 'admin' }, via: 'human', token: { trusted: true } }), { status: 403, nexted: false });
  assert.deepEqual(run({ user: { kind: 'person', role: 'admin' }, via: 'human', token: null }), { status: null, nexted: true });
  assert.equal(isPerson({ user: { kind: 'person' }, via: 'human' }), true);
  assert.equal(isPerson({ user: {}, via: 'human' }), true); // an unset kind is a person
});

// Every admin route that changes something (accounts, invites, trust, roles,
// kinds, provider settings, webhooks, shared blobs) needs a person. Reads stay
// open to an admin agent. A new admin route has to take a side here.
test('every admin-only route that changes something refuses agents', () => {
  const src = ['./index.js', './webhooks.js'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  const routes = [...src.matchAll(/app\.(get|post|put|patch|delete)\('([^']+)',([^\n]*)/g)]
    .filter((m) => /\brequireAdmin\b/.test(m[3]));
  assert.ok(routes.length >= 18, `found ${routes.length} admin routes`);
  const bad = routes.filter((m) => m[1] !== 'get' && !/\bneedsPerson\b/.test(m[3])).map((m) => `${m[1].toUpperCase()} ${m[2]}`);
  assert.deepEqual(bad, []);
  for (const route of ["'/api/comments/:cid/decision'", "'/api/suggestions/:sid/decide'"]) {
    const at = src.indexOf(route) >= 0 ? src : readFileSync(new URL('./suggestions.js', import.meta.url), 'utf8');
    const body = at.slice(at.indexOf(route), at.indexOf(route) + 400);
    assert.match(body, /!isPerson\(req\)/, `${route} must refuse every agent`);
  }
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

// An inline admin check (not requireAdmin) must also refuse agents: a
// `role === 'admin'` within a few lines of an isPerson/needsPerson, or reviewed
// here. requireAdmin's own definition and the role-being-assigned line are not checks.
test('every inline role admin check in server/src also requires a person', () => {
  // templateGrant's `&& person` is isPerson(req), passed in by templates.js.
  const reviewed = [/^\(user\.role === 'admin' && person\)/, /^if \(req\.user\?\.role !== 'admin'\) return res\.status\(403\)/, /^const role = req\.body\?\.role === 'admin'/];
  const bad = [];
  for (const f of readdirSync(new URL('.', import.meta.url)).filter((n) => n.endsWith('.js') && !n.endsWith('.test.js'))) {
    const lines = readFileSync(new URL(f, import.meta.url), 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (!/role\s*[!=]==\s*'admin'/.test(l) || reviewed.some((r) => r.test(l.trim()))) return;
      if (!/\b(isPerson|needsPerson)\b/.test(lines.slice(Math.max(0, i - 2), i + 3).join('\n'))) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

// A token is the credential an agent acts with: minting or deleting one is a
// person's job (an admin person mints for an agent account).
test('token minting and deleting need a person; admins mint for others', () => {
  const src = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  for (const r of ["app.post('/api/tokens'", "app.delete('/api/tokens/:id'", "app.post('/api/admin/users/:id/tokens'"]) {
    const line = src.split('\n').find((l) => l.includes(r));
    assert.ok(line && /\bneedsPerson\b/.test(line), `${r} must use needsPerson`);
  }
  assert.match(src.split('\n').find((l) => l.includes("app.post('/api/admin/users/:id/tokens'")), /\brequireAdmin\b/);
});
