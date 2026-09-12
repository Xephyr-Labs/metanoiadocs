// Web Push: the half of notifications that works with the app closed.
//
// The in-page Notification API needs an open tab, so a mention that arrives
// after someone shuts the laptop is only ever found by going and looking. This
// hands the message to the browser vendor's push service instead, which wakes
// the service worker whether or not Metanoia is open.
import webpush from 'web-push';
import { pool, getSetting } from './db.js';
import { hostOf, isGone, linkFor } from './push-rules.js';

/** Where the VAPID pair lives when it was not handed in by the environment. */
const VAPID_SETTING = 'vapid';

/**
 * VAPID identifies this server to every push service, and the identity has to
 * outlive a restart: rotating the pair silently invalidates every subscription
 * already handed out, and the browsers holding them never say so. So the pair
 * is generated once and kept — in the database by default, which means a fresh
 * deployment needs no key ceremony, and an operator who would rather hold them
 * can set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY and win.
 */
async function vapidKeys() {
  const fromEnv = {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
  };
  if (fromEnv.publicKey && fromEnv.privateKey) return fromEnv;

  const stored = await getSetting(VAPID_SETTING);
  if (stored?.publicKey && stored?.privateKey) return stored;

  const made = webpush.generateVAPIDKeys();
  // DO NOTHING rather than setSetting's upsert: two boots racing here must end
  // up with one pair, not with the loser overwriting the winner's — every
  // subscription taken against the discarded key would stop working.
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
    [VAPID_SETTING, JSON.stringify(made)]
  );
  return (await getSetting(VAPID_SETTING)) ?? made;
}

/** A push service wants to know who to complain to. An address is enough. */
function contact() {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  const from = process.env.SMTP_FROM || '';
  const angled = from.match(/<([^>]+)>/);
  const address = angled ? angled[1] : (from.includes('@') ? from.trim() : '');
  return address ? `mailto:${address}` : 'mailto:no-reply@metanoiadocs.local';
}

let ready = null;
/** Configure web-push once per process, and hand back the public key. */
function configure() {
  ready ??= (async () => {
    const keys = await vapidKeys();
    webpush.setVapidDetails(contact(), keys.publicKey, keys.privateKey);
    return keys.publicKey;
  })().catch((err) => {
    // Let the next caller try again rather than caching the failure forever.
    ready = null;
    throw err;
  });
  return ready;
}

/**
 * Push one notification to every device a person has switched alerts on in.
 *
 * Best-effort in the same way the email is: a comment must still save when a
 * push service is down, so every caller fires this without awaiting it.
 */
export async function sendPush(userId, { title, body, tag, docId }) {
  let key;
  try {
    key = await configure();
  } catch (err) {
    console.error('[push] no VAPID keys:', err.message);
    return;
  }
  if (!key) return;

  const { rows } = await pool.query(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [userId]
  );
  if (!rows.length) return;

  const payload = JSON.stringify({
    title,
    body: String(body || '').slice(0, 400),
    tag,
    url: linkFor({ docId }),
  });

  await Promise.all(rows.map(async (row) => {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        payload
      );
    } catch (err) {
      if (isGone(err.statusCode)) {
        await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [row.endpoint])
          .catch(() => {});
        return;
      }
      console.error('[push] send failed:', err.statusCode ?? '', err.message);
    }
  }));
}

export function registerPushRoutes(app, { requireUser, wrap }) {
  // The public key the browser needs to subscribe. Public by name and by
  // nature, but behind the session like everything else here.
  app.get('/api/push/key', requireUser, wrap(async (_req, res) => {
    res.json({ key: await configure() });
  }));

  app.post('/api/push/subscribe', requireUser, wrap(async (req, res) => {
    const endpoint = String(req.body?.endpoint || '');
    const p256dh = String(req.body?.keys?.p256dh || '');
    const auth = String(req.body?.keys?.auth || '');
    if (!/^https:\/\//i.test(endpoint) || !p256dh || !auth) {
      return res.status(400).json({ error: 'not a push subscription' });
    }
    await pool.query(
      `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [endpoint, req.user.id, p256dh, auth]
    );
    res.json({ ok: true });
  }));

  app.post('/api/push/unsubscribe', requireUser, wrap(async (req, res) => {
    const endpoint = String(req.body?.endpoint || '');
    // Scoped to the caller: an endpoint is a bearer-ish string, and deleting by
    // it alone would let anyone holding one switch off someone else's alerts.
    if (endpoint) {
      await pool.query(
        'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2',
        [endpoint, req.user.id]
      );
    }
    res.json({ ok: true });
  }));

  // Which devices are still listening. The app does not draw this yet; it is
  // here because "my phone went quiet" is otherwise a question with no answer
  // short of a psql prompt, and the endpoint itself must never be shown.
  app.get('/api/push/devices', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT endpoint, created_at FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at',
      [req.user.id]
    );
    res.json(rows.map((r) => ({ host: hostOf(r.endpoint), created_at: r.created_at })));
  }));
}
