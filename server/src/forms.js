// A public link that writes instead of reads.
//
// Share links publish a page read-only, which covers "here is what we decided"
// and nothing at all of "here is what I need". A bug report from a customer, a
// request from another team, an idea from someone who will never have a seat —
// all of that arrives as a chat message today and is copied into a task by hand
// if it is copied at all.
//
// The form is deliberately two fields and no account. Everything that makes an
// intake form a project in its own right — custom fields, validation rules,
// routing, confirmation emails — is absent on purpose: the value here is that
// the work lands in the database at all, and a form nobody can fill in because
// it asks nine questions has not helped.
//
// The token is the whole capability, and it grants exactly one thing: append a
// task to one database. It cannot read the board, it cannot see other
// submissions, and it can be revoked by turning the form off.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { usableTitle, withKey } from './task-key.js';
import { fireTrigger } from './automations.js';
import { emit } from './webhooks.js';
import { propsFor } from './props-routes.js';
import { coercePropValue } from './props.js';

const MAX_TITLE = 200;
const MAX_DETAILS = 4000;
const MAX_NAME = 120;

/**
 * How many submissions one form accepts per hour.
 *
 * Keyed on the token rather than the caller: an IP rotates for free, and
 * X-Forwarded-For is not trusted by this server. What is actually being
 * protected is the database behind the link — a board nobody can use because
 * it has nine thousand rows in it is the damage, and this is the number that
 * stops that while leaving a genuinely busy form working.
 *
 * ponytail: in-memory Map, because this server is one process. Same trade as
 * throttle.js, and the same fix the day it runs more than one.
 */
const LIMIT = 30;
const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map();

/** True when this token has room left in the window. Exported for its test. */
export function allow(token, now = Date.now(), limit = LIMIT) {
  const rec = hits.get(token);
  if (!rec || rec.until <= now) {
    hits.set(token, { n: 1, until: now + WINDOW_MS });
    // Opportunistic sweep: a workspace with many forms should not accumulate
    // an entry per token forever.
    if (hits.size > 2000) for (const [k, v] of hits) if (v.until <= now) hits.delete(k);
    return true;
  }
  if (rec.n >= limit) return false;
  rec.n += 1;
  return true;
}

/** Clear the window for a token. Only the tests need this. */
export function resetLimit(token) { hits.delete(token); }

const trim = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * The property types a form may ask a stranger for.
 *
 * `person` and `relation` are off the list because answering either means
 * knowing what is already in the workspace, which is exactly what a form link
 * does not grant. `file` is off it because an unauthenticated write of bytes is
 * a different risk from an unauthenticated write of a string, and wants its own
 * decision. `formula` and `rollup` are computed and have nothing to ask.
 */
export const FORM_TYPES = ['text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url', 'email', 'phone'];

/**
 * The fields a form actually shows: the saved list, resolved against the
 * database's properties as they are *now*.
 *
 * Resolved on every request rather than stored denormalised, so renaming a
 * property renames it on the form, deleting one removes it, and changing one to
 * a type a form may not ask for takes it off — instead of leaving a field that
 * writes somewhere that no longer exists.
 */
export function formFields(saved, props) {
  const byId = new Map(props.map((p) => [p.id, p]));
  const out = [];
  for (const entry of Array.isArray(saved) ? saved : []) {
    const prop = byId.get(entry?.id);
    if (!prop || !FORM_TYPES.includes(prop.type)) continue;
    out.push({
      id: prop.id,
      label: prop.label,
      type: prop.type,
      options: prop.options ?? [],
      required: entry?.required === true,
    });
  }
  return out;
}

/** What the owner saved, cleaned: known properties of askable types, once each. */
export function normalizeFormFields(value, props) {
  const askable = new Set(props.filter((p) => FORM_TYPES.includes(p.type)).map((p) => p.id));
  const seen = new Set();
  const out = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const id = typeof entry === 'string' ? entry : entry?.id;
    if (typeof id !== 'string' || !askable.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, required: entry?.required === true });
  }
  return out.slice(0, 20);
}

/**
 * The answers, as a props patch — or the first thing wrong with them.
 *
 * Runs `coercePropValue`, the same function every signed-in write runs, so a
 * form cannot put a shape in a database that the table then cannot render.
 */
