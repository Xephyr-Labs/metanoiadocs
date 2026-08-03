# MetanoiaDocs Intelligence Layer — Design

**Date:** 2026-08-03
**Status:** Approved
**Constraint:** No LLM. Pure JS + Postgres. Lightweight, fast, smooth UI.

## Goal

Add ambient intelligence to the editor: automatic tag suggestions, page-link
suggestions, related pages, task/decision/risk/deadline extraction, duplicate &
stale detection, workspace terminology checks, and a hybrid (keyword + fuzzy)
search — all computed locally with zero external calls and zero background
workers.

## Principle

**One spine, many views.** Every feature is a query-time view over a small
per-doc signals layer that is computed *synchronously on save* at chokepoints
that already exist. No LLM, no embeddings, no services, no cron.

## 1. Compute — where & when

`PUT /api/docs/:id/text` already receives a doc's extracted plain text on every
debounced edit (client-driven). Extend this handler to also:

1. Tokenize + compute top terms → upsert `doc_terms`.
2. Run regex extractors + simhash → upsert `doc_signals`.

Pure string ops, sub-5ms for a typical doc, synchronous. No worker, no queue.

**Client tweak:** the text extractor must preserve `- [ ]` / `- [x]` markers so
todos survive into `search_text` (today they are stripped to bare text). This is
the only client-side change to the save path.

## 2. Data model (2 new tables, added in `initSchema`)

```sql
CREATE TABLE IF NOT EXISTS doc_terms (
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  term   TEXT NOT NULL,
  tf     INT  NOT NULL DEFAULT 1,        -- term frequency in this doc
  PRIMARY KEY (doc_id, term)
);
CREATE INDEX IF NOT EXISTS doc_terms_term_idx ON doc_terms(term);

CREATE TABLE IF NOT EXISTS doc_signals (
  doc_id     TEXT PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
  tasks      JSONB NOT NULL DEFAULT '[]',
  decisions  JSONB NOT NULL DEFAULT '[]',
  risks      JSONB NOT NULL DEFAULT '[]',
  deadlines  JSONB NOT NULL DEFAULT '[]',
  mentions   JSONB NOT NULL DEFAULT '[]',   -- [{id,title,count}] of other docs named in text
  simhash    BIGINT,                        -- 64-bit simhash of the term set
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- **IDF** is computed at query time from `doc_terms`
  (`count(distinct doc_id)` per term). The corpus is a single workspace
  (hundreds–low thousands of docs), so a subquery is fine.
  `// ponytail: query-time IDF; add a term_df cache only if the corpus grows large.`
- `doc_terms` keeps only the top ~30 terms per doc (tokenize → lowercase →
  drop stopwords → drop len<3 → count → top 30). Keeps rows bounded.

## 3. Extractors (`server/src/intelligence.js`, regex on save)

Input: the plain text posted to `/text` (todo markers preserved).

- **tasks** — lines matching `- [ ]` / `- [x]` (carry `checked`), plus
  `TODO`, `action:`, `@name to …`.
- **decisions** — `decided | we (will|chose|agreed) | decision: | conclusion`.
  `unresolved: true` if the line also has `TBD | pending | ?`.
- **risks** — `risk | blocker | blocked | concern | threat`.
- **deadlines** — date regex (ISO `2026-08-03`, `Aug 3`, `3/8`) and/or
  `due | deadline | by <date>`. Store `{text, date?}`.
  `// ponytail: regex dates; add chrono-node only if fuzzy dates ("next Friday") matter.`
- **mentions** — for each *other* doc title (len≥4), `indexOf` in this text →
  `{id, title, count}`. Powers entity-linking / suggested links.
  `// ponytail: O(docs×len) scan; fine under a few thousand docs. Aho-Corasick if it bites.`
- **simhash** — 64-bit simhash over the term set (weighted by tf). Near-duplicate
  = Hamming distance ≤ 3.

Each extractor is a pure function with an inline `assert`-based self-check
(`intelligence.js` runs its own `demo()` under `import.meta`-guarded `main`).

## 4. Read endpoint

`GET /api/docs/:id/intelligence` → one round-trip, all query-time over the two
tables + existing tables. Access-gated by `grantOn` like every other doc route.

