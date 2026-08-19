# Designs in MetanoiaDocs — a canvas with a controls rail

**Date:** 2026-08-19
**Status:** proposed

## What this is

A **Designs** section in the sidebar. You make a design the way you make a
document, it opens on the canvas, and a rail sits between the sidebar and the
canvas carrying the controls a design tool has and a whiteboard does not:
layers, properties, alignment, export.

## What already exists (and is therefore not being built)

BlockSuite gives every document an edgeless canvas — shapes, brush, connectors,
frames, edgeless text, images — reachable today through the Page/Edgeless/Slides
toggle. The engine is not the gap. The gap is chrome.

`web-react/src/editor/slides.ts` is the working precedent for driving that canvas
from our own React chrome: it reaches `std.get(GfxControllerIdentifier)`, reads
frames off it, creates elements, and moves the viewport. The rail is the same
seam, wider.

## Decisions taken

| Question | Answer |
|---|---|
| What are designs for | A general-purpose canvas — no single workflow to optimise for |
| Relationship to documents | A document with a `kind` flag, not a separate entity |
| Rail contents for v1 | Layers, properties, align + distribute, export |
| Engine | BlockSuite edgeless, extended — not Excalidraw, not Grida |

### Why a flag on `docs` rather than a `designs` table

Everything a design needs already hangs off a document: sharing and permissions
(`doc_access`), folders, favourites, trash and retention, full-text search,
comments, and — as of this week — version history with in-place restore. A
design that is a document inherits all of it on day one. A separate table
re-implements each one, and the version-history work would not apply to it.

### The ceiling, stated plainly

