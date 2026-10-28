import crypto from 'node:crypto';
import { isPerson } from './approval.js';
import { getSetting, setSetting } from './db.js';
import { zoneOf, dayIn, startOfDayIn } from './timezone.js';

export const SETTING_KEY = 'google_calendar';

/** AES-256-GCM, stored as `v1:iv:tag:ciphertext` (each part base64). */
export function encryptToken(plain, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv, c.getAuthTag(), ct].map((p) => (typeof p === 'string' ? p : p.toString('base64'))).join(':');
}

export function decryptToken(enc, key) {
  const [v, iv, tag, ct] = String(enc).split(':');
  if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Unrecognised token format');
  const ivb = Buffer.from(iv, 'base64');
  const tagb = Buffer.from(tag, 'base64');
  if (ivb.length !== 12 || tagb.length !== 16) throw new Error('Unrecognised token format');
  const d = crypto.createDecipheriv('aes-256-gcm', key, ivb, { authTagLength: 16 });
  d.setAuthTag(tagb);
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

/** The 32-byte key from env, or null when unset/invalid. */
export function tokenKey(env = process.env) {
  const raw = (env.CALENDAR_TOKEN_KEY || '').trim();
  const k = Buffer.from(raw, 'base64');
  return k.length === 32 && k.toString('base64') === raw ? k : null;
}

/** ready = enabled + client id/secret saved + a valid token key on the server. */
export async function calendarConfig({ get = getSetting, env = process.env } = {}) {
  const s = (await get(SETTING_KEY)) || {};
  const clientId = s.clientId || '';
  const clientSecret = s.clientSecret || '';
  return {
    enabled: !!s.enabled, clientId, clientSecret,
    keySet: !!tokenKey(env),
    ready: !!(s.enabled && clientId && clientSecret && tokenKey(env)),
  };
}

// Asked for on every connect; people may still grant only the read-only one (older grants are read-only).
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
export const READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
export const SCOPES = `openid email ${CALENDAR_SCOPE}`;
const STATE_TTL = 10 * 60 * 1000;

/** The email claim of a JWT, decoded only: it came straight from Google's token endpoint over TLS. */
function emailFromIdToken(idToken) {
  try { return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')).email || null; } catch { return null; }
}

const MAX_EVENTS = 500;
const RESPONSES = ['accepted', 'tentative', 'declined', 'needsAction'];
const responseOf = (a) => (RESPONSES.includes(a?.responseStatus) ? a.responseStatus : null);
const httpOnly = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

/** Days since epoch of a real 'YYYY-MM-DD', else NaN. */
function dateIndex(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== s ? NaN : ms / 86_400_000;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: '\u00a0' };
/** Google's description HTML as plain text: shown as text, never as HTML. */
export function htmlToText(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>|<\/(p|div|li)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, k) => {
      if (k[0] === '#') {
        const n = k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
        try { return String.fromCodePoint(n); } catch { return m; }
      }
      return ENTITIES[k.toLowerCase()] ?? m;
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 5000);
}

export function registerCalendarRoutes(app, {
  requireUser, requireAdmin, needsPerson, wrap, pool,
  baseUrl = process.env.BASE_URL, env = process.env, get = getSetting, set = setSetting,
  fetch: f = fetch, now = Date.now,
}) {
  const cfg = () => calendarConfig({ get, env });
  const redirectUri = () => `${String(baseUrl).replace(/\/+$/, '')}/api/calendar/google/callback`;
  const authBase = () => (env.GOOGLE_AUTH_URL || 'https://accounts.google.com').replace(/\/+$/, '');
  const oauthBase = () => (env.GOOGLE_OAUTH_URL || 'https://oauth2.googleapis.com').replace(/\/+$/, '');
  const post = (path, form) => f(`${oauthBase()}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(),
  });
  // ponytail: in-process maps; a second server instance would need these in the DB.
  const states = new Map(); // state -> { userId, exp }
  const accessCache = new Map(); // userId -> { token, exp }

  // Admins see the setup; everyone else learns only whether the feature is on.
  app.get('/api/settings/calendar', requireUser, wrap(async (req, res) => {
    const c = await cfg();
    if (req.user?.role !== 'admin' || !isPerson(req)) return res.json({ enabled: c.ready });
    res.json({
      enabled: c.enabled, clientId: c.clientId, secretSet: !!c.clientSecret, keySet: c.keySet,
      redirectUri: redirectUri(),
    });
  }));

  // Blank secret keeps the stored one, as with the AI key.
  app.put('/api/settings/calendar', requireUser, requireAdmin, needsPerson, wrap(async (req, res) => {
    const old = (await get(SETTING_KEY)) || {};
    const b = req.body || {};
    if ((b.clientId !== undefined && (typeof b.clientId !== 'string' || b.clientId.length > 200))
      || (b.clientSecret !== undefined && (typeof b.clientSecret !== 'string' || b.clientSecret.length > 500))) {
      return res.status(400).json({ error: 'Client ID or secret is invalid or too long.' });
    }
    const next = {
      enabled: b.enabled === undefined ? !!old.enabled : !!b.enabled,
      clientId: typeof b.clientId === 'string' ? b.clientId.trim() : old.clientId || '',
      clientSecret: typeof b.clientSecret === 'string' && b.clientSecret.trim() ? b.clientSecret.trim() : old.clientSecret || '',
    };
    await set(SETTING_KEY, next);
    res.json({ ok: true });
  }));

  app.get('/api/calendar/status', requireUser, wrap(async (req, res) => {
    const c = await cfg();
    if (!c.ready) return res.json({ available: false, connected: false, email: null, canWrite: false });
    const { rows } = await pool.query('SELECT google_email, can_write FROM user_calendar_tokens WHERE user_id = $1', [req.user.id]);
    res.json({ available: true, connected: !!rows[0], email: rows[0]?.google_email || null, canWrite: !!rows[0]?.can_write });
  }));

  // Bumped whenever a user's connection changes, so a refresh that was in flight
  // across a disconnect/reconnect does not cache a token for the old one.
  const gen = new Map();
  const forget = (userId) => { gen.set(userId, (gen.get(userId) || 0) + 1); accessCache.delete(userId); };
  const drop = async (userId) => {
    await pool.query('DELETE FROM user_calendar_tokens WHERE user_id = $1', [userId]);
    forget(userId);
  };
  const revokeStored = async (userId) => {
    try {
      const { rows } = await pool.query('SELECT refresh_token_enc FROM user_calendar_tokens WHERE user_id = $1', [userId]);
      if (rows[0]) await post('/revoke', { token: decryptToken(rows[0].refresh_token_enc, tokenKey(env)) });
    } catch { /* best effort */ }
  };

  app.get('/api/calendar/google/connect', requireUser, needsPerson, wrap(async (req, res) => {
    const c = await cfg();
    if (!c.ready) return res.status(404).json({ error: 'Not found' });
    const t = now();
    // One live state per user keeps the map bounded by the number of people.
    for (const [k, v] of states) if (v.exp < t || v.userId === req.user.id) states.delete(k);
    const state = crypto.randomBytes(32).toString('base64url');
    states.set(state, { userId: req.user.id, exp: t + STATE_TTL });
    const q = new URLSearchParams({
      client_id: c.clientId, redirect_uri: redirectUri(), response_type: 'code', scope: SCOPES,
      access_type: 'offline', prompt: 'consent', state, include_granted_scopes: 'true',
    });
    res.redirect(`${authBase()}/o/oauth2/v2/auth?${q}`);
  }));

  // The browser arrives here from Google, so a missing session is an error page, not 401 JSON.
  const sessionOrErrorPage = (req, res, next) => {
    const r = Object.create(res);
    r.status = () => r;
    r.json = () => res.redirect('/?calendar=error');
    return requireUser(req, r, next);
  };

  // Every failure lands on the same page: Google's errors and tokens never reach the browser.
  app.get('/api/calendar/google/callback', sessionOrErrorPage, wrap(async (req, res) => {
    const c = await cfg();
    if (!c.ready) return res.status(404).json({ error: 'Not found' });
    const fail = (reason) => res.redirect(`/?calendar=error${reason ? `&reason=${reason}` : ''}`);
    const { code, state } = req.query || {};
    const s = typeof state === 'string' ? states.get(state) : undefined;
    if (s) states.delete(state); // single use, whatever happens next
    if (!s || s.exp < now() || s.userId !== req.user.id || typeof code !== 'string' || !code) return fail();
    let tok;
    try {
      const r = await post('/token', {
        code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri(), grant_type: 'authorization_code',
      });
      tok = r.ok ? await r.json() : null;
    } catch { tok = null; }
    if (!tok) return fail();
    if (!tok.refresh_token) return fail('reconsent');
    // Granular consent lets people untick the calendar box and still get a token.
    // Exact tokens: `calendar.events.readonly` must not pass for `calendar.events`.
    const granted = String(tok.scope || '').split(/\s+/);
    const canWrite = granted.includes(CALENDAR_SCOPE);
    if (!canWrite && !granted.includes(READONLY_SCOPE)) return fail('scope');
    // No revoke of a replaced token: Google revokes the whole grant, which would kill the new token too.
    try {
      await pool.query(
        `INSERT INTO user_calendar_tokens (user_id, google_email, refresh_token_enc, can_write, connected_at) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (user_id) DO UPDATE SET google_email = EXCLUDED.google_email, refresh_token_enc = EXCLUDED.refresh_token_enc,
           can_write = EXCLUDED.can_write, connected_at = now()`,
        [req.user.id, emailFromIdToken(tok.id_token), encryptToken(tok.refresh_token, tokenKey(env)), canWrite],
      );
    } catch { return fail(); }
    forget(req.user.id);
    res.redirect('/?calendar=connected');
  }));

  app.delete('/api/calendar/google', requireUser, needsPerson, wrap(async (req, res) => {
    const c = await cfg();
    if (!c.ready) return res.status(404).json({ error: 'Not found' });
    await revokeStored(req.user.id);
    await drop(req.user.id);
    res.status(204).end();
  }));

  /** A live access token for the user ({ token }), or { reconnect: true } when there is none to be had. Throws on transient errors. */
  async function accessTokenFor(userId) {
    const c = await cfg();
    if (!c.ready) return { reconnect: true };
    const hit = accessCache.get(userId);
    if (hit && hit.exp > now()) return { token: hit.token };
    const g = gen.get(userId);
    const { rows } = await pool.query('SELECT refresh_token_enc FROM user_calendar_tokens WHERE user_id = $1', [userId]);
    if (!rows[0]) return { reconnect: true };
    let refresh;
    try { refresh = decryptToken(rows[0].refresh_token_enc, tokenKey(env)); } catch {
      // Key rotated or row corrupt: the token is unusable for good.
      await drop(userId);
      return { reconnect: true };
    }
    const r = await post('/token', { refresh_token: refresh, client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'refresh_token' });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (body?.error === 'invalid_grant') {
        await drop(userId);
        return { reconnect: true };
      }
      throw new Error(`Google token refresh failed (${r.status})`);
    }
    if (typeof body?.access_token !== 'string' || !body.access_token) throw new Error('Google token refresh returned no access token');
    if (gen.get(userId) !== g) return { reconnect: true }; // disconnected or reconnected meanwhile
    accessCache.set(userId, { token: body.access_token, exp: now() + (Number(body.expires_in) || 3600) * 1000 - 60_000 });
    return { token: body.access_token };
  }

  const apiBase = () => (env.GOOGLE_API_URL || 'https://www.googleapis.com').replace(/\/+$/, '');
  const DAY = 86_400_000;

  /** Event id -> the caller's own live notes page for it. */
  async function notesFor(userId, events) {
    if (!events.length) return new Map();
    const { rows } = await pool.query(
      `SELECT m.event_id, m.doc_id FROM meeting_notes m JOIN docs d ON d.id = m.doc_id AND d.deleted_at IS NULL
        WHERE m.user_id = $1 AND m.event_id = ANY($2)`,
      [userId, events.map((e) => e.id)],
    );
    return new Map(rows.map((r) => [r.event_id, r.doc_id]));
  }

  /** A call on the person's Google calendar API: the Response, or { reconnect: true }. One retry on a 401 with a fresh token. */
  async function googleCall(uid, path, { method, body } = {}) {
    let r;
    for (let attempt = 0; attempt < 2; attempt++) {
      const tok = await accessTokenFor(uid);
      if (!tok.token) return { reconnect: true };
      const headers = { Authorization: `Bearer ${tok.token}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      r = await f(`${apiBase()}${path}`, method ? { method, headers, body: body === undefined ? undefined : JSON.stringify(body) } : { headers });
      if (r.status !== 401) return r;
      accessCache.delete(uid);
    }
    // A fresh token refused too: the grant is dead, so Settings must show Connect as well.
    await drop(uid);
    return { reconnect: true };
  }

  const googleGet = (uid, path) => googleCall(uid, path);

  const SCOPE_REASONS = ['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'];
  /**
   * A write on the person's calendar: the Response, { reconnect: true }, or { needsWrite: true } when the
   * grant lacks write scope (can_write is then cleared). Other 403s (e.g. not the organiser) come back as-is.
   */
  async function googleSend(uid, method, path, body) {
    const r = await googleCall(uid, path, { method, body });
    if (r.reconnect || r.status !== 403) return r;
    const e = (await r.clone().json().catch(() => null))?.error || {};
    const list = (x) => (Array.isArray(x) ? x : []);
    const reasons = [...list(e.errors), ...list(e.details)].map((x) => x?.reason).filter(Boolean);
    // PERMISSION_DENIED alone is also how other refusals look, so it counts only when Google names no reason.
    if (!reasons.some((x) => SCOPE_REASONS.includes(x)) && !(e.status === 'PERMISSION_DENIED' && !reasons.length)) return r;
    await pool.query('UPDATE user_calendar_tokens SET can_write = false WHERE user_id = $1', [uid]);
    return { needsWrite: true };
  }

  /** One event on the person's own calendar: { event }, { reconnect: true } or { missing: true } (gone, cancelled, or never theirs). */
  async function fetchEvent(uid, eventId) {
    const r = await googleGet(uid, `/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`);
    if (r.reconnect) return r;
    if (r.status === 404 || r.status === 410) return { missing: true };
    if (!r.ok) throw new Error(`Google event failed (${r.status})`);
    const event = await r.json().catch(() => null);
    if (!event || event.status === 'cancelled') return { missing: true };
    return { event };
  }

  app.get('/api/calendar/events', requireUser, wrap(async (req, res) => {
    const days = Math.min(7, Math.max(1, parseInt(req.query?.days, 10) || 1));
    const c = await cfg();
    if (!c.ready) return res.json({ connected: false, events: [] });
    const uid = req.user.id;
    const has = await pool.query('SELECT 1 FROM user_calendar_tokens WHERE user_id = $1', [uid]);
    if (!has.rows[0]) return res.json({ connected: false, events: [] });
    const zone = zoneOf(req.user);
    const { from, to } = req.query || {};
    let startMs, endMs;
    if (from !== undefined) {
      // A visible range: [start of `from`, start of `to`) in the person's zone, 1..42 days.
      const span = dateIndex(to) - dateIndex(from);
      if (!(span >= 1 && span <= 42)) return res.status(400).json({ error: 'from/to must be dates 1 to 42 days apart.' });
      startMs = startOfDayIn(zone, from);
      endMs = startOfDayIn(zone, to);
    } else {
      startMs = startOfDayIn(zone, dayIn(zone, new Date(now())));
      // Calendar days vary in length across DST, so the end is the start of day N from now, not +N*24h.
      endMs = startOfDayIn(zone, dayIn(zone, new Date(startMs + days * DAY + 12 * 3600_000)));
    }
    const base = {
      singleEvents: 'true', orderBy: 'startTime', timeMin: new Date(startMs).toISOString(), timeMax: new Date(endMs).toISOString(), maxResults: '250',
    };
    // Still connected when Google fails: the card says it could not load, not "Connect". Google's text stays here.
    const failed = (status) => {
      console.error(`[calendar] Google events failed (${status})`);
      return res.json({ connected: true, error: true, events: [] });
    };
    let raw = [];
    let pageToken;
    let pages = 0;
    do {
      const q = new URLSearchParams(pageToken ? { ...base, pageToken } : base);
      let r;
      try { r = await googleGet(uid, `/calendar/v3/calendars/primary/events?${q}`); } catch { return failed('network or token refresh'); }
      if (r.reconnect) return res.json({ connected: true, reconnect: true, events: [] });
      if (!r.ok) return failed(r.status);
      const body = await r.json().catch(() => ({}));
      raw = raw.concat(Array.isArray(body.items) ? body.items : []);
      pageToken = typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : null;
    } while (pageToken && raw.length < MAX_EVENTS && ++pages < 10); // page cap: a token with empty pages must not loop forever
    const keepDeclined = req.query?.declined === '1';
    const items = raw.slice(0, MAX_EVENTS).filter((e) => e && e.status !== 'cancelled'
      && (keepDeclined || !(e.attendees || []).some((a) => a.self && a.responseStatus === 'declined')));
    const emails = [...new Set(items.flatMap((e) => (e.attendees || []).map((a) => String(a.email || '').toLowerCase()).filter(Boolean)))];
    const byEmail = new Map();
    if (emails.length) {
      const u = await pool.query("SELECT id, lower(email) AS email FROM users WHERE kind <> 'agent' AND lower(email) = ANY($1)", [emails]);
      for (const row of u.rows) byEmail.set(row.email, row.id);
    }
    const notes = await notesFor(uid, items);
    const events = items.map((e) => ({
      id: e.id,
      title: e.summary || '(No title)',
      start: e.start?.dateTime || e.start?.date || null,
      end: e.end?.dateTime || e.end?.date || null,
      allDay: !e.start?.dateTime && !!e.start?.date,
      meetLink: [e.hangoutLink, (e.conferenceData?.entryPoints || []).find((p) => p.entryPointType === 'video')?.uri].find(httpOnly) || null, // invitees control these; never pass javascript: etc.
      attendees: (e.attendees || []).map((a) => ({
        email: a.email || '', name: a.displayName || '', userId: byEmail.get(String(a.email || '').toLowerCase()) ?? null, self: !!a.self,
        response: responseOf(a),
      })),
      notesDocId: notes.get(e.id) ?? null,
      description: htmlToText(e.description),
      location: typeof e.location === 'string' ? e.location : '',
      organizerSelf: e.organizer?.self === true,
      myResponse: responseOf((e.attendees || []).find((a) => a?.self)),
      recurringEventId: typeof e.recurringEventId === 'string' ? e.recurringEventId : null,
      htmlLink: httpOnly(e.htmlLink) ? e.htmlLink : null,
    }));
    res.json({ connected: true, events });
  }));

  return { accessTokenFor, fetchEvent, googleSend, calendarReady: async () => (await cfg()).ready };
}