export function readAnswers(fields, answers) {
  const props = {};
  for (const field of fields) {
    const raw = typeof answers?.[field.id] === 'string' ? answers[field.id].trim() : answers?.[field.id];
    // Whitespace is blank. Without the trim above, a required field is
    // satisfied by a space bar — and then coerced to null on the way in, so the
    // row lands empty in the column the form insisted on.
    const empty = raw === undefined || raw === null || raw === ''
      || (Array.isArray(raw) && raw.length === 0)
      || (field.type === 'checkbox' && raw === false);
    if (empty) {
      if (field.required) return { ok: false, error: `${field.label} is needed.` };
      continue;
    }
    const value = coercePropValue(field.type, raw);
    if (value === undefined) return { ok: false, error: `${field.label} is not a valid ${field.type}.` };
    // A choice has to be one of the choices. `coercePropValue` keeps any string
    // for a select, which is right for a signed-in write — the picker only ever
    // offers real options, and a stale id there is a race, not an attack. This
    // is a public endpoint with no picker in front of it, so the option list is
    // checked here rather than trusted.
    if (value !== null && (field.type === 'select' || field.type === 'multi_select')) {
      const known = new Set((field.options ?? []).map((o) => o.id));
      const chosen = Array.isArray(value) ? value : [value];
      if (chosen.some((v) => !known.has(v))) {
        return { ok: false, error: `${field.label} is not one of the choices.` };
      }
    }
    if (value !== null) props[field.id] = value;
  }
  return { ok: true, props };
}

