# Intelligence Layer v2 — Precision, Robustness & New Signals

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Fix the two robustness Criticals, raise signal precision (measured ~0–15% on tasks/risks/decisions), and add four pure-local ML capabilities — RAKE keyphrases, TextRank TL;DR, centroid auto-tagging, query expansion — plus frontend polish. No LLM, no heavy deps.

**Architecture:** Same spine — signals computed on save into `doc_terms`/`doc_signals`, read by `GET /docs/:id/intelligence`. This wave sharpens the extractors, batches DB writes, makes the backfill non-blocking, adds `doc_signals.summary`/`keyphrases`, and improves the endpoint's ranking (IDF/centroid/co-occurrence).

**Tech Stack:** Node 24 (`node --test`), Express, Postgres (`pg_trgm`), React 18 + Tailwind.

## Global Constraints
- No LLM, no external calls, no new runtime deps. Pure JS + Postgres.
- Extraction is best-effort; never fail a save.
- Access control unchanged (grantOn + visibility scope on every doc-returning query).
- Pure functions get `node --test` unit tests.
- Signals stored as JSONB/TEXT; simhash as decimal string; access-scoped `df` where term text is returned.

---

### Task 1: Robustness — async error guards + process safety net

Express 4 does not catch async handler rejections; one transient PG error in `/intelligence` currently crashes the process. Guard the async routes and add a last-resort process handler.

**Files:** Modify `server/src/index.js`

- [ ] **Step 1:** Add a tiny async wrapper near the top (after `const app = express()`):
```js
// Express 4 doesn't catch rejected promises from async handlers — wrap them.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
```
- [ ] **Step 2:** Wrap the two new async handlers: change `app.get('/api/docs/:id/intelligence', requireUser, async (req,res)=>{...})` to `app.get('/api/docs/:id/intelligence', requireUser, wrap(async (req,res)=>{...}))`, and the same for `app.get('/api/search', requireUser, wrap(async ...))` and `app.put('/api/docs/:id/text', requireUser, wrap(async ...))`.
- [ ] **Step 3:** Add a JSON error middleware AFTER all routes (before `app.listen`):
```js
// Last-resort error handler so a thrown/rejected route returns 500 instead of crashing.
app.use((err, req, res, next) => {
  console.error('[api] unhandled route error', err?.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'internal error' });
});
```
- [ ] **Step 4:** Add a process safety net near the top of the file (after imports):
```js
process.on('unhandledRejection', (e) => console.error('[proc] unhandledRejection', e?.message || e));
process.on('uncaughtException',  (e) => console.error('[proc] uncaughtException', e?.message || e));
```
- [ ] **Step 5:** `cd server && node --check src/index.js` → clean. Commit `fix(api): guard async routes + process-level error handlers (no more crash on transient PG error)`.

---

### Task 2: Backfill non-blocking + batched term inserts + flatText cap

Backfill is O(n²) synchronous with ~31 round-trips/doc. Batch the term insert into one statement, cap the mention-scan text, and yield to the event loop between docs.

**Files:** Modify `server/src/index.js` (`computeAndStoreSignals`, backfill IIFE)

- [ ] **Step 1:** In `computeAndStoreSignals`, cap the flat text before use: after building `flatText`, add `const scanText = flatText.slice(0, 100000);` and use `scanText` for `findMentions` and `topTerms`.
- [ ] **Step 2:** Replace the 30-iteration `INSERT` loop with a single batched insert:
```js
      await client.query('DELETE FROM doc_terms WHERE doc_id = $1', [docId]);
      if (terms.length) {
        await client.query(
          `INSERT INTO doc_terms (doc_id, term, tf)
           SELECT $1, t, f FROM unnest($2::text[], $3::int[]) AS x(t, f)
           ON CONFLICT DO NOTHING`,
          [docId, terms.map((t) => t.term), terms.map((t) => t.tf)],
        );
      }
```
- [ ] **Step 2b:** Let `computeAndStoreSignals` accept an optional pre-fetched titles list to avoid the per-doc `SELECT id,title` during backfill:
  Change signature to `async function computeAndStoreSignals(docId, fallbackText = '', titles = null)`; replace the `others` query with:
```js
    const others = titles
      ? titles.filter((t) => t.id !== docId)
      : (await pool.query('SELECT id, title FROM docs WHERE id <> $1 AND deleted_at IS NULL', [docId])).rows;
```
- [ ] **Step 3:** Make the backfill fetch titles once, and yield between docs:
```js
(async () => {
  try {
    const titles = (await pool.query('SELECT id, title FROM docs WHERE deleted_at IS NULL')).rows;
    const { rows } = await pool.query(
      `SELECT d.id FROM docs d LEFT JOIN doc_signals s ON s.doc_id=d.id
        WHERE d.deleted_at IS NULL AND s.doc_id IS NULL`);
    let n = 0;
    for (const r of rows) {
      await computeAndStoreSignals(r.id, '', titles);
      if (++n % 25 === 0) await new Promise((res) => setImmediate(res)); // yield to the event loop
    }
    if (rows.length) console.log('[intelligence] backfilled signals for', rows.length, 'docs');
  } catch (e) { console.error('[intelligence] backfill failed', e.message); }
})();
```
- [ ] **Step 4:** `node --check src/index.js`. Commit `perf(intelligence): batch term inserts, cap scan text, yield during backfill`.

---

### Task 3: Extraction precision (`intelligence.js`)

Raise task/decision/risk/mention precision. All pure — extend `intelligence.test.js`.

**Files:** Modify `server/src/intelligence.js`, `server/src/intelligence.test.js`

**Produces (new/changed signatures):**
- `tokenize` — now strips URL fragments and uses an extended stoplist.
- `extractSignals(blocks)` — skips `affine:code` blocks; skips template/tutorial todos; decisions require a real decision keyword (drop bare `we will`); risk/decision `text` is a ≤200-char snippet around the match.
- `findMentions(text, titles)` — whole-word match; skips titles that are a single common/generic word; min length 5.

- [ ] **Step 1 (tests first):** add to `intelligence.test.js`:
```js
test('tokenize strips urls and extended stopwords', () => {
  assert.deepEqual(tokenize('Visit https://acme.com/path for kubernetes'), ['kubernetes']);
});
test('extractSignals ignores code blocks and template todos', () => {
  const s = extractSignals([
    { flavour: 'affine:code', type: 'plain', checked: false, text: '// TODO: handle null' },
    { flavour: 'affine:list', type: 'todo', checked: false, text: '[Task]' },
    { flavour: 'affine:list', type: 'todo', checked: false, text: 'Ship the release notes' },
  ]);
  assert.equal(s.tasks.length, 1);
  assert.equal(s.tasks[0].text, 'Ship the release notes');
});
test('decisions require a real keyword, not bare future tense', () => {
  const s = extractSignals([
    { flavour: 'affine:paragraph', type: 'text', text: 'We will send you an email shortly.' },
    { flavour: 'affine:paragraph', type: 'text', text: 'We decided to adopt Postgres.' },
  ]);
  assert.equal(s.decisions.length, 1);
});
test('risk text is snippeted, not the whole block', () => {
  const long = 'x '.repeat(400) + 'this is a real risk to the timeline ' + 'y '.repeat(400);
  const s = extractSignals([{ flavour: 'affine:paragraph', type: 'text', text: long }]);
  assert.ok(s.risks[0].text.length <= 210);
  assert.ok(/risk/i.test(s.risks[0].text));
});
test('findMentions is whole-word and skips generic single-word titles', () => {
  const m = findMentions('The roadmap 2026 and the product plan', [
    { id: '1', title: 'Roadmap' },        // whole word present ("roadmap")
    { id: '2', title: 'Product' },        // generic single word → skipped
    { id: '3', title: 'Team' },           // len<5 → skipped
  ]);
  assert.deepEqual(m.map((x) => x.title), ['Roadmap']);
});
```
- [ ] **Step 2 (verify fail):** `cd server && node --test src/intelligence.test.js` — new tests fail.
- [ ] **Step 3 (implement):**
  - `tokenize`: before splitting, strip URLs: `text = String(text||'').toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/\b[a-z0-9.-]+\.(com|org|net|io|dev|co)\b/g, ' ');` then split. Add to `STOP`: `com www http https her him his hers us me my mine your yours use used using add added get got here there next prev previous first last name date time page section item thing way new also via per`.
  - `extractSignals`: at the top of the loop, `if (b.flavour === 'affine:code') continue;`. For todos, skip when the text is a template placeholder or too short: `const isPlaceholder = /^\s*\[[^\]]*\]\s*$/.test(text) || text.length < 4 || /^(click|type|press|drag|/) /i.test(text);` (skip tutorial phrases starting with those verbs, and single-bracket placeholders); only push real todos. Keep `checked` state.
  - decisions: regex `/\bdecided\b|\bdecision\b|\bconclusion\b|\bagreed\b/i` (drop the bare `we will|chose`; `agreed` kept). unresolved unchanged.
  - snippet helper: `const snip = (t, re) => { const m = t.match(re); if (!m) return t.slice(0,200); const i = Math.max(0, m.index - 80); return t.slice(i, i + 200).trim(); };` Apply to risks and decisions `text` using their matching regex.
  - `findMentions`: build a small `GENERIC` set (reuse an exported const: common words like product, project, team, notes, plan, doc, page, update, meeting, home, general, misc, draft, task, todo). For each title: `const t = title.trim(); if (t.length < 5) continue; if (!/\s/.test(t) && GENERIC.has(t.toLowerCase())) continue;` then match with a whole-word regex built by escaping the title: `const re = new RegExp('(?<![\\p{L}\\p{N}])' + escapeRegExp(t) + '(?![\\p{L}\\p{N}])', 'giu');` count matches. Add a local `escapeRegExp`.
