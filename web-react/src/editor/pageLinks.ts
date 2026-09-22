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
import { ActionPlacement, DocDisplayMetaProvider, ToolbarModuleExtension } from '@blocksuite/affine/shared/services';
import { BlockFlavourIdentifier } from '@blocksuite/affine/std';
import { OpenInNewIcon } from '@blocksuite/icons/lit';
import { docUrl } from '../lib/route';
import { insertLinkedNode, RefNodeSlotsProvider } from '@blocksuite/affine/inlines/reference';
import { LinkedWidgetConfigExtension } from '@blocksuite/affine/widgets/linked-doc';
import { computed, signal } from '@preact/signals-core';
import { docsApi } from '../lib/docsApi';
import { html, type TemplateResult } from 'lit';

/** The slice of a page this module needs. Mirrors `lib/types.ts` Page. */
export interface LinkTarget {
  id: string;
  title: string;
  icon: string;
  /** Last save, for breaking ties between equally good title matches. */
  updatedAt?: string;
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

/**
 * Workspace members, for the "@" menu's people group. Fetched once per page
 * load and cached at module scope: the menu is rebuilt synchronously on every
 * keystroke, so it cannot await anything, and a list of colleagues does not
 * change mid-session. Until it arrives the group simply does not appear.
 */
let people: { id: string; name: string; username: string | null }[] = [];
let peopleLoading = false;

/** The cached member list, for the custom "@" panel. Empty until it lands. */
export const linkPeople = () => people;

function loadPeople() {
  if (peopleLoading || people.length) return;
  peopleLoading = true;
  docsApi.users()
    .then((rows) => { people = rows.filter((u) => u.username); })
    .catch(() => { /* the menu just keeps its pages-only shape */ })
    .finally(() => { peopleLoading = false; });
}

/**
 * What the open "@" menu can do, published for the panel that replaces its
 * looks (linkedDocMenu.ts). Everything here needs the live inline editor and
 * the widget's own abort — which delete the trigger text and close the popover
 * — and both are handed to `getMenus` and to nothing else, so this is where
 * they are caught. Read at the moment of the click, never cached: a stale
 * inline editor writes into a block that is no longer there.
 */
export interface LiveLinkMenu {
  /** What the widget itself has as the query — the characters that reached the
   *  page before the panel took focus, which the panel starts from. */
  query: string;
  abort: () => void;
  link: (docId: string) => void;
  mention: (username: string) => void;
  create: (title: string) => Promise<void>;
}

/** The slice of BlockSuite's inline editor the caret dance needs. Loosely
 *  typed at the boundary, like the rest of this file's BlockSuite contact. */
interface InlineEditorParts {
  eventSource?: HTMLElement | null;
  yText?: { length: number };
  getInlineRange: () => { index: number; length: number } | null;
  toDomRange: (range: { index: number; length: number }) => Range | null;
}

let live: LiveLinkMenu | null = null;

export const liveLinkMenu = () => live;

/**
 * A person is written as literal "@username" text, not a reference node.
 *
 * That is deliberate: it is the exact shape the server already scans for in
 * comment bodies, so the same handle means the same person whether it is typed
 * in a comment or in the page, and no new inline node, schema version or
 * renderer has to exist for it. The handle is bolded and the trailing space is
 * not, so the cursor does not carry bold into whatever is typed next.
 */
function insertMention(
  inlineEditor: Parameters<typeof insertLinkedNode>[0]['inlineEditor'],
  username: string,
) {
  const editor = inlineEditor as unknown as {
    getInlineRange: () => { index: number; length: number } | null;
    insertText: (range: { index: number; length: number }, text: string, attrs?: unknown) => void;
    setInlineRange: (range: { index: number; length: number }) => void;
  } | null;
  const range = editor?.getInlineRange();
  if (!editor || !range) return;
  const handle = `@${username}`;
  editor.insertText(range, handle, { bold: true });
  editor.insertText({ index: range.index + handle.length, length: 0 }, ' ');
  editor.setInlineRange({ index: range.index + handle.length + 1, length: 0 });
}

/** Subsequence match, the same shape BlockSuite's own `isFuzzyMatch` uses.
 *  Exported so the link popup's page search matches what the "@" menu matches —
 *  two doc pickers that disagree about what "lnch" finds are two features. */
export function fuzzy(title: string, query: string) {
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

/**
 * The pages that match `query`, best first.
 *
 * Filtering alone was enough with thirty pages and useless with three hundred:
 * `fuzzy` is a subsequence match, so a short query matches almost everything,
 * and the survivors came back in sidebar order — the six shown were the six
 * highest in the tree, not the six most likely. The tiers below are the order
 * a person means them: the exact title, one that starts this way, a word that
 * starts this way, the letters somewhere in it, all the typed words in any
 * order, and only then a loose subsequence. Recency breaks ties, because the
 * page you touched this morning is usually the one you are linking to.
 */
export function rankPages<T extends LinkTarget>(pages: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return pages;
  const words = q.split(/\s+/).filter(Boolean);
  const scored: { page: T; score: number; title: string }[] = [];
  for (const page of pages) {
    const title = (page.title || UNTITLED).toLowerCase();
    let score: number;
    if (title === q) score = 0;
    else if (title.startsWith(q)) score = 1;
    else if (title.split(/[^a-z0-9]+/).some((w) => w && w.startsWith(q))) score = 2;
    else if (title.includes(q)) score = 3;
    else if (words.length > 1 && words.every((w) => title.includes(w))) score = 4;
    else if (fuzzy(title, q)) score = 5;
    else continue;
    scored.push({ page, score, title });
  }
  scored.sort((a, b) =>
    a.score - b.score ||
    (b.page.updatedAt ?? '').localeCompare(a.page.updatedAt ?? '') ||
    a.title.length - b.title.length);
  return scored.map((s) => s.page);
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
    const matches = rankPages(pages().filter((p) => p.id !== currentId), query);

    const link = (docId: string) => insertLinkedNode({ inlineEditor, docId });

    live = {
      query,
      // Abandoning the menu has to hand the caret back. Picking an item does
      // that by writing into the page; Escape writes nothing, so without this
      // the focus stays in a panel that no longer exists and the next thing
      // typed goes nowhere.
      abort: () => {
        abort();
        const editor = inlineEditor as unknown as InlineEditorParts;
        const source = editor.eventSource;
        const range = editor.getInlineRange();
        if (!source) return;
        source.focus();
        // Next frame, not this one. The focusable element is the page root, so
        // focusing it alone drops the caret at the top of the document, and
        // BlockSuite syncs the selection again right after — the caret has to
        // be put back once that has happened. Clamped, because the range still
        // counts the "@" that abort has just deleted.
        requestAnimationFrame(() => {
          const index = Math.min(range?.index ?? 0, editor.yText?.length ?? 0);
          const dom = editor.toDomRange({ index, length: 0 });
          if (!dom) return;
          const selection = source.ownerDocument.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(dom);
        });
      },
      link: (docId) => { abort(); link(docId); },
      mention: (username) => { abort(); insertMention(inlineEditor, username); },
      create: async (title) => {
        abort();
        const id = await createPage(title.trim() || UNTITLED);
        if (id) link(id);
      },
    };

    const matchedPeople = people.filter(
      (u) => fuzzy(u.username ?? '', query) || fuzzy(u.name || '', query),
    );

    return [
      {
        name: 'Mention a person',
        items: matchedPeople.map((u) => ({
          key: `person:${u.id}`,
          name: u.name || (u.username ?? ''),
          icon: emoji('👤'),
          action: () => {
            abort();
            insertMention(inlineEditor, u.username ?? '');
          },
        })),
        maxDisplay: MAX_MENU_ITEMS,
        overflowText: `${Math.max(matchedPeople.length - MAX_MENU_ITEMS, 0)} more people`,
        hidden: matchedPeople.length === 0,
      },
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

  loadPeople();

  return [
    LinkedWidgetConfigExtension({ getMenus }),
    // "Open in new tab" on the chip's hover toolbar. A `custom:` variant, like
    // the image toolbar: a second module for the flavour itself throws at
    // mount, and a custom one is merged into the built-in row by id. The
    // click goes through the chip's own `open`, so it lands in attachRefClicks
    // below with the mode set, the same as a middle click does.
    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:affine:reference'),
      config: {
        actions: [
          {
            placement: ActionPlacement.Normal,
            id: 'b.open-in-new-tab',
            tooltip: 'Open in new tab',
            icon: OpenInNewIcon(),
            run: (ctx: { message$: { peek: () => { element?: unknown } | null } }) => {
              const target = ctx.message$.peek()?.element as { open?: (e: { openMode: string }) => void } | undefined;
              target?.open?.({ openMode: 'open-in-new-tab' });
            },
          },
        ],
      },
    }),
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
  interface RefClick {
    pageId?: string;
    /** Set by the toolbar action above and by a middle click (BlockSuite
     *  maps button 1 to it); a ⌘/Ctrl click carries the intent on the event. */
    openMode?: string;
    event?: MouseEvent;
  }
  const host = editor.querySelector('editor-host') as
    | { std?: { getOptional?: (id: unknown) => { docLinkClicked?: { subscribe: (fn: (e: RefClick) => void) => { unsubscribe: () => void } } } | undefined } }
    | null;
  const slots = host?.std?.getOptional?.(RefNodeSlotsProvider);
  const sub = slots?.docLinkClicked?.subscribe((e) => {
    if (!e?.pageId) return;
    const newTab = e.openMode === 'open-in-new-tab' || !!e.event?.metaKey || !!e.event?.ctrlKey;
    if (newTab) window.open(docUrl(e.pageId), '_blank', 'noopener');
    else onOpen(e.pageId);
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