export function registerFormRoutes(app, { requireUser, wrap, baseUrl }) {
  const urlFor = (token) => `${baseUrl}/form/${token}`;

  /** What the form looks like, to whoever opened the link. Deliberately thin:
   *  the name of the database and the line above the fields, and nothing about
   *  what is already in it. */
  app.get('/api/form/:token', wrap(async (req, res) => {
    const token = String(req.params.token || '');
    if (token.length < 20 || token.length > 128) return res.status(404).json({ error: 'not found' });
    const { rows } = await pool.query(
      `SELECT id, name, icon, form_intro, form_fields FROM projects
        WHERE form_token = $1 AND archived_at IS NULL`,
      [token]
    );
    if (!rows[0]) return res.status(404).json({ error: 'This form is closed.' });
    // The fields carry a label, a type and its options — enough to draw the
    // form, and nothing about what is already in the database.
    const fields = formFields(rows[0].form_fields, await propsFor(rows[0].id));
    res.json({ name: rows[0].name, icon: rows[0].icon, intro: rows[0].form_intro ?? null, fields });
  }));

  /** Append a task. No account, no session — the token is the authorisation. */
  app.post('/api/form/:token', wrap(async (req, res) => {
    const token = String(req.params.token || '');
    if (token.length < 20 || token.length > 128) return res.status(404).json({ error: 'not found' });

    const title = trim(req.body?.title, MAX_TITLE);
    // Checked against the title as it will be *stored*, not as it arrived. A
    // task's key lives inside its own title, so withKey strips any leading
    // "MD-14: " before writing — and a submission of exactly "MD-14:" passed
    // the non-empty check here and then landed as a row with no name at all.
    // Public endpoint, so that was a nameless row anyone with the link could
    // make, and the sender was told it worked.
    if (!usableTitle(title)) {
      return res.status(400).json({ error: 'Say what you need in a line.' });
    }
    // Not collapsed the way the others are: the details are a paragraph, and
    // its line breaks are part of what was written.
    const details = String(req.body?.details ?? '').trim().slice(0, MAX_DETAILS);
    const from = trim(req.body?.name, MAX_NAME);
    const email = trim(req.body?.email, MAX_NAME);

    const { rows: project } = await pool.query(
      `SELECT id, key, form_fields FROM projects WHERE form_token = $1 AND archived_at IS NULL`,
      [token]
    );
    if (!project[0]) return res.status(404).json({ error: 'This form is closed.' });

    // Resolved against the database's properties as they are now, so a field
    // the owner has since deleted is not writable through an old open tab.
    const fields = formFields(project[0].form_fields, await propsFor(project[0].id));
    const answers = readAnswers(fields, req.body?.answers);
    if (!answers.ok) return res.status(400).json({ error: answers.error });

    // Checked after the token resolves, so a wrong token cannot be used to
    // learn which tokens are real by how fast they are refused.
    if (!allow(token)) {
      return res.status(429).json({ error: 'This form has had a lot of submissions. Try again later.' });
    }

    // The same claim an ordinary create makes: read and bump in one statement,
    // so two people submitting at the same moment get two different numbers.
    const { rows: claim } = await pool.query(
      'UPDATE projects SET task_seq = task_seq + 1 WHERE id = $1 RETURNING key, task_seq',
      [project[0].id]
    );
    if (!claim[0]) return res.status(404).json({ error: 'This form is closed.' });

    const id = crypto.randomUUID();
    const { rows: pos } = await pool.query(
      `SELECT coalesce(max(position), 0) + 1 AS n FROM tasks
        WHERE project_id = $1 AND status = 'todo' AND deleted_at IS NULL`,
      [project[0].id]
    );
    // created_by is left null: nobody signed in made this. submitted_by carries
    // whatever they chose to tell us, which is the honest answer and the one
    // the board can show.
    const who = [from, email].filter(Boolean).join(' · ') || null;
    const { rows } = await pool.query(
      `INSERT INTO tasks (id, project_id, num, title, status, position, submitted_by, props)
       VALUES ($1,$2,$3,$4,'todo',$5,$6,$7) RETURNING *`,
      [id, project[0].id, claim[0].task_seq, withKey(claim[0].key, claim[0].task_seq, title), pos[0].n, who,
       JSON.stringify(answers.props)]
    );

    // The paragraph goes in a comment rather than on the task's page. A page is
    // a Yjs document that has to be built block by block; a comment is text,
    // shows up in the peek beside the work, and is already the place a
    // conversation about a task lives.
    if (details) {
      await pool.query(
        `INSERT INTO comments (id, task_id, body, author_id, author_name)
         VALUES ($1, $2, $3, NULL, $4)`,
        [crypto.randomUUID(), id, details, from || 'Submitted through the form']
      );
    }

    emit('task.created', rows[0]);
    // A submission is a task being created, so the rules that listen for that
    // run — which is the whole point of having them for intake: "a new task in
    // this database goes to whoever is on triage". The actor is null, because
    // nobody signed in made it; notifyAssigneesById already has a name for
    // that case.
    await fireTrigger({ task: rows[0], kind: 'created', actorId: null });

    // The key, and nothing else. Whoever filled the form has no account and no
    // board to open; a number they can quote is the whole of what they need.
    res.json({ ok: true, key: claim[0].key ? `${claim[0].key}-${claim[0].task_seq}` : null });
  }));

  /** The form this database has, if any. */
  app.get('/api/projects/:id/form', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT form_token, form_intro, form_fields FROM projects WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    const props = await propsFor(req.params.id);
    res.json({
      token: rows[0].form_token,
      url: rows[0].form_token ? urlFor(rows[0].form_token) : null,
      intro: rows[0].form_intro ?? '',
      fields: normalizeFormFields(rows[0].form_fields, props),
      // Which properties could be asked for at all, so the dialog can offer
      // them without knowing the rule the server enforces.
      askable: props.filter((p) => FORM_TYPES.includes(p.type))
        .map((p) => ({ id: p.id, label: p.label, type: p.type })),
    });
  }));

  /** Turn one on, change its wording, or replace its address. */
  app.post('/api/projects/:id/form', requireUser, wrap(async (req, res) => {
    const rotate = req.body?.rotate === true;
    const intro = req.body?.intro === undefined ? null : String(req.body.intro).slice(0, 500);
    const props = await propsFor(req.params.id);
    // null leaves the saved list alone; a list replaces it wholesale, which is
    // what a checkbox column in the dialog sends.
    const fields = req.body?.fields === undefined
      ? null
      : JSON.stringify(normalizeFormFields(req.body.fields, props));
    const { rows } = await pool.query(
      `UPDATE projects
          SET form_token = CASE WHEN form_token IS NULL OR $2 THEN $3 ELSE form_token END,
              form_intro = coalesce($4, form_intro),
              form_fields = coalesce($5::jsonb, form_fields)
        WHERE id = $1 AND archived_at IS NULL
        RETURNING form_token, form_intro, form_fields`,
      [req.params.id, rotate, crypto.randomBytes(24).toString('base64url'), intro, fields]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json({
      token: rows[0].form_token,
      url: urlFor(rows[0].form_token),
      intro: rows[0].form_intro ?? '',
      fields: normalizeFormFields(rows[0].form_fields, props),
      askable: props.filter((p) => FORM_TYPES.includes(p.type))
        .map((p) => ({ id: p.id, label: p.label, type: p.type })),
    });
  }));

  /** Turn it off. The address stops working at once and is not kept: a form
   *  that can be switched back on with the same link is a link that was never
   *  really revoked. */
  app.delete('/api/projects/:id/form', requireUser, wrap(async (req, res) => {
    await pool.query('UPDATE projects SET form_token = NULL WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  }));
}
