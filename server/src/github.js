import crypto from 'node:crypto';

/** Only GitHub's public origin is a network destination, never a pasted host. */
export function parseGitHubUrl(input) {
  let u;
  try { u = new URL(input); } catch { throw new Error('Paste a GitHub issue or pull request URL.'); }
  const match = /^\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/(issues|pull)\/([1-9]\d*)\/?$/.exec(u.pathname);
  if (u.origin !== 'https://github.com' || u.username || u.password || !match || !Number.isSafeInteger(Number(match[4]))) {
    throw new Error('Paste a GitHub issue or pull request URL.');
  }
  const [, owner, repo, type, number] = match;
  return { owner, repo, kind: type === 'pull' ? 'pull' : 'issue', number: Number(number), url: `https://github.com/${owner}/${repo}/${type}/${number}` };
}

function apiError(status) {
  const message = status === 404 ? 'GitHub item not found. For private repositories, ask your admin to configure GitHub access.'
    : status === 401 ? 'GitHub refused the configured token. Ask your admin to replace it.'
    : status === 403 || status === 429 ? 'GitHub access was refused or rate limited. Try again later or ask your admin to check access.'
    : 'GitHub could not be reached. Try again.';
  return Object.assign(new Error(message), { status: status === 404 ? 404 : 502 });
}

export async function fetchGitHubItem(ref, { fetchImpl = fetch, env = process.env } = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'MetanoiaDocs' };
  if (env.GITHUB_TOKEN) {
    const allow = String(env.GITHUB_REPOSITORIES || '').split(',').map((s) => s.trim().toLowerCase());
    if (!allow.includes(`${ref.owner}/${ref.repo}`.toLowerCase())) {
      throw Object.assign(new Error('This repository is not allowed. Ask your admin to add it to GITHUB_REPOSITORIES.'), { status: 403 });
    }
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }
  const call = async (suffix) => {
    let response;
    try {
      response = await fetchImpl(`https://api.github.com/repos/${ref.owner}/${ref.repo}/${suffix}`, {
        headers, redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
    } catch { throw apiError(502); }
    if (!response.ok) throw apiError(response.status);
    let data;
    try { data = await response.json(); } catch { throw apiError(502); }
    return { data, partial: !!response.headers?.get('link')?.includes('rel="next"') };
  };
  const { data } = await call(`${ref.kind === 'pull' ? 'pulls' : 'issues'}/${ref.number}`);
  if (!data || typeof data.title !== 'string' || !['open', 'closed'].includes(data.state)) throw apiError(502);
  // A PR pasted as /issues/N should still get PR status, not lose its review context.
  if (ref.kind === 'issue' && data.pull_request) return fetchGitHubItem({ ...ref, kind: 'pull', url: ref.url.replace('/issues/', '/pull/') }, { fetchImpl, env });
  const item = { ...ref, title: data.title.slice(0, 500), state: data.merged ? 'merged' : data.state === 'closed' ? 'closed' : data.draft ? 'draft' : data.state, reviews: null };
  if (ref.kind === 'pull') {
    const { data: reviews, partial } = await call(`pulls/${ref.number}/reviews?per_page=100`);
    if (!Array.isArray(reviews)) throw apiError(502);
    const latest = new Map();
    for (const review of reviews) {
      if (!review.user?.login || !['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) continue;
      const previous = latest.get(review.user.login);
      if (!previous || String(review.submitted_at) >= String(previous.submitted_at)) latest.set(review.user.login, review);
    }
    item.reviews = {
      approved: [...latest.values()].filter((r) => r.state === 'APPROVED').length,
      changesRequested: [...latest.values()].filter((r) => r.state === 'CHANGES_REQUESTED').length,
      requested: Array.isArray(data.requested_reviewers) ? data.requested_reviewers.length : 0,
      partial,
    };
  }
  return item;
}

export function registerGitHubRoutes(app, { requireUser, needsPerson, wrap, pool, grantOn, fetchImpl = fetch, env = process.env }) {
  async function taskFor(req, res, writing = false) {
    const { rows } = await pool.query('SELECT id, doc_id FROM tasks WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    const task = rows[0];
    if (!task) { res.status(404).json({ error: 'Task not found' }); return null; }
    // Tasks are workspace-visible until their page carries a narrower grant.
    if (task.doc_id) {
      const role = await grantOn(task.doc_id, req.user.id);
      if (!role) { res.status(404).json({ error: 'Task not found' }); return null; }
      if (writing && !['owner', 'editor'].includes(role)) { res.status(403).json({ error: 'You need edit access to link GitHub items.' }); return null; }
    }
    return task;
  }
  const publicRow = (row) => ({ id: row.id, ...row.metadata, refreshedAt: row.refreshed_at });
  const knownFailure = (res, e) => res.status(e.status || 502).json({ error: e.message });

  app.get('/api/tasks/:id/github', requireUser, wrap(async (req, res) => {
    if (!(await taskFor(req, res))) return;
    const { rows } = await pool.query('SELECT id, metadata, refreshed_at FROM task_github_links WHERE task_id = $1 ORDER BY created_at', [req.params.id]);
    res.json(rows.map(publicRow));
  }));

  app.post('/api/tasks/:id/github', requireUser, needsPerson, wrap(async (req, res) => {
    if (!(await taskFor(req, res, true))) return;
    let ref;
    try { ref = parseGitHubUrl(req.body?.url); } catch (e) { return res.status(400).json({ error: e.message }); }
    const count = await pool.query('SELECT count(*)::int AS n FROM task_github_links WHERE task_id = $1', [req.params.id]);
    if ((count.rows[0]?.n || 0) >= 20) return res.status(400).json({ error: 'A task can link up to 20 GitHub items.' });
    let metadata;
    try { metadata = await fetchGitHubItem(ref, { fetchImpl, env }); } catch (e) { return knownFailure(res, e); }
    const { rows } = await pool.query(
      `INSERT INTO task_github_links (id, task_id, url, metadata, created_by, refreshed_at)
       VALUES ($1,$2,$3,$4,$5,now()) ON CONFLICT (task_id, url)
       DO UPDATE SET metadata = EXCLUDED.metadata, refreshed_at = now() RETURNING id, metadata, refreshed_at`,
      [crypto.randomUUID(), req.params.id, metadata.url, JSON.stringify(metadata), req.user.id],
    );
    res.json(publicRow(rows[0]));
  }));

  app.post('/api/tasks/:id/github/:linkId/refresh', requireUser, needsPerson, wrap(async (req, res) => {
    if (!(await taskFor(req, res, true))) return;
    const { rows } = await pool.query('SELECT url FROM task_github_links WHERE id = $1 AND task_id = $2', [req.params.linkId, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Link not found' });
    let metadata;
    try { metadata = await fetchGitHubItem(parseGitHubUrl(rows[0].url), { fetchImpl, env }); } catch (e) { return knownFailure(res, e); }
    const updated = await pool.query('UPDATE task_github_links SET metadata = $3, refreshed_at = now() WHERE id = $1 AND task_id = $2 RETURNING id, metadata, refreshed_at', [req.params.linkId, req.params.id, JSON.stringify(metadata)]);
    if (!updated.rows[0]) return res.status(404).json({ error: 'Link not found' });
    res.json(publicRow(updated.rows[0]));
  }));

  app.delete('/api/tasks/:id/github/:linkId', requireUser, needsPerson, wrap(async (req, res) => {
    if (!(await taskFor(req, res, true))) return;
    await pool.query('DELETE FROM task_github_links WHERE id = $1 AND task_id = $2', [req.params.linkId, req.params.id]);
    res.json({ ok: true });
  }));
}
