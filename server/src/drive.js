// Google Drive: one shared drive (or one shared folder), connected once by an
// admin, visible to the whole workspace.
//
// The connection is a Google service account. An admin pastes its JSON key in
// Settings, adds the account's email to the shared drive, or shares a folder
// with it, and picks it. A folder is there because shared drives need Google
// Workspace; a team on plain Gmail has only folders to share. A service account rather than "Sign in with Google" because it
// never expires, needs no OAuth client with a registered redirect for every
// instance, and belongs to no one person who might leave.
//
// Only metadata is mirrored (drive_files): names, types, folders, who changed
// what and when. The bytes stay in Drive and are fetched on demand when someone
// (usually an agent) asks to read a file. Read-only by design: nothing here
// writes to Drive.
import crypto from 'node:crypto';
import { pool, getSetting, setSetting } from './db.js';
import { emit } from './webhooks.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const SYNC_MS = 5 * 60_000;
const FOLDER = 'application/vnd.google-apps.folder';
const FILE_FIELDS =
  'id,name,mimeType,parents,webViewLink,iconLink,size,modifiedTime,lastModifyingUser(displayName),trashed';
/** Text handed back by read is cut here: an agent asking about a 400-page PDF
 *  wants the start and the fact that there is more, not the whole thing. */
export const READ_MAX_CHARS = 200_000;
/** Downloads bigger than this are refused before a byte is fetched. */
const READ_MAX_BYTES = 25 * 1024 * 1024;

/** The two fields of a service-account key file we use, or an error that says
 *  what was pasted instead. */
export function parseServiceAccount(text) {
  let key;
  try {
    key = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    throw new Error('That is not JSON. Paste the whole key file Google downloaded.');
  }
  if (key?.type !== 'service_account' || !key.client_email || !key.private_key) {
    throw new Error('That is not a service-account key (expected "type": "service_account").');
  }
  return { client_email: key.client_email, private_key: key.private_key };
}

/** The signed JWT Google trades for an access token (RFC 7523). */
export function signedAssertion(sa, nowMs = Date.now()) {
  const iat = Math.floor(nowMs / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600,
  })}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(data), sa.private_key).toString('base64url');
  return `${data}.${sig}`;
}

let cachedToken = null; // { email, token, expMs }

