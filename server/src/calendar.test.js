import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encryptToken, decryptToken, calendarConfig, registerCalendarRoutes } from './calendar.js';

const key = crypto.randomBytes(32);
const KEY_ENV = key.toString('base64');
const good = { enabled: true, clientId: 'id', clientSecret: 'sec' };

test('encrypt/decrypt round-trips and is randomised', () => {
  const a = encryptToken('refresh-1', key);
  assert.match(a, /^v1:/);
  assert.notEqual(a, encryptToken('refresh-1', key));
  assert.equal(decryptToken(a, key), 'refresh-1');
});

test('tampered ciphertext, wrong key, bad format all throw', () => {
  const a = encryptToken('x', key).split(':');
  const flip = (s) => Buffer.from(s, 'base64').map((b, i) => (i ? b : b ^ 1)).toString('base64');
  assert.throws(() => decryptToken([a[0], a[1], a[2], flip(a[3])].join(':'), key));
  assert.throws(() => decryptToken(a.join(':'), crypto.randomBytes(32)));
  assert.throws(() => decryptToken('nope', key));
});

test('calendarConfig is ready only when enabled, configured and keyed', async () => {
  const cfg = (s, k) => calendarConfig({ get: async () => s, env: { CALENDAR_TOKEN_KEY: k } });
  assert.equal((await cfg(good, KEY_ENV)).ready, true);
  assert.equal((await cfg(good, undefined)).ready, false);
  assert.equal((await cfg(good, Buffer.alloc(16).toString('base64'))).ready, false);
  assert.equal((await cfg({ ...good, enabled: false }, KEY_ENV)).ready, false);
  assert.equal((await cfg({ ...good, clientSecret: '' }, KEY_ENV)).ready, false);
  assert.equal((await cfg(null, KEY_ENV)).ready, false);
});

function setup(stored, env = { CALENDAR_TOKEN_KEY: KEY_ENV }, rows = []) {
  const routes = {};
  const app = { get: (p, ...h) => { routes['GET ' + p] = h[h.length - 1]; }, put: (p, ...h) => { routes['PUT ' + p] = h[h.length - 1]; } };
  const store = { v: stored };
  registerCalendarRoutes(app, {
    requireUser() {}, requireAdmin() {}, needsPerson() {}, wrap: (f) => f,
    pool: { query: async () => ({ rows }) }, baseUrl: 'https://x.test', env,
    get: async () => store.v, set: async (_k, v) => { store.v = v; },
  });
  const call = async (r, user, body) => {
    let out; await routes[r]({ user, body }, { json: (v) => { out = v; }, status() { return this; } });
    return out;
  };
  return { call, store };
}

test('settings GET never returns the secret; non-admin sees only availability', async () => {
  const { call } = setup(good);
  const admin = await call('GET /api/settings/calendar', { id: 'a', role: 'admin' });
  assert.deepEqual(admin, { enabled: true, clientId: 'id', secretSet: true, keySet: true, redirectUri: 'https://x.test/api/calendar/google/callback' });
  assert.ok(!JSON.stringify(admin).includes('sec"'));
  const member = await call('GET /api/settings/calendar', { id: 'b', role: 'member' });
  assert.deepEqual(member, { enabled: true });
  const off = await setup({ ...good, enabled: false }).call('GET /api/settings/calendar', { id: 'b', role: 'member' });
  assert.deepEqual(off, { enabled: false });
});

test('settings PUT keeps the stored secret when blank, replaces when given', async () => {
  const { call, store } = setup(good);
  await call('PUT /api/settings/calendar', { role: 'admin' }, { enabled: true, clientId: ' new ', clientSecret: '' });
  assert.deepEqual(store.v, { enabled: true, clientId: 'new', clientSecret: 'sec' });
  await call('PUT /api/settings/calendar', { role: 'admin' }, { enabled: false, clientId: 'new', clientSecret: 's2' });
  assert.equal(store.v.clientSecret, 's2');
  assert.equal(store.v.enabled, false);
});

test('status reports availability and connection without tokens', async () => {
  const { call } = setup(good, undefined, [{ google_email: 'me@g.com' }]);
  assert.deepEqual(await call('GET /api/calendar/status', { id: 'u' }), { available: true, connected: true, email: 'me@g.com' });
  const none = await setup(good).call('GET /api/calendar/status', { id: 'u' });
  assert.deepEqual(none, { available: true, connected: false, email: null });
  const off = await setup(good, {}).call('GET /api/calendar/status', { id: 'u' });
  assert.deepEqual(off, { available: false, connected: false, email: null });
});
