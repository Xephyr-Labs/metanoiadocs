import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encryptToken, decryptToken, calendarConfig, registerCalendarRoutes } from './calendar.js';

function requireUser() {} function requireAdmin() {} function needsPerson() {}
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

test('a truncated auth tag is refused', () => {
  const a = encryptToken('x', key).split(':');
  const short = Buffer.from(a[2], 'base64').subarray(0, 4).toString('base64');
  assert.throws(() => decryptToken([a[0], a[1], short, a[3]].join(':'), key));
  assert.throws(() => decryptToken([a[0], Buffer.alloc(8).toString('base64'), a[2], a[3]].join(':'), key));
});

test('a mistyped token key is not ready', async () => {
  const bad = KEY_ENV.slice(0, -4) + '!!!!';
  assert.equal((await calendarConfig({ get: async () => good, env: { CALENDAR_TOKEN_KEY: bad } })).ready, false);
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
  const routes = {}; const chains = {};
  const app = { get: (p, ...h) => { routes['GET ' + p] = h[h.length - 1]; }, put: (p, ...h) => { routes['PUT ' + p] = h[h.length - 1]; chains['PUT ' + p] = h; }, delete() {} };
  const store = { v: stored };
  registerCalendarRoutes(app, {
    requireUser, requireAdmin, needsPerson, wrap: (f) => f,
    pool: { query: async () => ({ rows }) }, baseUrl: 'https://x.test/', env,
    get: async () => store.v, set: async (_k, v) => { store.v = v; },
  });
  const call = async (r, user, body) => {
    let out; await routes[r]({ user, body }, { json: (v) => { out = v; }, status(c) { this.code = c; return this; } });
    return out;
  };
  return { call, store, chains };
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

test('settings PUT is guarded by requireUser, requireAdmin and needsPerson', () => {
  const c = setup(good).chains['PUT /api/settings/calendar'];
  for (const g of [requireUser, requireAdmin, needsPerson]) assert.ok(c.includes(g));
});

test('settings PUT rejects oversized or non-string fields', async () => {
  const { call, store } = setup(good);
  const r1 = await call('PUT /api/settings/calendar', { role: 'admin' }, { clientId: 'x'.repeat(201) });
  const r2 = await call('PUT /api/settings/calendar', { role: 'admin' }, { clientSecret: 'x'.repeat(501) });
  const r3 = await call('PUT /api/settings/calendar', { role: 'admin' }, { clientId: 5 });
  for (const r of [r1, r2, r3]) assert.ok(r.error);
  assert.deepEqual(store.v, good);
});

/* ---- connect / callback / disconnect / access tokens ---- */

const jwt = (payload) => ['h', Buffer.from(JSON.stringify(payload)).toString('base64url'), 's'].join('.');

function oauthSetup({ stored = good, tokenReply, refreshReply, env = { CALENDAR_TOKEN_KEY: KEY_ENV } } = {}) {
  const routes = {}; const chains = {};
  const reg = (m) => (p, ...h) => { routes[m + ' ' + p] = h[h.length - 1]; chains[m + ' ' + p] = h; };
  const app = { get: reg('GET'), put: reg('PUT'), delete: reg('DELETE') };
  const db = new Map(); const calls = []; const queries = []; let n = 0;
  const pool = {
    query: async (sql, p) => {
      queries.push(sql);
      if (/^INSERT/.test(sql)) { db.set(p[0], { google_email: p[1], refresh_token_enc: p[2] }); return { rows: [] }; }
      if (/^DELETE/.test(sql)) { db.delete(p[0]); return { rows: [] }; }
      const r = db.get(p[0]); return { rows: r ? [r] : [] };
    },
  };
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
  const fetch = async (url, opts = {}) => {
    if (hooks.beforeFetch) await hooks.beforeFetch(url);
    const body = new URLSearchParams(opts.body || '');
    calls.push({ url, body });
    if (url.endsWith('/revoke')) return reply(200, {});
    if (body.get('grant_type') === 'authorization_code') return tokenReply ? reply(...tokenReply) : reply(200, { access_token: 'at', expires_in: 3600, refresh_token: 'rt-' + (++n), scope: 'openid https://www.googleapis.com/auth/calendar.events.readonly email', id_token: jwt({ email: 'me@g.com' }) });
    if (body.get('grant_type') === 'refresh_token') return refreshReply ? reply(...refreshReply) : reply(200, { access_token: 'at-' + calls.length, expires_in: 3600 });
    return reply(404, {});
  };
  let clock = 1_000_000; const hooks = {};
  // Behaves like the real one: 401 JSON without a session.
  const authUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'unauthorized' }));
  const api = registerCalendarRoutes(app, {
    requireUser: authUser, requireAdmin, needsPerson, wrap: (f) => f, pool, baseUrl: 'https://x.test', env,
    get: async () => stored, set: async () => {}, fetch, now: () => clock,
  });
  const call = async (r, user, query = {}) => {
    const chain = chains[r];
    const res = { code: 200, status(c) { this.code = c; return this; }, json(v) { this.body = v; return this; },
      redirect(u) { this.location = u; this.code = 302; return this; }, end() { return this; }, sendStatus(c) { this.code = c; return this; } };
    const req = { user, query, body: {} };
    // Run any real (non-fake) middleware in the chain, then the handler.
    for (const h of chain.slice(0, -1)) {
      if ([requireAdmin, needsPerson].includes(h)) continue;
      let go = false; await h(req, res, () => { go = true; }); if (!go) return res;
    }
    await routes[r](req, res);
    return res;
  };
  return { call, db, calls, chains, api, queries, hooks, authUser, tick: (ms) => { clock += ms; } };
}

