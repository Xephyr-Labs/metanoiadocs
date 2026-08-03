# Intelligence Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ambient, local (no-LLM) intelligence to MetanoiaDocs — related pages, task/decision/risk/deadline extraction, auto tag & link suggestions, duplicate/stale/terminology detection, and hybrid search — via a per-doc signals layer computed synchronously on save.

**Architecture:** A per-doc signals layer (`doc_terms`, `doc_signals`) is computed synchronously in the existing `PUT /api/docs/:id/text` save handler, reading the persisted Yjs (`doc_states`) for true block structure. A single `GET /api/docs/:id/intelligence` endpoint returns every rail view as query-time joins over those tables. Frontend adds a collapsible right rail + inline tag chips. Zero services, zero workers, zero external calls.

**Tech Stack:** Node 24 (`node --test`), Express, Postgres (`pg`, `pg_trgm`), Yjs (`yjs`), React 18 + Vite + Tailwind + Radix + framer-motion.

## Global Constraints

- **No LLM, no embeddings, no external network calls, no background workers.** All compute is pure JS + Postgres, synchronous on the existing save path.
- **Access control:** every intelligence query is scoped to docs the user can access (`d.visibility = 'team' OR doc_access row`), reusing the existing `grantOn` gate. No signal may reveal a doc the user cannot already read.
- **Failure isolation:** signal computation on save is best-effort — wrapped so a malformed doc never fails the `/text` write.
- **Pure functions get `node --test` unit tests.** DB-touching endpoints are smoke-verified against the running stack (no test-DB harness is scaffolded — YAGNI).
- **Follow existing conventions:** ESM `.js` on the server, Radix + Tailwind + framer-motion + lucide-react on the client. No new runtime dependencies.
- **Simhash stored as TEXT** (decimal string); Hamming distance computed in JS over fetched candidates (avoids Postgres bigint bit-count version issues).

---

### Task 1: Pure extractor core (`server/src/intelligence.js`)

Pure, dependency-free functions. No DB, no Yjs. Operate on plain text and a normalized block array `[{flavour, type, checked, text}]`.

**Files:**
- Create: `server/src/intelligence.js`
- Create: `server/src/intelligence.test.js`
- Modify: `server/package.json` (add `"test": "node --test"`)

**Interfaces:**
- Produces:
  - `tokenize(text: string) -> string[]` — lowercase, split on non-alnum, drop stopwords, drop len<3.
  - `topTerms(text: string, n=30) -> {term:string, tf:number}[]` — counted, sorted desc, top n.
  - `extractSignals(blocks: {flavour,type,checked,text}[]) -> {tasks,decisions,risks,deadlines}` where
    `tasks: {text,checked}[]`, `decisions: {text,unresolved}[]`, `risks: {text}[]`, `deadlines: {text,date:string|null}[]`.
  - `findMentions(text: string, titles: {id,title}[]) -> {id,title,count}[]` — case-insensitive whole-title occurrences, titles len≥4, self excluded by caller.
  - `simhash(terms: {term,tf}[]) -> string` — 64-bit simhash as a decimal string.
  - `hamming(a: string, b: string) -> number` — popcount of XOR of two decimal-string 64-bit hashes.

- [ ] **Step 1: Write failing tests**

```js
// server/src/intelligence.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, topTerms, extractSignals, findMentions, simhash, hamming } from './intelligence.js';

test('tokenize drops stopwords, short words, punctuation', () => {
  assert.deepEqual(tokenize('The Kubernetes cluster is on!'), ['kubernetes', 'cluster']);
});

test('topTerms counts and ranks', () => {
  const t = topTerms('alpha alpha beta', 10);
  assert.deepEqual(t[0], { term: 'alpha', tf: 2 });
});

test('extractSignals pulls tasks/decisions/risks/deadlines', () => {
  const blocks = [
    { flavour: 'affine:list', type: 'todo', checked: false, text: 'ship the rail' },
    { flavour: 'affine:list', type: 'todo', checked: true, text: 'done thing' },
    { flavour: 'affine:paragraph', type: 'text', text: 'We decided to use Postgres.' },
    { flavour: 'affine:paragraph', type: 'text', text: 'Decision: schema TBD' },
    { flavour: 'affine:paragraph', type: 'text', text: 'Main risk is scope creep.' },
    { flavour: 'affine:paragraph', type: 'text', text: 'Due 2026-08-10 for launch.' },
  ];
  const s = extractSignals(blocks);
  assert.deepEqual(s.tasks, [
    { text: 'ship the rail', checked: false },
    { text: 'done thing', checked: true },
  ]);
  assert.equal(s.decisions.length, 2);
  assert.equal(s.decisions.find((d) => /TBD/.test(d.text)).unresolved, true);
  assert.equal(s.risks.length, 1);
  assert.equal(s.deadlines[0].date, '2026-08-10');
});

test('findMentions matches other doc titles, min length 4', () => {
  const m = findMentions('See the Roadmap and the API docs.', [
    { id: '1', title: 'Roadmap' },
    { id: '2', title: 'API' }, // len<4 → ignored
  ]);
  assert.deepEqual(m, [{ id: '1', title: 'Roadmap', count: 1 }]);
});

test('simhash of similar term sets is near, different is far', () => {
  const a = simhash(topTerms('alpha beta gamma delta epsilon', 30));
  const b = simhash(topTerms('alpha beta gamma delta epsilon zeta', 30));
  const c = simhash(topTerms('completely unrelated words here banana', 30));
  // Relative invariant: a near-identical set is closer than an unrelated one.
  assert.ok(hamming(a, b) < hamming(a, c));
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd server && node --test src/intelligence.test.js`
Expected: FAIL (module/exports not found).

- [ ] **Step 3: Implement `server/src/intelligence.js`**