- [ ] **Step 4:** `node --test src/intelligence.test.js` all pass. Commit `feat(intelligence): sharper extraction (code/template skip, snippets, whole-word mentions, url/stopword cleanup)`.

---

### Task 4: RAKE keyphrase extraction (`intelligence.js`)

Pure, deterministic, no dep. Rapid Automatic Keyphrase Extraction: split text on stopwords + punctuation into candidate phrases; score each word by deg(word)/freq(word) summed over the phrase; return top phrases.

**Files:** Modify `server/src/intelligence.js`, `server/src/intelligence.test.js`

**Produces:** `keyphrases(text: string, n=8) -> string[]` — top-n multi-word (or single) keyphrases, lowercased, deduped, order by score desc.

- [ ] **Step 1 (test):**
```js
test('keyphrases extracts multi-word phrases over stopwords', () => {
  const kp = keyphrases('The kubernetes cluster autoscaler manages the kubernetes cluster nodes and pods.', 5);
  assert.ok(kp.some((p) => p.includes('kubernetes cluster')));
  assert.ok(kp.every((p) => typeof p === 'string' && p.length));
});
```
- [ ] **Step 2:** verify fail.
- [ ] **Step 3 (implement):**
```js
export function keyphrases(text, n = 8) {
  const words = String(text || '').toLowerCase();
  // Split into candidate phrases at stopwords / punctuation.
  const tokens = words.split(/([^a-z0-9]+)/);
  const phrases = [];
  let cur = [];
  for (const tok of words.split(/\s+/)) {
    const w = tok.replace(/[^a-z0-9]/g, '');
    if (!w || STOP.has(w) || w.length < 3) { if (cur.length) { phrases.push(cur); cur = []; } continue; }
    cur.push(w);
  }
  if (cur.length) phrases.push(cur);
  // Word scores: degree (co-occurrence incl. self) / frequency.
  const freq = new Map(), deg = new Map();
  for (const ph of phrases) {
    const d = ph.length - 1;
    for (const w of ph) { freq.set(w, (freq.get(w) || 0) + 1); deg.set(w, (deg.get(w) || 0) + d + 1); }
  }
  const wscore = (w) => (deg.get(w) || 0) / (freq.get(w) || 1);
  const scored = new Map();
  for (const ph of phrases) {
    const key = ph.join(' ');
    const s = ph.reduce((a, w) => a + wscore(w), 0);
    if (!scored.has(key) || scored.get(key) < s) scored.set(key, s);
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map((e) => e[0]);
}
```
- [ ] **Step 4:** tests pass. Commit `feat(intelligence): RAKE keyphrase extraction`.

