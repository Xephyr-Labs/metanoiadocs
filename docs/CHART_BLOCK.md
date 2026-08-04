# Chart block (`metanoia:chart`)

An interactive Apache ECharts chart as a first-class BlockSuite block. Renders in
both **Page** and **Edgeless**, stays interactive (never a static image), and
persists only its configuration + data — never rendered pixels.

## Architecture

All code lives in `web-react/src/editor/chart/`. Layers, inner → outer:

| File | Responsibility |
|------|----------------|
| `chart-types.ts` | Typed schema (`ChartBlockProps`, data sources), defaults, sample data. Pure. |
| `chart-schema.ts` | Validation/normalization, migration, JSON sanitization, prototype-pollution-safe merge of `advancedOptions`. Pure. |
| `buildEChartsOption.ts` | **Adapter**: `(props, rows) → EChartsOption`. Bar/line/pie/scatter, multi-Y, group-by, aggregation, zoom. Pure, no BlockSuite/ECharts runtime. |
| `data-source.ts` | Resolves a `ChartDataSource` → `{rows, columns}`. Inline (complete) + database (read from model). The seam for new data adapters. |
| `echarts-setup.ts` | Modular ECharts registration (only bar/line/pie/scatter + tooltip/legend/grid/dataset/dataZoom/title/transform + canvas renderer). Dynamically imported. |
| `chart-canvas.ts` | `<metanoia-chart-canvas>` — the LitElement that owns the ECharts instance: init-after-mount, `ResizeObserver`, dispose, `setOption` dedup, theme, empty/invalid/error states, interaction gating. Shared by both modes. |
| `chart-config-panel.ts` | `<metanoia-chart-config>` — the settings drawer + inline table editor. Edits props via BlockSuite transactions. |
| `chart-model.ts` | BlockSuite schema + gfx-compatible model. |
| `chart-block.ts` / `chart-edgeless-block.ts` | Page (`BlockComponent`) and Edgeless (`GfxBlockComponent`) views. |
| `chart-slash.ts` | `/chart` slash-menu item. |
| `spec.ts` / `effects.ts` / `index.ts` | View extensions, custom-element registration, public surface. |

ECharts is a **dynamic import** (`echarts-setup` chunk, ~210 KB gzip) — it never
enters the main bundle and only loads for docs that actually render a chart.

## Block schema

`ChartBlockProps` (see `chart-types.ts`) is the persisted config. The model adds
gfx geometry props (`xywh`, `index`, `rotate`, `lockedBySelf`) so it is an
edgeless element — mirroring the built-in image block:

```ts
export class MetanoiaChartBlockModel
  extends GfxCompatible<MetanoiaChartProps>(BlockModel)
  implements GfxElementGeometry {}
```

`CHART_SCHEMA_VERSION` (currently `1`) is stored as `props.version`.
`normalizeChartProps()` coerces any untrusted/partial value into a valid shape;
`migrateChartProps()` is the version-migration entry point.

## Registration

Wired in `mountEditor.ts` (three touch-points, same pattern as any BlockSuite block):

```ts
chartEffects();                                  // define custom elements once
schema.register([MetanoiaChartBlockSchema]);     // standalone schema
collection.storeExtensions = [...storeManager.get('store'), MetanoiaChartBlockSchemaExtension]; // store DI
editor.pageSpecs     = [...viewManager.get('page'),     ...chartViewExtensions, ...common];
editor.edgelessSpecs = [...viewManager.get('edgeless'), ...chartViewExtensions, ...common];
```

`chartViewExtensions` = `FlavourExtension` + one parent-aware `BlockViewExtension`
+ `SlashMenuConfigExtension`.

## Page and Edgeless rendering

One flavour, two custom elements, chosen by parent — the exact image-block
mechanism:

```ts
BlockViewExtension('metanoia:chart', model =>
  model.store.getParent(model.id)?.flavour === 'affine:surface'
    ? literal`metanoia-edgeless-chart`   // GfxBlockComponent
    : literal`metanoia-chart`);          // BlockComponent
```