const ENV_URLS = { CALENDAR_TOKEN_KEY: KEY_ENV, GOOGLE_AUTH_URL: 'https://auth.fake', GOOGLE_OAUTH_URL: 'https://oauth.fake' };

async function connect(s, user = { id: 'u' }) {
  const r = await s.call('GET /api/calendar/google/connect', user);
  return new URL(r.location).searchParams.get('state');
}

test('connect redirects to Google consent with the right parameters', async () => {
  const s = oauthSetup({ env: ENV_URLS });
  const r = await s.call('GET /api/calendar/google/connect', { id: 'u' });
  assert.equal(r.code, 302);
  const u = new URL(r.location);
  assert.equal(u.origin + u.pathname, 'https://auth.fake/o/oauth2/v2/auth');
  const q = Object.fromEntries(u.searchParams);
  assert.equal(q.client_id, 'id');
  assert.equal(q.redirect_uri, 'https://x.test/api/calendar/google/callback');
  assert.equal(q.response_type, 'code');
  assert.equal(q.access_type, 'offline');
  assert.equal(q.prompt, 'consent');
  assert.equal(q.include_granted_scopes, 'true');
  assert.deepEqual(q.scope.split(' ').sort(), ['email', 'https://www.googleapis.com/auth/calendar.events.readonly', 'openid']);
  assert.equal(Buffer.from(q.state, 'base64url').length, 32);
  for (const g of [s.authUser, needsPerson]) assert.ok(s.chains['GET /api/calendar/google/connect'].includes(g));
  for (const g of [s.authUser, needsPerson]) assert.ok(s.chains['DELETE /api/calendar/google'].includes(g));
});

test('every OAuth route 404s when the connector is not ready', async () => {
  const s = oauthSetup({ env: {} });
  assert.equal((await s.call('GET /api/calendar/google/connect', { id: 'u' })).code, 404);
  assert.equal((await s.call('GET /api/calendar/google/callback', { id: 'u' }, { code: 'c', state: 'x' })).code, 404);
  assert.equal((await s.call('DELETE /api/calendar/google', { id: 'u' })).code, 404);
  assert.deepEqual(await s.api.accessTokenFor('u'), { reconnect: true });
});