---

### Task 5: TextRank extractive summary (`intelligence.js`)

Pure. Rank sentences by centrality in a term-overlap graph; return the top 2–3 in original order.

**Files:** Modify `server/src/intelligence.js`, `server/src/intelligence.test.js`

**Produces:** `summarize(text: string, k=3) -> string` — up to k highest-ranked sentences, joined by a space, in original order.

- [ ] **Step 1 (test):**
```js
test('summarize returns a subset of sentences, capped', () => {
  const t = 'Kubernetes runs containers. The autoscaler adds nodes under load. Cats are unrelated fluff. The cluster scales pods automatically based on demand.';
  const s = summarize(t, 2);
  assert.ok(s.length > 0 && s.length < t.length);
  assert.ok(!/cats are unrelated/i.test(s)); // the off-topic sentence should rank last
});
```
- [ ] **Step 2:** verify fail.
- [ ] **Step 3 (implement):** split into sentences (`text.split(/(?<=[.!?])\s+/)`), keep those ≥ ~25 chars; represent each as a Set of tokenized terms; similarity = shared-term count / (log sizes) (a lightweight TextRank edge weight); run ~20 power iterations of weighted PageRank (damping 0.85); take top-k by score, then restore original order and join. Guard: if <3 sentences, return the first ~2 joined.
```js
export function summarize(text, k = 3) {
  const sents = String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 25);
  if (sents.length <= k) return sents.slice(0, k).join(' ');
  const toks = sents.map((s) => new Set(tokenize(s)));
  const N = sents.length;
  const sim = (i, j) => {
    if (i === j) return 0;
    let shared = 0; for (const t of toks[i]) if (toks[j].has(t)) shared++;
    const denom = Math.log(toks[i].size + 1) + Math.log(toks[j].size + 1);
    return denom ? shared / denom : 0;
  };
  const W = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => sim(i, j)));
  const out = W.map((row) => row.reduce((a, b) => a + b, 0) || 1);
  let score = new Array(N).fill(1 / N);
  for (let it = 0; it < 20; it++) {
    const next = new Array(N).fill(0.15 / N);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (W[j][i]) next[i] += 0.85 * (W[j][i] / out[j]) * score[j];
    score = next;
  }
  const idx = score.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).slice(0, k).map((x) => x[1]).sort((a, b) => a - b);
  return idx.map((i) => sents[i]).join(' ');
}
```
- [ ] **Step 4:** tests pass. Commit `feat(intelligence): TextRank extractive summary`.

---

### Task 6: Schema + wire summary/keyphrases into save

**Files:** Modify `server/src/db.js`, `server/src/index.js`

- [ ] **Step 1 (db.js):** in `initSchema`, add:
```sql
    ALTER TABLE doc_signals ADD COLUMN IF NOT EXISTS summary TEXT NOT NULL DEFAULT '';
    ALTER TABLE doc_signals ADD COLUMN IF NOT EXISTS keyphrases JSONB NOT NULL DEFAULT '[]';
    CREATE INDEX IF NOT EXISTS doc_terms_term_trgm_idx ON doc_terms USING GIN (term gin_trgm_ops);
```
- [ ] **Step 2 (index.js):** import `keyphrases, summarize` from `./intelligence.js`. In `computeAndStoreSignals`, after computing `signals`, add:
```js
    const summary = summarize(blocks.filter((b) => b.flavour !== 'affine:code').map((b) => b.text).join(' '), 3);
    const kps = keyphrases(scanText, 8);
```
  Extend the `doc_signals` upsert column list + values with `summary` and `keyphrases` (`JSON.stringify(kps)`), and add them to the `ON CONFLICT DO UPDATE SET` clause.