```js
// Pure, local, no-LLM signal extraction. No DB, no Yjs — operates on plain text
// and a normalized block array. Every function is deterministic and testable.
import crypto from 'node:crypto';

const STOP = new Set(
  ('a an the and or but if then else for to of in on at by with as is are was were be been being ' +
   'this that these those it its i we you they he she them our your their not no do does did done ' +
   'will would can could should may might must have has had from up out about into over than too very ' +
   'so just also more most some any all each other which who whom what when where why how')
    .split(/\s+/),
);

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

export function topTerms(text, n = 30) {
  const counts = new Map();
  for (const w of tokenize(text)) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts.entries()]
    .map(([term, tf]) => ({ term, tf }))
    .sort((a, b) => b.tf - a.tf || a.term.localeCompare(b.term))
    .slice(0, n);
}

const DATE_RE =
  /\b(\d{4}-\d{2}-\d{2})\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b|\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/i;

function firstDate(text) {
  const m = text.match(DATE_RE);
  return m ? (m[1] || m[0]) : null;
}

export function extractSignals(blocks) {
  const tasks = [];
  const decisions = [];
  const risks = [];
  const deadlines = [];
  for (const b of blocks) {
    const text = String(b.text || '').trim();
    if (!text) continue;
    if (b.flavour === 'affine:list' && b.type === 'todo') {
      tasks.push({ text, checked: !!b.checked });
      continue;
    }
    if (/\b(todo|action item|action:)\b/i.test(text) || /@\w+\s+to\s+/i.test(text)) {
      tasks.push({ text, checked: false });
    }
    if (/\bdecided\b|\bdecision\b|\bwe (?:will|chose|agreed)\b|\bconclusion\b/i.test(text)) {
      decisions.push({ text, unresolved: /\b(tbd|pending)\b|\?/i.test(text) });
    }
    if (/\b(risk|blocker|blocked|concern|threat)\b/i.test(text)) {
      risks.push({ text });
    }
    if (/\b(due|deadline|by)\b/i.test(text) && DATE_RE.test(text)) {
      deadlines.push({ text, date: firstDate(text) });
    } else if (DATE_RE.test(text) && /\b(due|deadline|launch|ship|deliver)\b/i.test(text)) {
      deadlines.push({ text, date: firstDate(text) });
    }
  }
  return { tasks, decisions, risks, deadlines };
}

export function findMentions(text, titles) {
  const hay = String(text || '').toLowerCase();
  const out = [];
  for (const { id, title } of titles) {
    const t = String(title || '').trim();
    if (t.length < 4) continue;
    const needle = t.toLowerCase();
    let count = 0;
    let idx = hay.indexOf(needle);
    while (idx !== -1) { count++; idx = hay.indexOf(needle, idx + needle.length); }
    if (count > 0) out.push({ id, title: t, count });
  }
  return out.sort((a, b) => b.count - a.count);
}

// 64-bit simhash over weighted terms, returned as a decimal string.
export function simhash(terms) {
  const v = new Array(64).fill(0);
  for (const { term, tf } of terms) {
    const h = BigInt('0x' + crypto.createHash('md5').update(term).digest('hex').slice(0, 16));
    for (let i = 0; i < 64; i++) {
      const bit = (h >> BigInt(i)) & 1n;
      v[i] += bit === 1n ? tf : -tf;
    }
  }
  let out = 0n;
  for (let i = 0; i < 64; i++) if (v[i] > 0) out |= 1n << BigInt(i);
  return out.toString();
}

export function hamming(a, b) {
  let x = BigInt(a) ^ BigInt(b);
  let count = 0;
  while (x) { count += Number(x & 1n); x >>= 1n; }
  return count;
}
```

- [ ] **Step 4: Add test script**

In `server/package.json` `scripts`, add: `"test": "node --test"`.

- [ ] **Step 5: Run tests, verify they pass**

Run: `cd server && node --test src/intelligence.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/intelligence.js server/src/intelligence.test.js server/package.json
git commit -m "feat(intelligence): pure local extractors (terms, signals, mentions, simhash)"
```

---

### Task 2: Normalized block decoder (`extractBlocks` in `blocks.js`)

Reuse the existing Yjs decode walk to also return block-level flavour/type/checked, so signals get true todos (not `.innerText`).

**Files:**
- Modify: `server/src/blocks.js` (add `extractBlocks`, share the walk with `extractText`)
- Modify: `server/src/intelligence.test.js` (add decode test using `buildDocState`)

**Interfaces:**
- Consumes: `buildDocState` (Task exists already), Yjs.
- Produces: `extractBlocks(existing: Buffer|Uint8Array) -> {title:string, blocks:{flavour,type,checked,text}[]}` in tree order.

- [ ] **Step 1: Write failing test**

```js
// append to server/src/intelligence.test.js
import { buildDocState } from './blocks.js';
import { extractBlocks } from './blocks.js';

test('extractBlocks returns todos with checked state and title', () => {
  const state = buildDocState('Plan', '# Heading\n- [ ] open task\n- [x] done task\nplain line');
  const { title, blocks } = extractBlocks(Buffer.from(state));
  assert.equal(title, 'Plan');
  const todos = blocks.filter((b) => b.flavour === 'affine:list' && b.type === 'todo');
  assert.equal(todos.length, 2);
  assert.equal(todos[0].checked, false);
  assert.equal(todos[1].checked, true);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd server && node --test src/intelligence.test.js`
Expected: FAIL (`extractBlocks` not exported).

- [ ] **Step 3: Implement `extractBlocks` in `server/src/blocks.js`**

Add below `extractText`:

```js
/** Decode a doc_states buffer to {title, blocks[]} with flavour/type/checked, tree order. */
export function extractBlocks(existing) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(existing));
  const blocksMap = doc.getMap('blocks');
  const get = (id) => blocksMap.get(id);
  const textOf = (b) => {
    const t = b.get('prop:text');
    return t instanceof Y.Text ? t.toString() : '';
  };
  let page = null, title = '';
  for (const [, b] of blocksMap) {
    if (b instanceof Y.Map && b.get('sys:flavour') === 'affine:page') {
      page = b;
      const t = b.get('prop:title');
      title = t instanceof Y.Text ? t.toString() : '';
      break;
    }
  }
  const out = [];
  const walk = (id) => {
    const b = get(id);
    if (!(b instanceof Y.Map)) return;
    const fl = b.get('sys:flavour');
    if (fl === 'affine:paragraph' || fl === 'affine:list' || fl === 'affine:code') {
      out.push({
        flavour: fl,
        type: b.get('prop:type') || 'text',
        checked: !!b.get('prop:checked'),
        text: textOf(b),
      });
    }
    const kids = b.get('sys:children');
    if (kids instanceof Y.Array) for (const c of kids.toArray()) walk(c);
  };
  if (page) { const kids = page.get('sys:children'); if (kids instanceof Y.Array) for (const c of kids.toArray()) walk(c); }
  return { title, blocks: out };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd server && node --test src/intelligence.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/blocks.js server/src/intelligence.test.js
git commit -m "feat(blocks): extractBlocks decoder (flavour/type/checked) for signals"
```