test('callback stores the refresh token encrypted and redirects connected', async () => {
  const s = oauthSetup({ env: ENV_URLS });
  const state = await connect(s);
  const r = await s.call('GET /api/calendar/google/callback', { id: 'u' }, { code: 'the-code', state });
  assert.equal(r.location, '/?calendar=connected');
  const ex = s.calls.find((c) => c.body.get('grant_type') === 'authorization_code');
  assert.equal(ex.url, 'https://oauth.fake/token');
  assert.equal(ex.body.get('code'), 'the-code');
  assert.equal(ex.body.get('client_secret'), 'sec');
  assert.equal(ex.body.get('redirect_uri'), 'https://x.test/api/calendar/google/callback');
  const row = s.db.get('u');
  assert.equal(row.google_email, 'me@g.com');
  assert.ok(!row.refresh_token_enc.includes('rt-1'));
  assert.equal(decryptToken(row.refresh_token_enc, key), 'rt-1');
});

test('callback rejects unknown, expired, other-user and reused state', async () => {
  const s = oauthSetup({ env: ENV_URLS });
  const cb = (user, state) => s.call('GET /api/calendar/google/callback', user, { code: 'c', state });
  assert.equal((await cb({ id: 'u' }, 'nope')).location, '/?calendar=error');
  assert.equal((await cb({ id: 'u' }, undefined)).location, '/?calendar=error');
  const other = await connect(s);
  assert.equal((await cb({ id: 'someone-else' }, other)).location, '/?calendar=error');
  const old = await connect(s);
  s.tick(10 * 60 * 1000 + 1);
  assert.equal((await cb({ id: 'u' }, old)).location, '/?calendar=error');
  const once = await connect(s);
  assert.equal((await cb({ id: 'u' }, once)).location, '/?calendar=connected');
  assert.equal((await cb({ id: 'u' }, once)).location, '/?calendar=error');
  assert.equal(s.calls.filter((c) => c.body.get('grant_type') === 'authorization_code').length, 1);
});

test('callback without a refresh token, or with a Google error, fails without storing', async () => {
  const s = oauthSetup({ env: ENV_URLS, tokenReply: [200, { access_token: 'at', expires_in: 3600, id_token: jwt({ email: 'me@g.com' }) }] });
  const r = await s.call('GET /api/calendar/google/callback', { id: 'u' }, { code: 'c', state: await connect(s) });
  assert.equal(r.location, '/?calendar=error&reason=reconsent');
  assert.equal(s.db.size, 0);
  const bad = oauthSetup({ env: ENV_URLS, tokenReply: [400, { error: 'invalid_grant', error_description: 'secret stuff' }] });
  const r2 = await bad.call('GET /api/calendar/google/callback', { id: 'u' }, { code: 'c', state: await connect(bad) });
  assert.equal(r2.location, '/?calendar=error');
  const denied = oauthSetup({ env: ENV_URLS });
  const r3 = await denied.call('GET /api/calendar/google/callback', { id: 'u' }, { error: 'access_denied', state: await connect(denied) });
  assert.equal(r3.location, '/?calendar=error');
  assert.equal(denied.calls.length, 0);
});

test('disconnect revokes best-effort and deletes the row', async () => {
  const s = oauthSetup({ env: ENV_URLS });
  await s.call('GET /api/calendar/google/callback', { id: 'u' }, { code: 'c', state: await connect(s) });
  const r = await s.call('DELETE /api/calendar/google', { id: 'u' });
  assert.equal(r.code, 204);
  assert.equal(s.db.size, 0);
  const rv = s.calls.find((c) => c.url === 'https://oauth.fake/revoke');
  assert.equal(rv.body.get('token'), 'rt-1');
});

