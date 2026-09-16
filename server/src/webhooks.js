// Outgoing webhooks: the workspace telling something else that a thing
// happened, instead of that something else asking every thirty seconds.
//
// Every emit is fire-and-forget. A task must save when the receiving end is
// down, slow, or gone, so nothing here is ever awaited by the route that
// triggered it and nothing here throws at its caller.
import crypto from 'node:crypto';
import { pool } from './db.js';

/**
 * The events a hook can subscribe to. A closed list rather than free text: a
 * typo in a subscription is silence, which is the one failure mode a person
 * cannot tell apart from "nothing has happened yet".
 */
export const WEBHOOK_EVENTS = [
  'task.created',
  'task.updated',
  'task.deleted',
  'doc.created',
  'doc.updated',
  'doc.deleted',
  'comment.created',
  'run.finished',
];

/** Attempt delays. Three tries over half a minute: long enough to ride out a
 *  deploy on the other end, short enough that nobody waits on a queue we do
 *  not have. */
const BACKOFF_MS = [0, 2_000, 15_000];
const TIMEOUT_MS = 10_000;
/** Deliveries kept per hook. The log answers "is this still working", which
 *  needs the recent past, not all of it. */
const KEEP_DELIVERIES = 100;

/**
 * Is this somewhere we are willing to POST?
 *
 * Only the scheme is checked. A webhook URL is admin-configured, and an admin
 * of a self-hosted instance can already reach everything this process can —
 * so blocking private addresses would cost the common case (a hook pointing at
 * another container on the same compose network) and buy nothing against the
 * only party who can set one.
 */
export function validWebhookUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The signature a receiver recomputes to know the payload came from here.
 *
 * The timestamp is inside the signed string, not merely sent beside it, so a
 * captured delivery cannot be replayed later with a fresh timestamp — the
 * signature would no longer match. Receivers should reject anything much older
 * than a few minutes.
 */
export function signPayload(secret, timestamp, body) {
  const mac = crypto.createHmac('sha256', String(secret)).update(`${timestamp}.${body}`).digest('hex');
  return `sha256=${mac}`;
}

/** The events a subscription covers. An empty list means "everything", which is
 *  what someone who just pasted a URL in almost always wants. */
export function subscribes(hook, event) {
  return !hook.events?.length || hook.events.includes(event);
}

