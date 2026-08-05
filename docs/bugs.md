# Bugs and Review Findings

## Fixed

### Database-backed charts cannot select database fields

`knownColumns()` only echoed already-selected fields, so database sources fell back to
stale names like `month`, `revenue`, `cost`. It now resolves columns through
`resolveChartData` — the same resolver the canvas renders from, so picker and chart agree
and a view's column visibility is respected. Selected fields are unioned in so a stale
selection stays visible. The three `cols.length ? cols : knownColumns()` sites collapse
onto that one path.

- [chart-config-panel.ts:272](/home/sajjad/workspace/metanoiadocs/web-react/src/editor/chart/chart-config-panel.ts:272)

### Charts do not refresh when the source database changes

The canvas subscribed only to its own model. `watchSource()` now also subscribes to the
database model's `propsUpdated` (cells, columns, view filter/sort) and `childrenUpdated`
(rows), re-subscribing on source change and tearing down on disconnect or store swap. It
no-ops when the watched id is unchanged, so calling it from every refresh cannot loop.
`findModelById` is exported from `data-source.ts` rather than duplicated.

- [chart-canvas.ts:130](/home/sajjad/workspace/metanoiadocs/web-react/src/editor/chart/chart-canvas.ts:130)

### Intelligence results can become stale after rapid edits

`/api/docs/:id/text` fired signal computation after responding, with no ordering, so an
older run could overwrite a newer one. `coalesceByKey` wraps `computeAndStoreSignals`:
per doc, one computation at a time, queued ones collapse to the newest text.

- [intelligence.js:90](/home/sajjad/workspace/metanoiadocs/server/src/intelligence.js:90)
- [index.js:922](/home/sajjad/workspace/metanoiadocs/server/src/index.js:922)

### Todo markers are not preserved in search text

`innerText` drops `- [ ]` / `- [x]` — the checkbox is DOM chrome, not text — so the
backend fallback parser read todos as paragraphs. Fixed at both ends:

- Client builds text by walking the **store** (`docPlainText`), not the DOM, so markers
  and checked state survive; also picks up unrendered blocks. Database cell values are
  walked explicitly since the DOM read included them for free. `innerText` stays as a
  fallback if the walk yields nothing.
- Server's `blocksFromText` parses `- [ ]` / `- [x]` into real todo blocks — independently
  useful, since users type those markers by hand into plain paragraphs.

- [docText.ts](/home/sajjad/workspace/metanoiadocs/web-react/src/editor/docText.ts)
- [intelligence.js:55](/home/sajjad/workspace/metanoiadocs/server/src/intelligence.js:55)

### Intelligence rail: expanded state not persisted

"More signals" now persists to `localStorage` under `mn-rail-more`, matching the rail's
own open state, and the button toggles both ways (it previously only expanded, with no
way back).

- [IntelligenceRail.tsx:57](/home/sajjad/workspace/metanoiadocs/web-react/src/components/intelligence/IntelligenceRail.tsx:57)

## Not bugs

Both trace to the v1 plan, which v2 supersedes.

### Intelligence extraction does not match the documented rules

- **Title minimum.** v1 says len≥4; v2 Task 3 says *"min length 5"* and its own test
  asserts a 4-character title is skipped. `t.length < 5` is correct.
- **Decision pattern.** v2 specifies `/\bdecided\b|\bdecision\b|\bconclusion\b|\bagreed\b/i`
  and says to drop the bare `we will|chose`. The code matches exactly — the narrowing
  raises precision on bare future tense.
- **Deadline pattern.** Matches the v1 implementation step verbatim. v2 does not change it.

Widening these is a spec decision, not a defect.

- [2026-08-03-intelligence-v2.md:106](/home/sajjad/workspace/metanoiadocs/docs/superpowers/plans/2026-08-03-intelligence-v2.md:106)

### Rail `[[title]]` copy affordance

v2 Step 5 removes it explicitly: *"drop dead affordance. Remove the copy `[[title]]`
button (nothing consumes wiki-links); rows navigate on click only. (Keep the copy icon
out entirely.)"* Re-adding it reintroduces a dead control.

- [2026-08-03-intelligence-v2.md:350](/home/sajjad/workspace/metanoiadocs/docs/superpowers/plans/2026-08-03-intelligence-v2.md:350)

## Validation

- Backend tests: 16 passed (13 pre-existing + 3 new)
- Frontend tests: 33 passed (29 pre-existing + 4 new)
- `tsc --noEmit`: no errors in `src/` (remaining errors are pre-existing in `node_modules/@blocksuite`)
- Production build: passed
- `git diff --check`: passed

The two chart fixes are covered only through the already-tested `resolveChartData` they
delegate to; the Lit panel and canvas wiring are unverified without a DOM test environment.