Both views host the **same** `<metanoia-chart-canvas>` with the same `model` +
`store`, so a chart is a single block/data-model in both modes. The canvas reads
config from `model.props`, resolves data, and renders; it self-refreshes on
`model.propsUpdated`, on theme flips, and on resize.

**Interaction vs selection** (canvas): the ECharts container is
`pointer-events: none` by default, so a click selects/moves the block. Double-click
(or the on-hover **Interact** chip) enables `pointer-events`, shows a subtle accent
ring, and routes hover/zoom/legend to ECharts. **Esc** or a click outside exits.

## Data-source adapters

`resolveChartData(store, source)` in `data-source.ts` is the single seam.

- **inline** — rows/columns straight from the block.
- **database** — reads `columns`, `cells`, and child-row order off the
  `affine:database` model. Handles deleted/inaccessible sources gracefully.

### Adding a new external data-source adapter

1. Add a variant to `ChartDataSource` in `chart-types.ts` (e.g. `{ sourceType: 'api'; url: string }`).
2. Handle it in `normalizeDataSource()` (validation) in `chart-schema.ts`.
3. Add a branch in `resolveChartData()` returning `{ ok, rows, columns, error? }`.
4. Add a picker in `chart-config-panel.ts` `render()`.

## Adding a new chart type

1. Add the literal to `ChartType` in `chart-types.ts` and to `CHART_TYPES`.
2. Register the ECharts chart in `echarts-setup.ts` (`echarts.use([...])`).
3. Add a `buildXxx(props, rows)` branch in `buildEChartsOption.ts`.
4. Add a case to the `switch` in `buildEChartsOption`.
5. Add tests in `chart.test.ts`.

No UI change needed — the config panel reads `CHART_TYPES`.

## Security

- `advancedOptions` is **serializable JSON only** — `sanitizeAdvancedOptions()`
  strips functions/symbols/undefined and blocks `__proto__`/`prototype`/`constructor`.
- `mergeAdvancedOptions()` deep-merges advanced JSON onto the generated option but
  **cannot** overwrite `series`/`dataset` (the data pipeline) and is
  prototype-pollution safe at every level.
- No `eval`, no persisted callbacks.

## Testing

`npm test` (vitest) runs `chart.test.ts`: adapter (all four types, multi-Y,
group-by), every aggregation, invalid/empty data, schema defaults + coercion,
migration, and the sanitize/merge security guarantees.

Full editor-integration behaviours (mount lifecycle, resize, block insertion,
persistence, Page/Edgeless render) are verified in the running app via Playwright
rather than a headless BlockSuite harness (none is configured in this repo).

## Known limitations / TODO

- **Standalone Edgeless gfx element.** A chart inserted via `/chart` lives in a
  note and renders interactively in both Page and Edgeless (inside the note). A
  chart parented directly to `affine:surface` (a free-floating, individually
  drag-resizable canvas element) does **not** yet render: BlockSuite 0.22.4's
  edgeless-root block portal does not pick up the custom gfx flavour from just
  `FlavourExtension` + a `GfxBlockComponent` view (image works via additional
  internal wiring). The gfx model + `metanoia-edgeless-chart` component are in
  place; the missing piece is the edgeless-root surface-block-portal registration
  for a custom flavour. **TODO:** register the chart flavour with the edgeless
  root's block portal (investigate `affine-block-root/src/edgeless`).
- **Database view filtering.** `data-source.ts` reads **all** rows from an
  `affine:database` model. View-scoped filters/sort/grouping live in
  `@blocksuite/data-view`'s runtime, not the model, so `viewId` is persisted and
  selectable but not yet applied. **TODO** marked in `data-source.ts`.
- **Toolbar "Insert chart".** Insertion is via the `/chart` slash command. A
  global toolbar entry (`ToolbarModuleExtension`) can be added the same way the
  image block does.
