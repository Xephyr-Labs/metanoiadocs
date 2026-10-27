import crypto from 'node:crypto';
import { isPerson } from './approval.js';
import { getSetting, setSetting } from './db.js';

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

export function registerCalendarRoutes(app, {
  requireUser, requireAdmin, needsPerson, wrap, pool,
  baseUrl = process.env.BASE_URL, env = process.env, get = getSetting, set = setSetting,
}) {
  const cfg = () => calendarConfig({ get, env });

  // Admins see the setup; everyone else learns only whether the feature is on.
  app.get('/api/settings/calendar', requireUser, wrap(async (req, res) => {
    const c = await cfg();
    if (req.user?.role !== 'admin' || !isPerson(req)) return res.json({ enabled: c.ready });
    res.json({
      enabled: c.enabled, clientId: c.clientId, secretSet: !!c.clientSecret, keySet: c.keySet,
      redirectUri: `${String(baseUrl).replace(/\/+$/, '')}/api/calendar/google/callback`,
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
    if (!c.ready) return res.json({ available: false, connected: false, email: null });
    const { rows } = await pool.query('SELECT google_email FROM user_calendar_tokens WHERE user_id = $1', [req.user.id]);
    res.json({ available: true, connected: !!rows[0], email: rows[0]?.google_email || null });
  }));
}