test('disconnect still deletes when revoke throws', async () => {
  const s = oauthSetup({ env: ENV_URLS });
  await s.call('GET /api/calendar/google/callback', { id: 'u' }, { code: 'c', state: await connect(s) });
  s.db.set('u', { google_email: 'x', refresh_token_enc: 'garbage' });
  assert.equal((await s.call('DELETE /api/calendar/google', { id: 'u' })).code, 204);
  assert.equal(s.db.size, 0);
});

test('accessTokenFor caches until 60 s before expiry, then refreshes', async () => {
  const s = oauthSetup({ env: ENV_URLS });
  assert.deepEqual(await s.api.accessTokenFor('u'), { reconnect: true });
  await s.call('GET /api/calendar/google/callback', { id: 'u' }, { code: 'c', state: await connect(s) });
  const a = await s.api.accessTokenFor('u');
  assert.ok(a.token);
  const refresh = s.calls.filter((c) => c.body.get('grant_type') === 'refresh_token');
  assert.equal(refresh.length, 1);
  assert.equal(refresh[0].body.get('refresh_token'), 'rt-1');
  s.tick(3600_000 - 61_000);
  assert.deepEqual(await s.api.accessTokenFor('u'), a);
  s.tick(2_000);
  const b = await s.api.accessTokenFor('u');
  assert.notEqual(b.token, a.token);
  assert.ok(!s.queries.some((q) => /access/i.test(q)));
});

test('accessTokenFor on invalid_grant deletes the row and asks to reconnect', async () => {
  const s = oauthSetup({ env: ENV_URLS, refreshReply: [400, { error: 'invalid_grant' }] });
  await s.call('GET /api/calendar/google/callback', { id: 'u' }, { code: 'c', state: await connect(s) });
  assert.deepEqual(await s.api.accessTokenFor('u'), { reconnect: true });
  assert.equal(s.db.size, 0);
});

test('accessTokenFor on a transient failure keeps the row and throws', async () => {
  const s = oauthSetup({ env: ENV_URLS, refreshReply: [500, { error: 'backend' }] });
  await s.call('GET /api/calendar/google/callback', { id: 'u' }, { code: 'c', state: await connect(s) });
  await assert.rejects(() => s.api.accessTokenFor('u'));
  assert.equal(s.db.size, 1);
});

test('callback refuses a grant without calendar scope', async () => {
  const s = oauthSetup({ env: ENV_URLS, tokenReply: [200, { access_token: 'at', expires_in: 3600, refresh_token: 'rt', scope: 'openid email', id_token: jwt({ email: 'me@g.com' }) }] });
  const r = await s.call('GET /api/calendar/google/callback', { id: 'u' }, { code: 'c', state: await connect(s) });
  assert.equal(r.location, '/?calendar=error&reason=scope');
  assert.equal(s.db.size, 0);
});

test('accessTokenFor on an undecryptable row deletes it and asks to reconnect', async () => {
  const s = oauthSetup({ env: ENV_URLS });
  s.db.set('u', { google_email: 'x', refresh_token_enc: 'garbage' });
  assert.deepEqual(await s.api.accessTokenFor('u'), { reconnect: true });
  assert.equal(s.db.size, 0);
});

test('only the latest connect state per user stays live', async () => {
  const s = oauthSetup({ env: ENV_URLS });
  const first = await connect(s);
  const second = await connect(s);
  const other = await connect(s, { id: 'v' });
  const cb = (user, state) => s.call('GET /api/calendar/google/callback', user, { code: 'c', state });
  assert.equal((await cb({ id: 'u' }, first)).location, '/?calendar=error');
  assert.equal((await cb({ id: 'u' }, second)).location, '/?calendar=connected');
  assert.equal((await cb({ id: 'v' }, other)).location, '/?calendar=connected');
});

