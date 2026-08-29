# Notion-style Databases, Task Pages and Pinning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing tasks module into a Notion-style database — every row is a page with its own document body, databases carry custom properties and relations, databases nest and embed into pages — and let folders be pinned the way documents already can be.

**Architecture:** A project *is* a database and a task *is* a row; nothing is rebuilt. Custom columns live in a new `db_props` table with values in a JSONB column on `tasks`; relations live in an edge table so deletes stay consistent. A row's page reuses the `tasks.doc_id` column that already exists, created lazily as a `docs` row with `kind = 'task'`. Databases nest through `projects.parent_id`, and embed into any document through a new BlockSuite block flavour built exactly like the existing chart block.

**Tech Stack:** Node 20 ESM + Express 4 + `pg` (server, tests with `node --test`), React 18 + Vite + Tailwind + BlockSuite 0.22.4 (web, tests with `vitest`), Postgres 16.

**Spec:** `docs/superpowers/specs/2026-08-29-notion-databases-design.md`

## Global Constraints

- Repo: `~/workspace/metanoiadocs`, branch off `main`. Deploy is out of scope for this plan.
- **The server test suite is `node --test` with no database harness.** No existing server test touches `pool`. Therefore: every non-trivial rule goes in an exported *pure function* that gets a unit test, and the SQL route that calls it is verified by the manual `curl` check written into that task. Do not add a Postgres test container.
- Web tests are `vitest run` from `web-react/`. Existing tests cover pure modules in `web-react/src/lib/` only — no component rendering tests, no testing-library. Keep to that.
- Schema changes go in `initSchema` in `server/src/db.js` and must be idempotent (`IF NOT EXISTS`). A statement that cannot be made idempotent is guarded by a `schema_migrations` marker, following `normalizeLegacyFolderImport` in the same file.
- **Never use Tailwind opacity modifiers on this project's colour tokens** (`bg-accent/60`, `bg-danger/25`, …). The tokens are `var(--x)` hex and render transparent. Use solid tokens: `bg-accent`, `bg-surface-2`, `ring-danger`.
- Property type values, verbatim: `text`, `number`, `select`, `multi_select`, `date`, `checkbox`, `person`, `url`, `relation`.
- Document kinds, verbatim: `doc`, `design`, `task`.
- Statuses stay the four that exist: `todo`, `doing`, `review`, `done`.
- Commands: server tests `cd server && npm test`; web tests `cd web-react && npm test`; web typecheck+build `cd web-react && npm run build`; local stack `docker compose up -d --build`, app on `http://localhost:8092`, admin login `admin` / `admin123`.
- Manual checks use `curl` against `http://localhost:8092` with a session cookie. Get one once and reuse it:
  ```bash
  curl -s -c /tmp/mn.jar -X POST http://localhost:8092/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"admin123"}'
  # then pass -b /tmp/mn.jar on every later call
  ```
- Commit after every task, Conventional Commits, subject ≤ 50 chars.

---

### Task 1: Property schema and pure property helpers

**Files:**
- Modify: `server/src/db.js` (inside `initSchema`, after the `task_kinds` block near the end of the DDL string)
- Create: `server/src/props.js`
- Create: `server/src/props.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PROP_TYPES: string[]`
  - `propKey(label: string, taken?: string[]): string`
  - `canChangeType(from: string, to: string): boolean`
  - `normalizeOptions(value: unknown): { id: string, label: string, color: string }[]`
  - `coercePropValue(type: string, value: unknown): unknown` — returns the storable JSON value, or `undefined` when the input is not valid for that type.

- [ ] **Step 1: Write the failing test**

Create `server/src/props.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROP_TYPES, propKey, canChangeType, normalizeOptions, coercePropValue } from './props.js';

test('propKey slugs a label and never collides', () => {
  assert.equal(propKey('Story Points'), 'story-points');
  assert.equal(propKey('  Owner!  '), 'owner');
  assert.equal(propKey('Owner', ['owner']), 'owner-2');
  assert.equal(propKey('📌', ['prop']), 'prop-2');
});

test('canChangeType allows only lossless pairs', () => {
  assert.equal(canChangeType('text', 'url'), true);
  assert.equal(canChangeType('url', 'text'), true);
  assert.equal(canChangeType('select', 'multi_select'), true);
  assert.equal(canChangeType('multi_select', 'select'), true);
  assert.equal(canChangeType('text', 'text'), true);
  assert.equal(canChangeType('number', 'text'), false);
  assert.equal(canChangeType('relation', 'text'), false);
});

test('normalizeOptions keeps id/label/color and drops junk', () => {
  const out = normalizeOptions([
    { id: 'a', label: 'High', color: 'red' },
    { label: 'Low' },
    'nope',
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { id: 'a', label: 'High', color: 'red' });
  assert.equal(out[1].label, 'Low');
  assert.equal(out[1].color, 'gray');
  assert.ok(out[1].id.length > 0);
});

test('coercePropValue stores what the type says and rejects the rest', () => {
  assert.equal(coercePropValue('text', ' hi '), 'hi');
  assert.equal(coercePropValue('number', '12.5'), 12.5);
  assert.equal(coercePropValue('number', 'abc'), undefined);
  assert.equal(coercePropValue('checkbox', 'yes'), true);
  assert.equal(coercePropValue('date', '2026-08-29'), '2026-08-29');
  assert.equal(coercePropValue('date', '29/08/2026'), undefined);
  assert.deepEqual(coercePropValue('multi_select', ['a', 'b', 'a']), ['a', 'b']);
  assert.equal(coercePropValue('url', 'javascript:alert(1)'), undefined);
  assert.equal(coercePropValue('url', 'https://x.dev'), 'https://x.dev');
  assert.equal(coercePropValue('text', null), null);
});

test('every type in PROP_TYPES round-trips a null clear', () => {
  for (const type of PROP_TYPES) assert.equal(coercePropValue(type, null), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module './props.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/src/props.js`:

```js
import crypto from 'node:crypto';

/** The property types a database column can have. `relation` is the only one
 *  whose value lives outside `tasks.props` — see task_relations. */
export const PROP_TYPES = [
  'text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'person', 'url', 'relation',
];

/** A stable key for a user-typed label, unique within `taken`. Mirrors
 *  kindKey in tasks.js: derived once at creation, never recomputed, so a
 *  later rename cannot orphan stored values. */
export function propKey(label, taken = []) {
  const base =
    String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) ||
    'prop';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// Pairs where no stored value is destroyed by the change. Anything else is a
// 400 rather than a silent data loss.
const COMPATIBLE = [['text', 'url'], ['select', 'multi_select']];

export function canChangeType(from, to) {
  if (from === to) return true;
  return COMPATIBLE.some(([a, b]) => (from === a && to === b) || (from === b && to === a));
}

export function normalizeOptions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((o) => o && typeof o === 'object')
    .slice(0, 100)
    .map((o) => ({
      id: typeof o.id === 'string' && o.id ? o.id.slice(0, 64) : crypto.randomUUID(),
      label: String(o.label ?? '').trim().slice(0, 80),
      color: String(o.color ?? 'gray').slice(0, 20),
    }));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The storable JSON value for `type`, or undefined when the input is invalid.
 *  null always means "clear this property". */
export function coercePropValue(type, value) {
  if (value === null || value === '' || value === undefined) return null;
  switch (type) {
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'checkbox':
      return value !== false && value !== 'false' && value !== 0;
    case 'date': {
      const s = String(value).slice(0, 10);
      return DATE.test(s) && !Number.isNaN(Date.parse(s)) ? s : undefined;
    }
    case 'multi_select':
      return Array.isArray(value)
        ? [...new Set(value.filter((v) => typeof v === 'string'))].slice(0, 100)
        : undefined;
    case 'url': {
      const s = String(value).trim().slice(0, 2000);
      // Only http(s): a stored javascript: URL becomes a click target later.
      return /^https?:\/\//i.test(s) ? s : undefined;
    }
    case 'relation':
      // Relations are edges, never values in props.
      return undefined;
    default:
      return String(value).trim().slice(0, 2000);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test`
Expected: PASS, including the pre-existing suites.

- [ ] **Step 5: Add the schema**

In `server/src/db.js`, inside the `initSchema` template string, immediately after the `task_kinds_key_idx` line and before the closing backtick:

```sql
    -- ── database properties ─────────────────────────────────────────────────
    -- A project is a database; these are its columns beyond the fixed task
    -- fields. Per-project and editable by anyone who can see the project,
    -- following the task_kinds precedent above.
    CREATE TABLE IF NOT EXISTS db_props (
      id                TEXT PRIMARY KEY,
      project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      key               TEXT NOT NULL,
      label             TEXT NOT NULL,
      type              TEXT NOT NULL DEFAULT 'text',
      options           JSONB NOT NULL DEFAULT '[]',
      target_project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      position          INT NOT NULL DEFAULT 0,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS db_props_key_idx ON db_props(project_id, key);

    -- Property values, keyed by db_props.id. JSONB rather than an EAV table:
    -- reading a row needs no join and adding a property needs no migration.
    -- ponytail: filtering across databases on a property is a JSONB scan —
    -- add a GIN index here, or a real EAV table, if that ever measures slow.
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS props JSONB NOT NULL DEFAULT '{}';
```

- [ ] **Step 6: Verify the schema applies**

Run:
```bash
docker compose up -d --build
docker compose exec -T db psql -U postgres -d metanoiadocs -c '\d db_props'
docker compose exec -T db psql -U postgres -d metanoiadocs -c "SELECT column_name FROM information_schema.columns WHERE table_name='tasks' AND column_name='props'"
```
Expected: the `db_props` table description prints, and `props` is listed.

- [ ] **Step 7: Commit**

```bash
git add server/src/props.js server/src/props.test.js server/src/db.js
git commit -m "feat(db): database properties table and helpers"
```

---

### Task 2: Property routes

**Files:**
- Create: `server/src/props-routes.js`
- Modify: `server/src/index.js:1971` (registration, beside `registerTaskRoutes`)
- Modify: `server/src/tasks.js` (`PATCH /api/tasks/:id` gains `props`)

**Interfaces:**
- Consumes: `PROP_TYPES`, `propKey`, `canChangeType`, `normalizeOptions`, `coercePropValue` from `./props.js`.
- Produces: `registerPropRoutes(app, { requireUser, wrap })`, and these endpoints:
  - `GET /api/projects/:id/props` → `PropRow[]`
  - `POST /api/projects/:id/props` `{ label, type?, options?, targetProjectId? }` → `PropRow`
  - `PATCH /api/props/:id` `{ label?, type?, options?, position?, targetProjectId? }` → `PropRow`
  - `DELETE /api/props/:id` → `{ ok: true }`
  - `PATCH /api/tasks/:id` accepts `props: Record<string, unknown>` (shallow merge; `null` clears one key)

  `PropRow` is the table row: `{ id, project_id, key, label, type, options, target_project_id, position, created_at }`.

- [ ] **Step 1: Write the failing test**

Add to `server/src/props.test.js`:

