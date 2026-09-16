// Outgoing webhooks: the workspace telling something else that a thing
// happened, instead of that something else asking every thirty seconds.
//
// A task must save when the receiving end is down, slow, or gone, so emit()
// only writes a queued row and returns — the worker at the bottom of this file
// does the HTTP, on its own schedule, out of the request's way. Nothing here is
// awaited by the route that triggered it and nothing here throws at its caller.
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
    `INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status_code, error, attempts, ok, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [crypto.randomUUID(), row.webhookId, row.event, JSON.stringify(row.payload),
     row.statusCode ?? null, row.error ?? null, row.attempts, row.ok,
     row.ok ? 'done' : 'failed']
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

/**
 * POST one event to one hook, once.
 *
 * Exactly one attempt: the worker owns the retry schedule now, because a
 * schedule held in this function's stack dies with the process. Resolves with
 * the outcome rather than rejecting — a rejected promise in the worker loop
 * would be an unhandledRejection for something already recorded.
 */
export async function deliver(hook, event, payload, { fetchImpl = fetch } = {}) {
  const body = JSON.stringify({ event, at: new Date().toISOString(), data: payload });
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
    if (res.ok) return { ok: true, statusCode: res.status, attempts: 1 };
    return { ok: false, statusCode: res.status, attempts: 1, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, statusCode: null, attempts: 1, error: e?.message || String(e) };
  }
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
 * Record that `event` happened, for every hook subscribed to it.
 *
 * This writes rows and returns; the worker below does the HTTP. That split is
 * the point. The first version delivered inline and held its retry schedule in
 * a setTimeout, so a restart during the back-off — a deploy, a crash, a
 * `docker compose up` — dropped the delivery with no trace that it had ever
 * been owed. A queued row survives all three.
 *
 * ponytail: enqueued just after the domain write, not inside its transaction.
 * A true outbox would make the two atomic, but the writes this fires on are
 * single auto-committed statements, so there is no transaction to join without
 * restructuring every route. The window this leaves is the microseconds between
 * the UPDATE committing and this INSERT; what it removes is the seconds-long
 * window the retry loop used to own. Pass a client through the call sites the
 * day that is not good enough.
 */
export function emit(event, payload) {
  (async () => {
    const hooks = (await activeHooks()).filter((h) => subscribes(h, event));
    if (!hooks.length) return;
    await pool.query(
      `INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status, attempt_at)
       SELECT gen_random_uuid()::text, h, $2, $3, 'queued', now()
         FROM unnest($1::text[]) AS h`,
      [hooks.map((h) => h.id), event, JSON.stringify(payload)]
    );
  })().catch((e) => console.error('[webhook] enqueue failed:', e.message));
}

/** Attempts before a delivery is given up on, and how long to wait after each.
 *  Minutes rather than seconds now that a restart cannot lose the schedule —
 *  an endpoint that is down is usually down for longer than fifteen seconds. */
const RETRY_AFTER_S = [0, 30, 120, 600, 1800];
/** Consecutive failed deliveries before a hook switches itself off, so one
 *  decommissioned endpoint cannot occupy the worker forever. */
const DISABLE_AFTER = 10;
const WORKER_TICK_MS = Number(process.env.WEBHOOK_TICK_MS || 5_000);

/**
 * Deliver one queued row. Claimed with SKIP LOCKED so several instances — or
 * several ticks overlapping — never send the same delivery twice.
 */
async function drainOne({ fetchImpl = fetch } = {}) {
  const { rows } = await pool.query(
    `UPDATE webhook_deliveries SET status = 'delivering'
      WHERE id = (
        SELECT d.id FROM webhook_deliveries d
          JOIN webhooks w ON w.id = d.webhook_id
         WHERE d.status = 'queued' AND d.attempt_at <= now() AND w.active = true
         ORDER BY d.attempt_at
         LIMIT 1 FOR UPDATE OF d SKIP LOCKED
      )
      RETURNING *`);
  const row = rows[0];
  if (!row) return false;

  const { rows: hook } = await pool.query('SELECT * FROM webhooks WHERE id = $1', [row.webhook_id]);
  if (!hook[0]) {
    await pool.query(`UPDATE webhook_deliveries SET status = 'failed' WHERE id = $1`, [row.id]);
    return true;
  }

  const attempt = row.attempts + 1;
  const out = await deliver(hook[0], row.event, row.payload, { fetchImpl });

  if (out.ok) {
    await pool.query(
      `UPDATE webhook_deliveries
          SET status = 'done', ok = true, status_code = $2, error = NULL, attempts = $3
        WHERE id = $1`,
      [row.id, out.statusCode, attempt]);
    await pool.query('UPDATE webhooks SET consecutive_failures = 0 WHERE id = $1', [row.webhook_id]);
    return true;
  }

  // A 4xx is the receiver refusing this payload; sending it again changes
  // nothing. Only 5xx and network failures are worth another go.
  const retryable = out.statusCode === null || out.statusCode >= 500;
  const more = retryable && attempt < RETRY_AFTER_S.length;
  await pool.query(
    `UPDATE webhook_deliveries
        SET status = $4, ok = false, status_code = $2, error = $5, attempts = $3,
            attempt_at = now() + ($6 || ' seconds')::interval
      WHERE id = $1`,
    [row.id, out.statusCode, attempt, more ? 'queued' : 'failed', out.error,
     String(more ? RETRY_AFTER_S[attempt] : 0)]);

  if (!more) {
    const { rows: w } = await pool.query(
      `UPDATE webhooks SET consecutive_failures = consecutive_failures + 1
        WHERE id = $1 RETURNING consecutive_failures`, [row.webhook_id]);
    if ((w[0]?.consecutive_failures ?? 0) >= DISABLE_AFTER) {
      await pool.query('UPDATE webhooks SET active = false WHERE id = $1', [row.webhook_id]);
      forgetHooks();
      console.warn(`[webhook] ${row.webhook_id} disabled after ${DISABLE_AFTER} consecutive failures`);
    }
  }
  return true;
}

/** Drain whatever is due, newest tick wins. Exported for the tests. */
export async function drainWebhooks(opts = {}) {
  let sent = 0;
  // Bounded so one tick cannot monopolise the pool on a large backlog.
  while (sent < 20 && await drainOne(opts)) sent++;
  return sent;
}

/** Start the delivery worker. Called once at boot. */
export function startWebhookWorker() {
  // Anything left 'delivering' belongs to a process that is gone — a crash
  // mid-flight. Put it back on the queue rather than stranding it.
  pool.query(`UPDATE webhook_deliveries SET status = 'queued' WHERE status = 'delivering'`)
    .catch((e) => console.error('[webhook] requeue on boot:', e.message));
  const timer = setInterval(
    () => drainWebhooks().catch((e) => console.error('[webhook] worker:', e.message)),
    WORKER_TICK_MS);
  timer.unref?.();
  return timer;
}

/** What a hook looks like to the settings screen. The secret goes out once, at
 *  creation, and never again — the same rule the API tokens screen follows. */
const publicHook = (h) => ({
  id: h.id, url: h.url, events: h.events, active: h.active, created_at: h.created_at,
  // How many deliveries in a row have failed. The settings screen says so when
  // it is non-zero, because a hook that turned itself off looks identical to
  // one an admin switched off on purpose.
  consecutive_failures: h.consecutive_failures ?? 0,
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
    if (req.body?.active !== undefined) {
      set('active', !!req.body.active);
      // Switching a disabled hook back on starts its count over. Without this it
      // carries ten strikes and the very next failure switches it off again.
      if (req.body.active) set('consecutive_failures', 0);
    }
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
    // One shot, answered inline: the person is sitting there waiting for it.
    // A queued row would tell them nothing until the worker got to it.
    const out = await deliver(rows[0], 'ping', payload);
    await logDelivery({ webhookId: rows[0].id, event: 'ping', payload, ...out });
    // A working test clears the strikes — an endpoint that answers is not dead,
    // whatever the last ten automatic deliveries thought.
    if (out.ok) await pool.query('UPDATE webhooks SET consecutive_failures = 0 WHERE id = $1', [rows[0].id]);
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