test('a refresh in flight during disconnect does not re-cache a token', async () => {
  const s = oauthSetup({ env: ENV_URLS });
  await s.call('GET /api/calendar/google/callback', { id: 'u' }, { code: 'c', state: await connect(s) });
  let release; const gate = new Promise((r) => { release = r; });
  s.hooks.beforeFetch = async (url) => { if (url.endsWith('/token')) { s.hooks.beforeFetch = null; await gate; } };
  const pending = s.api.accessTokenFor('u');
  await new Promise((r) => setImmediate(r));
  await s.call('DELETE /api/calendar/google', { id: 'u' });
  release();
  await pending;
  assert.deepEqual(await s.api.accessTokenFor('u'), { reconnect: true });
});

test('a 200 refresh without an access token throws and caches nothing', async () => {
  const s = oauthSetup({ env: ENV_URLS, refreshReply: [200, { expires_in: 3600 }] });
  await s.call('GET /api/calendar/google/callback', { id: 'u' }, { code: 'c', state: await connect(s) });
  await assert.rejects(() => s.api.accessTokenFor('u'));
  await assert.rejects(() => s.api.accessTokenFor('u'));
});

test('reconnecting revokes the old refresh token first', async () => {
  const s = oauthSetup({ env: ENV_URLS });
  await s.call('GET /api/calendar/google/callback', { id: 'u' }, { code: 'c', state: await connect(s) });
  await s.call('GET /api/calendar/google/callback', { id: 'u' }, { code: 'c', state: await connect(s) });
  const rv = s.calls.filter((c) => c.url.endsWith('/revoke'));
  assert.equal(rv.length, 1);
  assert.equal(rv[0].body.get('token'), 'rt-1');
  assert.equal(decryptToken(s.db.get('u').refresh_token_enc, key), 'rt-2');
});

test('callback with no session, a DB error, an array state or no code goes to the error page', async () => {
  const s = oauthSetup({ env: ENV_URLS });
  // No session: requireUser would answer 401 JSON; the callback sends the browser to the error page.
  const anon = await s.call('GET /api/calendar/google/callback', undefined, { code: 'c', state: 'x' });
  assert.equal(anon.location, '/?calendar=error');
  assert.equal(s.calls.length, 0);
  const st = await connect(s);
  assert.equal((await s.call('GET /api/calendar/google/callback', { id: 'u' }, { code: 'c', state: [st] })).location, '/?calendar=error');
  const st2 = await connect(s);
  assert.equal((await s.call('GET /api/calendar/google/callback', { id: 'u' }, { state: st2 })).location, '/?calendar=error');
  const broken = oauthSetup({ env: ENV_URLS });
  const st3 = await connect(broken);
  const q = broken.db.set.bind(broken.db);
  broken.db.set = () => { throw new Error('db down'); };
  assert.equal((await broken.call('GET /api/calendar/google/callback', { id: 'u' }, { code: 'c', state: st3 })).location, '/?calendar=error');
  broken.db.set = q;
});

// ---- events ----
import { startOfDayIn } from './timezone.js';

test('startOfDayIn follows the zone and DST', () => {
  assert.equal(new Date(startOfDayIn('Asia/Dhaka', '2026-10-28')).toISOString(), '2026-10-27T18:00:00.000Z');
  assert.equal(new Date(startOfDayIn('America/New_York', '2026-10-28')).toISOString(), '2026-10-28T04:00:00.000Z');
  assert.equal(new Date(startOfDayIn('America/New_York', '2026-11-02')).toISOString(), '2026-11-02T05:00:00.000Z');
});

