// What the server writes into a page must be something the editor accepts.
//
// The server builds BlockSuite documents by hand (markdown from Andy and the
// API, imports, templates) — server/src/blocks.js writes Yjs keys directly,
// with no BlockSuite in the loop. When the two drift, the page breaks only
// when someone opens it: a table whose rows the editor could not extend, a
// flavour version BlockSuite rejects, a prop it never reads. So a page built
// from markdown that exercises everything the server can write is checked
// here, block by block, against BlockSuite's own schemas.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { AffineSchemas } from '@blocksuite/affine/schemas';
// @ts-expect-error — plain JS from the server, no types.
import { buildDocState } from '../../../server/src/blocks.js';

// Props this app adds on top of BlockSuite's, read back by our own painters.
const OWN_PROPS = new Set(['mnSize', 'mnPanel', 'mnAlign']);
const PARAGRAPH_TYPES = new Set(['text', 'quote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const LIST_TYPES = new Set(['bulleted', 'numbered', 'todo', 'toggle']);
const MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link', 'color', 'background', 'reference', 'latex']);

const MARKDOWN = `
# Heading one
## Heading two
### Heading three
#### Four
##### Five
###### Six

Plain **bold** _italic_ ~~strike~~ \`code\` [a link](https://example.com) <u>under</u> <mark>marked</mark> <span style="color: red; background: yellow">coloured</span>.

<small>A small footnote line.</small>

<big>A big line.</big>

> A quote
> on two lines

- bullet
  - nested bullet
- [ ] to do
- [x] done
1. first
2. second

\`\`\`ts
const a = 1;
\`\`\`

---

| Col A | Col B |
| --- | --- |
| a \\| pipe | 2 |
| 3 | 4 |

> [!NOTE]
> A note panel

> [!WARNING]
> A warning panel

> [!CALLOUT 💡]
> A plain callout

![An image](/api/blob/abc123)

See [[Another page]].
`;

const schemas = new Map(
  (AffineSchemas as unknown as { version: number; model: { flavour: string; props?: (i: unknown) => Record<string, unknown> } }[])
    .map((s) => [s.model.flavour, s]),
);
const propsOf = (flavour: string) =>
  new Set(Object.keys(schemas.get(flavour)?.model.props?.({ Text: () => ({}), Boxed: (v: unknown) => v }) ?? {}));

describe('server-built pages fit the editor', () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, buildDocState('Contract', MARKDOWN, (title: string) => (title === 'Another page' ? 'page-id-1' : null)));
  const blocks = [...doc.getMap('blocks')] as [string, Y.Map<unknown>][];

  it('builds every kind of block the server knows', () => {
    const flavours = new Set(blocks.map(([, b]) => b.get('sys:flavour')));
    for (const f of ['affine:page', 'affine:surface', 'affine:note', 'affine:paragraph', 'affine:list', 'affine:code',
      'affine:divider', 'affine:table', 'affine:callout', 'affine:image']) {
      expect(flavours, f).toContain(f);
    }
  });

  it('uses only flavours, versions and props BlockSuite has', () => {
    for (const [id, b] of blocks) {
      const flavour = String(b.get('sys:flavour'));
      const schema = schemas.get(flavour);
      expect(schema, `${flavour} (${id}) is not a BlockSuite flavour`).toBeTruthy();
      expect(b.get('sys:version'), `${flavour} version`).toBe(schema!.version);
      const known = propsOf(flavour);
      for (const key of b.keys()) {
        if (!key.startsWith('prop:')) continue;
        // Flat keys for nested props: prop:rows.<id>.order belongs to "rows".
        const prop = key.slice(5).split('.')[0];
        expect(known.has(prop) || OWN_PROPS.has(prop), `${flavour} has no prop "${prop}"`).toBe(true);
      }
    }
  });

  it('uses only block types and text marks the editor renders', () => {
    for (const [, b] of blocks) {
      const flavour = b.get('sys:flavour');
      const type = b.get('prop:type');
      if (flavour === 'affine:paragraph') expect(PARAGRAPH_TYPES.has(String(type)), `paragraph type ${type}`).toBe(true);
      if (flavour === 'affine:list') expect(LIST_TYPES.has(String(type)), `list type ${type}`).toBe(true);
      const text = b.get('prop:text');
      if (!(text instanceof Y.Text)) continue;
      for (const op of text.toDelta() as { attributes?: Record<string, unknown> }[]) {
        for (const mark of Object.keys(op.attributes ?? {})) expect(MARKS.has(mark), `mark "${mark}"`).toBe(true);
      }
    }
  });
});