async function logDelivery(row) {
  await pool.query(
    `INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status_code, error, attempts, ok)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [crypto.randomUUID(), row.webhookId, row.event, JSON.stringify(row.payload),
     row.statusCode ?? null, row.error ?? null, row.attempts, row.ok]
  );
  // Trim in the same breath as the insert: a sweeper is a second moving part
  // for a table that only ever grows at the rate we write to it.
  await pool.query(
    `DELETE FROM webhook_deliveries
      WHERE webhook_id = $1
        AND id NOT IN (
          SELECT id FROM webhook_deliveries WHERE webhook_id = $1
           ORDER BY created_at DESC LIMIT $2
        )`,
    [row.webhookId, KEEP_DELIVERIES]
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Deliver one event to one hook, retrying a failure a couple of times.
 *
 * Resolves with the outcome rather than rejecting: the only caller is the
 * detached fan-out below, and a rejected promise there would be an
 * unhandledRejection for something that is already logged.
 */
export async function deliver(hook, event, payload, { fetchImpl = fetch } = {}) {
  const body = JSON.stringify({ event, at: new Date().toISOString(), data: payload });
  let statusCode = null;
  let error = null;

  for (let attempt = 1; attempt <= BACKOFF_MS.length; attempt++) {
    if (BACKOFF_MS[attempt - 1]) await sleep(BACKOFF_MS[attempt - 1]);
    const timestamp = Math.floor(Date.now() / 1000);
    try {
      const res = await fetchImpl(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'MetanoiaDocs-Webhook/1',
          'X-Metanoia-Event': event,
          'X-Metanoia-Delivery': crypto.randomUUID(),
          'X-Metanoia-Timestamp': String(timestamp),
          'X-Metanoia-Signature': signPayload(hook.secret, timestamp, body),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      statusCode = res.status;
      error = null;
      // Anything 2xx is taken as delivered. A 4xx is the receiver telling us it
      // did not like the payload; retrying an identical one is pointless, so
      // only 5xx and network failures go round again.
      if (res.ok) return { ok: true, statusCode, attempts: attempt };
      if (res.status < 500) return { ok: false, statusCode, attempts: attempt, error: `HTTP ${res.status}` };
      error = `HTTP ${res.status}`;
    } catch (e) {
      statusCode = null;
      error = e?.message || String(e);
    }
  }
  return { ok: false, statusCode, attempts: BACKOFF_MS.length, error };
}

/**
 * The active hooks, cached for a few seconds.
 *
 * Every task edit emits, and the great majority of workspaces have no hooks at
 * all — without this, dragging a card across a board costs a round trip to ask
 * a question whose answer is almost always "none". The cache is dropped on
 * every write below, so a hook someone just added fires on the next event
 * rather than in five seconds' time.
 */
let cache = null;
const CACHE_MS = 5_000;
const forgetHooks = () => { cache = null; };

async function activeHooks() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const { rows } = await pool.query(
    'SELECT * FROM webhooks WHERE active = true ORDER BY created_at');
  cache = { at: Date.now(), rows };
  return rows;
}

/**
 * Tell every subscribed hook that `event` happened. Never awaited by callers —
 * call it and move on.
 *
 * Deliveries to different hooks run in parallel; a hook that times out cannot
 * hold up the one next to it.
 */
export function emit(event, payload) {
  (async () => {
    const hooks = (await activeHooks()).filter((h) => subscribes(h, event));
    if (!hooks.length) return;
    await Promise.all(hooks.map(async (hook) => {
      const out = await deliver(hook, event, payload);
      await logDelivery({ webhookId: hook.id, event, payload, ...out });
    }));
  })().catch((e) => console.error('[webhook] emit failed:', e.message));
}

/** What a hook looks like to the settings screen. The secret goes out once, at
 *  creation, and never again — the same rule the API tokens screen follows. */
const publicHook = (h) => ({
  id: h.id, url: h.url, events: h.events, active: h.active, created_at: h.created_at,
});

export function registerWebhookRoutes(app, { requireUser, requireAdmin, wrap }) {
  // Hooks are workspace-wide and carry a workspace's data off it, so they are
  // an admin's to create and an admin's to read.
  app.get('/api/webhooks', requireUser, requireAdmin, wrap(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT w.*,
              (SELECT d.ok FROM webhook_deliveries d
                WHERE d.webhook_id = w.id ORDER BY d.created_at DESC LIMIT 1) AS last_ok,
              (SELECT d.created_at FROM webhook_deliveries d
                WHERE d.webhook_id = w.id ORDER BY d.created_at DESC LIMIT 1) AS last_at
         FROM webhooks w ORDER BY w.created_at DESC`);
    res.json(rows.map((r) => ({ ...publicHook(r), last_ok: r.last_ok, last_at: r.last_at })));
  }));

  app.get('/api/webhooks/events', requireUser, requireAdmin, wrap(async (_req, res) => {
    res.json(WEBHOOK_EVENTS);
  }));

  app.post('/api/webhooks', requireUser, requireAdmin, wrap(async (req, res) => {
    const url = String(req.body?.url || '').trim();
    if (!validWebhookUrl(url)) return res.status(400).json({ error: 'Enter an http(s) URL.' });
    const events = Array.isArray(req.body?.events)
      ? req.body.events.filter((e) => WEBHOOK_EVENTS.includes(e))
      : [];
    const id = crypto.randomUUID();
    const secret = crypto.randomBytes(32).toString('base64url');
    const { rows } = await pool.query(
      `INSERT INTO webhooks (id, url, secret, events, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, url, secret, events, req.user.id]
    );
    forgetHooks();
    // The one time the secret is returned. It cannot be recovered afterwards —
    // an admin who loses it rotates it, which is a new secret, not the old one.
    res.json({ ...publicHook(rows[0]), secret });
  }));

  app.patch('/api/webhooks/:id', requireUser, requireAdmin, wrap(async (req, res) => {
    const sets = [];
    const vals = [];
    const set = (sql, v) => { vals.push(v); sets.push(`${sql} = $${vals.length}`); };
    if (req.body?.url !== undefined) {
      if (!validWebhookUrl(req.body.url)) return res.status(400).json({ error: 'Enter an http(s) URL.' });
      set('url', String(req.body.url).trim());
    }
    if (req.body?.events !== undefined) {
      set('events', Array.isArray(req.body.events)
        ? req.body.events.filter((e) => WEBHOOK_EVENTS.includes(e))
        : []);
    }
    if (req.body?.active !== undefined) set('active', !!req.body.active);
    if (!sets.length) return res.json({ ok: true });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE webhooks SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    forgetHooks();
    res.json(publicHook(rows[0]));
  }));

  app.post('/api/webhooks/:id/rotate', requireUser, requireAdmin, wrap(async (req, res) => {
    const secret = crypto.randomBytes(32).toString('base64url');
    const { rows } = await pool.query(
      'UPDATE webhooks SET secret = $2 WHERE id = $1 RETURNING *', [req.params.id, secret]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    forgetHooks();
    res.json({ ...publicHook(rows[0]), secret });
  }));

  app.delete('/api/webhooks/:id', requireUser, requireAdmin, wrap(async (req, res) => {
    await pool.query('DELETE FROM webhooks WHERE id = $1', [req.params.id]);
    forgetHooks();
    res.json({ ok: true });
  }));

  // Send one now and say what came back. Awaited, unlike a real emit: the whole
  // point is the answer, and the person is sitting there waiting for it.
  app.post('/api/webhooks/:id/test', requireUser, requireAdmin, wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM webhooks WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    const payload = { message: 'Test delivery from MetanoiaDocs.', by: req.user.id };
    const out = await deliver(rows[0], 'ping', payload);
    await logDelivery({ webhookId: rows[0].id, event: 'ping', payload, ...out });
    res.json(out);
  }));

  app.get('/api/webhooks/:id/deliveries', requireUser, requireAdmin, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, event, status_code, error, attempts, ok, created_at
         FROM webhook_deliveries WHERE webhook_id = $1
        ORDER BY created_at DESC LIMIT 50`,
      [req.params.id]
    );
    res.json(rows);
  }));
}