- [ ] **Step 3:** `node --check src/index.js`. Commit `feat(intelligence): store TextRank summary + RAKE keyphrases on save`.

---

### Task 7: Endpoint — centroid auto-tags, keyphrase suggestions, summary/keyphrases in response, query expansion

**Files:** Modify `server/src/index.js`

- [ ] **Step 1 — suggestedTags via centroid + IDF + keyphrases.** Replace the current `suggestedTags` block with:
```js
  // Centroid auto-tag: rank existing tags by term-overlap between this doc and
  // the docs already carrying each tag (weighted by rarity). Access-scoped.
  const centroidTags = (await pool.query(
    `WITH mine AS (SELECT term, tf FROM doc_terms WHERE doc_id=$1),
          df AS (SELECT term, count(DISTINCT doc_id)::float n FROM doc_terms GROUP BY term)
     SELECT t.id AS "tagId", t.name, sum(mine.tf * dt.tf / GREATEST(df.n,1)) AS score
       FROM mine
       JOIN doc_terms dt ON dt.term = mine.term AND dt.doc_id <> $1
       JOIN df ON df.term = mine.term
       JOIN doc_tags g ON g.doc_id = dt.doc_id
       JOIN tags t ON t.id = g.tag_id
       JOIN docs d ON d.id = dt.doc_id
       LEFT JOIN doc_access a ON a.doc_id = d.id AND a.user_id = $2
      WHERE d.deleted_at IS NULL AND (a.user_id IS NOT NULL OR d.visibility='team')
        AND t.id NOT IN (SELECT tag_id FROM doc_tags WHERE doc_id=$1)
      GROUP BY t.id, t.name ORDER BY score DESC LIMIT 4`, [id, uid])).rows;
  // Keyphrase-derived new-tag ideas (not already a tag, not already applied).
  const kps = Array.isArray(sig.keyphrases) ? sig.keyphrases : [];
  const existingTagNames = new Set((await pool.query('SELECT lower(name) n FROM tags')).rows.map((r) => r.n));
  const kpTags = kps.filter((p) => p.length <= 30 && !existingTagNames.has(p.toLowerCase())).slice(0, 3)
    .map((p) => ({ name: p, exists: false }));
  const suggestedTags = [
    ...centroidTags.map((t) => ({ name: t.name, exists: true, tagId: t.tagId })),
    ...kpTags,
  ].slice(0, 5);
```
- [ ] **Step 2 — return summary + keyphrases.** Add to the `res.json({...})`: `summary: sig.summary || '', keyphrases: kps,`.
- [ ] **Step 3 — query expansion in /search.** Before running the search query, expand the query with top co-occurring terms:
```js
  // Co-occurrence query expansion: pull the strongest terms that co-occur with
  // the query's own terms across the corpus, append them (OR) to widen recall.
  let expanded = q;
  try {
    const qterms = tokenize(q);
    if (qterms.length) {
      const ex = (await pool.query(
        `SELECT dt2.term, count(*) c
           FROM doc_terms dt1 JOIN doc_terms dt2 ON dt2.doc_id = dt1.doc_id AND dt2.term <> dt1.term
          WHERE dt1.term = ANY($1)
          GROUP BY dt2.term ORDER BY c DESC LIMIT 3`, [qterms])).rows.map((r) => r.term);
      if (ex.length) expanded = q + ' ' + ex.join(' ');
    }
  } catch { /* expansion is best-effort */ }
```
  Use `expanded` for the `plainto_tsquery` calls in the `fts` branch and `ts_headline`, but keep the original `q` for the `pg_trgm` fuzzy `%` comparisons (fuzzy on the raw query only). Import `tokenize` from `./intelligence.js`.
- [ ] **Step 4:** `node --check src/index.js`. Commit `feat(intelligence): centroid auto-tags, keyphrase suggestions, summary in response, query expansion`.

---

### Task 8: Client types (`docsApi.ts`)

**Files:** Modify `web-react/src/lib/docsApi.ts`

