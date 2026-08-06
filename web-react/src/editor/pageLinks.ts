// Page-to-page @-references.
//
// Every doc is mounted in its own TestWorkspace (one collection, one doc), so
// BlockSuite's built-in "@" menu — which lists `collection.meta.docMetas` — can
// only ever see the page you are already in, and its reference chip renders any
// other page as a deleted doc. These extensions swap both data sources for the
// workspace's real page index:
//
//   · getMenus            → our pages, so "@" can find every page
//   · DocDisplayMetaProvider → live title + emoji for a doc outside the collection
//
// Click routing and link extraction live here too, so everything that knows
// about references sits in one file.
import { DocDisplayMetaProvider } from '@blocksuite/affine/shared/services';
import { insertLinkedNode, RefNodeSlotsProvider } from '@blocksuite/affine/inlines/reference';
import { LinkedWidgetConfigExtension } from '@blocksuite/affine/widgets/linked-doc';
import { computed, signal } from '@preact/signals-core';
import { html, type TemplateResult } from 'lit';

/** The slice of a page this module needs. Mirrors `lib/types.ts` Page. */
export interface LinkTarget {
  id: string;
  title: string;
  icon: string;
}

export interface PageLinkOptions {
  /** Current page index, read fresh on every keystroke so new pages show up. */
  pages: () => LinkTarget[];
  /** The doc being edited — never offer to link a page to itself. */
  currentId: string;
  /** Create a page titled `title` and resolve its id. Must NOT navigate away. */
  createPage: (title: string) => Promise<string | null>;
}

const MAX_MENU_ITEMS = 6;
const UNTITLED = 'Untitled';

/** Subsequence match, the same shape BlockSuite's own `isFuzzyMatch` uses. */
function fuzzy(title: string, query: string) {
  if (!query) return true;
  const t = title.toLowerCase();
  const q = query.toLowerCase();
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i += 1;
    if (i === q.length) return true;
  }
  return false;
}

const emoji = (icon: string): TemplateResult<1> =>
  html`<span style="font-size:16px;line-height:20px">${icon || '📄'}</span>`;

/**
 * Everything the editor needs to offer, render and route page references.
 * Spread into the editor's extension list alongside the other DI overrides.
 */
export function pageLinkExtensions({ pages, currentId, createPage }: PageLinkOptions) {
  const find = (id: string) => pages().find((p) => p.id === id);

  const getMenus = (
    query: string,
    abort: () => void,
    _host: unknown,
    inlineEditor: Parameters<typeof insertLinkedNode>[0]['inlineEditor'],
  ) => {
    const matches = pages()
      .filter((p) => p.id !== currentId)
      .filter((p) => fuzzy(p.title || UNTITLED, query));

    const link = (docId: string) => insertLinkedNode({ inlineEditor, docId });

    return [
      {
        name: 'Link to page',
        items: matches.map((p) => ({
          key: p.id,
          name: p.title || UNTITLED,
          icon: emoji(p.icon),
          action: () => {
            abort();
            link(p.id);
          },
        })),
        maxDisplay: MAX_MENU_ITEMS,
        overflowText: `${Math.max(matches.length - MAX_MENU_ITEMS, 0)} more pages`,
        hidden: matches.length === 0,
      },
      {
        name: 'New page',
        items: [
          {
            key: 'create',
            name: query ? `Create “${query}” and link it` : 'Create a page and link it',
            icon: emoji('✨'),
            action: async () => {
              abort();
              const id = await createPage(query.trim() || UNTITLED);
              if (id) link(id);
            },
          },
        ],
      },
    ];
  };

  return [
    LinkedWidgetConfigExtension({ getMenus }),
    {
      setup: (di: { override: (a: unknown, b: unknown) => void }) =>
        di.override(DocDisplayMetaProvider, {
          // Signals are recreated per call rather than cached: the page index is
          // a plain array that React replaces on every refresh, so there is
          // nothing stable to subscribe to. Reference chips re-render on doc
          // update anyway, which is when a title change would land.
          title: (pageId: string, params?: { title?: string }) =>
            computed(() => find(pageId)?.title || params?.title || 'Deleted page'),
          icon: (pageId: string) => signal(emoji(find(pageId)?.icon ?? '')),
        }),
    },
  ];
}

/**
 * Route clicks on a reference chip back into the app instead of letting
 * BlockSuite try to open a doc that isn't in this collection.
 * Returns a detach function; the underlying subject is a module-level singleton
 * in BlockSuite, so failing to unsubscribe would leak across mounts.
 */
export function attachRefClicks(editor: Element, onOpen: (docId: string) => void) {
  const host = editor.querySelector('editor-host') as
    | { std?: { getOptional?: (id: unknown) => { docLinkClicked?: { subscribe: (fn: (e: { pageId?: string }) => void) => { unsubscribe: () => void } } } | undefined } }
    | null;
  const slots = host?.std?.getOptional?.(RefNodeSlotsProvider);
  const sub = slots?.docLinkClicked?.subscribe((e) => {
    if (e?.pageId) onOpen(e.pageId);
  });
  return () => {
    try { sub?.unsubscribe(); } catch { /* noop */ }
  };
}

/**
 * Every page this doc @-references, deduped. Walked off the store rather than
 * the DOM so references inside collapsed or unrendered blocks still count.
 *
 * The result REPLACES the stored link set, so under-collecting silently deletes
 * backlinks. Rich text is not only `model.text` — table and database cells hold
 * their own, nested under props — so this scans props for anything delta-shaped
 * instead of naming paths it would be easy to forget to update.
 * Loosely typed at this boundary, like docText.ts.
 */
export function collectPageLinks(store: unknown): string[] {
  const ids = new Set<string>();

  const takeDeltas = (value: any) => {
    for (const d of value.toDelta() ?? []) {
      const pageId = d?.attributes?.reference?.pageId;
      if (typeof pageId === 'string' && pageId) ids.add(pageId);
    }
  };

  // Depth guard: props are plain data, but a cycle here would hang the save.
  const scan = (value: any, depth: number) => {
    if (!value || depth > 6) return;
    if (typeof value.toDelta === 'function') return takeDeltas(value);
    if (Array.isArray(value)) {
      for (const v of value) scan(v, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      for (const v of Object.values(value)) scan(v, depth + 1);
    }
  };

  const walk = (model: any) => {
    if (!model) return;
    scan(model.text, 0);
    scan(model.props, 0);
    for (const child of model.children ?? []) walk(child);
  };

  for (const child of (store as any)?.root?.children ?? []) walk(child);
  return [...ids];
}