```js
import { propsPatch } from './props.js';

test('propsPatch coerces per type and drops unknown property ids', () => {
  const defs = [
    { id: 'p1', type: 'number' },
    { id: 'p2', type: 'multi_select' },
  ];
  assert.deepEqual(propsPatch(defs, { p1: '3', p2: ['a'], nope: 'x' }), {
    ok: true,
    value: { p1: 3, p2: ['a'] },
  });
});

test('propsPatch reports the first invalid value instead of storing it', () => {
  const defs = [{ id: 'p1', type: 'date' }];
  assert.deepEqual(propsPatch(defs, { p1: 'yesterday' }), {
    ok: false,
    error: 'p1 is not a valid date',
  });
});

test('propsPatch keeps an explicit null so a value can be cleared', () => {
  const defs = [{ id: 'p1', type: 'text' }];
  assert.deepEqual(propsPatch(defs, { p1: null }), { ok: true, value: { p1: null } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test`
Expected: FAIL — `propsPatch is not a function`.

- [ ] **Step 3: Implement propsPatch**

Append to `server/src/props.js`:

```js
/**
 * Validate a `props` patch against a project's property definitions.
 * Unknown ids are dropped rather than rejected: a client holding a stale
 * column list should not fail the whole save.
 */
export function propsPatch(defs, patch) {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const value = {};
  for (const [id, raw] of Object.entries(patch || {})) {
    const def = byId.get(id);
    if (!def) continue;
    const coerced = coercePropValue(def.type, raw);
    if (coerced === undefined) return { ok: false, error: `${id} is not a valid ${def.type}` };
    value[id] = coerced;
  }
  return { ok: true, value };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 5: Write the routes**

Create `server/src/props-routes.js`:

```js
import crypto from 'node:crypto';
import { pool } from './db.js';
import { PROP_TYPES, propKey, canChangeType, normalizeOptions } from './props.js';

/** Enough columns to be useful without turning the table into a spreadsheet. */
const MAX_PROPS = 40;

async function propsFor(projectId) {
  const { rows } = await pool.query(
    'SELECT * FROM db_props WHERE project_id = $1 ORDER BY position ASC, created_at ASC',
    [projectId]
  );
  return rows;
}

export { propsFor };