- [ ] **Step 1:** Add to `Intelligence`: `summary: string;` and `keyphrases: string[];`.
- [ ] **Step 2:** `cd web-react && npx tsc --noEmit` → no new errors. Commit `feat(client): summary + keyphrases on Intelligence type`.

---

### Task 9: Frontend polish (`IntelligenceRail.tsx`, `useIntelligence.ts`, `EditorArea.tsx`, `TagSuggestions.tsx`)

**Files:** Modify those four.

- [ ] **Step 1 — clear data on doc switch + expose error.** In `useIntelligence.ts`, add `const [error, setError] = useState(false)`, `setData(null)` and `setError(false)` at the START of the effect when `pageId` changes, set `error=true` in `.catch`, return `{ data, loading, error }`.
- [ ] **Step 2 — hoist Section/Row.** In `IntelligenceRail.tsx`, move `Section` and `Row` OUT of the component to module scope (pass `ws`/`copyLink` as needed via props, or keep `Row` taking an `onOpen`/`onCopy` callback). They must not be redefined per render.
- [ ] **Step 3 — Summary card + keyphrases.** At the top of the rail body (above Related), render the summary when present:
```tsx
{data?.summary && (
  <div className="border-b border-line px-3 py-2 text-sm text-muted"><span className="mb-1 block text-xs font-medium">Summary</span>{data.summary}</div>
)}
```
- [ ] **Step 4 — error + empty states.** When `error`, show a small "Couldn't load" row. When `data` is present but every section is empty and no summary/badges, show a muted "No signals yet."
- [ ] **Step 5 — drop dead affordance.** Remove the "copy `[[title]]`" button (nothing consumes wiki-links); rows navigate on click only. (Keep the copy icon out entirely.)
- [ ] **Step 6 — a11y.** Give icon-only buttons `aria-label` (not just `title`); add `role="status"` to the loading skeleton.
- [ ] **Step 7 — mobile: skip the fetch.** In `EditorArea.tsx`, gate the hook on a viewport check so mobile doesn't fetch for a hidden rail: `const showRail = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;` then `useIntelligence(showRail ? (page?.id ?? null) : null, refreshKey)`. (Simple one-shot check is fine; a resize listener is optional.)
- [ ] **Step 8 — filter suggestedTags vs applied.** In `TagSuggestions.tsx`, also filter out any suggestion whose `name` matches a tag already on the page (`page.tags`); pass `page` or the applied tag names in. (EditorArea/PageHeader already has `page`.)
- [ ] **Step 9 — timer cleanup.** In `EditorArea.tsx`, add a `useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, [])`.
- [ ] **Step 10:** `cd web-react && npx tsc --noEmit` (no new errors) + `npm run build` (succeeds). Commit `feat(ui): summary card, error/empty states, hoist components, mobile fetch skip, drop dead link affordance, a11y`.

---

### Task 10: Integration smoke (coordinator)

- [ ] Rebuild + up (`docker compose up -d --build`), confirm health 200 + backfill log.
- [ ] Re-measure signal precision on real docs (tasks/risks/decisions/mentions) vs the pre-v2 numbers; confirm noise dropped. Check `summary`/`keyphrases` populated. Verify `terminology` uses the new trgm index (`EXPLAIN`).

---

## Self-Review
- Robustness Criticals → Tasks 1, 2. ✓
- Precision (code/template/decisions/risk-snippet/mentions/terms) → Task 3. ✓
- Keyphrases → Task 4; TL;DR → Task 5; both stored Task 6; centroid auto-tag + keyphrase tags + query expansion → Task 7. ✓
- Client + rail (summary card, error/empty, hoist, mobile skip, dead-affordance, a11y, filter) → Tasks 8, 9. ✓
- Perf (batch insert Task 2, doc_terms trgm index Task 6). ✓
- Types consistent: `keyphrases(text,n)->string[]`, `summarize(text,k)->string`, `computeAndStoreSignals(docId, fallbackText?, titles?)`, Intelligence gains `summary`/`keyphrases`.