```
{
  related:      [{id, title, icon, score}],        // TF-IDF term overlap (cosine), top 5
  tasks:        [{text, checked}],
  decisions:    [{text, unresolved}],
  risks:        [{text}],
  deadlines:    [{text, date}],
  suggestedTags:[{name, exists, tagId?}],          // top terms → existing tag or new proposal
  suggestedLinks:[{id, title, count}],             // = mentions not already shared/linked
  changedDeps:  [{id, title, updated_at}],         // mentioned docs updated after this doc
  duplicateOf:  {id, title, similarity} | null,    // simhash Hamming ≤3
  stale:        {months} | null,                   // untouched > STALE_MONTHS (default 6)
  collaborators:[{id, name}],                      // editors of related docs not shared here
  templates:    [{id, title}],                     // docs tagged `template` overlapping this doc
  terminology:  [{term, suggest, count}]           // doc term trigram-near a higher-df workspace term
}
```

All results are scoped to docs the requesting user can access
(`visibility='team' OR doc_access`).

### Query notes
- **related / templates** — join this doc's `doc_terms` to other docs' `doc_terms`
  on `term`, score `sum(tf_a * tf_b / df)`, order desc, limit. `templates` filters
  the candidate set to docs tagged `template`.
- **collaborators** — distinct `created_by` + `doc_access.user_id` of the related
  docs, minus users already in this doc's `doc_access`.
- **duplicateOf** — compare this doc's simhash to others via
  `bit_count(simhash # $1) <= 3` (Postgres `bit_count` on bigint), pick closest.
- **terminology** — for each of this doc's terms, `pg_trgm` similarity against
  high-df workspace terms; flag when a much-more-frequent near-variant exists.
  Best-effort; capped at a few.

## 5. Hybrid search upgrade

Migration: `CREATE EXTENSION IF NOT EXISTS pg_trgm;` + a GIN trigram index on
`title` (and optionally `search_text`).

`/api/search`: keep the FTS ranked query; `UNION` a `pg_trgm` fuzzy pass
(`title % $q OR search_text % $q`) so typos / partial words still match. Merge,
de-dup by id, FTS matches rank above pure-fuzzy. Same access scope as today.

## 6. Frontend

- **`web-react/src/components/intelligence/IntelligenceRail.tsx`** — collapsible
  right rail in the editor. Accordion cards, one per signal group, each showing a
  count. Collapses to a thin icon strip with count badges. Skeleton while loading.
  Open/closed state + which cards are expanded persisted in `localStorage`.
  Fetches `intelligence(id)` on doc-open and 2s after the last save (debounced).
- **Inline tag chips** — a dismissible `+ roadmap  + api` row under the doc title.
  Click adds via existing `docsApi.addDocTag`; dismissed suggestions stored per-doc
  in `localStorage` so they never nag twice.
- **Link / related / dep / duplicate** items navigate to the target doc on click,
  and each offers a "copy `[[title]]`" affordance.
- **Duplicate** and **stale** render as small badges in the rail header — not nags.
- `docsApi.ts` gains `intelligence(id)` returning the typed shape above.

Design follows the existing Radix + Tailwind component conventions; no new UI deps.

## 7. Scope

**In this phase:** §1–§6 in full, including collaborators, templates, and
terminology (all cheap query-time additions).

**Deferred (noted, not built):**
- Auto-*inserting* real BlockSuite reference blocks at the mention site (editor
  schema is heavy). This phase suggests links + offers copy `[[title]]`.
  `// ponytail: insert affine linked-doc inline blocks in a later pass.`
- Any global workspace dashboard. Duplicate / stale / terminology surface per-doc
  in the rail instead (chosen: no global page).

## 8. Performance & safety

- **Save cost:** O(doc length + number of titles), one synchronous pass. No LLM,
  no network.
- **Read cost:** a handful of indexed Postgres queries; no per-request compute
  beyond SQL.
- **Access control:** the intelligence endpoint and every sub-query reuse the
  existing `grantOn` / `visibility` scoping. No signal leaks a doc the user
  can't already read.
- **Failure isolation:** signal computation on save is wrapped so a malformed doc
  never fails the `/text` write — signals are best-effort, the save is not.

## Files touched

New:
- `server/src/intelligence.js` — tokenizer, extractors, simhash, self-check.
- `web-react/src/components/intelligence/IntelligenceRail.tsx`
- `web-react/src/components/intelligence/TagSuggestions.tsx` (inline chips)

Modified:
- `server/src/db.js` — 2 tables + pg_trgm.
- `server/src/index.js` — extend `/text`, add `/intelligence`, upgrade `/search`.
- `server/src/blocks.js` / client extractor — preserve todo markers.
- `web-react/src/lib/docsApi.ts` — `intelligence(id)` + types.
- `web-react/src/editor/*` — mount the rail + inline chips in the doc view.