---

### Task 3: Schema — `doc_terms`, `doc_signals`, `pg_trgm`

**Files:**
- Modify: `server/src/db.js` (`initSchema` — append inside the existing template literal)

**Interfaces:**
- Produces: tables `doc_terms(doc_id,term,tf)`, `doc_signals(doc_id,tasks,decisions,risks,deadlines,mentions,simhash,updated_at)`; extension `pg_trgm`; trigram GIN index on `docs(title)`.

- [ ] **Step 1: Add DDL to `initSchema`**

Append before the closing `` ` `` of the `pool.query` template in `server/src/db.js`:

```sql
    -- Intelligence layer: per-doc term vector + extracted signals. Computed
    -- synchronously on the /text save. Best-effort; never blocks a save.
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE INDEX IF NOT EXISTS docs_title_trgm_idx ON docs USING GIN (title gin_trgm_ops);

    CREATE TABLE IF NOT EXISTS doc_terms (
      doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
      term   TEXT NOT NULL,
      tf     INT  NOT NULL DEFAULT 1,
      PRIMARY KEY (doc_id, term)
    );
    CREATE INDEX IF NOT EXISTS doc_terms_term_idx ON doc_terms(term);

    CREATE TABLE IF NOT EXISTS doc_signals (
      doc_id     TEXT PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
      tasks      JSONB NOT NULL DEFAULT '[]',
      decisions  JSONB NOT NULL DEFAULT '[]',
      risks      JSONB NOT NULL DEFAULT '[]',
      deadlines  JSONB NOT NULL DEFAULT '[]',
      mentions   JSONB NOT NULL DEFAULT '[]',
      simhash    TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
```

- [ ] **Step 2: Verify boot applies it**

Run (with the dev DB up): `cd server && node -e "import('./src/db.js').then(async m => { await m.initSchema(); const r = await m.pool.query(\"SELECT to_regclass('doc_signals') a, to_regclass('doc_terms') b\"); console.log(r.rows[0]); process.exit(0); })"`
Expected: `{ a: 'doc_signals', b: 'doc_terms' }`.

- [ ] **Step 3: Commit**

```bash
git add server/src/db.js
git commit -m "feat(db): doc_terms, doc_signals tables + pg_trgm title index"
```

---

### Task 4: Compute signals on save (extend `PUT /api/docs/:id/text`)

**Files:**
- Modify: `server/src/index.js` (the `/api/docs/:id/text` handler near line 833; import from `./intelligence.js` and `./blocks.js`)

**Interfaces:**
- Consumes: `topTerms`, `extractSignals`, `findMentions`, `simhash` (Task 1); `extractBlocks` (Task 2); `pool` (db).
- Produces: on each save, upserts one `doc_terms` set + one `doc_signals` row for the doc. New helper `computeAndStoreSignals(docId)`.

- [ ] **Step 1: Add imports at top of `index.js`**

```js
import { topTerms, extractSignals, findMentions, simhash } from './intelligence.js';
import { extractBlocks } from './blocks.js';
```
(Merge with the existing `./blocks.js` import if present.)

- [ ] **Step 2: Add `computeAndStoreSignals` helper**

Place near the other helpers:

```js
// Best-effort per-doc signal computation. Reads the persisted Yjs (true block
// structure incl. todos); falls back to the posted plain text if absent. Never
// throws into the caller — a bad doc must not fail the save.
async function computeAndStoreSignals(docId, fallbackText = '') {
  try {
    let title = '';
    let blocks = [];
    const st = await pool.query('SELECT state FROM doc_states WHERE doc_id = $1', [docId]);
    if (st.rows[0]?.state) {
      ({ title, blocks } = extractBlocks(st.rows[0].state));
    } else {
      blocks = String(fallbackText).split('\n').filter(Boolean)
        .map((text) => ({ flavour: 'affine:paragraph', type: 'text', checked: false, text }));
    }
    const flatText = (title + '\n' + blocks.map((b) => b.text).join('\n')).trim();
    const terms = topTerms(flatText, 30);
    const signals = extractSignals(blocks);

    const others = await pool.query(
      'SELECT id, title FROM docs WHERE id <> $1 AND deleted_at IS NULL', [docId],
    );
    const mentions = findMentions(flatText, others.rows);
    const hash = simhash(terms);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM doc_terms WHERE doc_id = $1', [docId]);
      for (const { term, tf } of terms) {
        await client.query(
          'INSERT INTO doc_terms (doc_id, term, tf) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [docId, term, tf],
        );
      }
      await client.query(
        `INSERT INTO doc_signals (doc_id, tasks, decisions, risks, deadlines, mentions, simhash, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (doc_id) DO UPDATE SET
           tasks=EXCLUDED.tasks, decisions=EXCLUDED.decisions, risks=EXCLUDED.risks,
           deadlines=EXCLUDED.deadlines, mentions=EXCLUDED.mentions, simhash=EXCLUDED.simhash,
           updated_at=now()`,
        [docId, JSON.stringify(signals.tasks), JSON.stringify(signals.decisions),
         JSON.stringify(signals.risks), JSON.stringify(signals.deadlines),
         JSON.stringify(mentions), hash],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('[intelligence] signal compute failed for', docId, e.message);
  }
}
```

- [ ] **Step 3: Call it from the `/text` handler (fire-and-forget, non-blocking)**

Modify the handler so the response is not delayed by signal work:

```js
app.put('/api/docs/:id/text', requireUser, async (req, res) => {
  if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  const text = String(req.body?.text || '').slice(0, 100000);
  await pool.query('UPDATE docs SET search_text = $1 WHERE id = $2', [text, req.params.id]);
  res.json({ ok: true });
  computeAndStoreSignals(req.params.id, text); // best-effort, after response
});
```

- [ ] **Step 4: Smoke-verify against a running stack**

With the stack up and a valid session cookie in `$C` and an existing `$DOC` id:
```bash
curl -s -b "$C" -X PUT localhost:8092/api/docs/$DOC/text \
  -H 'Content-Type: application/json' \
  -d '{"text":"We decided to ship the Roadmap. Risk: scope creep. Due 2026-08-10."}' >/dev/null
sleep 1
psql "$DATABASE_URL" -c "SELECT jsonb_array_length(decisions) d, jsonb_array_length(risks) r, jsonb_array_length(deadlines) dl, simhash IS NOT NULL h FROM doc_signals WHERE doc_id='$DOC';"
```
Expected: `d=1, r=1, dl=1, h=t`.

- [ ] **Step 5: Commit**

```bash
git add server/src/index.js
git commit -m "feat(intelligence): compute doc signals on save (best-effort, non-blocking)"
```

---

### Task 5: `GET /api/docs/:id/intelligence`

**Files:**
- Modify: `server/src/index.js` (add route; add `hamming` to the intelligence import)

**Interfaces:**
- Consumes: `hamming` (Task 1), `pool`, `grantOn`.
- Produces: JSON of the shape in the spec §4.

- [ ] **Step 1: Add the route**

`hamming` already exported from `intelligence.js` — extend the import. Add:

```js
const STALE_MONTHS = Number(process.env.STALE_MONTHS || 6);

// Everything the Intelligence rail needs, in one round-trip. All access-scoped.
app.get('/api/docs/:id/intelligence', requireUser, async (req, res) => {
  const id = req.params.id;
  const uid = req.user.id;
  if (!(await grantOn(id, uid))) return res.status(403).json({ error: 'forbidden' });

  // Visibility predicate reused across sub-queries.
  const visJoin = `LEFT JOIN doc_access a ON a.doc_id = d.id AND a.user_id = $2`;
  const visWhere = `d.deleted_at IS NULL AND (a.user_id IS NOT NULL OR d.visibility='team')`;

  const sig = (await pool.query('SELECT * FROM doc_signals WHERE doc_id=$1', [id])).rows[0] || {};

  // Related: shared-term overlap weighted by rarity (query-time IDF).
  const related = (await pool.query(
    `WITH df AS (SELECT term, count(DISTINCT doc_id)::float AS n FROM doc_terms GROUP BY term),
          mine AS (SELECT term, tf FROM doc_terms WHERE doc_id=$1)
     SELECT d.id, d.title, d.icon,
            sum(mine.tf * dt.tf / GREATEST(df.n,1)) AS score
       FROM mine
       JOIN doc_terms dt ON dt.term=mine.term AND dt.doc_id<>$1
       JOIN df ON df.term=mine.term
       JOIN docs d ON d.id=dt.doc_id
       ${visJoin}
      WHERE ${visWhere}
      GROUP BY d.id, d.title, d.icon
      ORDER BY score DESC
      LIMIT 5`, [id, uid])).rows;

  // Suggested tags: top terms that name (or nearly name) tags or are strong terms.
  const myTerms = (await pool.query('SELECT term, tf FROM doc_terms WHERE doc_id=$1 ORDER BY tf DESC LIMIT 8', [id])).rows;
  const tagRows = (await pool.query('SELECT id, lower(name) name FROM tags')).rows;
  const tagByName = new Map(tagRows.map((t) => [t.name, t.id]));
  const suggestedTags = myTerms.slice(0, 5).map((t) => ({
    name: t.term, exists: tagByName.has(t.term), tagId: tagByName.get(t.term) || undefined,
  }));

  // Suggested links + changed deps derive from stored mentions.
  const mentions = Array.isArray(sig.mentions) ? sig.mentions : [];
  const mentionIds = mentions.map((m) => m.id);
  let suggestedLinks = [];
  let changedDeps = [];
  if (mentionIds.length) {
    const accessible = (await pool.query(
      `SELECT d.id, d.title, d.icon, d.updated_at
         FROM docs d ${visJoin}
        WHERE d.id = ANY($1) AND ${visWhere}`, [mentionIds, uid])).rows;
    const byId = new Map(accessible.map((d) => [d.id, d]));
    suggestedLinks = mentions.filter((m) => byId.has(m.id))
      .map((m) => ({ id: m.id, title: byId.get(m.id).title, count: m.count }));
    const selfUpdated = (await pool.query('SELECT updated_at FROM docs WHERE id=$1', [id])).rows[0]?.updated_at;
    changedDeps = accessible
      .filter((d) => selfUpdated && new Date(d.updated_at) > new Date(selfUpdated))
      .map((d) => ({ id: d.id, title: d.title, updated_at: d.updated_at }));
  }

  // Duplicate: nearest simhash (Hamming ≤3) among accessible docs, computed in JS.
  let duplicateOf = null;
  if (sig.simhash) {
    const cand = (await pool.query(
      `SELECT d.id, d.title, s.simhash
         FROM doc_signals s JOIN docs d ON d.id=s.doc_id
         ${visJoin}
        WHERE s.doc_id<>$1 AND s.simhash IS NOT NULL AND ${visWhere}`, [id, uid])).rows;
    let best = null;
    for (const c of cand) {
      const dist = hamming(sig.simhash, c.simhash);
      if (dist <= 3 && (!best || dist < best.dist)) best = { id: c.id, title: c.title, dist };
    }
    if (best) duplicateOf = { id: best.id, title: best.title, similarity: 1 - best.dist / 64 };
  }

  // Stale badge.
  const selfRow = (await pool.query('SELECT updated_at FROM docs WHERE id=$1', [id])).rows[0];
  let stale = null;
  if (selfRow) {
    const months = (Date.now() - new Date(selfRow.updated_at).getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (months > STALE_MONTHS) stale = { months: Math.round(months) };
  }

  // Collaborators: editors of related docs not already shared here.
  let collaborators = [];
  if (related.length) {
    const relIds = related.map((r) => r.id);
    collaborators = (await pool.query(
      `SELECT DISTINCT u.id, u.name FROM users u
         WHERE u.id IN (
           SELECT created_by FROM docs WHERE id = ANY($1) AND created_by IS NOT NULL
           UNION SELECT user_id FROM doc_access WHERE doc_id = ANY($1)
         )
         AND u.id NOT IN (SELECT user_id FROM doc_access WHERE doc_id=$2)
         AND u.id <> $3
       LIMIT 5`, [relIds, id, uid])).rows;
  }

  // Templates: docs tagged 'template' overlapping this doc's terms.
  const templates = (await pool.query(
    `WITH mine AS (SELECT term, tf FROM doc_terms WHERE doc_id=$1)
     SELECT d.id, d.title, sum(mine.tf*dt.tf) AS score
       FROM mine JOIN doc_terms dt ON dt.term=mine.term AND dt.doc_id<>$1
       JOIN docs d ON d.id=dt.doc_id
       ${visJoin}
       JOIN doc_tags g ON g.doc_id=d.id
       JOIN tags t ON t.id=g.tag_id AND lower(t.name)='template'
      WHERE ${visWhere}
      GROUP BY d.id, d.title ORDER BY score DESC LIMIT 3`, [id, uid])).rows
    .map((r) => ({ id: r.id, title: r.title }));

  // Terminology: my terms that are trigram-near a much-more-frequent workspace term.
  const terminology = (await pool.query(
    `WITH acc AS (
       SELECT d.id FROM docs d
         LEFT JOIN doc_access a ON a.doc_id=d.id AND a.user_id=$2
        WHERE d.deleted_at IS NULL AND (a.user_id IS NOT NULL OR d.visibility='team')
     ),
          mine AS (SELECT term FROM doc_terms WHERE doc_id=$1),
          df AS (SELECT term, count(DISTINCT doc_id)::int n FROM doc_terms
                  WHERE doc_id IN (SELECT id FROM acc) GROUP BY term)
     SELECT m.term, o.term AS suggest, o.n AS count
       FROM mine m
       JOIN df self ON self.term=m.term
       JOIN df o ON o.term<>m.term AND similarity(o.term,m.term) > 0.55 AND o.n >= self.n*3
      ORDER BY o.n DESC LIMIT 3`, [id, uid])).rows;

  res.json({
    related: related.map((r) => ({ id: r.id, title: r.title, icon: r.icon, score: Number(r.score) })),
    tasks: sig.tasks || [], decisions: sig.decisions || [], risks: sig.risks || [], deadlines: sig.deadlines || [],
    suggestedTags, suggestedLinks, changedDeps, duplicateOf, stale, collaborators, templates, terminology,
  });
});
```

- [ ] **Step 2: Smoke-verify**

```bash
curl -s -b "$C" localhost:8092/api/docs/$DOC/intelligence | jq 'keys'
```
Expected: array containing `related, tasks, decisions, risks, deadlines, suggestedTags, suggestedLinks, changedDeps, duplicateOf, stale, collaborators, templates, terminology`.

- [ ] **Step 3: Commit**

```bash
git add server/src/index.js
git commit -m "feat(intelligence): GET /docs/:id/intelligence aggregation endpoint"
```

---

### Task 6: Hybrid search upgrade (`/api/search`)

**Files:**
- Modify: `server/src/index.js` (`/api/search` handler near line 840)

**Interfaces:**
- Produces: same response shape (`[{id,title,snippet}]`), now including fuzzy matches.

- [ ] **Step 1: Replace the query with an FTS ∪ trigram union**

```js
app.get('/api/search', requireUser, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const { rows } = await pool.query(
    `WITH scoped AS (
       SELECT d.id, d.title, d.search_text, d.search_tsv
         FROM docs d
         LEFT JOIN doc_access a ON a.doc_id=d.id AND a.user_id=$1
        WHERE d.deleted_at IS NULL AND (a.user_id IS NOT NULL OR d.visibility='team')
     ),
     fts AS (
       SELECT id, title, search_text, 1 AS pri,
              ts_rank(search_tsv, plainto_tsquery('english', $2)) AS rank
         FROM scoped
        WHERE search_tsv @@ plainto_tsquery('english', $2)
     ),
     fuzzy AS (
       SELECT id, title, search_text, 2 AS pri,
              GREATEST(similarity(title,$2), similarity(left(search_text,2000),$2)) AS rank
         FROM scoped
        WHERE title % $2 OR left(search_text,2000) % $2
     ),
     merged AS (
       SELECT DISTINCT ON (id) id, title, search_text, pri, rank
         FROM (SELECT * FROM fts UNION ALL SELECT * FROM fuzzy) u
        ORDER BY id, pri, rank DESC
     )
     SELECT id, title,
            ts_headline('english', search_text, plainto_tsquery('english', $2),
                        'MaxWords=18, MinWords=6, ShortWord=2') AS snippet
       FROM merged
      ORDER BY pri, rank DESC
      LIMIT 20`,
    [req.user.id, q],
  );
  res.json(rows.map((r) => ({ id: r.id, title: r.title, snippet: r.snippet })));
});
```

- [ ] **Step 2: Smoke-verify a typo still matches**

```bash
curl -s -b "$C" "localhost:8092/api/search?q=roadmpa" | jq 'length'   # misspelled "roadmap"
```
Expected: `>= 1` when a "Roadmap" doc exists (fuzzy pass catches it; the old FTS-only query returned 0).

- [ ] **Step 3: Commit**

```bash
git add server/src/index.js
git commit -m "feat(search): hybrid FTS + pg_trgm fuzzy search"
```

---

### Task 7: Client API — `intelligence(id)` + types

**Files:**
- Modify: `web-react/src/lib/docsApi.ts`

**Interfaces:**
- Produces: `docsApi.intelligence(id) -> Promise<Intelligence>` and the `Intelligence` type.

- [ ] **Step 1: Add the type + method**

Add the interface near the other row types:

```ts
export interface Intelligence {
  related: { id: string; title: string; icon: string; score: number }[];
  tasks: { text: string; checked: boolean }[];
  decisions: { text: string; unresolved: boolean }[];
  risks: { text: string }[];
  deadlines: { text: string; date: string | null }[];
  suggestedTags: { name: string; exists: boolean; tagId?: string }[];
  suggestedLinks: { id: string; title: string; count: number }[];
  changedDeps: { id: string; title: string; updated_at: string }[];
  duplicateOf: { id: string; title: string; similarity: number } | null;
  stale: { months: number } | null;
  collaborators: { id: string; name: string }[];
  templates: { id: string; title: string }[];
  terminology: { term: string; suggest: string; count: number }[];
}
```

Add to the `docsApi` object:

```ts
  intelligence: (id: string): Promise<Intelligence> => req(`/docs/${id}/intelligence`),
```

- [ ] **Step 2: Type-check**

Run: `cd web-react && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add web-react/src/lib/docsApi.ts
git commit -m "feat(client): docsApi.intelligence + Intelligence type"
```

---

### Task 8: Intelligence rail component

**Files:**
- Create: `web-react/src/components/intelligence/IntelligenceRail.tsx`
- Create: `web-react/src/hooks/useIntelligence.ts`

**Interfaces:**
- Consumes: `docsApi.intelligence`, `Intelligence` type, `useWorkspace` (for navigate + addTagToPage).
- Produces: `<IntelligenceRail pageId={string} />`; `useIntelligence(pageId, refreshKey)` returning `{ data, loading }`.

- [ ] **Step 1: Fetch hook**

```tsx
// web-react/src/hooks/useIntelligence.ts
import { useEffect, useState } from 'react';
import { docsApi, type Intelligence } from '../lib/docsApi';

export function useIntelligence(pageId: string | null, refreshKey: number) {
  const [data, setData] = useState<Intelligence | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!pageId) { setData(null); return; }
    let alive = true;
    setLoading(true);
    docsApi.intelligence(pageId)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [pageId, refreshKey]);
  return { data, loading };
}
```

- [ ] **Step 2: Rail component**

Build `IntelligenceRail.tsx`: a collapsible right column (persist `mn-rail-open` in `localStorage`). When open, render accordion cards only for non-empty groups, each with a count and lucide icon:
- Related (`Sparkles`) → list; click navigates (`ws.openPage(id)`), each row has a copy-`[[title]]` button.
- Tasks (`CheckSquare`) → checkbox glyph + text.
- Decisions (`Flag`), Risks (`AlertTriangle`), Deadlines (`Calendar`) → text lines; unresolved decisions get a muted "unresolved" chip; deadlines show `date`.
- Missing links (`Link`) → `suggestedLinks`; navigate + copy `[[title]]`.
- Changed deps (`RefreshCw`) → list with relative time.
- Collaborators (`Users`), Templates (`LayoutTemplate`), Terminology (`SpellCheck`) → simple lists; terminology shows `term → suggest (count×)`.
- Header badges: if `duplicateOf` → `Copy` badge "Possible duplicate of …"; if `stale` → `Clock` badge "N mo old".

Collapsed state = a thin vertical strip of icon+count badges that expands on click. Skeleton (3 shimmer rows) while `loading && !data`. Empty overall → a single muted "No signals yet" line. Use framer-motion for the expand/collapse, matching existing components.

```tsx
// web-react/src/components/intelligence/IntelligenceRail.tsx
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Sparkles, CheckSquare, Flag, AlertTriangle, Calendar, Link as LinkIcon,
  RefreshCw, Users, LayoutTemplate, SpellCheck, PanelRightClose, PanelRightOpen,
  Copy, Clock,
} from 'lucide-react';
import { useIntelligence } from '../../hooks/useIntelligence';
import { useWorkspace } from '../../store/workspace';