function evSetup({ connected = true, calls = [], items = [], tokenReply, eventStatuses = [200] } = {}) {
  const routes = {};
  const app = { get: (p, ...h) => { routes['GET ' + p] = h[h.length - 1]; }, put() {}, delete() {} };
  const enc = encryptToken('refresh-1', key);
  let ei = 0;
  const fakeFetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if (String(url).includes('/token')) {
      return tokenReply ? tokenReply() : { ok: true, status: 200, json: async () => ({ access_token: 'at' + calls.length, expires_in: 3600 }) };
    }
    const st = eventStatuses[Math.min(ei++, eventStatuses.length - 1)];
    return { ok: st < 300, status: st, json: async () => ({ items }) };
  };
  const pool = { query: async (sql, args) => {
    if (/FROM user_calendar_tokens/.test(sql)) return { rows: connected ? [{ refresh_token_enc: enc }] : [] };
    if (/FROM users/.test(sql)) return { rows: [{ id: 'u2', email: 'bob@x.test' }].filter((r) => args[0].includes(r.email)) };
    return { rows: [] };
  } };
  registerCalendarRoutes(app, {
    requireUser, requireAdmin, needsPerson, wrap: (f) => f, pool, baseUrl: 'https://x.test', env: { CALENDAR_TOKEN_KEY: KEY_ENV, GOOGLE_API_URL: 'http://g.test/' },
    get: async () => good, set: async () => {}, fetch: fakeFetch, now: () => Date.parse('2026-10-28T20:00:00Z'),
  });
  return async (user, query = {}) => { let out; await routes['GET /api/calendar/events']({ user, query }, { json: (v) => { out = v; } }); return out; };
}

const ev = (o) => ({ id: 'e1', summary: 'Standup', start: { dateTime: '2026-10-29T10:00:00+06:00' }, end: { dateTime: '2026-10-29T10:30:00+06:00' }, ...o });

test('events: window starts at the start of the person\'s today in their zone', async () => {
  const calls = [];
  const call = evSetup({ calls });
  // 20:00Z is already Oct 29 02:00 in Dhaka.
  await call({ id: 'u1', timezone: 'Asia/Dhaka' }, { days: '2' });
  const u = new URL(calls.find((c) => c.url.includes('/calendar/v3')).url);
  assert.equal(u.origin + u.pathname, 'http://g.test/calendar/v3/calendars/primary/events');
  assert.equal(u.searchParams.get('timeMin'), '2026-10-28T18:00:00.000Z');
  assert.equal(u.searchParams.get('timeMax'), '2026-10-30T18:00:00.000Z');
  assert.equal(u.searchParams.get('singleEvents'), 'true');
  assert.match(calls.find((c) => c.url.includes('/calendar/v3')).opts.headers.Authorization, /^Bearer at/);
});

test('events: cancelled and self-declined skipped; attendees matched; shape', async () => {
  const items = [
    ev({ id: 'ok', hangoutLink: 'https://meet/x', attendees: [{ email: 'Me@x.test', self: true, responseStatus: 'accepted' }, { email: 'BOB@x.test', displayName: 'Bob' }, { email: 'out@z.test' }] }),
    ev({ id: 'c', status: 'cancelled' }),
    ev({ id: 'd', attendees: [{ email: 'me@x.test', self: true, responseStatus: 'declined' }] }),
    ev({ id: 'ad', start: { date: '2026-10-29' }, end: { date: '2026-10-30' }, conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://v/1' }] } }),
  ];
  const out = await evSetup({ items })({ id: 'u1' });
  assert.deepEqual(out.events.map((e) => e.id), ['ok', 'ad']);
  assert.equal(out.events[0].meetLink, 'https://meet/x');
  assert.deepEqual(out.events[0].attendees.map((a) => [a.userId, a.self]), [[null, true], ['u2', false], [null, false]]);
  assert.equal(out.events[0].notesDocId, null);
  assert.equal(out.events[1].allDay, true);
  assert.equal(out.events[1].meetLink, 'https://v/1');
});

test('events: not connected -> connected:false', async () => {
  assert.deepEqual(await evSetup({ connected: false })({ id: 'u1' }), { connected: false, events: [] });
});

test('events: invalid_grant -> reconnect', async () => {
  const call = evSetup({ tokenReply: () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) }) });
  assert.deepEqual(await call({ id: 'u1' }), { connected: true, reconnect: true, events: [] });
});

