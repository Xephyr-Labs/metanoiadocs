# Designs in MetanoiaDocs — a canvas that lives beside the docs

**Date:** 2026-08-19
**Status:** proposed

## What this is

A **Designs** section in the sidebar. You make a design the way you make a
document, and it opens on the canvas that every document already has — plus the
few controls BlockSuite does not already draw for us.

## What already exists (and is therefore not being built)

BlockSuite gives every document an edgeless canvas — shapes, brush, connectors,
frames, edgeless text, images — reachable today through the Page/Edgeless/Slides
toggle. The engine is not the gap. The gap is chrome.

`web-react/src/editor/slides.ts` is the working precedent for driving that canvas
from our own React chrome: it reaches `std.get(GfxControllerIdentifier)`, reads
frames off it, creates elements, and moves the viewport.

**The vocabulary, in full** (checked against the installed 0.22.4, so nobody has
to re-derive it): shapes are `rect`, `ellipse`, `diamond`, `triangle` — plus
rounded-rect via radius — in two styles, General and Scribbled. Alongside them:
brush, connector, text, note, frame, image, group, mindmap, link, template.

**What BlockSuite already renders, and we therefore do not build:**

| Already there | Package |
|---|---|
| Element toolbar on selection — fill, stroke, style, font | `affine-widget-edgeless-toolbar`, `affine-widget-toolbar` |
| Frames panel (frames are artboards) | `affine-fragment-frame-panel` |
| Export to PNG / PDF | `ExportManager` in `affine-block-surface` |
| Zoom, fit, presentation | `affine-widget-edgeless-zoom-toolbar`, `PresentTool` |

Grepping for an alignment helper found none, so align/distribute is the one
control genuinely absent.

## Decisions taken

| Question | Answer |
|---|---|
| What are designs for | A general-purpose canvas — no single workflow to optimise for |
| Relationship to documents | A document with a `kind` flag, not a separate entity |
| Controls for v1 | Frames panel (reused), align + distribute, export — see below |
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
- mounts the frames panel beside the canvas, inside `EditorArea`'s canvas
  branch where `SlidesRail` already mounts for slides.

The sidebar gains a **Designs** section, built like the Projects section:
`SectionLabel` with a `+` action, rows that highlight when active. Designs also
still appear in folders, favourites and search, because they are documents.

### 3. Controls — only what is missing

No 260px rail of hand-built panels. The element toolbar already carries
appearance, so a Properties panel would re-render what BlockSuite draws two
inches away, and export is a menu item rather than a panel. What is left:

- **Frames panel** — mount `affine-fragment-frame-panel` beside the canvas, the
  way `SlidesRail` mounts for slides. Frames are artboards, so this is the
  layers list for the structure that matters, at the cost of mounting a
  component that already exists.
- **Align + distribute** — the one real gap. Pure functions in `lib/align.ts`
  (`alignBounds(bounds, mode) → bounds[]`), applied with one
  `gfx.updateElement` per changed element inside a single `store.transact` so it
  is one undo step and one Yjs update. Reads the selection from
  `gfx.selection.selectedElements`, geometry from `Bound.deserialize(el.xywh)`.
  Rendered as a small floating cluster, enabled on multi-select: ≥2 elements to
  align, ≥3 to distribute.
- **Export** — a menu item calling `ExportManager.exportPng()` / `exportPdf()`.
  Exporting just the selection uses `edgelessToCanvas(renderer, bound, gfx,
  blocks, elements)` with `gfx.selection.selectedBound`, and can `PUT
  /api/blob/:key` so an export drops into a document and rides the existing
  docx/PDF path.

A hand-built layers tree for non-frame elements is **deferred**, not planned. If
frames turn out not to be enough after real use, `gfx.gfxElements` ordered by
`gfx.layer.compare` is the way in, and reordering means writing a fractional
`index` prop. Not before someone actually asks.

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

Following the repo's split — pure logic under vitest, the imperative BlockSuite
seam checked in a browser:

- `lib/align.ts` — align and distribute maths, including the degenerate cases:
  one element, identical bounds, zero-width elements, and distribute with
  exactly three.
- Browser pass: create a design from the sidebar, draw three shapes, align and
  distribute them, export a PNG, then confirm the design appears in version
  history and restores.

## Risks

1. **`gfx` API surface stability.** `slides.ts` already depends on it and has
   held across this BlockSuite version. Everything we touch stays behind one
   thin module (`lib/designCanvas.ts`) so a BlockSuite bump has a single place
   to fix.
2. **Scope creep toward Figma.** The ceiling section above is the answer. The
   vocabulary table is there so the limit is a fact, not an opinion.

## Phasing

1. Entity + navigation: `kind` column, API, sidebar Designs section, create,
   open in edgeless with the mode toggle hidden.
2. Frames panel mounted beside the canvas.
3. Align + distribute.
4. Export menu item.

Phase 1 alone gives the team "designs live here", and the canvas already works
— so it is worth shipping and living with before anything else is built. Phases
2-4 are each a day or less, and should be ordered by what people actually miss.