const RAIL_KEY = 'mn-rail-open';

export function IntelligenceRail({ pageId, refreshKey }: { pageId: string | null; refreshKey: number }) {
  const ws = useWorkspace();
  const [open, setOpen] = useState(() => localStorage.getItem(RAIL_KEY) !== '0');
  const { data, loading } = useIntelligence(pageId, refreshKey);
  const toggle = () => { const n = !open; setOpen(n); localStorage.setItem(RAIL_KEY, n ? '1' : '0'); };
  const copyLink = (title: string) => navigator.clipboard?.writeText(`[[${title}]]`);

  if (!open) {
    return (
      <button onClick={toggle} title="Show intelligence"
        className="flex w-9 shrink-0 items-center justify-center border-l border-border bg-canvas text-muted hover:text-fg">
        <PanelRightOpen size={16} />
      </button>
    );
  }

  const Section = ({ icon: Icon, label, count, children }: any) =>
    count ? (
      <div className="border-b border-border/60 px-3 py-2">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
          <Icon size={13} /> {label} <span className="ml-auto tabular-nums">{count}</span>
        </div>
        <div className="space-y-1 text-sm">{children}</div>
      </div>
    ) : null;

  const Row = ({ id, title, onCopy }: { id: string; title: string; onCopy?: boolean }) => (
    <div className="group flex items-center gap-1">
      <button onClick={() => ws.openPage(id)} className="truncate text-left hover:text-accent">{title}</button>
      {onCopy && (
        <button onClick={() => copyLink(title)} title="Copy [[link]]"
          className="ml-auto opacity-0 group-hover:opacity-100"><Copy size={12} /></button>
      )}
    </div>
  );

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-l border-border bg-canvas">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-xs font-semibold">
        <Sparkles size={13} className="text-accent" /> Intelligence
        <button onClick={toggle} className="ml-auto text-muted hover:text-fg" title="Hide">
          <PanelRightClose size={16} />
        </button>
      </div>

      {(data?.duplicateOf || data?.stale) && (
        <div className="flex flex-wrap gap-1 border-b border-border/60 px-3 py-2 text-xs">
          {data?.duplicateOf && (
            <button onClick={() => ws.openPage(data.duplicateOf!.id)}
              className="flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-600">
              <Copy size={11} /> Possible duplicate
            </button>
          )}
          {data?.stale && (
            <span className="flex items-center gap-1 rounded bg-muted/10 px-1.5 py-0.5 text-muted">
              <Clock size={11} /> {data.stale.months} mo old
            </span>
          )}
        </div>
      )}

      {loading && !data && (
        <div className="space-y-2 p-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-muted/20" />)}
        </div>
      )}

      {data && (
        <AnimatePresence>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Section icon={Sparkles} label="Related" count={data.related.length}>
              {data.related.map((r) => <Row key={r.id} id={r.id} title={r.title} onCopy />)}
            </Section>
            <Section icon={CheckSquare} label="Tasks" count={data.tasks.length}>
              {data.tasks.map((t, i) => (
                <div key={i} className={t.checked ? 'text-muted line-through' : ''}>
                  {t.checked ? '☑' : '☐'} {t.text}
                </div>
              ))}
            </Section>
            <Section icon={Flag} label="Decisions" count={data.decisions.length}>
              {data.decisions.map((d, i) => (
                <div key={i}>{d.text}{d.unresolved && <span className="ml-1 rounded bg-amber-500/10 px-1 text-[10px] text-amber-600">unresolved</span>}</div>
              ))}
            </Section>
            <Section icon={AlertTriangle} label="Risks" count={data.risks.length}>
              {data.risks.map((r, i) => <div key={i}>{r.text}</div>)}
            </Section>
            <Section icon={Calendar} label="Deadlines" count={data.deadlines.length}>
              {data.deadlines.map((d, i) => <div key={i}>{d.date && <b className="mr-1">{d.date}</b>}{d.text}</div>)}
            </Section>
            <Section icon={LinkIcon} label="Missing links" count={data.suggestedLinks.length}>
              {data.suggestedLinks.map((l) => <Row key={l.id} id={l.id} title={l.title} onCopy />)}
            </Section>
            <Section icon={RefreshCw} label="Changed deps" count={data.changedDeps.length}>
              {data.changedDeps.map((d) => <Row key={d.id} id={d.id} title={d.title} />)}
            </Section>
            <Section icon={Users} label="Collaborators" count={data.collaborators.length}>
              {data.collaborators.map((c) => <div key={c.id}>{c.name}</div>)}
            </Section>
            <Section icon={LayoutTemplate} label="Templates" count={data.templates.length}>
              {data.templates.map((t) => <Row key={t.id} id={t.id} title={t.title} />)}
            </Section>
            <Section icon={SpellCheck} label="Terminology" count={data.terminology.length}>
              {data.terminology.map((t, i) => <div key={i} className="text-muted">{t.term} → <b>{t.suggest}</b> ({t.count}×)</div>)}
            </Section>
          </motion.div>
        </AnimatePresence>
      )}
    </aside>
  );
}
```

Note: if `ws.openPage` does not exist, use the workspace's actual navigate method (check `useWorkspace` — likely `setCurrentPage`/`openPage`); wire to whatever selects a page by id.

- [ ] **Step 3: Type-check**

Run: `cd web-react && npx tsc --noEmit`
Expected: no new errors (fix the navigate method name if flagged).

- [ ] **Step 4: Commit**

```bash
git add web-react/src/components/intelligence/IntelligenceRail.tsx web-react/src/hooks/useIntelligence.ts
git commit -m "feat(ui): intelligence rail component + fetch hook"
```

---

### Task 9: Inline tag suggestions

**Files:**
- Create: `web-react/src/components/editor/TagSuggestions.tsx`
- Modify: `web-react/src/components/editor/TagChips.tsx` (render `<TagSuggestions>` beneath, or add to PageHeader — whichever hosts TagChips)

**Interfaces:**
- Consumes: `Intelligence['suggestedTags']`, `useWorkspace().addTagToPage`.
- Produces: `<TagSuggestions pageId title suggested />` — dismissible chips.

- [ ] **Step 1: Component**

```tsx
// web-react/src/components/editor/TagSuggestions.tsx
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useWorkspace } from '../../store/workspace';
import type { Intelligence } from '../../lib/docsApi';