This produces a very good general-purpose canvas. It does **not** produce Figma,
and it does not grow into Figma. Out of scope, permanently, under this design:
vector pen/bezier path editing, components and instances, auto-layout,
constraints, boolean operations, design tokens. Those need a different engine
(Penpot beside the app, or Grida's canvas once it leaves canary). If the team
later needs them, that is a new project, not an increment of this one.

## Architecture

### 1. The entity

`docs.kind TEXT NOT NULL DEFAULT 'doc'` — `'doc' | 'design'`. Added in
`initSchema` beside the other additive columns.

- `POST /api/docs` accepts `kind`; the row is returned with it.
- `GET /api/docs` returns `kind` so the sidebar can split the list.
- Everything else — access, trash, versions, search, comments — is untouched,
  because a design *is* a doc.

A design is seeded with a surface block at creation (page + surface + note),
which the existing `buildDocState` path already produces; `mountEditor`'s
`ensureSurface` covers documents that predate this.

### 2. The view

No new view type. `ws.view` stays `'doc'`; opening a document whose `kind` is
`'design'`:

- forces `ws.mode = 'edgeless'` and hides the Page/Edgeless/Slides toggle (a
  design has one surface, and offering "page mode" on it invites confusion),
- mounts `DesignRail` between the sidebar and the canvas, inside `EditorArea`'s
  canvas branch where `SlidesRail` already mounts for slides.

The sidebar gains a **Designs** section, built like the Projects section:
`SectionLabel` with a `+` action, rows that highlight when active. Designs also
still appear in folders, favourites and search, because they are documents.

### 3. The rail

`web-react/src/components/design/DesignRail.tsx`, 260px, `border-r border-line`,
four collapsible panels. It holds no state of its own about the document — every
panel reads the gfx controller and writes back through it, so a teammate's edit,
an undo, or a version restore all flow through without a sync layer.

```
Sidebar │ DesignRail            │ canvas
        │ ── Layers ─────────── │
        │  Frame 1              │
        │   Rect                │
        │   Text                │
        │ ── Properties ─────── │
        │  X  120   Y  64       │
        │  W  320   H  180      │
        │  Fill ▪  Stroke ▪     │
        │ ── Align ──────────── │
        │ ── Export ─────────── │
```

## The four panels, against the real API

All of this is `@blocksuite/std/gfx` `GfxController`, reached exactly as
`slides.ts` reaches it.

### Layers

- **Read:** `gfx.gfxElements` (`GfxModel[]` — canvas elements *and* gfx blocks),
  sorted with `gfx.layer.compare(a, b)` so the list matches stacking order.
- **Select:** `gfx.selection.set({ elements: [id] })`; multi-select passes several.
- **Stay in sync:** subscribe to `gfx.selection.slots.updated` (an rxjs `Subject`)
  and to the document's Yjs update stream, the way `attachImageAlign` already does.
- **Reorder:** stacking is a fractional `index` prop on the element; bring
  forward/send back writes a new index between its neighbours via
  `gfx.updateElement(el, { index })`. Reuse `lib/reorder.ts`'s `placeAt` idea,
  ported to fractional strings.
- **Delete:** `gfx.deleteElement(el)`.
- **Naming:** frames carry `title`; other element types have no name property, so
  rows fall back to a type label ("Rectangle", "Connector"). Renaming arbitrary
  elements is deferred rather than faked with a parallel name map.
- Visibility/lock toggles are **not** in v1 — pending confirmation that the
  element models carry those props rather than them being an editor-only concept.

### Properties

Two bands:

1. **Geometry — every element.** `x`, `y`, `w`, `h`, rotation. Read from
   `Bound.deserialize(el.xywh)`; write with
   `gfx.updateElement(el, { xywh: bound.serialize() })`.
2. **Appearance — per element type.** Shapes carry `fillColor` / `strokeColor` /
   `strokeWidth` / `radius`; brush carries `color` / `lineWidth`; text carries
   `fontSize` / `color`; connectors carry stroke and endpoints. The panel renders
   the band matching the selection's type, and shows only the shared geometry
   band for a mixed selection.

Colours come from the existing palette tokens, not a colour picker — a full
picker is its own project.

### Align + distribute

Pure geometry over the selection's `Bound`s: align left/centre/right and
top/middle/bottom, distribute horizontal/vertical spacing. Implemented as pure
functions in `lib/align.ts` (`alignBounds(bounds, mode) → bounds[]`), then one
`gfx.updateElement` per changed element inside a single `store.transact` so it
is one undo step and one Yjs update.

Needs ≥2 elements selected for align, ≥3 for distribute; the buttons disable
otherwise.

### Export

Uses BlockSuite's own `ExportManager` from `@blocksuite/affine-block-surface`,
registered through `editor.edgelessSpecs` alongside the extensions
`mountEditor` already installs:

- `edgelessToCanvas(surfaceRenderer, bound, gfx, blocks, elements)` →
  `HTMLCanvasElement`, given `gfx.selection.selectedBound` (or
  `gfx.elementsBound` for the whole canvas).
- Canvas → blob at 1x/2x → either a download, or a `PUT /api/blob/:key` so an
  exported image can be dropped into a document and ride the existing docx/PDF
  and print pipeline.
- `exportPng()` / `exportPdf()` cover the whole-canvas case directly.

Remote images inside the canvas need `imageProxyEndpoint`; ours are same-origin
via `/api/blob`, so this should be a non-issue — confirm during implementation.

## What this inherits for free

Worth being explicit, because it is the whole argument for the flag-on-docs
approach:

- **Multiplayer** — the canvas is the document's Yjs state, already synced over
  hocuspocus with presence.
- **Version history and restore** — a design gets snapshots, the rendered
  preview, and in-place restore with no extra work; `rewriteDoc` replaces the
  blocks map, and surface elements live in it.
- **Comments, folders, favourites, trash, search, permissions, public links.**

## Testing

Following the repo's existing split — pure logic under vitest, the imperative
BlockSuite seam checked in a browser:

- `lib/align.ts` — align and distribute maths, including the degenerate cases
  (one element, identical bounds, zero-width elements).
- Fractional index generation for reordering — that a new index sorts strictly
  between its neighbours, and that repeated reordering does not collapse.
- Property coercion — a typed value in the geometry inputs producing a valid
  serialised `xywh`, and rejecting NaN rather than writing it to the document.
- Browser pass: create a design from the sidebar, draw two shapes, select from
  the layers list, set geometry numerically, align them, export a PNG, then
  confirm the design appears in version history and restores.

## Risks

1. **Per-type property variance.** There is no single "fill" across element
   types. Mitigation: the appearance band is keyed off element type with a
   shared geometry band; unknown types render geometry only rather than
   guessing.
2. **Fractional index reordering.** Getting z-order wrong is visible and
   annoying. Mitigation: pure, unit-tested index generation; the layers list
   renders from `gfx.layer.compare`, so it always shows the truth.
3. **`gfx` API surface stability.** `slides.ts` already depends on it and has
   held across this BlockSuite version. Anything we touch stays behind a thin
   module (`lib/designCanvas.ts`) so a BlockSuite bump has one place to fix.
4. **Scope creep toward Figma.** The ceiling section above is the answer;
   anything past it is a different project.

## Phasing

1. Entity + navigation: `kind` column, API, sidebar Designs section, create,
   open in edgeless with the toggle hidden. A design is usable immediately —
   the canvas already works.
2. Rail shell + Layers.
3. Properties.
4. Align + distribute.
5. Export.

Each phase is independently shippable, and phase 1 alone already gives the
team "designs live here" without a half-built rail in the way.