async function accessToken(sa, fetchImpl = fetch) {
  if (cachedToken?.email === sa.client_email && cachedToken.expMs > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedAssertion(sa),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Google refused the key: ${body.error_description || body.error || res.status}`);
  }
  cachedToken = { email: sa.client_email, token: body.access_token, expMs: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

/** One Drive API call. `raw` returns the Response for downloads. */
async function gapi(sa, path, params = {}, { raw = false } = {}) {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken(sa)}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error?.message || `Google Drive answered ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return raw ? res : res.json();
}

const ALL_DRIVES = { supportsAllDrives: true, includeItemsFromAllDrives: true };

/** A Drive file as a drive_files row, or null for one that should not be kept. */
export function fileRow(f) {
  if (!f?.id || f.trashed) return null;
  return {
    id: f.id,
    name: f.name || 'Untitled',
    mime_type: f.mimeType || 'application/octet-stream',
    parent_id: f.parents?.[0] ?? null,
    web_view_link: f.webViewLink ?? null,
    icon_link: f.iconLink ?? null,
    size: f.size != null ? Number(f.size) : null,
    modified_at: f.modifiedTime ?? null,
    modified_by: f.lastModifyingUser?.displayName ?? null,
  };
}

/** How to turn a file into text: export a Google-native file, download a plain
 *  one, or null when there is no text to be had (images, video, zips). */
export function textRoute(mimeType) {
  if (mimeType === 'application/vnd.google-apps.document') return { export: 'text/plain' };
  if (mimeType === 'application/vnd.google-apps.presentation') return { export: 'text/plain' };
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return { export: 'text/csv' };
  if (mimeType === 'application/pdf') return { pdf: true };
  if (/^text\//.test(mimeType) || /(json|xml|csv|markdown|yaml)/.test(mimeType)) return { download: true };
  return null;
}

/** What a member's browser, or an agent, sees of a file. */
export const publicFile = (r) => ({
  id: r.id,
  name: r.name,
  mimeType: r.mime_type,
  isFolder: r.mime_type === FOLDER,
  parentId: r.parent_id,
  url: r.web_view_link,
  iconLink: r.icon_link,
  size: r.size != null ? Number(r.size) : null,
  modifiedAt: r.modified_at,
  modifiedBy: r.modified_by,
});

async function upsertFiles(client, rows) {
  if (!rows.length) return;
  await client.query(
    `INSERT INTO drive_files (id, name, mime_type, parent_id, web_view_link, icon_link, size, modified_at, modified_by, synced_at)
     SELECT * , now() FROM jsonb_to_recordset($1::jsonb) AS x(
       id text, name text, mime_type text, parent_id text, web_view_link text, icon_link text,
       size bigint, modified_at timestamptz, modified_by text)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, mime_type = EXCLUDED.mime_type, parent_id = EXCLUDED.parent_id,
       web_view_link = EXCLUDED.web_view_link, icon_link = EXCLUDED.icon_link, size = EXCLUDED.size,
       modified_at = EXCLUDED.modified_at, modified_by = EXCLUDED.modified_by, synced_at = now()`,
    [JSON.stringify(rows)]
  );
}

/** Rebuild the mirror from scratch: on connect, and whenever the change feed
 *  is lost. The start token is taken before listing, so a change made while
 *  the listing runs is replayed by the next incremental sync, not missed. */
async function listAll(sa, params) {
  const out = [];
  let pageToken;
  do {
    const page = await gapi(sa, '/files', {
      ...ALL_DRIVES, pageSize: 1000, pageToken, ...params, fields: `nextPageToken,files(${FILE_FIELDS})`,
    });
    for (const f of page.files || []) {
      const r = fileRow(f);
      if (r) out.push(r);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

/** A folder has no one-call listing of everything under it, so walk it. */
async function listFolder(sa, rootId) {
  const rows = [];
  const queue = [rootId];
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift();
    for (const r of await listAll(sa, { q: `'${id.replace(/'/g, "\\'")}' in parents and trashed = false` })) {
      rows.push(r);
      if (r.mime_type === FOLDER && !seen.has(r.id)) {
        seen.add(r.id);
        queue.push(r.id);
      }
    }
  }
  return rows;
}

async function fullSync(sa, cfg) {
  const folder = cfg.rootKind === 'folder';
  const { startPageToken } = await gapi(sa, '/changes/startPageToken',
    folder ? { supportsAllDrives: true } : { driveId: cfg.driveId, supportsAllDrives: true });
  const rows = folder
    ? await listFolder(sa, cfg.driveId)
    : await listAll(sa, { corpora: 'drive', driveId: cfg.driveId, q: 'trashed = false' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM drive_files');
    for (let i = 0; i < rows.length; i += 1000) await upsertFiles(client, rows.slice(i, i + 1000));
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return startPageToken;
}

/** Apply what changed since the stored token, announcing each file so a
 *  webhook (and the agents behind it) hear about it. */
async function incrementalSync(sa, cfg, token) {
  const folder = cfg.rootKind === 'folder';
  // A folder's feed is the account's whole feed: everything shared with it.
  // Only what sits under the connected folder is kept, so track which folders
  // are inside as the changes arrive (a new subfolder, then its first file).
  const inside = folder
    ? new Set([cfg.driveId, ...(await pool.query('SELECT id FROM drive_files WHERE mime_type = $1', [FOLDER])).rows.map((r) => r.id)])
    : null;
  const known = folder
    ? new Set((await pool.query('SELECT id FROM drive_files')).rows.map((r) => r.id))
    : null;
  let pageToken = token;
  let next = token;
  const changed = [];
  while (pageToken) {
    const page = await gapi(sa, '/changes', {
      ...ALL_DRIVES, ...(folder ? {} : { driveId: cfg.driveId }), pageToken, pageSize: 1000,
      fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
    });
    const up = [];
    const gone = [];
    for (const c of page.changes || []) {
      let r = c.removed ? null : fileRow(c.file);
      if (folder) {
        if (r && !inside.has(r.parent_id)) r = null;
        // Not ours and never was: someone else's file shared with the account.
        if (!r && !known.has(c.fileId)) continue;
        if (r) {
          known.add(r.id);
          if (r.mime_type === FOLDER) inside.add(r.id);
        } else {
          known.delete(c.fileId);
          inside.delete(c.fileId);
        }
      }
      if (r) up.push(r);
      else gone.push(c.fileId);
      changed.push(r ? { ...publicFile(r), removed: false } : { id: c.fileId, removed: true });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await upsertFiles(client, up);
      if (gone.length) {
        await client.query(
          `WITH RECURSIVE sub AS (
             SELECT id FROM drive_files WHERE id = ANY($1)
             UNION SELECT f.id FROM drive_files f JOIN sub ON f.parent_id = sub.id)
           DELETE FROM drive_files WHERE id IN (SELECT id FROM sub)`,
          [gone]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    if (page.newStartPageToken) next = page.newStartPageToken;
    pageToken = page.nextPageToken;
  }
  return { token: next, changed };
}

let syncing = null;

/** Bring the mirror up to date. Concurrent calls share one run. */
export function syncDrive({ full = false } = {}) {
  syncing ??= (async () => {
    const cfg = (await getSetting('drive')) || {};
    if (!cfg.sa || !cfg.driveId) return null;
    let result = {};
    let changed = [];
    try {
      if (full || !cfg.pageToken) {
        result.pageToken = await fullSync(cfg.sa, cfg);
      } else {
        try {
          const inc = await incrementalSync(cfg.sa, cfg, cfg.pageToken);
          result.pageToken = inc.token;
          changed = inc.changed;
        } catch (e) {
          // An expired or invalid page token: start over rather than stall.
          if (e.status !== 400 && e.status !== 404) throw e;
          result.pageToken = await fullSync(cfg.sa, cfg);
        }
      }
      result.lastError = null;
    } catch (e) {
      result = { lastError: e.message };
    }
    const { rows: [{ n }] } = await pool.query('SELECT count(*)::int AS n FROM drive_files');
    // Re-read: an admin may have disconnected or switched drives mid-sync, and
    // this run's token belongs to the drive it started on.
    const now = (await getSetting('drive')) || {};
    if (now.driveId !== cfg.driveId) {
      // What this run wrote is the old drive's. Clear it, and mirror the new
      // one once this run has let go (a call now would join this run).
      await pool.query('DELETE FROM drive_files');
      if (now.driveId) setImmediate(() => syncDrive({ full: true }).catch((e) => console.error('[drive] sync:', e.message)));
      return null;
    }
    await setSetting('drive', { ...now, ...result, lastSyncAt: new Date().toISOString(), fileCount: n });
    for (const f of changed) emit('drive.file.changed', f);
    return { ...result, fileCount: n, changed: changed.length };
  })().finally(() => { syncing = null; });
  return syncing;
}

export function startDriveSync() {
  const timer = setInterval(
    () => syncDrive().catch((e) => console.error('[drive] sync:', e.message)),
    SYNC_MS);
  timer.unref?.();
  return timer;
}

/** A file's text, for read_drive_file. */
async function fileText(sa, row) {
  const route = textRoute(row.mime_type);
  if (!route) {
    const what = row.mime_type === FOLDER ? 'That is a folder' : `A ${row.mime_type} file has no text to read`;
    throw Object.assign(new Error(`${what}. Open it in Drive: ${row.web_view_link}`), { status: 415 });
  }
  if (row.size && row.size > READ_MAX_BYTES) {
    throw Object.assign(new Error('That file is too large to read here. Open it in Drive.'), { status: 413 });
  }
  let text;
  if (route.export) {
    text = await (await gapi(sa, `/files/${encodeURIComponent(row.id)}/export`, { mimeType: route.export }, { raw: true })).text();
  } else {
    const res = await gapi(sa, `/files/${encodeURIComponent(row.id)}`, { alt: 'media', supportsAllDrives: true }, { raw: true });
    if (route.pdf) {
      const { pdfToMarkdown } = await import('./pdf.js');
      text = await pdfToMarkdown(Buffer.from(await res.arrayBuffer()));
    } else {
      text = await res.text();
    }
  }
  const truncated = text.length > READ_MAX_CHARS;
  return { text: truncated ? text.slice(0, READ_MAX_CHARS) : text, truncated };
}

/** The settings screen's view of the connection. Never includes the key. */
async function status() {
  const cfg = (await getSetting('drive')) || {};
  return {
    keySet: !!cfg.sa,
    serviceAccount: cfg.sa?.client_email || '',
    connected: !!(cfg.sa && cfg.driveId),
    driveId: cfg.driveId || null,
    driveName: cfg.driveName || null,
    rootKind: cfg.rootKind || null,
    lastSyncAt: cfg.lastSyncAt || null,
    lastError: cfg.lastError || null,
    fileCount: cfg.fileCount ?? 0,
  };
}

async function needSa(res) {
  const cfg = (await getSetting('drive')) || {};
  if (!cfg.sa) {
    res.status(409).json({ error: 'Add a service-account key first.' });
    return null;
  }
  return cfg;
}

export function registerDriveRoutes(app, { requireUser, requireAdmin, wrap }) {
  app.get('/api/settings/drive', requireUser, wrap(async (_req, res) => res.json(await status())));

  // Saving a key forgets any drive chosen with the previous one: that account
  // may not be a member of it.
  app.put('/api/settings/drive/key', requireUser, requireAdmin, wrap(async (req, res) => {
    let sa;
    try {
      sa = parseServiceAccount(req.body?.key);
      await accessToken(sa);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    await setSetting('drive', { sa });
    await pool.query('DELETE FROM drive_files');
    res.json(await status());
  }));

  // What the account could be connected to: shared drives it is a member of,
  // and folders shared with it directly.
  app.get('/api/drive/roots', requireUser, requireAdmin, wrap(async (_req, res) => {
    const cfg = await needSa(res);
    if (!cfg) return;
    const [{ drives = [] }, { files = [] }] = await Promise.all([
      gapi(cfg.sa, '/drives', { pageSize: 100, fields: 'drives(id,name)' }),
      gapi(cfg.sa, '/files', {
        ...ALL_DRIVES, pageSize: 100, fields: 'files(id,name)',
        q: `mimeType = '${FOLDER}' and sharedWithMe and trashed = false`,
      }),
    ]);
    res.json([
      ...drives.map((d) => ({ id: d.id, name: d.name, kind: 'drive' })),
      ...files.map((f) => ({ id: f.id, name: f.name, kind: 'folder' })),
    ]);
  }));

  app.post('/api/drive/connect', requireUser, requireAdmin, wrap(async (req, res) => {
    const cfg = await needSa(res);
    if (!cfg) return;
    const driveId = String(req.body?.driveId || '');
    const rootKind = req.body?.kind === 'folder' ? 'folder' : 'drive';
    let root;
    try {
      root = rootKind === 'folder'
        ? await gapi(cfg.sa, `/files/${encodeURIComponent(driveId)}`, { fields: 'id,name,mimeType', supportsAllDrives: true })
        : await gapi(cfg.sa, `/drives/${encodeURIComponent(driveId)}`, { fields: 'id,name' });
    } catch (e) {
      if (e.status === 404) {
        return res.status(404).json({
          error: `${cfg.sa.client_email} cannot see that ${rootKind === 'folder' ? 'folder. Share it with the account first' : 'shared drive. Add the account as a member first'}.`,
        });
      }
      throw e;
    }
    if (rootKind === 'folder' && root.mimeType !== FOLDER) return res.status(400).json({ error: 'That is a file, not a folder.' });
    await setSetting('drive', {
      sa: cfg.sa, driveId: root.id, driveName: root.name, rootKind, connectedAt: new Date().toISOString(),
    });
    // The first listing of a big drive takes a while; the screen polls status.
    syncDrive({ full: true }).catch((e) => console.error('[drive] first sync:', e.message));
    res.json(await status());
  }));

  app.post('/api/drive/sync', requireUser, requireAdmin, wrap(async (_req, res) => {
    syncDrive().catch((e) => console.error('[drive] sync:', e.message));
    res.status(202).json({ ok: true });
  }));

  // Task links are kept: reconnecting the same drive brings them back.
  app.delete('/api/settings/drive', requireUser, requireAdmin, wrap(async (_req, res) => {
    await setSetting('drive', {});
    await pool.query('DELETE FROM drive_files');
    res.json(await status());
  }));

  app.get('/api/drive/files', requireUser, wrap(async (req, res) => {
    const where = [];
    const vals = [];
    const q = String(req.query.q || '').trim();
    if (q) {
      vals.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(`name ILIKE $${vals.length}`);
    }
    if (req.query.folder) {
      vals.push(String(req.query.folder));
      where.push(`parent_id = $${vals.length}`);
    }
    if (req.query.since) {
      vals.push(String(req.query.since));
      where.push(`modified_at >= $${vals.length}::timestamptz`);
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const { rows } = await pool.query(
      `SELECT * FROM drive_files ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY (mime_type = '${FOLDER}') DESC, modified_at DESC NULLS LAST, name
        LIMIT ${limit} OFFSET ${offset}`,
      vals
    );
    res.json(rows.map(publicFile));
  }));

  app.get('/api/drive/files/:id', requireUser, wrap(async (req, res) => {
    const { rows: [row] } = await pool.query('SELECT * FROM drive_files WHERE id = $1', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'not found' });
    const { rows: tasks } = await pool.query(
      `SELECT t.id, t.title, t.status FROM task_drive_files l
         JOIN tasks t ON t.id = l.task_id AND t.deleted_at IS NULL
        WHERE l.file_id = $1 ORDER BY l.created_at`,
      [row.id]
    );
    res.json({ ...publicFile(row), tasks });
  }));

  app.get('/api/drive/files/:id/text', requireUser, wrap(async (req, res) => {
    const cfg = (await getSetting('drive')) || {};
    const { rows: [row] } = await pool.query('SELECT * FROM drive_files WHERE id = $1', [req.params.id]);
    if (!row || !cfg.sa) return res.status(404).json({ error: 'not found' });
    try {
      res.json({ id: row.id, name: row.name, mimeType: row.mime_type, ...(await fileText(cfg.sa, row)) });
    } catch (e) {
      res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message });
    }
  }));

  app.get('/api/tasks/:id/drive-files', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT l.file_id, f.* FROM task_drive_files l
         LEFT JOIN drive_files f ON f.id = l.file_id
        WHERE l.task_id = $1 ORDER BY l.created_at`,
      [req.params.id]
    );
    // A link whose file left the drive (or a disconnected drive) still shows,
    // so nobody is told a task has no files when it had some.
    res.json(rows.map((r) => (r.id ? publicFile(r) : { id: r.file_id, missing: true })));
  }));

  app.post('/api/tasks/:id/drive-files', requireUser, wrap(async (req, res) => {
    const fileId = String(req.body?.fileId || '');
    const { rows: [task] } = await pool.query(
      'SELECT id FROM tasks WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    if (!task) return res.status(404).json({ error: 'task not found' });
    const { rows: [file] } = await pool.query('SELECT * FROM drive_files WHERE id = $1', [fileId]);
    if (!file) return res.status(404).json({ error: 'That file is not in the connected drive.' });
    await pool.query(
      `INSERT INTO task_drive_files (task_id, file_id, added_by) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [task.id, file.id, req.user.id]
    );
    res.json(publicFile(file));
  }));

  app.delete('/api/tasks/:id/drive-files/:fileId', requireUser, wrap(async (req, res) => {
    await pool.query('DELETE FROM task_drive_files WHERE task_id = $1 AND file_id = $2', [
      req.params.id, req.params.fileId,
    ]);
    res.json({ ok: true });
  }));
}