const dismissKey = (pageId: string) => `mn-tagsug-dismiss-${pageId}`;

export function TagSuggestions({ pageId, suggested }: { pageId: string; suggested: Intelligence['suggestedTags'] }) {
  const ws = useWorkspace();
  const [dismissed, setDismissed] = useState<Set<string>>(
    () => new Set(JSON.parse(localStorage.getItem(dismissKey(pageId)) || '[]')),
  );
  const dismiss = (name: string) => {
    const next = new Set(dismissed).add(name);
    setDismissed(next);
    localStorage.setItem(dismissKey(pageId), JSON.stringify([...next]));
  };
  const shown = suggested.filter((s) => !dismissed.has(s.name)).slice(0, 4);
  if (!shown.length) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted">Suggested:</span>
      {shown.map((s) => (
        <span key={s.name} className="group flex items-center gap-0.5 rounded-full border border-dashed border-border px-1.5 py-0.5 text-xs text-muted">
          <button className="flex items-center gap-0.5 hover:text-accent"
            onClick={() => { ws.addTagToPage(pageId, s.tagId ? { tagId: s.tagId } : { name: s.name }); dismiss(s.name); }}>
            <Plus size={11} /> {s.name}
          </button>
          <button className="opacity-0 group-hover:opacity-60 hover:!opacity-100" onClick={() => dismiss(s.name)}>×</button>
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd web-react && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add web-react/src/components/editor/TagSuggestions.tsx
git commit -m "feat(ui): inline dismissible tag suggestions"
```

---

### Task 10: Wire rail + suggestions into the editor, refresh on save

**Files:**
- Modify: `web-react/src/components/editor/EditorArea.tsx` (mount rail beside the editor; feed `refreshKey`)
- Modify: `web-react/src/components/editor/TagChips.tsx` or `PageHeader.tsx` (mount `<TagSuggestions>`)
- Modify: `web-react/src/editor/mountEditor.ts` (emit a "saved" signal so the rail refetches ~2s after edits settle)

**Interfaces:**
- Consumes: `IntelligenceRail`, `TagSuggestions`, the intelligence fetch.
- Produces: a `refreshKey` that increments after each `/text` save so rail + suggestions refetch.

- [ ] **Step 1: Bump `refreshKey` after a save**

In `mountEditor.ts`, after the `fetch(.../text ...)` resolves, call an optional `onSaved?()` callback passed into `mountEditor` options. Add `onSaved` to its options type and invoke it in the `.then()` of the text PUT.

```ts
// in the push() text PUT:
fetch(`/api/docs/${docId}/text`, { /* … */ }).then(() => onSaved?.()).catch(() => {});
```

- [ ] **Step 2: Thread `onSaved` through `LazyEditor` / `BlockSuiteEditor` to `EditorArea`**

Add an `onSaved?: () => void` prop down the chain to `mountEditor`. In `EditorArea`, keep `const [refreshKey, setRefreshKey] = useState(0)` and pass `onSaved={() => { clearTimeout(t); t = setTimeout(() => setRefreshKey(k => k+1), 2000); }}` (debounced 2s). (Store the timer in a `useRef`.)

- [ ] **Step 3: Render the rail beside the editor**

In `EditorArea`, wrap the editor and rail in a horizontal flex so the rail sits on the right of the page (page mode only; hide in edgeless and on mobile with `hidden md:flex`):

```tsx
<div className="flex min-h-0 flex-1">
  <div className="relative min-h-0 flex-1"> {/* existing editor host */} </div>
  {!edgeless && <div className="hidden md:flex"><IntelligenceRail pageId={page.id} refreshKey={refreshKey} /></div>}
</div>
```

- [ ] **Step 4: Render tag suggestions under the title**

Where `TagChips` renders (under the page icon/title), fetch the same intelligence once (lift to a shared context or fetch in the header) and render `<TagSuggestions pageId={page.id} suggested={intel.suggestedTags} />`. Simplest: give `EditorArea` the intelligence `data` (from a `useIntelligence(page.id, refreshKey)` call at the `EditorArea` level) and pass `suggestedTags` down to the header, while the rail receives the same `data` as a prop instead of fetching again.

Refactor: lift the fetch to `EditorArea` via `useIntelligence(page.id, refreshKey)`, pass `data`/`loading` into `IntelligenceRail` as props (make `pageId` optional there and prefer injected `data`), and pass `data?.suggestedTags` to the header. One fetch, two consumers.

- [ ] **Step 5: Type-check + build**

Run: `cd web-react && npx tsc --noEmit && npm run build`
Expected: build succeeds.

- [ ] **Step 6: Manual smoke (running stack)**

Open a doc with a todo, a "Risk:" line, a "We decided…" line, and text that names another doc. Within ~3s of editing: rail shows Tasks/Risks/Decisions counts, Related/Missing-links populate, suggested tag chips appear under the title. Collapse/expand persists across reload.

- [ ] **Step 7: Commit**

```bash
git add web-react/src/components/editor/EditorArea.tsx web-react/src/components/editor/TagChips.tsx web-react/src/components/editor/PageHeader.tsx web-react/src/editor/mountEditor.ts web-react/src/editor/LazyEditor.tsx web-react/src/editor/BlockSuiteEditor.tsx
git commit -m "feat(ui): mount intelligence rail + tag suggestions, refresh on save"
```

---

### Task 11: Backfill signals for existing docs (one-shot)

New tables are empty for docs that existed before this feature. Provide a boot-time backfill for docs missing a `doc_signals` row.

**Files:**
- Modify: `server/src/index.js` (call a backfill after `initSchema`, once)

**Interfaces:**
- Consumes: `computeAndStoreSignals`.

- [ ] **Step 1: Add backfill on boot**

After `initSchema()` runs at startup, add:

```js
// One-shot backfill: compute signals for docs that don't have them yet. Runs
// sequentially in the background so a large workspace doesn't stampede the pool.
(async () => {
  try {
    const { rows } = await pool.query(
      `SELECT d.id FROM docs d LEFT JOIN doc_signals s ON s.doc_id=d.id
        WHERE d.deleted_at IS NULL AND s.doc_id IS NULL`);
    for (const r of rows) await computeAndStoreSignals(r.id);
    if (rows.length) console.log('[intelligence] backfilled signals for', rows.length, 'docs');
  } catch (e) { console.error('[intelligence] backfill failed', e.message); }
})();
```

- [ ] **Step 2: Verify**

Restart the server; check logs show the backfill count, then:
```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM doc_signals;"
```
Expected: count ≈ number of live docs.

- [ ] **Step 3: Commit**

```bash
git add server/src/index.js
git commit -m "feat(intelligence): one-shot signal backfill on boot"
```

---

## Self-Review

**Spec coverage:**
- Hybrid search → Task 6 ✓
- Automatic tags → Tasks 5 (suggestedTags), 9 (inline chips) ✓
- Auto page-link / entity linking → Tasks 4 (mentions), 5 (suggestedLinks) ✓
- Missing links → Task 5 (suggestedLinks) ✓
- Related pages → Task 5 (related) ✓
- Task/decision/risk/deadline extraction → Tasks 1, 4, 5 ✓
- Stale + duplicate detection → Tasks 1 (simhash), 5 (duplicateOf, stale) ✓
- Terminology check → Task 5 (terminology via pg_trgm) ✓
- Recommendation engine (revisit/collaborators/templates/changed-deps/unresolved decisions) → Task 5 (collaborators, templates, changedDeps; unresolved flag in decisions). "Revisit" is folded into the per-doc stale badge (no global page, per design). ✓
- Smooth UI right rail + inline → Tasks 8, 9, 10 ✓
- Backfill for pre-existing docs → Task 11 ✓

**Placeholder scan:** none — every code step is concrete. The two "check the actual method name" notes (workspace navigate in Task 8, prop threading in Task 10) are explicit verify-then-wire instructions, not deferred work.

**Type consistency:** `Intelligence` shape in Task 7 matches the endpoint JSON in Task 5 and the consumers in Tasks 8–10. `computeAndStoreSignals(docId, fallbackText?)` used identically in Tasks 4 and 11. `extractBlocks` return `{title, blocks}` consumed in Task 4. `simhash`/`hamming` string-based contract consistent across Tasks 1, 4, 5.

**Known integration risks flagged for the implementer:**
- `useWorkspace` navigate method name (Task 8) — verify (`openPage` vs `setCurrentPage`).
- `onSaved` prop threading through `LazyEditor`/`BlockSuiteEditor` (Task 10) — mechanical but touches 3 files.
- `doc_states` may lag the `/text` post by the Hocuspocus debounce; signals converge on the next save. Acceptable for ambient signals (noted in design §1).