export function registerPropRoutes(app, { requireUser, wrap }) {
  app.get('/api/projects/:id/props', requireUser, wrap(async (req, res) => {
    res.json(await propsFor(req.params.id));
  }));

  app.post('/api/projects/:id/props', requireUser, wrap(async (req, res) => {
    const label = String(req.body?.label ?? '').trim().slice(0, 60);
    if (!label) return res.status(400).json({ error: 'Give the property a name.' });
    const type = String(req.body?.type || 'text');
    if (!PROP_TYPES.includes(type)) return res.status(400).json({ error: 'unknown property type' });

    let targetProjectId = null;
    if (type === 'relation') {
      targetProjectId = req.body?.targetProjectId || null;
      const { rowCount } = await pool.query(
        'SELECT 1 FROM projects WHERE id = $1 AND archived_at IS NULL',
        [targetProjectId]
      );
      if (!rowCount) return res.status(400).json({ error: 'a relation needs a target database' });
    }

    const existing = await propsFor(req.params.id);
    if (existing.length >= MAX_PROPS) {
      return res.status(400).json({ error: `A database can have at most ${MAX_PROPS} properties.` });
    }
    const { rows } = await pool.query(
      `INSERT INTO db_props (id, project_id, key, label, type, options, target_project_id, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        crypto.randomUUID(),
        req.params.id,
        propKey(label, existing.map((p) => p.key)),
        label,
        type,
        JSON.stringify(normalizeOptions(req.body?.options)),
        targetProjectId,
        existing.length,
      ]
    );
    res.json(rows[0]);
  }));

  app.patch('/api/props/:id', requireUser, wrap(async (req, res) => {
    const b = req.body || {};
    const { rows: cur } = await pool.query('SELECT * FROM db_props WHERE id = $1', [req.params.id]);
    if (!cur[0]) return res.status(404).json({ error: 'not found' });

    const sets = [];
    const vals = [];
    const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

    if (b.label !== undefined) {
      const label = String(b.label).trim().slice(0, 60);
      if (!label) return res.status(400).json({ error: 'Give the property a name.' });
      set('label', label);
    }
    if (b.type !== undefined && b.type !== cur[0].type) {
      if (!PROP_TYPES.includes(b.type)) return res.status(400).json({ error: 'unknown property type' });
      if (!canChangeType(cur[0].type, b.type)) {
        return res.status(400).json({ error: `Cannot change a ${cur[0].type} property to ${b.type}.` });
      }
      set('type', b.type);
    }
    if (b.options !== undefined) set('options', JSON.stringify(normalizeOptions(b.options)));
    if (b.position !== undefined) set('position', Number(b.position) || 0);
    if (b.targetProjectId !== undefined) set('target_project_id', b.targetProjectId || null);
    if (!sets.length) return res.json(cur[0]);

    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE db_props SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals
    );
    res.json(rows[0]);
  }));

  app.delete('/api/props/:id', requireUser, wrap(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [prop] } = await client.query(
        'SELECT * FROM db_props WHERE id = $1 FOR UPDATE', [req.params.id]
      );
      if (!prop) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'not found' });
      }
      // One statement over one project's rows — cheap enough to do inline.
      await client.query('UPDATE tasks SET props = props - $1 WHERE project_id = $2', [
        prop.id, prop.project_id,
      ]);
      await client.query('DELETE FROM db_props WHERE id = $1', [prop.id]);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }));
}
```

- [ ] **Step 6: Register the routes**

In `server/src/index.js`, beside the existing imports near line 38:

```js
import { registerPropRoutes } from './props-routes.js';
```

and beside `registerTaskRoutes(app, { requireUser, wrap });` at line 1971:

```js
registerPropRoutes(app, { requireUser, wrap });
```

- [ ] **Step 7: Accept `props` on the task patch**

In `server/src/tasks.js`, inside `app.patch('/api/tasks/:id', …)`, immediately before the `if (!sets.length)` line:

```js
    if (b.props !== undefined) {
      const { rows: owner } = await pool.query('SELECT project_id FROM tasks WHERE id = $1', [req.params.id]);
      if (!owner[0]) return res.status(404).json({ error: 'not found' });
      const checked = propsPatch(await propsFor(owner[0].project_id), b.props);
      if (!checked.ok) return res.status(400).json({ error: checked.error });
      // Shallow merge, so two people editing different properties of the same
      // row do not clobber each other.
      set('props', JSON.stringify(checked.value));
      sets[sets.length - 1] = `props = props || $${vals.length}::jsonb`;
    }
```

and add at the top of `server/src/tasks.js`:

```js
import { propsPatch } from './props.js';
import { propsFor } from './props-routes.js';
```

- [ ] **Step 8: Manual check**

Run (with the cookie jar from Global Constraints, and a real project id from `GET /api/projects`):

```bash
P=$(curl -s -b /tmp/mn.jar http://localhost:8092/api/projects | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["id"])')
PROP=$(curl -s -b /tmp/mn.jar -X POST http://localhost:8092/api/projects/$P/props \
  -H 'Content-Type: application/json' -d '{"label":"Story Points","type":"number"}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
T=$(curl -s -b /tmp/mn.jar -X POST http://localhost:8092/api/tasks \
  -H 'Content-Type: application/json' -d "{\"projectId\":\"$P\",\"title\":\"prop check\"}" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
curl -s -b /tmp/mn.jar -X PATCH http://localhost:8092/api/tasks/$T \
  -H 'Content-Type: application/json' -d "{\"props\":{\"$PROP\":\"5\"}}"
curl -s -b /tmp/mn.jar -X PATCH http://localhost:8092/api/tasks/$T \
  -H 'Content-Type: application/json' -d "{\"props\":{\"$PROP\":\"abc\"}}"
curl -s -b /tmp/mn.jar -X DELETE http://localhost:8092/api/props/$PROP
curl -s -b /tmp/mn.jar http://localhost:8092/api/projects/$P/tasks | grep -o '"props":[^,]*' | head -3
```
Expected: the first PATCH returns the row with `"props":{"<id>":5}`; the second returns `400` with `is not a valid number`; after the DELETE the row's `props` no longer contains that key.

- [ ] **Step 9: Commit**

```bash
git add server/src/props-routes.js server/src/props.js server/src/props.test.js server/src/tasks.js server/src/index.js
git commit -m "feat(api): custom database properties"
```

---

### Task 3: Relations between rows

**Files:**
- Modify: `server/src/db.js` (DDL, after the `db_props` block from Task 1)
- Modify: `server/src/props.js` (pure validation helper)
- Modify: `server/src/props.test.js`
- Modify: `server/src/props-routes.js` (relation endpoints and the row detail route)

**Interfaces:**
- Consumes: `propsFor` from `./props-routes.js`.
- Produces:
  - `relationError(prop, fromProjectId, toProjectId): string | null` in `props.js`
  - `POST /api/tasks/:id/relations` `{ propId, toId }` → `{ ok: true }`
  - `DELETE /api/tasks/:id/relations` `{ propId, toId }` → `{ ok: true }`
  - `GET /api/tasks/:id` → `{ ...taskRow, props, relations: Record<propId, RelatedRow[]>, backlinks: RelatedRow[] }` where `RelatedRow` is `{ id, title, project_id, project_name, doc_id }`.

- [ ] **Step 1: Write the failing test**

Add to `server/src/props.test.js`:

```js
import { relationError } from './props.js';

test('relationError guards the property and both ends of the edge', () => {
  const prop = { id: 'p1', type: 'relation', project_id: 'A', target_project_id: 'B' };
  assert.equal(relationError(prop, 'A', 'B'), null);
  assert.equal(relationError(null, 'A', 'B'), 'unknown property');
  assert.equal(relationError({ ...prop, type: 'text' }, 'A', 'B'), 'that property is not a relation');
  assert.equal(relationError(prop, 'C', 'B'), 'that property belongs to another database');
  assert.equal(relationError(prop, 'A', 'C'), 'that row is not in the linked database');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test`
Expected: FAIL — `relationError is not a function`.

- [ ] **Step 3: Implement relationError**

Append to `server/src/props.js`:

```js
/** Why this relation edge is not allowed, or null when it is. */
export function relationError(prop, fromProjectId, toProjectId) {
  if (!prop) return 'unknown property';
  if (prop.type !== 'relation') return 'that property is not a relation';
  if (prop.project_id !== fromProjectId) return 'that property belongs to another database';
  if (prop.target_project_id !== toProjectId) return 'that row is not in the linked database';
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 5: Add the schema**

In `server/src/db.js`, directly after the `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS props …` line:

```sql
    -- Relation values are edges, not JSON: the foreign keys clear every edge
    -- pointing at a row that gets deleted, so no page renders a dead link.
    CREATE TABLE IF NOT EXISTS task_relations (
      prop_id TEXT NOT NULL REFERENCES db_props(id) ON DELETE CASCADE,
      from_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      to_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (prop_id, from_id, to_id)
    );
    -- "which rows point at me" is what a row page asks on every open.
    CREATE INDEX IF NOT EXISTS task_relations_to_idx ON task_relations(to_id);
```

- [ ] **Step 6: Add the relation and detail routes**

Append inside `registerPropRoutes` in `server/src/props-routes.js`:

```js
  const RELATED = `
    SELECT t.id, t.title, t.project_id, p.name AS project_name, t.doc_id
      FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE t.deleted_at IS NULL`;

  async function edgeContext(taskId, propId, toId) {
    const { rows } = await pool.query(
      'SELECT id, project_id FROM tasks WHERE id = ANY($1) AND deleted_at IS NULL',
      [[taskId, toId]]
    );
    const from = rows.find((r) => r.id === taskId);
    const to = rows.find((r) => r.id === toId);
    if (!from || !to) return { error: 'not found', status: 404 };
    const { rows: props } = await pool.query('SELECT * FROM db_props WHERE id = $1', [propId]);
    const bad = relationError(props[0] ?? null, from.project_id, to.project_id);
    return bad ? { error: bad, status: 400 } : { ok: true };
  }

  app.post('/api/tasks/:id/relations', requireUser, wrap(async (req, res) => {
    const { propId, toId } = req.body || {};
    if (!propId || !toId) return res.status(400).json({ error: 'propId and toId required' });
    const ctx = await edgeContext(req.params.id, propId, toId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    await pool.query(
      `INSERT INTO task_relations (prop_id, from_id, to_id) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [propId, req.params.id, toId]
    );
    res.json({ ok: true });
  }));

  app.delete('/api/tasks/:id/relations', requireUser, wrap(async (req, res) => {
    const { propId, toId } = req.body || {};
    await pool.query(
      'DELETE FROM task_relations WHERE prop_id = $1 AND from_id = $2 AND to_id = $3',
      [propId, req.params.id, toId]
    );
    res.json({ ok: true });
  }));

  app.get('/api/tasks/:id', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT * FROM tasks WHERE id = $1 AND deleted_at IS NULL', [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    const { rows: out } = await pool.query(
      `${RELATED} AND t.id IN (SELECT to_id FROM task_relations WHERE from_id = $1)`,
      [req.params.id]
    );
    const { rows: edges } = await pool.query(
      'SELECT prop_id, to_id FROM task_relations WHERE from_id = $1', [req.params.id]
    );
    const { rows: backlinks } = await pool.query(
      `${RELATED} AND t.id IN (SELECT from_id FROM task_relations WHERE to_id = $1)`,
      [req.params.id]
    );
    const byId = new Map(out.map((r) => [r.id, r]));
    const relations = {};
    for (const e of edges) {
      const row = byId.get(e.to_id);
      if (row) (relations[e.prop_id] ||= []).push(row);
    }
    res.json({ ...rows[0], relations, backlinks });
  }));
```

and extend the import at the top of the file:

```js
import { PROP_TYPES, propKey, canChangeType, normalizeOptions, relationError } from './props.js';
```

- [ ] **Step 7: Manual check**

```bash
docker compose up -d --build
# two projects, one relation property, one edge
A=$(curl -s -b /tmp/mn.jar -X POST http://localhost:8092/api/projects -H 'Content-Type: application/json' -d '{"name":"Rel A"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
B=$(curl -s -b /tmp/mn.jar -X POST http://localhost:8092/api/projects -H 'Content-Type: application/json' -d '{"name":"Rel B"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
RP=$(curl -s -b /tmp/mn.jar -X POST http://localhost:8092/api/projects/$A/props -H 'Content-Type: application/json' -d "{\"label\":\"Blocks\",\"type\":\"relation\",\"targetProjectId\":\"$B\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
TA=$(curl -s -b /tmp/mn.jar -X POST http://localhost:8092/api/tasks -H 'Content-Type: application/json' -d "{\"projectId\":\"$A\",\"title\":\"row a\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
TB=$(curl -s -b /tmp/mn.jar -X POST http://localhost:8092/api/tasks -H 'Content-Type: application/json' -d "{\"projectId\":\"$B\",\"title\":\"row b\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
curl -s -b /tmp/mn.jar -X POST http://localhost:8092/api/tasks/$TA/relations -H 'Content-Type: application/json' -d "{\"propId\":\"$RP\",\"toId\":\"$TB\"}"
curl -s -b /tmp/mn.jar http://localhost:8092/api/tasks/$TB   # backlinks should list "row a"
curl -s -b /tmp/mn.jar -X DELETE http://localhost:8092/api/tasks/$TB
curl -s -b /tmp/mn.jar http://localhost:8092/api/tasks/$TA   # relations must be empty, not a dead id
```
Expected: `GET /api/tasks/$TB` shows `row a` under `backlinks`; after deleting `$TB` the `relations` object on `$TA` is `{}`.

Note: `DELETE /api/tasks/:id` is a soft delete (`deleted_at`), so the edge row survives in the table — the `RELATED` query filters `deleted_at IS NULL`, which is why the response is empty. That is the intended behaviour: undeleting the row brings the link back.

- [ ] **Step 8: Commit**

```bash
git add server/src/db.js server/src/props.js server/src/props.test.js server/src/props-routes.js
git commit -m "feat(api): relations between database rows"
```

---

### Task 4: A row's page

**Files:**
- Modify: `server/src/index.js` (export `createDocRow`; accept `kind: 'task'`; title sync on `PATCH /api/docs/:id`)
- Modify: `server/src/tasks.js` (`POST /api/tasks/:id/page`, title sync on task patch)
- Modify: `server/src/props.js` + `server/src/props.test.js` (pure `docKind` helper)

**Interfaces:**
- Consumes: `createDocRow({ title, icon, userId, folderId, visibility, kind, content })`, passed into `registerTaskRoutes` as an option. It is **not** imported from `index.js` — `index.js` already imports `tasks.js`, so importing back would make the module graph cyclic.
- Produces:
  - `docKind(value: unknown): 'doc' | 'design' | 'task'` in `props.js`
  - `POST /api/tasks/:id/page` → `{ docId: string }`, idempotent.

- [ ] **Step 1: Write the failing test**

Add to `server/src/props.test.js`:

```js
import { docKind } from './props.js';

test('docKind accepts the three kinds and falls back to doc', () => {
  assert.equal(docKind('design'), 'design');
  assert.equal(docKind('task'), 'task');
  assert.equal(docKind('doc'), 'doc');
  assert.equal(docKind('nonsense'), 'doc');
  assert.equal(docKind(undefined), 'doc');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test`
Expected: FAIL — `docKind is not a function`.

- [ ] **Step 3: Implement docKind**

Append to `server/src/props.js`:

```js
/** A document is a page, a design opens on the canvas, a task is a row's page. */
export function docKind(value) {
  return value === 'design' || value === 'task' ? value : 'doc';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 5: Let a document be created as a row page**

In `server/src/index.js`:

1. Import the helper beside the other imports near line 38:
   ```js
   import { docKind } from './props.js';
   ```
2. Pass the creator into the task routes — change line 1971 to:
   ```js
   registerTaskRoutes(app, { requireUser, wrap, createDocRow });
   ```
3. In `app.post('/api/docs', …)`, replace the `kind:` line with:
   ```js
     kind: docKind(req.body?.kind),
   ```
4. In `app.patch('/api/docs/:id', …)`, after the `await pool.query(…UPDATE docs SET…)` call and before `res.json({ ok: true })`, mirror a title change back onto the row that owns this page:
   ```js
   if (typeof req.body?.title === 'string') {
     // The row and its page show the same title. Write only when it differs,
     // which is what stops the two updates looping.
     await pool.query(
       'UPDATE tasks SET title = $1 WHERE doc_id = $2 AND title <> $1',
       [req.body.title.slice(0, 500), req.params.id]
     );
   }
   ```

- [ ] **Step 6: Add the page route and the other direction of the sync**

In `server/src/tasks.js`:

1. Take the creator from the options object — the pattern the file already uses for `requireUser` and `wrap`:
   ```js
   export function registerTaskRoutes(app, { requireUser, wrap, createDocRow }) {
   ```

2. Add the route inside `registerTaskRoutes`:
   ```js
   app.post('/api/tasks/:id/page', requireUser, wrap(async (req, res) => {
     const { rows } = await pool.query(
       'SELECT id, title, doc_id FROM tasks WHERE id = $1 AND deleted_at IS NULL',
       [req.params.id]
     );
     if (!rows[0]) return res.status(404).json({ error: 'not found' });
     // Idempotent: a second call returns the page the first one made.
     if (rows[0].doc_id) return res.json({ docId: rows[0].doc_id });
     const doc = await createDocRow({
       title: rows[0].title || 'Untitled',
       icon: '📄',
       userId: req.user.id,
       folderId: null,
       visibility: 'team',
       kind: 'task',
       content: null,
     });
     await pool.query('UPDATE tasks SET doc_id = $1 WHERE id = $2', [doc.id, req.params.id]);
     res.json({ docId: doc.id });
   }));
   ```

3. In `app.patch('/api/tasks/:id', …)`, immediately after the successful `UPDATE tasks …` (just before `res.json(rows[0])`):
   ```js
   if (b.title !== undefined && rows[0].doc_id) {
     await pool.query(
       'UPDATE docs SET title = $1, updated_at = now() WHERE id = $2 AND title <> $1',
       [String(b.title).slice(0, 200), rows[0].doc_id]
     );
   }
   ```

- [ ] **Step 7: Manual check**

```bash
docker compose up -d --build
T=$(curl -s -b /tmp/mn.jar -X POST http://localhost:8092/api/tasks -H 'Content-Type: application/json' -d "{\"projectId\":\"$P\",\"title\":\"page check\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
curl -s -b /tmp/mn.jar -X POST http://localhost:8092/api/tasks/$T/page
curl -s -b /tmp/mn.jar -X POST http://localhost:8092/api/tasks/$T/page   # same docId
D=$(curl -s -b /tmp/mn.jar -X POST http://localhost:8092/api/tasks/$T/page | python3 -c 'import json,sys;print(json.load(sys.stdin)["docId"])')
curl -s -b /tmp/mn.jar -X PATCH http://localhost:8092/api/tasks/$T -H 'Content-Type: application/json' -d '{"title":"renamed from the row"}'
curl -s -b /tmp/mn.jar http://localhost:8092/api/docs | python3 -c "import json,sys;print([d['title'] for d in json.load(sys.stdin) if d['id']=='$D'])"
curl -s -b /tmp/mn.jar -X PATCH http://localhost:8092/api/docs/$D -H 'Content-Type: application/json' -d '{"title":"renamed from the page"}'
curl -s -b /tmp/mn.jar http://localhost:8092/api/projects/$P/tasks | python3 -c "import json,sys;print([t['title'] for t in json.load(sys.stdin) if t['id']=='$T'])"
```
Expected: both `POST …/page` calls return the same `docId`; the document title follows the row rename, and the row title follows the page rename.

- [ ] **Step 8: Commit**

```bash
git add server/src/index.js server/src/tasks.js server/src/props.js server/src/props.test.js
git commit -m "feat(api): every row gets its own page"
```

---

### Task 5: Sub-databases

**Files:**
- Modify: `server/src/db.js` (DDL)
- Create: `server/src/project-tree.js`
- Create: `server/src/project-tree.test.js`
- Modify: `server/src/tasks.js` (`GET /api/projects` returns `parent_id`; `POST /api/projects/:id/move`; `POST /api/projects` accepts `parentId`)

**Interfaces:**
- Consumes: nothing.
- Produces: `wouldProjectCycle(parents: Map<string, string|null>, id: string, newParentId: string|null): boolean`, and `POST /api/projects/:id/move` `{ parentId, position? }` → `ProjectRow`.

- [ ] **Step 1: Write the failing test**

Create `server/src/project-tree.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wouldProjectCycle } from './project-tree.js';

test('wouldProjectCycle rejects self and descendant parents', () => {
  const parents = new Map([['a', null], ['b', 'a'], ['c', 'b']]);
  assert.equal(wouldProjectCycle(parents, 'b', 'b'), true);
  assert.equal(wouldProjectCycle(parents, 'a', 'c'), true);
  assert.equal(wouldProjectCycle(parents, 'c', 'a'), false);
  assert.equal(wouldProjectCycle(parents, 'c', null), false);
});

test('wouldProjectCycle terminates on an already-cyclic graph', () => {
  const parents = new Map([['x', 'y'], ['y', 'x']]);
  assert.equal(wouldProjectCycle(parents, 'z', 'x'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module './project-tree.js'`.

- [ ] **Step 3: Implement the guard**

Create `server/src/project-tree.js`:

```js
/**
 * Would parenting `id` under `newParentId` close a loop? Walks up from the
 * proposed parent; reaching `id` means the move would swallow its own
 * ancestor. `seen` also makes this terminate on data that is already cyclic.
 *
 * Same shape as wouldFolderCycle in folders.js — folders and databases are
 * separate trees, so they get separate guards rather than a shared generic one.
 */
export function wouldProjectCycle(parents, id, newParentId) {
  let cur = newParentId;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    if (cur === id) return true;
    seen.add(cur);
    cur = parents.get(cur) ?? null;
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 5: Add the schema**

In `server/src/db.js`, directly after the `task_relations` block:

```sql
    -- A database can nest under another, the way folders and pages already do.
    -- NULL is top level. Cascade: a sub-database has no meaning without its
    -- parent, and its rows already cascade from projects.
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS parent_id TEXT
      REFERENCES projects(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS projects_parent_idx ON projects(parent_id, position);
```

- [ ] **Step 6: Accept and expose the parent**

In `server/src/tasks.js`:

1. `GET /api/projects` already selects `p.*`, so `parent_id` ships automatically. Change only the ordering so children sort under their parents predictably:
   ```js
        ORDER BY p.parent_id NULLS FIRST, p.position ASC, p.created_at ASC`
   ```
2. In `app.post('/api/projects', …)`, add `parent_id` to the insert:
   ```js
       `INSERT INTO projects (id, name, icon, color, doc_id, parent_id, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
       [
         id,
         String(req.body?.name || 'Untitled project').slice(0, 200),
         String(req.body?.icon || '📋').slice(0, 8),
         String(req.body?.color || 'blue').slice(0, 20),
         req.body?.docId || null,
         req.body?.parentId || null,
         req.user.id,
       ]
   ```
3. Add the move route, registered **before** `app.patch('/api/projects/:id', …)` so `move` is never read as a project id:
   ```js
   app.post('/api/projects/:id/move', requireUser, wrap(async (req, res) => {
     const parentId = typeof req.body?.parentId === 'string' ? req.body.parentId : null;
     const { rows: all } = await pool.query('SELECT id, parent_id FROM projects WHERE archived_at IS NULL');
     const parents = new Map(all.map((r) => [r.id, r.parent_id]));
     if (!parents.has(req.params.id)) return res.status(404).json({ error: 'not found' });
     if (parentId && !parents.has(parentId)) return res.status(400).json({ error: 'unknown parent' });
     if (wouldProjectCycle(parents, req.params.id, parentId)) {
       return res.status(400).json({ error: 'that would put a database inside itself' });
     }
     const { rows } = await pool.query(
       `UPDATE projects SET parent_id = $1, position = $2 WHERE id = $3 RETURNING *`,
       [parentId, Number(req.body?.position) || 0, req.params.id]
     );
     res.json(rows[0]);
   }));
   ```
4. Import the guard at the top of the file:
   ```js
   import { wouldProjectCycle } from './project-tree.js';
   ```

- [ ] **Step 7: Manual check**

```bash
docker compose up -d --build
curl -s -b /tmp/mn.jar -X POST http://localhost:8092/api/projects/$B/move -H 'Content-Type: application/json' -d "{\"parentId\":\"$A\"}"
curl -s -b /tmp/mn.jar -X POST http://localhost:8092/api/projects/$A/move -H 'Content-Type: application/json' -d "{\"parentId\":\"$B\"}"
```
Expected: the first call returns the row with `parent_id` set to `$A`; the second returns `400` with `that would put a database inside itself`.

- [ ] **Step 8: Commit**

```bash
git add server/src/db.js server/src/project-tree.js server/src/project-tree.test.js server/src/tasks.js
git commit -m "feat(api): databases nest under databases"
```

---

### Task 6: Client API and types

**Files:**
- Modify: `web-react/src/lib/tasksApi.ts`
- Modify: `web-react/src/lib/docsApi.ts` (folder favorite call — used in Task 12; added here so the API layer lands in one commit)

**Interfaces:**
- Consumes: the endpoints from Tasks 2–5.
- Produces, on `tasksApi`:
  - `props(projectId: string): Promise<PropRow[]>`
  - `createProp(projectId: string, b: { label: string; type?: PropType; options?: PropOption[]; targetProjectId?: string }): Promise<PropRow>`
  - `patchProp(id: string, b: Partial<{ label: string; type: PropType; options: PropOption[]; position: number; targetProjectId: string | null }>): Promise<PropRow>`
  - `deleteProp(id: string): Promise<{ ok: true }>`
  - `task(id: string): Promise<TaskDetail>`
  - `addRelation(id: string, propId: string, toId: string): Promise<{ ok: true }>`
  - `removeRelation(id: string, propId: string, toId: string): Promise<{ ok: true }>`
  - `taskPage(id: string): Promise<{ docId: string }>`
  - `moveProject(id: string, b: { parentId: string | null; position?: number }): Promise<ProjectRow>`
  - `createProject` gains `parentId?: string | null`
  - `TaskPatch` gains `props?: Record<string, unknown>`
  - `ProjectRow` gains `parent_id: string | null`
- And on `docsApi`: `favoriteFolder(id: string, favorite: boolean)`.

- [ ] **Step 1: Add the types**

In `web-react/src/lib/tasksApi.ts`, above `export interface TaskRow`:

```ts
export type PropType =
  | 'text' | 'number' | 'select' | 'multi_select'
  | 'date' | 'checkbox' | 'person' | 'url' | 'relation';

export const PROP_TYPES: PropType[] = [
  'text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'person', 'url', 'relation',
];

export const PROP_TYPE_LABEL: Record<PropType, string> = {
  text: 'Text', number: 'Number', select: 'Select', multi_select: 'Multi-select',
  date: 'Date', checkbox: 'Checkbox', person: 'Person', url: 'URL', relation: 'Relation',
};

export interface PropOption {
  id: string;
  label: string;
  color: string;
}

export interface PropRow {
  id: string;
  project_id: string;
  key: string;
  label: string;
  type: PropType;
  options: PropOption[];
  target_project_id: string | null;
  position: number;
}

/** A row in another database, as shown on a relation chip. */
export interface RelatedRow {
  id: string;
  title: string;
  project_id: string;
  project_name: string;
  doc_id: string | null;
}

export interface TaskDetail extends TaskRow {
  relations: Record<string, RelatedRow[]>;
  backlinks: RelatedRow[];
}
```

Add `props: Record<string, unknown>;` to `TaskRow`, `parent_id: string | null;` to `ProjectRow`, and `props?: Record<string, unknown>;` to `TaskPatch`.

- [ ] **Step 2: Add the calls**

In the `tasksApi` object in the same file:

```ts
  props: (projectId: string): Promise<PropRow[]> => req(`/projects/${projectId}/props`),
  createProp: (
    projectId: string,
    b: { label: string; type?: PropType; options?: PropOption[]; targetProjectId?: string },
  ): Promise<PropRow> => req(`/projects/${projectId}/props`, { method: 'POST', ...body(b) }),
  patchProp: (
    id: string,
    b: Partial<{ label: string; type: PropType; options: PropOption[]; position: number; targetProjectId: string | null }>,
  ): Promise<PropRow> => req(`/props/${id}`, { method: 'PATCH', ...body(b) }),
  deleteProp: (id: string) => req(`/props/${id}`, { method: 'DELETE' }),

  task: (id: string): Promise<TaskDetail> => req(`/tasks/${id}`),
  addRelation: (id: string, propId: string, toId: string) =>
    req(`/tasks/${id}/relations`, { method: 'POST', ...body({ propId, toId }) }),
  removeRelation: (id: string, propId: string, toId: string) =>
    req(`/tasks/${id}/relations`, { method: 'DELETE', ...body({ propId, toId }) }),
  /** Creates the row's page on first call, returns the same id after that. */
  taskPage: (id: string): Promise<{ docId: string }> => req(`/tasks/${id}/page`, { method: 'POST' }),

  moveProject: (id: string, b: { parentId: string | null; position?: number }): Promise<ProjectRow> =>
    req(`/projects/${id}/move`, { method: 'POST', ...body(b) }),
```

and widen `createProject`:

```ts
  createProject: (b: { name: string; icon?: string; color?: string; docId?: string; parentId?: string | null }): Promise<ProjectRow> =>
    req('/projects', { method: 'POST', ...body(b) }),
```

- [ ] **Step 3: Add the folder favorite call**

In `web-react/src/lib/docsApi.ts`, beside `favorite:` (line 235):

```ts
  favoriteFolder: (id: string, favorite: boolean) =>
    req(`/folders/${id}/favorite`, { method: 'PUT', body: JSON.stringify({ favorite }) }),
```

and add `favorite: boolean;` to `FolderRow`.

- [ ] **Step 4: Verify it compiles**

Run: `cd web-react && npm run build`
Expected: build succeeds. (`TaskRow.props` is new and required — if any existing construction of a `TaskRow` literal fails to compile, add `props: {}` there rather than making the field optional.)

- [ ] **Step 5: Commit**

```bash
git add web-react/src/lib/tasksApi.ts web-react/src/lib/docsApi.ts
git commit -m "feat(web): api client for properties and pages"
```

---

### Task 7: Property value formatting

**Files:**
- Create: `web-react/src/lib/props.ts`
- Create: `web-react/src/lib/props.test.ts`

**Interfaces:**
- Consumes: `PropRow`, `PropOption`, `PropType` from `./tasksApi`.
- Produces:
  - `formatPropValue(prop: PropRow, value: unknown, users?: { id: string; name: string }[]): string`
  - `selectedOptions(prop: PropRow, value: unknown): PropOption[]`
  - `emptyValue(type: PropType): unknown`

- [ ] **Step 1: Write the failing test**

Create `web-react/src/lib/props.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatPropValue, selectedOptions, emptyValue } from './props';
import type { PropRow } from './tasksApi';

const prop = (over: Partial<PropRow>): PropRow => ({
  id: 'p1', project_id: 'A', key: 'k', label: 'L', type: 'text',
  options: [], target_project_id: null, position: 0, ...over,
});

describe('formatPropValue', () => {
  it('renders each type in a table cell', () => {
    expect(formatPropValue(prop({}), 'hi')).toBe('hi');
    expect(formatPropValue(prop({ type: 'number' }), 3)).toBe('3');
    expect(formatPropValue(prop({ type: 'checkbox' }), true)).toBe('Yes');
    expect(formatPropValue(prop({ type: 'checkbox' }), false)).toBe('No');
    expect(formatPropValue(prop({ type: 'date' }), '2026-08-29')).toBe('2026-08-29');
  });

  it('resolves a person to a name and falls back to the raw id', () => {
    const p = prop({ type: 'person' });
    expect(formatPropValue(p, 'u1', [{ id: 'u1', name: 'Ada' }])).toBe('Ada');
    expect(formatPropValue(p, 'u9', [{ id: 'u1', name: 'Ada' }])).toBe('u9');
  });

  it('shows an empty string for a missing value', () => {
    expect(formatPropValue(prop({}), null)).toBe('');
    expect(formatPropValue(prop({ type: 'multi_select' }), undefined)).toBe('');
  });
});

describe('selectedOptions', () => {
  const p = prop({
    type: 'multi_select',
    options: [
      { id: 'o1', label: 'High', color: 'red' },
      { id: 'o2', label: 'Low', color: 'gray' },
    ],
  });

  it('maps stored ids to option rows', () => {
    expect(selectedOptions(p, ['o2', 'o1']).map((o) => o.label)).toEqual(['Low', 'High']);
  });

  it('drops an id whose option was deleted instead of throwing', () => {
    expect(selectedOptions(p, ['o1', 'gone']).map((o) => o.id)).toEqual(['o1']);
  });

  it('accepts a single select value as well as an array', () => {
    expect(selectedOptions(prop({ type: 'select', options: p.options }), 'o1')).toHaveLength(1);
  });
});

describe('emptyValue', () => {
  it('gives each type the value that means "not set"', () => {
    expect(emptyValue('checkbox')).toBe(false);
    expect(emptyValue('multi_select')).toEqual([]);
    expect(emptyValue('text')).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web-react && npm test`
Expected: FAIL — cannot resolve `./props`.

- [ ] **Step 3: Implement**

Create `web-react/src/lib/props.ts`:

```ts
import type { PropOption, PropRow, PropType } from './tasksApi';

/** Ids a select/multi-select value holds, as an array either way. */
function ids(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return typeof value === 'string' && value ? [value] : [];
}

/** The options a value selects. An id whose option was deleted is dropped —
 *  the value stays in the database, so restoring the option restores the chip. */
export function selectedOptions(prop: PropRow, value: unknown): PropOption[] {
  const byId = new Map(prop.options.map((o) => [o.id, o]));
  return ids(value).map((id) => byId.get(id)).filter((o): o is PropOption => !!o);
}

/** One line of text for a table cell or a collapsed peek row. */
export function formatPropValue(
  prop: PropRow,
  value: unknown,
  users: { id: string; name: string }[] = [],
): string {
  if (value === null || value === undefined || value === '') {
    return prop.type === 'checkbox' ? 'No' : '';
  }
  switch (prop.type) {
    case 'checkbox':
      return value ? 'Yes' : 'No';
    case 'select':
    case 'multi_select':
      return selectedOptions(prop, value).map((o) => o.label).join(', ');
    case 'person':
      return users.find((u) => u.id === value)?.name ?? String(value);
    default:
      return String(value);
  }
}

/** What "not set" looks like per type, for a freshly rendered editor. */
export function emptyValue(type: PropType): unknown {
  if (type === 'checkbox') return false;
  if (type === 'multi_select') return [];
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web-react && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web-react/src/lib/props.ts web-react/src/lib/props.test.ts
git commit -m "feat(web): format database property values"
```

---

### Task 8: Property editors, the properties dialog, and table columns

**Files:**
- Create: `web-react/src/components/project/props/PropertyValue.tsx`
- Create: `web-react/src/components/project/props/PropsDialog.tsx`
- Modify: `web-react/src/components/project/useProject.ts` (load and mutate props)
- Modify: `web-react/src/components/project/TaskTable.tsx` (custom columns)
- Modify: `web-react/src/components/project/ProjectView.tsx` (menu entry + wiring)

**Interfaces:**
- Consumes: `tasksApi.props/createProp/patchProp/deleteProp`, `formatPropValue`, `selectedOptions`, `emptyValue`.
- Produces:
  - `<PropertyValue prop users value onChange />` — one editor for any property type except `relation` (relations render in the peek, Task 9).
  - `<PropsDialog open onOpenChange props projects onCreate onPatch onDelete />`
  - `useProject` gains `props: PropRow[]`, `createProp`, `patchProp`, `deleteProp`, and `setProp(taskId, propId, value)`.

- [ ] **Step 1: Write the property editor**

Create `web-react/src/components/project/props/PropertyValue.tsx`:

```tsx
import type { UserRow } from '../../../lib/docsApi';
import { cn } from '../../../lib/cn';
import { selectedOptions } from '../../../lib/props';
import type { PropRow } from '../../../lib/tasksApi';
import { field } from '../../ui/styles';

interface Props {
  prop: PropRow;
  users: UserRow[];
  value: unknown;
  onChange: (value: unknown) => void;
}

/** One editor per property type. Relations are edges, not values, so they are
 *  rendered by the peek rather than here. */
export function PropertyValue({ prop, users, value, onChange }: Props) {
  switch (prop.type) {
    case 'number':
      return (
        <input
          type="number"
          className={field}
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'checkbox':
      return (
        <input
          type="checkbox"
          className="h-4 w-4 accent-accent"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case 'date':
      return (
        <input
          type="date"
          className={field}
          value={typeof value === 'string' ? value.slice(0, 10) : ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case 'person':
      return (
        <select className={field} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Nobody</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.username}</option>)}
        </select>
      );
    case 'select':
      return (
        <select className={field} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Empty</option>
          {prop.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      );
    case 'multi_select': {
      const chosen = new Set(selectedOptions(prop, value).map((o) => o.id));
      return (
        <div className="flex flex-wrap gap-1">
          {prop.options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                const next = new Set(chosen);
                if (next.has(o.id)) next.delete(o.id); else next.add(o.id);
                onChange([...next]);
              }}
              className={cn(
                'rounded-full border border-line px-2 py-0.5 text-2xs',
                chosen.has(o.id) ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover',
              )}
            >
              {o.label}
            </button>
          ))}
          {!prop.options.length && <span className="text-2xs text-faint">No options yet.</span>}
        </div>
      );
    }
    case 'url':
      return (
        <input
          type="url"
          placeholder="https://"
          className={field}
          defaultValue={typeof value === 'string' ? value : ''}
          onBlur={(e) => e.target.value !== value && onChange(e.target.value || null)}
        />
      );
    default:
      return (
        <input
          className={field}
          defaultValue={typeof value === 'string' ? value : ''}
          onBlur={(e) => e.target.value !== value && onChange(e.target.value || null)}
        />
      );
  }
}
```

- [ ] **Step 2: Write the properties dialog**

Create `web-react/src/components/project/props/PropsDialog.tsx`, modelled on `TaskKindsDialog.tsx` (read that file first and match its layout, button styles and error handling):

```tsx
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PROP_TYPES, PROP_TYPE_LABEL, type PropRow, type PropType, type ProjectRow } from '../../../lib/tasksApi';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { Modal } from '../../ui/Modal';
import { field } from '../../ui/styles';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  props: PropRow[];
  projects: ProjectRow[];
  onCreate: (b: { label: string; type: PropType; targetProjectId?: string }) => Promise<string | null>;
  onPatch: (id: string, b: Partial<{ label: string; options: PropRow['options'] }>) => void;
  onDelete: (id: string) => void;
}

/** Add, rename and delete a database's columns. */
export function PropsDialog({ open, onOpenChange, props, projects, onCreate, onPatch, onDelete }: Props) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<PropType>('text');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const err = await onCreate({ label, type, ...(type === 'relation' ? { targetProjectId: target } : {}) });
    if (err) return setError(err);
    setLabel('');
    setError(null);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Properties" width={520}>
      <div className="space-y-2 p-4">
        {props.map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <input
              className={field}
              defaultValue={p.label}
              onBlur={(e) => e.target.value !== p.label && onPatch(p.id, { label: e.target.value })}
            />
            <span className="w-28 shrink-0 text-2xs text-muted">{PROP_TYPE_LABEL[p.type]}</span>
            <IconButton icon={<Trash2 size={14} />} label={`Delete ${p.label}`} onClick={() => onDelete(p.id)} />
          </div>
        ))}
        {!props.length && <p className="text-sm text-faint">No custom properties yet.</p>}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <input
            className={field}
            placeholder="Property name…"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <select className={field} value={type} onChange={(e) => setType(e.target.value as PropType)}>
            {PROP_TYPES.map((t) => <option key={t} value={t}>{PROP_TYPE_LABEL[t]}</option>)}
          </select>
          {type === 'relation' && (
            <select className={field} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Link to…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={add}>Add</Button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
```

Adding a `select` or `multi_select` property creates it with no options; options are added by editing the property's `options` through `onPatch` — wire a small comma-separated input beside such a row, following the same `onBlur` pattern as the label field:

```tsx
{(p.type === 'select' || p.type === 'multi_select') && (
  <input
    className={field}
    placeholder="Options, comma separated"
    defaultValue={p.options.map((o) => o.label).join(', ')}
    onBlur={(e) => onPatch(p.id, {
      options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).map((labelText) => {
        const existing = p.options.find((o) => o.label === labelText);
        return existing ?? { id: crypto.randomUUID(), label: labelText, color: 'gray' };
      }),
    })}
  />
)}
```

- [ ] **Step 3: Load and mutate properties in useProject**

In `web-react/src/components/project/useProject.ts`:

1. Add `const [props, setProps] = useState<PropRow[]>([]);`
2. Fetch them in `refresh`, alongside the existing three:
   ```ts
   const [t, s, k, pr] = await Promise.all([
     tasksApi.projectTasks(projectId),
     tasksApi.sprints(projectId).catch(() => [] as SprintRow[]),
     tasksApi.kinds(projectId).catch(() => [] as TaskKindRow[]),
     tasksApi.props(projectId).catch(() => [] as PropRow[]),
   ]);
   setProps(pr);
   ```
3. Add the mutators, following the optimistic-then-resync pattern the file already uses:
   ```ts
   const setProp = useCallback(async (taskId: string, propId: string, value: unknown) => {
     setTasks((prev) => prev.map((t) => (t.id === taskId
       ? { ...t, props: { ...t.props, [propId]: value } } : t)));
     try {
       await tasksApi.patchTask(taskId, { props: { [propId]: value } });
     } catch (e) {
       setError(e instanceof Error ? e.message : 'Could not save that property.');
       refresh();
     }
   }, [refresh]);

   /** Resolves with an error message, or null on success. */
   const createProp = useCallback(async (b: { label: string; type: PropType; targetProjectId?: string }) => {
     if (!projectId) return 'No database is open.';
     try {
       setProps((prev) => [...prev, await tasksApi.createProp(projectId, b)]);
       return null;
     } catch (e) {
       return e instanceof Error ? e.message : 'Could not add that property.';
     }
   }, [projectId]);

   const patchProp = useCallback(async (id: string, b: Partial<{ label: string; options: PropOption[] }>) => {
     const before = props;
     setProps((prev) => prev.map((p) => (p.id === id ? { ...p, ...b } as PropRow : p)));
     try {
       const row = await tasksApi.patchProp(id, b);
       setProps((prev) => prev.map((p) => (p.id === id ? row : p)));
     } catch {
       setProps(before);
     }
   }, [props]);

   const deleteProp = useCallback(async (id: string) => {
     setProps((prev) => prev.filter((p) => p.id !== id));
     setTasks((prev) => prev.map((t) => {
       const { [id]: _gone, ...rest } = t.props;
       return { ...t, props: rest };
     }));
     await tasksApi.deleteProp(id).catch(() => refresh());
   }, [refresh]);
   ```
4. Return `props, setProp, createProp, patchProp, deleteProp` from the hook.

- [ ] **Step 4: Render custom columns in the table**

In `web-react/src/components/project/TaskTable.tsx`, add `props: PropRow[]` and `onSetProp: (taskId: string, propId: string, value: unknown) => void` to `Props`, render one `<th>` per property after `Progress`, and one `<td>` per property in each row:

```tsx
{props.map((p) => (
  <th key={p.id} className={cn(cell, 'font-semibold')}>{p.label}</th>
))}
```

```tsx
{props.map((p) => (
  <td key={p.id} className={cell}>
    {p.type === 'relation' ? (
      <button type="button" onClick={() => onOpen(t)} className="text-2xs text-muted hover:text-accent">
        Open row
      </button>
    ) : (
      <PropertyValue
        prop={p}
        users={users}
        value={t.props?.[p.id] ?? null}
        onChange={(v) => onSetProp(t.id, p.id, v)}
      />
    )}
  </td>
))}
```

- [ ] **Step 5: Wire it into ProjectView**

In `web-react/src/components/project/ProjectView.tsx`:
- `const [propsOpen, setPropsOpen] = useState(false);`
- pass `props={p.props}` and `onSetProp={p.setProp}` to `<TaskTable …/>`
- add `{ icon: Columns3, label: 'Properties…', onSelect: () => setPropsOpen(true) }` to the existing `Menu` items (import `Columns3` from `lucide-react`)
- render `<PropsDialog open={propsOpen} onOpenChange={setPropsOpen} props={p.props} projects={ws.projects} onCreate={p.createProp} onPatch={p.patchProp} onDelete={p.deleteProp} />`

- [ ] **Step 6: Verify**

Run: `cd web-react && npm test && npm run build`
Expected: both pass.

Then, with the stack running (`docker compose up -d --build`), open `http://localhost:8092`, pick a project, open **⋯ → Properties…**, add a `Select` property with options `High, Low`, close the dialog, switch to the Table tab and set the value on a row. Reload the page: the value is still there.

- [ ] **Step 7: Commit**

```bash
git add web-react/src/components/project
git commit -m "feat(web): custom columns in the table view"
```

---

### Task 9: The row peek and the row page

**Files:**
- Create: `web-react/src/components/project/TaskPeek.tsx`
- Delete: `web-react/src/components/project/TaskDialog.tsx`
- Modify: `web-react/src/components/project/ProjectView.tsx`
- Modify: `web-react/src/store/workspace.tsx` (row pages out of the sidebar root lists)
- Modify: `web-react/src/lib/types.ts` (`Page.kind` gains `'task'`)

**Interfaces:**
- Consumes: `tasksApi.taskPage`, `tasksApi.task`, `tasksApi.addRelation/removeRelation`, `<LazyEditor>` from `../../editor/LazyEditor`, `showDoc` from `../../lib/route`.
- Produces: `<TaskPeek task tasks props sprints users onClose onPatch onSetProp onDelete onAddDep onRemoveDep onManageKinds />`, replacing `TaskDialog` at every call site.

- [ ] **Step 1: Take the row pages out of the sidebar**

In `web-react/src/lib/types.ts`, widen the kind:

```ts
  /** A design opens on the canvas; a task is a database row's page. */
  kind: 'doc' | 'design' | 'task';
```

In `web-react/src/store/workspace.tsx`:
- line ~141, keep every kind the server sends:
  ```ts
      kind: r.kind === 'design' ? 'design' : r.kind === 'task' ? 'task' : 'doc',
  ```
- lines ~738 and ~780, exclude row pages from the root lists exactly as designs are excluded:
  ```ts
      .filter((p) => !p.folderId && !p.parentId && p.kind !== 'design' && p.kind !== 'task')
  ```
  Apply the same added clause to both filters. A row page is reachable by id (`/d/<id>`) and through search — it is only kept out of the tree, because it belongs to its row.

- [ ] **Step 2: Write the peek**

Create `web-react/src/components/project/TaskPeek.tsx`. Start from the body of `TaskDialog.tsx` — the type, status, assignee, sprint, date, points and dependency fields carry over unchanged — and add the three new parts:

```tsx
import { ExternalLink, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LazyEditor } from '../../editor/LazyEditor';
import { showDoc } from '../../lib/route';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import { tasksApi, type PropRow, type RelatedRow, type TaskDetail, type TaskRow } from '../../lib/tasksApi';
import { PropertyValue } from './props/PropertyValue';
import { IconButton } from '../ui/IconButton';
import { field } from '../ui/styles'; // used by RelationField below

// …Props interface as in TaskDialog, plus:
//   props: PropRow[];
//   onSetProp: (taskId: string, propId: string, value: unknown) => void;

export function TaskPeek({ task, props, users, onSetProp, onClose, /* …the rest as in TaskDialog */ }: Props) {
  const ws = useWorkspace();
  const auth = useAuth();
  const [docId, setDocId] = useState<string | null>(task?.doc_id ?? null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);

  // Opening the row is what creates its page — importing a thousand rows must
  // not create a thousand empty documents.
  useEffect(() => {
    if (!task) return;
    let alive = true;
    setDocId(task.doc_id);
    tasksApi.taskPage(task.id).then((r) => alive && setDocId(r.docId)).catch(() => {});
    tasksApi.task(task.id).then((d) => alive && setDetail(d)).catch(() => {});
    return () => { alive = false; };
  }, [task?.id]);

  if (!task) return null;

  return (
    <aside className="fixed right-0 top-0 z-40 flex h-full w-full max-w-[560px] flex-col border-l border-line bg-canvas shadow-modal">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
        {/* title input: same onBlur → onPatch(task.id, { title }) as TaskDialog */}
        <IconButton
          icon={<ExternalLink size={16} />}
          label="Open as page"
          disabled={!docId}
          onClick={() => { if (docId) { ws.select(docId); showDoc(docId); onClose(); } }}
        />
        <IconButton icon={<X size={16} />} label="Close" onClick={onClose} />
      </header>

      <div className="scrollarea min-h-0 flex-1 overflow-y-auto">
        {/* built-in fields, copied from TaskDialog */}

        <section className="space-y-3 border-t border-line p-4">
          {props.map((p) => (
            <div key={p.id} className="grid grid-cols-[120px_1fr] items-center gap-3">
              <span className="text-2xs font-medium text-muted">{p.label}</span>
              {p.type === 'relation'
                ? <RelationField task={task} prop={p} detail={detail} onChanged={setDetail} />
                : <PropertyValue prop={p} users={users} value={task.props?.[p.id] ?? null} onChange={(v) => onSetProp(task.id, p.id, v)} />}
            </div>
          ))}
        </section>

        {!!detail?.backlinks.length && (
          <section className="border-t border-line p-4">
            <h3 className="mb-2 text-2xs font-semibold uppercase text-muted">Linked from</h3>
            <ul className="space-y-1">
              {detail.backlinks.map((r) => (
                <li key={r.id} className="truncate text-sm text-ink">
                  <span className="text-faint">{r.project_name} · </span>{r.title || 'Untitled'}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="border-t border-line">
          {docId && (
            <LazyEditor
              docId={docId}
              title={task.title}
              mode="page"
              userName={auth.user?.name || 'You'}
              fullWidth
            />
          )}
        </section>
      </div>
    </aside>
  );
}
```

`RelationField` lives in the same file — a picker over the target database's rows plus a chip list:

```tsx
function RelationField({ task, prop, detail, onChanged }: {
  task: TaskRow;
  prop: PropRow;
  detail: TaskDetail | null;
  onChanged: (d: TaskDetail) => void;
}) {
  const [choices, setChoices] = useState<TaskRow[]>([]);
  const linked: RelatedRow[] = detail?.relations[prop.id] ?? [];

  useEffect(() => {
    if (!prop.target_project_id) return;
    tasksApi.projectTasks(prop.target_project_id).then(setChoices).catch(() => setChoices([]));
  }, [prop.target_project_id]);

  const refresh = () => tasksApi.task(task.id).then(onChanged).catch(() => {});

  return (
    <div className="min-w-0">
      <div className="mb-1 flex flex-wrap gap-1">
        {linked.map((r) => (
          <button
            key={r.id}
            type="button"
            title="Remove this link"
            onClick={() => tasksApi.removeRelation(task.id, prop.id, r.id).then(refresh)}
            className="rounded-full border border-line px-2 py-0.5 text-2xs text-ink hover:bg-hover"
          >
            {r.title || 'Untitled'} ×
          </button>
        ))}
      </div>
      <select
        className={field}
        value=""
        onChange={(e) => e.target.value && tasksApi.addRelation(task.id, prop.id, e.target.value).then(refresh)}
      >
        <option value="">Link a row…</option>
        {choices
          .filter((c) => !linked.some((l) => l.id === c.id))
          .map((c) => <option key={c.id} value={c.id}>{c.title || 'Untitled'}</option>)}
      </select>
    </div>
  );
}
```

- [ ] **Step 3: Swap the call site and delete the dialog**

In `ProjectView.tsx`, replace the `<TaskDialog … />` element with `<TaskPeek … />`, passing the same handlers plus `props={p.props}` and `onSetProp={p.setProp}`. Then:

```bash
git rm web-react/src/components/project/TaskDialog.tsx
```

Check nothing else imports it:

```bash
python3 -c "
import subprocess
print(subprocess.run(['grep','-rn','TaskDialog','web-react/src'],capture_output=True,text=True).stdout)
"
```
Expected: no output (the `TaskKindsDialog` import is a different symbol — make sure the grep result is genuinely empty of `TaskDialog` references, not of `TaskKindsDialog`).

- [ ] **Step 4: Verify**

Run: `cd web-react && npm test && npm run build`
Expected: both pass.

With the stack rebuilt, click a card on the board: the peek opens on the right with the properties and an editable body. Type into the body, close the peek, reopen it — the text is there. Click ↗: the app navigates to `/d/<id>` and shows the same document full width. Confirm the sidebar does **not** grow a loose page for it.

**Before verifying in a browser that has visited this app before, unregister the service worker and clear caches** (DevTools → Application → Service Workers → Unregister, then `caches.keys().then(ks => ks.forEach(k => caches.delete(k)))`), or the stale precache will serve the old bundle and the screenshot will lie.

- [ ] **Step 5: Commit**

```bash
git add web-react/src/components/project web-react/src/store/workspace.tsx web-react/src/lib/types.ts
git commit -m "feat(web): a row opens as a peek with its own page"
```

---

### Task 10: The database tree in the sidebar

**Files:**
- Modify: `web-react/src/components/sidebar/Sidebar.tsx` (Projects section renders a tree)
- Modify: `web-react/src/store/workspace.tsx` (`createProject(parentId)` helper if one is needed by the row menu)

**Interfaces:**
- Consumes: `ProjectRow.parent_id`, `tasksApi.createProject({ name, parentId })`.
- Produces: a recursive `ProjectRow` renderer inside `Sidebar.tsx` with a "New sub-database" action per row.

- [ ] **Step 1: Build the tree**

In `Sidebar.tsx`, replace the flat `ws.projects.map(…)` block with a recursive renderer. Keep the existing row markup exactly — icon, name, overdue/open count, `bg-accent-soft text-accent` when active — and add indentation plus a per-row menu:

```tsx
function ProjectRows({ parentId, depth }: { parentId: string | null; depth: number }) {
  const ws = useWorkspace();
  const [naming, setNaming] = useState(false);
  const kids = ws.projects.filter((p) => (p.parent_id ?? null) === parentId);
  if (!kids.length && !naming) return null;
  return (
    <>
      {kids.map((p) => {
        const open = Number(p.total) - Number(p.done);
        return (
          <div key={p.id}>
            <div className="group flex items-center">
              <button
                type="button"
                onClick={() => ws.openProject(p.id)}
                style={{ paddingLeft: 8 + depth * 12 }}
                className={cn(
                  'flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md pr-2 text-base leading-5 transition-colors duration-120',
                  ws.view === 'project' && ws.activeProjectId === p.id ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-hover',
                )}
              >
                <span className="text-md leading-none">{p.icon}</span>
                <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">{p.name}</span>
                {Number(p.overdue) > 0 ? (
                  <span className="shrink-0 text-2xs font-semibold text-danger">{p.overdue}</span>
                ) : open > 0 ? (
                  <span className="shrink-0 text-2xs text-faint">{open}</span>
                ) : null}
              </button>
              <button
                type="button"
                aria-label={`New database under ${p.name}`}
                onClick={() => setNaming(true)}
                className={cn(rowAction, 'opacity-0 group-hover:opacity-100')}
              >
                <Plus size={14} />
              </button>
            </div>
            <ProjectRows parentId={p.id} depth={depth + 1} />
          </div>
        );
      })}
    </>
  );
}
```

Hold the "which row is being named" state in the `Sidebar` component rather than per row — one `namingParent: string | null` is enough, and it keeps a single `RowInput` on screen:

```tsx
const [namingParent, setNamingParent] = useState<string | null | undefined>(undefined);
const createProject = async (name: string) => {
  const p = await tasksApi.createProject({ name, parentId: namingParent ?? null });
  await ws.refreshProjects();
  setNamingParent(undefined);
  ws.openProject(p.id);
};
```

`undefined` means no input is showing; `null` means "new top-level database"; a string means "new sub-database of that id". Render the existing `<RowInput>` when `namingParent !== undefined`.

- [ ] **Step 2: Verify**

Run: `cd web-react && npm run build`
Expected: build succeeds.

In the browser: hover a project row, click +, type a name. The new database appears indented under it, and clicking it opens its (empty) board.

- [ ] **Step 3: Commit**

```bash
git add web-react/src/components/sidebar/Sidebar.tsx
git commit -m "feat(web): nest databases in the sidebar"
```

---

### Task 11: The embedded database block

**Files:**
- Create: `web-react/src/editor/database/database-model.ts`
- Create: `web-react/src/editor/database/database-block.ts`
- Create: `web-react/src/editor/database/database-slash.ts`
- Create: `web-react/src/editor/database/spec.ts`
- Create: `web-react/src/editor/database/effects.ts`
- Create: `web-react/src/editor/database/index.ts`
- Modify: `web-react/src/editor/mountEditor.ts:34-35,133,352-353` (register schema and view extensions)

**Interfaces:**
- Consumes: `Board` and `TaskTable` from `../../components/project/`, `useProject`.
- Produces: flavour `metanoia:database` with props `{ projectId: string, view: 'board' | 'table' }`, exported as `databaseEffects`, `databaseViewExtensions`, `MetanoiaDatabaseBlockSchema`, `MetanoiaDatabaseBlockSchemaExtension`.

**Read `web-react/src/editor/chart/` first.** This block is the same construction with a different payload; deviating from that shape is what breaks in edgeless mode.

- [ ] **Step 1: Define the model**

Create `web-react/src/editor/database/database-model.ts`:

```ts
import type { GfxCommonBlockProps, GfxElementGeometry } from '@blocksuite/std/gfx';
import { GfxCompatible } from '@blocksuite/std/gfx';
import { BlockModel, BlockSchemaExtension, defineBlockSchema } from '@blocksuite/store';

export const DATABASE_FLAVOUR = 'metanoia:database';

export interface DatabaseBlockProps {
  /** The project (database) this view reads. Empty until one is picked. */
  projectId: string;
  view: 'board' | 'table';
  height: number;
}

export type MetanoiaDatabaseProps = DatabaseBlockProps & Omit<GfxCommonBlockProps, 'scale'>;

export function defaultDatabaseProps(): DatabaseBlockProps {
  return { projectId: '', view: 'table', height: 360 };
}

export const MetanoiaDatabaseBlockSchema = defineBlockSchema({
  flavour: DATABASE_FLAVOUR,
  props: (): MetanoiaDatabaseProps => ({
    ...defaultDatabaseProps(),
    index: 'a0',
    xywh: '[0,0,640,360]',
    lockedBySelf: false,
    rotate: 0,
  }),
  metadata: { version: 1, role: 'content' },
  toModel: () => new MetanoiaDatabaseBlockModel(),
});

export const MetanoiaDatabaseBlockSchemaExtension = BlockSchemaExtension(MetanoiaDatabaseBlockSchema);

export class MetanoiaDatabaseBlockModel
  extends GfxCompatible<MetanoiaDatabaseProps>(BlockModel)
  implements GfxElementGeometry {}

declare global {
  interface BlockSuiteModelMap {
    [DATABASE_FLAVOUR]: MetanoiaDatabaseBlockModel;
  }
}
```

- [ ] **Step 2: Render it**

Create `web-react/src/editor/database/database-block.ts`. It is a lit component that mounts a React root, because rendering the *same* `Board`/`TaskTable` components is what keeps an embedded view identical to the full one:

```ts
import { BlockComponent } from '@blocksuite/std';
import { html } from 'lit';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { EmbeddedDatabase } from '../../components/project/EmbeddedDatabase';
import type { MetanoiaDatabaseBlockModel } from './database-model';

export class MetanoiaDatabaseBlockComponent extends BlockComponent<MetanoiaDatabaseBlockModel> {
  private root: Root | null = null;

  override disconnectedCallback() {
    // React roots must be unmounted asynchronously — unmounting inside a
    // lifecycle callback while React is rendering throws.
    const root = this.root;
    this.root = null;
    if (root) queueMicrotask(() => root.unmount());
    super.disconnectedCallback();
  }

  override updated() {
    const host = this.querySelector('.mn-db-host');
    if (!host) return;
    this.root ??= createRoot(host);
    this.root.render(
      createElement(EmbeddedDatabase, {
        projectId: this.model.props.projectId,
        view: this.model.props.view,
        onPick: (projectId: string) => this.store.updateBlock(this.model, { projectId }),
        onView: (view: 'board' | 'table') => this.store.updateBlock(this.model, { view }),
      }),
    );
  }

  override renderBlock() {
    return html`
      <div class="mn-db" style=${`min-height:${this.model.props.height}px`} contenteditable="false">
        <div class="mn-db-host"></div>
      </div>`;
  }
}
```

Create `web-react/src/components/project/EmbeddedDatabase.tsx`: the picker when `projectId` is empty, the view when it is not, and a plain placeholder when the database is gone.

```tsx
import { useWorkspace } from '../../store/workspace';
import { Board } from './Board';
import { KindsProvider } from './kinds';
import { TaskTable } from './TaskTable';
import { useProject } from './useProject';

interface Props {
  projectId: string;
  view: 'board' | 'table';
  onPick: (projectId: string) => void;
  onView: (view: 'board' | 'table') => void;
}

export function EmbeddedDatabase({ projectId, view, onPick, onView }: Props) {
  const ws = useWorkspace();
  const p = useProject(projectId || null);
  const project = ws.projects.find((x) => x.id === projectId) ?? null;

  if (!projectId) {
    return (
      <div className="rounded-md border border-line p-4">
        <select className="w-full" defaultValue="" onChange={(e) => e.target.value && onPick(e.target.value)}>
          <option value="">Pick a database…</option>
          {ws.projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
    );
  }
  if (!project) {
    return <p className="rounded-md border border-line p-4 text-sm text-faint">That database no longer exists.</p>;
  }

  return (
    <KindsProvider kinds={p.kinds}>
      <div className="rounded-md border border-line">
        <header className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span>{project.icon}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{project.name}</span>
          <select className="text-2xs" value={view} onChange={(e) => onView(e.target.value as 'board' | 'table')}>
            <option value="table">Table</option>
            <option value="board">Board</option>
          </select>
        </header>
        {view === 'board'
          ? <Board tasks={p.tasks} onOpen={() => {}} onAdd={() => {}} onMove={(id, status, position) => p.patch(id, { status, position })} />
          : <TaskTable tasks={p.tasks} users={p.users} props={p.props} onPatch={p.patch} onSetProp={p.setProp} onOpen={() => {}} onDelete={p.remove} />}
      </div>
    </KindsProvider>
  );
}
```

The embedded view opens nothing — `onOpen` is a no-op — because a peek belongs to the project screen, not to a block inside a document. Clicking through to the row is what the ↗ on the project screen is for.

- [ ] **Step 3: Slash entry, spec and effects**

Create `database-slash.ts`, `spec.ts`, `effects.ts` and `index.ts` mirroring `chart-slash.ts`, `chart/spec.ts`, `chart/effects.ts` and `chart/index.ts` exactly, substituting `DATABASE_FLAVOUR`, `defaultDatabaseProps`, the tag `metanoia-database`, the slash item name `Database`, description `Embed a database view.`, and the same `group: '4_Content & Media@2'`. The block has no edgeless-specific component, so `spec.ts` maps the flavour to the single tag:

```ts
BlockViewExtension(DATABASE_FLAVOUR, literal`metanoia-database`),
```

- [ ] **Step 4: Register it in the editor**

In `web-react/src/editor/mountEditor.ts`, alongside the chart registrations at lines 34-35, 133 and 352-353:

```ts
import { databaseEffects, databaseViewExtensions } from './database';
import { MetanoiaDatabaseBlockSchema, MetanoiaDatabaseBlockSchemaExtension } from './database';
```

Register the schema in the store's DI beside `MetanoiaChartBlockSchemaExtension`, call `databaseEffects()` beside `chartEffects()`, and append `...databaseViewExtensions` to both `editor.pageSpecs` and `editor.edgelessSpecs`.

- [ ] **Step 5: Verify**

Run: `cd web-react && npm test && npm run build`
Expected: both pass.

In the browser (service worker cleared): open a document, type `/database`, pick the Database item, choose a database in the picker. The table renders inside the page. Reload: the block still points at the same database. Delete that database and reload: the block shows "That database no longer exists." rather than a blank page or a crash.

- [ ] **Step 6: Commit**

```bash
git add web-react/src/editor/database web-react/src/editor/mountEditor.ts web-react/src/components/project/EmbeddedDatabase.tsx
git commit -m "feat(editor): embed a database view in a page"
```

---

### Task 12: Pinning a folder — schema and route

**Files:**
- Modify: `server/src/db.js` (favorites DDL + a `schema_migrations`-guarded migration)
- Modify: `server/src/folders-routes.js` (`favorite` on the list, `PUT /api/folders/:id/favorite`)

**Interfaces:**
- Consumes: `visibleFolder` from `./folders-routes.js`.
- Produces: `PUT /api/folders/:id/favorite` `{ favorite: boolean }` → `{ ok: true }`, and `favorite: boolean` on every row of `GET /api/folders`.

- [ ] **Step 1: Add the schema**

In `server/src/db.js`, inside `initSchema` after the `favorites` table definition:

```sql
    -- Pinning covers folders too. doc_id becomes nullable and exactly one of
    -- the two targets is set; the old (user_id, doc_id) primary key cannot
    -- express that, so it is replaced by two partial unique indexes.
    ALTER TABLE favorites ADD COLUMN IF NOT EXISTS folder_id TEXT
      REFERENCES folders(id) ON DELETE CASCADE;
    ALTER TABLE favorites ALTER COLUMN doc_id DROP NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS favorites_doc_idx
      ON favorites(user_id, doc_id) WHERE doc_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS favorites_folder_idx
      ON favorites(user_id, folder_id) WHERE folder_id IS NOT NULL;
```

Then, below `normalizeLegacyFolderImport()`'s call in `initSchema`, add a second guarded migration for the two statements that are not idempotent:

```js
  await relaxFavoritesKey();
```

and the function itself, next to `normalizeLegacyFolderImport`:

```js
/** Drop the (user_id, doc_id) primary key and add the one-target check.
 *  Neither statement is idempotent, so it runs exactly once behind a marker —
 *  and inside a transaction, so two instances booting together cannot both
 *  apply it. */
async function relaxFavoritesKey() {
  const marker = 'favorites-allow-folder-targets-v1';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      'INSERT INTO schema_migrations (key) VALUES ($1) ON CONFLICT (key) DO NOTHING',
      [marker]
    );
    if (!claimed.rowCount) {
      await client.query('ROLLBACK');
      return;
    }
    await client.query('ALTER TABLE favorites DROP CONSTRAINT IF EXISTS favorites_pkey');
    await client.query(`
      ALTER TABLE favorites ADD CONSTRAINT favorites_one_target
        CHECK ((doc_id IS NULL) <> (folder_id IS NULL))
    `);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 2: Add the route and the list column**

In `server/src/folders-routes.js`, add `favorite` to the `GET /api/folders` query — add `[req.user.id]` as its parameter (the query currently takes none, so also change the call to pass the array):

```sql
              (SELECT count(*)::int FROM folders child
                WHERE child.parent_id = f.id AND child.deleted_at IS NULL) AS folder_count,
              EXISTS (SELECT 1 FROM favorites fav
                       WHERE fav.folder_id = f.id AND fav.user_id = $1) AS favorite
```

and change the handler signature from `(_req, res)` to `(req, res)`.

Then add the toggle, mirroring `PUT /api/docs/:id/favorite` in `index.js`:

```js
  // Folders are workspace-wide, so there is no per-folder grant to check —
  // existing and not deleted is the whole condition.
  app.put('/api/folders/:id/favorite', requireUser, wrap(async (req, res) => {
    if (!(await visibleFolder(req.params.id, req.user.id))) {
      return res.status(404).json({ error: 'not found' });
    }
    if (req.body?.favorite === false) {
      await pool.query('DELETE FROM favorites WHERE user_id = $1 AND folder_id = $2', [
        req.user.id, req.params.id,
      ]);
    } else {
      await pool.query(
        'INSERT INTO favorites (user_id, folder_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.user.id, req.params.id]
      );
    }
    res.json({ ok: true });
  }));
```

`visibleFolder` is already imported at the top of that file.

- [ ] **Step 3: Manual check**

```bash
docker compose up -d --build
F=$(curl -s -b /tmp/mn.jar -X POST http://localhost:8092/api/folders -H 'Content-Type: application/json' -d '{"name":"Pin me"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
curl -s -b /tmp/mn.jar -X PUT http://localhost:8092/api/folders/$F/favorite -H 'Content-Type: application/json' -d '{"favorite":true}'
curl -s -b /tmp/mn.jar http://localhost:8092/api/folders | python3 -c "import json,sys;print([f['favorite'] for f in json.load(sys.stdin) if f['id']=='$F'])"
curl -s -b /tmp/mn.jar -X PUT http://localhost:8092/api/folders/$F/favorite -H 'Content-Type: application/json' -d '{"favorite":false}'
curl -s -b /tmp/mn.jar http://localhost:8092/api/folders | python3 -c "import json,sys;print([f['favorite'] for f in json.load(sys.stdin) if f['id']=='$F'])"
docker compose exec -T db psql -U postgres -d metanoiadocs \
  -c "INSERT INTO favorites (user_id, doc_id, folder_id) SELECT id, NULL, NULL FROM users LIMIT 1"
```
Expected: `[True]` then `[False]`, and the last statement fails with `violates check constraint "favorites_one_target"` — which is the constraint doing its job. Also confirm existing document favorites still list: `curl -s -b /tmp/mn.jar http://localhost:8092/api/docs | grep -c '"favorite":true'`.

- [ ] **Step 4: Commit**

```bash
git add server/src/db.js server/src/folders-routes.js
git commit -m "feat(api): pin a folder, not just a document"
```

---

### Task 13: Pinning a folder — the sidebar

**Files:**
- Modify: `web-react/src/store/workspace.tsx` (folder favorite state + toggle)
- Modify: `web-react/src/lib/types.ts` (`Folder.favorite`)
- Modify: `web-react/src/components/sidebar/Sidebar.tsx` (Favorites section lists folders)
- Modify: `web-react/src/components/sidebar/FolderTree.tsx` (star in the row menu)
- Modify: `web-react/src/components/folder/FolderView.tsx` (star in the header)

**Interfaces:**
- Consumes: `docsApi.favoriteFolder` (Task 6), `FolderRow.favorite`.
- Produces: `ws.favoriteFolderIds: string[]` and `ws.toggleFolderFavorite(id: string): void`.

- [ ] **Step 1: Carry the flag into the store**

In `web-react/src/lib/types.ts`, add to `Folder`:

```ts
  favorite: boolean;
```

In `web-react/src/store/workspace.tsx`:
- in `buildFolders`, add `favorite: !!row.favorite,` to the mapped object;
- add to the context type: `favoriteFolderIds: string[];` and `toggleFolderFavorite: (id: string) => void;`
- implement the toggle beside `toggleFavorite`, in the same optimistic shape:
  ```ts
  const toggleFolderFavorite = useCallback((id: string) => {
    setFolders((f) => {
      const cur = f[id];
      if (!cur) return f;
      const favorite = !cur.favorite;
      docsApi.favoriteFolder(id, favorite).catch(() => refresh());
      return { ...f, [id]: { ...cur, favorite } };
    });
  }, [refresh]);
  ```
- derive the list beside `favoriteIds`:
  ```ts
  const favoriteFolderIds = useMemo(
    () => Object.values(folders).filter((f) => f.favorite).map((f) => f.id),
    [folders],
  );
  ```
- add both to the two context value objects (the memo at line ~786 and its dependency array at ~800).

- [ ] **Step 2: Show folders in the Favorites section**

In `Sidebar.tsx`, add a folder row renderer beside `DocRow`:

```tsx
function FavoriteFolderRow({ id }: { id: string }) {
  const ws = useWorkspace();
  const f = ws.folders[id];
  if (!f) return null;
  return (
    <button
      type="button"
      onClick={() => ws.openFolder(id)}
      className={cn(
        'flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-base leading-5 transition-colors duration-120',
        ws.view === 'folder' && ws.activeFolderId === id ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-hover',
      )}
    >
      <Folder size={16} className="shrink-0" />
      <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">{f.name}</span>
      <Star size={14} className="shrink-0 fill-current text-amber-400" />
    </button>
  );
}
```

and widen the section's condition and body — folders first, then documents:

```tsx
{(ws.favoriteFolderIds.length > 0 || ws.favoriteIds.length > 0) && (
  <section className="mb-5">
    <SectionLabel>Favorites</SectionLabel>
    <div className="space-y-px">
      {ws.favoriteFolderIds.map((id) => <FavoriteFolderRow key={id} id={id} />)}
      {ws.favoriteIds.map((id) => <DocRow key={id} id={id} />)}
    </div>
  </section>
)}
```

Import `Folder` from `lucide-react` if it is not already imported there.

- [ ] **Step 3: Add the control where a folder is acted on**

In `FolderTree.tsx`, add an item to the folder row's existing menu (match the shape of the items already there):

```tsx
{ icon: Star, label: folder.favorite ? 'Remove from Favorites' : 'Add to Favorites', onSelect: () => ws.toggleFolderFavorite(folder.id) },
```

In `FolderView.tsx`, add the same toggle to the header as an `IconButton`, mirroring how `TopBar.tsx:223` does it for a document:

```tsx
<IconButton
  icon={<Star size={18} className={cn(folder.favorite && 'fill-amber-400 text-amber-400')} />}
  label={folder.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
  onClick={() => ws.toggleFolderFavorite(folder.id)}
/>
```

- [ ] **Step 4: Verify**

Run: `cd web-react && npm test && npm run build`
Expected: both pass.

In the browser: star a folder from its row menu — it appears at the top of Favorites, above the starred documents. Reload: it is still there. Unstar from the folder header: it leaves the section, and the starred documents are untouched.

- [ ] **Step 5: Commit**

```bash
git add web-react/src
git commit -m "feat(web): pin folders beside documents"
```

---

### Task 14: README and final sweep

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the feature**

Add a short section to `README.md` beside the existing feature descriptions, in the same voice:

```markdown
### Databases

A project is a database. Every row is a page: click it and a peek opens with
its properties and its own document body, which you can open full screen like
any other page. A database carries whatever columns you give it — text,
number, select, multi-select, date, checkbox, person, URL — plus relations,
which link a row to a row in another database and show the reverse link on the
other side.

Databases nest under each other in the sidebar, and `/database` in any document
embeds a live table or board view of one.
```

- [ ] **Step 2: Full verification**

Run:
```bash
cd server && npm test
cd ../web-react && npm test && npm run build
cd .. && docker compose up -d --build
```
Expected: server tests pass, web tests pass, build succeeds, container comes up healthy.

Then walk the whole feature once in a browser with the service worker cleared: create a database, add a `select` property and a relation to a second database, open a row, type in its body, link a row, open the row full screen, embed the database in a document, nest a sub-database, pin a folder.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): databases, row pages and pinning"
```

---

## Notes for the executor

- **Tasks 1–5 are server-only and independent of 6–13.** Tasks 6 onward assume the endpoints exist; run the stack while working on them.
- **The service worker will lie to you.** After any rebuild, unregister it and clear caches before believing what a browser shows.
- **Never claim a manual check passed without running it.** Every task's verification step prints something specific — quote it.
- If a step's code does not fit the surrounding file's conventions once you see the file, follow the file. The snippets here are written from the code as it stands on `main` at `2203376`, but the file is the source of truth.