test('events: a 401 refreshes the token once, then reconnect', async () => {
  const calls = [];
  assert.equal((await evSetup({ calls, eventStatuses: [401, 200], items: [ev({})] })({ id: 'u1' })).events.length, 1);
  assert.equal(calls.filter((c) => c.url.includes('/token')).length, 2);
  const out = await evSetup({ eventStatuses: [401] })({ id: 'u1' });
  assert.deepEqual(out, { connected: true, reconnect: true, events: [] });
});

test('events: notesDocId is the caller\'s own live notes page', async () => {
  const routes = {}; const seen = [];
  const app = { get: (p, ...h) => { routes['GET ' + p] = h[h.length - 1]; }, put() {}, delete() {} };
  const enc = encryptToken('refresh-1', key);
  const pool = { query: async (sql, args) => {
    if (/FROM user_calendar_tokens/.test(sql)) return { rows: [{ refresh_token_enc: enc }] };
    if (/FROM meeting_notes/.test(sql)) { seen.push({ sql, args }); return { rows: [{ event_id: 'e1', doc_id: 'd1' }] }; }
    return { rows: [] };
  } };
  const fetch = async (url) => (String(url).includes('/token')
    ? { ok: true, status: 200, json: async () => ({ access_token: 'at', expires_in: 3600 }) }
    : { ok: true, status: 200, json: async () => ({ items: [ev({}), ev({ id: 'e2' })] }) });
  registerCalendarRoutes(app, {
    requireUser, requireAdmin, needsPerson, wrap: (f) => f, pool, env: { CALENDAR_TOKEN_KEY: KEY_ENV },
    get: async () => good, set: async () => {}, fetch, now: () => Date.parse('2026-10-28T20:00:00Z'),
  });
  let out; await routes['GET /api/calendar/events']({ user: { id: 'u1' }, query: {} }, { json: (v) => { out = v; } });
  assert.deepEqual(out.events.map((e) => e.notesDocId), ['d1', null]);
  assert.deepEqual(seen[0].args, ['u1', ['e1', 'e2']]);
  assert.match(seen[0].sql, /m\.user_id = \$1/);
  assert.match(seen[0].sql, /deleted_at IS NULL/);
});

test('fetchEvent: encoded id; 404/410/cancelled -> missing; no token -> reconnect', async () => {
  const urls = []; let reply;
  const enc = encryptToken('refresh-1', key);
  const fetch = async (url) => { urls.push(String(url)); return String(url).includes('/token')
    ? { ok: true, status: 200, json: async () => ({ access_token: 'at', expires_in: 3600 }) } : reply; };
  const mk = (rows) => registerCalendarRoutes({ get() {}, put() {}, delete() {} }, {
    requireUser, requireAdmin, needsPerson, wrap: (f) => f, pool: { query: async () => ({ rows }) },
    env: { CALENDAR_TOKEN_KEY: KEY_ENV, GOOGLE_API_URL: 'http://g.test' }, get: async () => good, set: async () => {}, fetch,
  });
  const { fetchEvent } = mk([{ refresh_token_enc: enc }]);
  reply = { ok: true, status: 200, json: async () => ({ id: 'a/b', summary: 'x' }) };
  assert.equal((await fetchEvent('u1', 'a/b')).event.summary, 'x');
  assert.equal(urls.at(-1), 'http://g.test/calendar/v3/calendars/primary/events/a%2Fb');
  for (const st of [404, 410]) { reply = { ok: false, status: st, json: async () => ({}) }; assert.deepEqual(await fetchEvent('u1', 'e'), { missing: true }); }
  reply = { ok: true, status: 200, json: async () => ({ id: 'e', status: 'cancelled' }) };
  assert.deepEqual(await fetchEvent('u1', 'e'), { missing: true });
  reply = { ok: false, status: 500, json: async () => ({}) };
  await assert.rejects(fetchEvent('u1', 'e'));
  assert.deepEqual(await mk([]).fetchEvent('u1', 'e'), { reconnect: true });
});
