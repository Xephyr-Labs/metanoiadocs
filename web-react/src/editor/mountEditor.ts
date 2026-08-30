// BlockSuite mount wired to the real backend: content persists + syncs live
// over Hocuspocus (/sync), blobs go to Postgres (/api/blob), and the title +
// plain text are pushed back so the sidebar and search stay current.
import { effects as itEffects } from '@blocksuite/integration-test/effects';
import { getTestViewManager } from '@blocksuite/integration-test/view';
import { getTestStoreManager } from '@blocksuite/integration-test/store';
import { AffineSchemas } from '@blocksuite/affine/schemas';
import { Schema, Text } from '@blocksuite/affine/store';
import { TestWorkspace } from '@blocksuite/affine/store/test';
import {
  DocModeProvider,
  EditorSettingExtension,
  FontConfigExtension,
  FeatureFlagService,
  CommunityCanvasTextFonts,
  ThemeExtensionIdentifier,
  VirtualKeyboardProvider,
} from '@blocksuite/affine/shared/services';
import { ColorScheme } from '@blocksuite/affine/model';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { applyUpdate } from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Signal } from '@preact/signals-core';
import { avatarFor } from '../lib/avatar';
import { attachPresence } from './presence';
import { attachComments } from './comments';
import { takePendingSeed } from './pendingSeed';
import { docPlainText } from './docText';
import { attachMermaidPreviews } from './mermaidPreview';
import { attachRefClicks, collectPageLinks, pageLinkExtensions, type LinkTarget } from './pageLinks';
import { missingDocMetas } from './docMetas';
import { blockLinkExtensions } from './blockLinks';
import { attachImageAlign, imageAlignExtensions } from './imageAlign';
import { chartEffects, chartViewExtensions } from './chart';
import { MetanoiaChartBlockSchema, MetanoiaChartBlockSchemaExtension } from './chart/chart-model';
import {
  databaseEffects, databaseViewExtensions,
  MetanoiaDatabaseBlockSchema, MetanoiaDatabaseBlockSchemaExtension,
} from './database';
import { createVirtualKeyboardProvider } from './virtualKeyboard';

let effectsInstalled = false;
function installEffects() {
  if (effectsInstalled) return;
  itEffects();
  // Nothing to add for the floating table of contents: the view manager builds
  // OutlineViewExtension during mount and its effect() defines those elements.
  // Registering them here as well threw NotSupportedError on the second define
  // and took the whole editor down with it.
  effectsInstalled = true;
}

const wsBase = () =>
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sync`;

// Server-backed blobs (images/attachments) keyed by sha256 via /api/blob.
class HttpBlobSource {
  name = 'metanoia-http';
  readonly = false;
  private share: string;
  constructor(share?: string) {
    this.share = share ? `?share=${encodeURIComponent(share)}` : '';
  }
  async get(key: string) {
    const res = await fetch(`/api/blob/${encodeURIComponent(key)}${this.share}`, { credentials: 'same-origin' });
    return res.ok ? await res.blob() : null;
  }
  async set(key: string, value: Blob) {
    await fetch(`/api/blob/${encodeURIComponent(key)}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': value.type || 'application/octet-stream' },
      body: value,
    });
    return key;
  }
  async delete(key: string) {
    await fetch(`/api/blob/${encodeURIComponent(key)}`, { method: 'DELETE', credentials: 'same-origin' });
  }
  async list() {
    const res = await fetch('/api/blob', { credentials: 'same-origin' });
    return res.ok ? await res.json() : [];
  }
}

interface MountArgs {
  docId: string;
  title: string;
  mode: 'page' | 'edgeless';
  userName: string;
  share?: string; // public read-only share token
  /** Render an archived version instead of the live document: the snapshot's
   *  Yjs state is applied to a detached doc with no provider and no local
   *  cache behind it, and the editor is read-only. Nothing is ever written
   *  back — history is a preview, and restoring is a separate, explicit act. */
  snapshot?: Uint8Array;
  onTitle?: (title: string) => void;
  onSaved?: () => void;
  /** Page index for the "@" menu. Omitted for public viewers. */
  pages?: () => LinkTarget[];
  /** Create a page and return its id, without navigating away from this one. */
  createPage?: (title: string) => Promise<string | null>;
  /** A reference chip was clicked — open that page. */
  onOpenDoc?: (docId: string) => void;
  /** The document was rewritten wholesale on the server (a version restore).
   *  The Yjs state has already converged; the editor has to be rebuilt for the
   *  screen to agree with it. */
  onRemoteRewrite?: () => void;
}

function docModeService(editor: { mode: string }, mode: 'page' | 'edgeless') {
  let current = mode;
  return {
    getPrimaryMode: () => current,
    setPrimaryMode: (m: 'page' | 'edgeless') => { current = m; },
    togglePrimaryMode: () => (current = current === 'page' ? 'edgeless' : 'page'),
    getEditorMode: () => editor.mode,
    setEditorMode: () => {},
    onPrimaryModeChange: () => ({ unsubscribe() {} }),
  };
}

export async function mountEditor(
  root: HTMLElement,
  { docId, title, mode, userName, share, snapshot, onTitle, onSaved, pages, createPage, onOpenDoc, onRemoteRewrite }: MountArgs,
) {
  installEffects();
  chartEffects(); // register the metanoia:chart custom elements once
  databaseEffects(); // register the metanoia:database custom element once
  const viewManager = getTestViewManager();
  const storeManager = getTestStoreManager();

  const schema = new Schema();
  schema.register(AffineSchemas);
  schema.register([MetanoiaChartBlockSchema, MetanoiaDatabaseBlockSchema]);

  const collection = new TestWorkspace({ id: docId, blobSources: { main: new HttpBlobSource(share) } });
  // Register the chart schema into the store's DI (this is the channel the
  // collection actually uses; the standalone `schema` above is not wired in).
  collection.storeExtensions = [...storeManager.get('store'), MetanoiaChartBlockSchemaExtension, MetanoiaDatabaseBlockSchemaExtension];
  collection.start();
  collection.meta.initialize();

  const doc = collection.getDoc(docId) ?? collection.createDoc(docId);
  if (!doc) throw new Error('doc did not materialize: ' + docId);

  // This collection holds one doc, but the pages it @-references are real. A
  // reference chip reads existence off `meta.docMetas` and strikes through
  // anything missing from it, so every link would render as deleted unless the
  // index is registered here. Metadata only — no doc is loaded or synced.
  const rememberDocs = (targets: LinkTarget[]) => {
    for (const meta of missingDocMetas(collection.meta.docMetas, targets, Date.now())) {
      collection.meta.addDocMeta(meta);
    }
  };
  if (pages) rememberDocs(pages());
  const store = doc.getStore({ id: docId });

  // A snapshot IS the content — it arrives over HTTP and stays local. Opening a
  // provider here would sync the archived state onto the live document, which
  // is exactly the accident version history exists to protect against.
  if (snapshot) applyUpdate(doc.spaceDoc, snapshot);

  // Live sync to our server. Cookie authenticates a member; a share token
  // authenticates a read-only public viewer.
  const provider = snapshot
    ? null
    : new HocuspocusProvider({
        url: wsBase(),
        name: docId,
        document: doc.spaceDoc,
        parameters: share ? { doc: docId, share } : { doc: docId },
        awareness: collection.awarenessStore.awareness,
      });

  provider?.on('stateless', ({ payload }: { payload: string }) => {
    try { if (JSON.parse(payload)?.type === 'doc-restored') onRemoteRewrite?.(); } catch { /* not ours */ }
  });

  // Local-first persistence: edits are written to IndexedDB, so the doc opens
  // instantly and survives being offline; Hocuspocus merges everything back on
  // reconnect (Yjs is a CRDT, so offline + remote edits combine without conflict).
  // Public read-only viewers don't need a local cache.
  const idb = share || snapshot ? null : new IndexeddbPersistence(`mn-doc-${docId}`, doc.spaceDoc);

  // Name + color ride on awareness: BlockSuite paints remote carets/selections
  // with them, and the TopBar avatar stack reads them via attachPresence.
  // avatarFor keeps the color stable per person (matches their avatar) instead
  // of varying per tab.
  const displayName = userName || 'Someone';
  collection.awarenessStore.awareness.setLocalStateField('user', {
    name: displayName,
    color: avatarFor(displayName).color,
  });
  // A snapshot has no connection and no collaborators; publishing its awareness
  // would put a phantom reader in the live document's presence stack.
  const detachPresence = snapshot ? () => {} : attachPresence(collection.awarenessStore.awareness);

  // Kill BlockSuite's hover tooltips ("Bold", "Underline", …). They portal into
  // body as .blocksuite-portal divs with the tooltip inside a shadow root, so
  // CSS can't reach them — hide each tooltip portal as it appears instead.
  const tooltipKiller = new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes.forEach((n) => {
        if (
          n instanceof HTMLElement &&
          n.classList.contains('blocksuite-portal') &&
          n.shadowRoot?.querySelector('.affine-tooltip')
        ) {
          n.style.display = 'none';
        }
      });
    }
  });
  tooltipKiller.observe(document.body, { childList: true });

  // Whether the server's copy actually arrived. Everything below turns on this:
  // a slow sync and an empty document look identical from here, and only one of
  // them may be written to.
  const synced = snapshot ? true : await new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
    provider?.on('synced', () => finish(true));
    // Long enough for a big document over a slow link. It no longer authorises
    // a write, so waiting costs a spinner rather than the document.
    setTimeout(() => finish(false), 20000);
  });

  store.load();

  // Public viewer and version preview alike: read-only. Set before the editor
  // mounts so no caret or tools show.
  if (share || snapshot) store.readonly = true;

  // An archived state that decodes to nothing is a broken snapshot, not an
  // empty page — say so rather than rendering a blank sheet that looks like
  // the version wiped the document.
  if (snapshot && !store.root) throw new Error('This version could not be rendered.');

  // A document that has neither synced nor cached anything locally is unknown,
  // not empty. Seeding one on a timeout is what put a second, empty page root
  // beside the real content in eight documents — the editor then rendered the
  // seeded root and the document looked wiped. Fail loudly instead; the caller
  // offers a reload, and nothing is written.
  if (!synced && !store.root) {
    throw new Error('This document could not be loaded — the server did not answer in time.');
  }

  // Only the first client to reach a still-empty doc seeds the skeleton (page ->
  // surface + note + blocks). A read-only viewer never seeds. If the doc was
  // created from a template, seed its blocks; otherwise a single empty paragraph.
  if (!share && !snapshot && !store.root) {
    const seed = takePendingSeed(docId);
    try {
      const pageId = store.addBlock('affine:page', { title: new Text(title) });
      store.addBlock('affine:surface', {}, pageId);
      const noteId = store.addBlock('affine:note', {}, pageId);
      const blocks = seed && seed.length ? seed : [{ type: 'text' as const, text: '' }];
      for (const b of blocks) {
        if (b.type === 'divider') { store.addBlock('affine:divider', {}, noteId); continue; }
        const flavour = b.type === 'bullet' || b.type === 'numbered' || b.type === 'todo' ? 'affine:list' : 'affine:paragraph';
        const props: Record<string, unknown> = { text: new Text(b.text ?? '') };
        if (b.type === 'h1') props.type = 'h1';
        else if (b.type === 'h2') props.type = 'h2';
        else if (b.type === 'h3') props.type = 'h3';
        else if (b.type === 'quote') props.type = 'quote';
        else if (b.type === 'bullet') props.type = 'bulleted';
        else if (b.type === 'numbered') props.type = 'numbered';
        else if (b.type === 'todo') props.type = 'todo';
        store.addBlock(flavour, props, noteId);
      }
    } catch {
      const pageId = store.addBlock('affine:page', {});
      store.addBlock('affine:surface', {}, pageId);
      const noteId = store.addBlock('affine:note', {}, pageId);
      store.addBlock('affine:paragraph', {}, noteId);
    }
  }

  // The title can now change from OUTSIDE the document too — a row rename in
  // the task peek/table writes docs.title directly, never touching Yjs. If we
  // didn't reconcile here, the stale Yjs title would win: the debounced push
  // below compares Yjs against `lastTitle` and, seeing a "change", would PATCH
  // the old Yjs title back over the rename a second after every open. So at
  // mount the database title (the `title` prop) wins over whatever Yjs still
  // has — this runs once, here, before `lastTitle` is captured below, so it
  // covers every caller (peek, full page, sidebar) through one path. Typing
  // into the title block continues to win going forward: that's the push
  // below, which fires on every subsequent Yjs change, this block does not.
  if (!share && !snapshot && store.root) {
    try {
      const titleModel = (store.root as { props?: { title?: InstanceType<typeof Text> } }).props?.title;
      const yjsTitle = titleModel ? titleModel.toString() : '';
      if (titleModel && title && title !== yjsTitle) {
        titleModel.replace(0, yjsTitle.length, title);
      }
    } catch { /* best effort — a save from the user's own typing still works */ }
  }

  // Docs the server built (API, markdown import, templates) had no surface until
  // now, and edgeless/slides mount into the surface — without one the canvas is
  // blank. Heal it, but only when the canvas is actually about to be shown: a
  // write here is an edit, and healing on every open would mark every doc in the
  // workspace as just-edited the first time someone reads it.
  // Two clients switching to canvas at the same instant would add two surfaces;
  // BlockSuite reads the first, so the loser is inert.
  const ensureSurface = () => {
    if (share || snapshot) return;
    const pageRoot = store.root as { id: string; children?: { flavour: string }[] } | null;
    if (!pageRoot || (pageRoot.children ?? []).some((c) => c.flavour === 'affine:surface')) return;
    try { store.addBlock('affine:surface', {}, pageRoot.id, 0); } catch { /* raced, fine */ }
  };
  if (mode === 'edgeless') ensureSurface();

  const editor = document.createElement('affine-editor-container') as HTMLElement & {
    autofocus: boolean; doc: unknown; mode: string;
    pageSpecs: unknown[]; edgelessSpecs: unknown[]; updateComplete: Promise<unknown>;
  };
  editor.autofocus = false;
  editor.doc = store;
  editor.mode = mode;
  store.get(FeatureFlagService).setFlag('enable_advanced_block_visibility', true);

  // Follow the app's dark/light toggle (a `dark` class on <html>) so BlockSuite's
  // own themed surfaces — floating toolbars, slash/@ menus, popovers — switch too.
  // Without this, BlockSuite stays in its default light theme and those portaled
  // widgets render white on our dark canvas.
  const appScheme = () => (document.documentElement.classList.contains('dark') ? ColorScheme.Dark : ColorScheme.Light);
  const themeSignal = new Signal<ColorScheme>(appScheme());
  const themeObserver = new MutationObserver(() => {
    const s = appScheme();
    if (themeSignal.value !== s) themeSignal.value = s;
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  const virtualKeyboard = createVirtualKeyboardProvider();

  const common = [
    FontConfigExtension(CommunityCanvasTextFonts),
    EditorSettingExtension({ setting$: new Signal({}) }),
    { setup: (di: { override: (a: unknown, b: unknown) => void }) => di.override(DocModeProvider, docModeService(editor, mode)) },
    {
      setup: (di: { override: (a: unknown, b: unknown) => void }) =>
        di.override(ThemeExtensionIdentifier, {
          getAppTheme: () => themeSignal,
          getEdgelessTheme: () => themeSignal,
        }),
    },
    {
      setup: (di: { override: (a: unknown, b: unknown) => void }) =>
        di.override(VirtualKeyboardProvider, () => virtualKeyboard),
    },
    // Alignment is a property of the document, so a public viewer must see it
    // too; the toolbar it is set from never opens for them (readonly store).
    ...imageAlignExtensions(),
    // "@" page references. These carry the title resolver as well as the menu,
    // so a version preview keeps them too — without the resolver every mention
    // in an old version renders struck through as a deleted page. The menu
    // itself is unreachable there: the store is read-only, so nothing can type
    // an "@". A public viewer gets neither: it has no page index to offer.
    ...(share || !pages || !createPage
      ? []
      : [
          ...pageLinkExtensions({
            pages,
            currentId: docId,
            // Registered here rather than waiting for the page index to refresh:
            // the chip renders as soon as the id comes back.
            createPage: async (t) => {
              const id = await createPage(t);
              if (id) rememberDocs([{ id, title: t, icon: '📄' }]);
              return id;
            },
          }),
          ...blockLinkExtensions(docId),
        ]),
  ];
  editor.pageSpecs = [...viewManager.get('page'), ...chartViewExtensions, ...databaseViewExtensions, ...common];
  editor.edgelessSpecs = [...viewManager.get('edgeless'), ...chartViewExtensions, ...databaseViewExtensions, ...common];

  root.replaceChildren(editor);
  await editor.updateComplete;

  // Inline comments: selection button + quote highlights. Not for public
  // viewers (comments API needs a member session).
  const detachComments = share || snapshot
    ? null
    : attachComments(editor, docId, (cb) => {
        doc.spaceDoc.on('update', cb);
        return () => doc.spaceDoc.off('update', cb);
      });

  // Clicking a reference chip opens that page in the app; BlockSuite's own
  // handler would look for the doc in this collection and find nothing.
  const detachRefClicks = onOpenDoc ? attachRefClicks(editor, onOpenDoc) : null;

  // Paint each image's stored alignment onto the DOM (see imageAlign.ts).
  const detachImageAlign = attachImageAlign({
    store: store as unknown as Parameters<typeof attachImageAlign>[0]['store'],
    root: editor,
    onChange: (cb) => { doc.spaceDoc.on('update', cb); return () => doc.spaceDoc.off('update', cb); },
  });

  // Render read-only diagram previews under ```mermaid code blocks. Mermaid is
  // dynamically imported inside here, so it only loads for docs that use it.
  const detachMermaid = attachMermaidPreviews({
    store,
    root: editor,
    isDark: () => themeSignal.value === ColorScheme.Dark,
    onChange: (cb) => { doc.spaceDoc.on('update', cb); return () => doc.spaceDoc.off('update', cb); },
  });

  // Debounced sync of title (sidebar) + plain text (search) back to the server.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastTitle = title;
  const push = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      // From the MODEL, never the DOM: <doc-title> is a container others can
      // render into (our metadata band does), and innerText swept that chrome
      // into the title and saved it. The model has exactly one title in it.
      let docTitle = '';
      try {
        docTitle = String((store.root as { props?: { title?: { toString(): string } } } | null)?.props?.title ?? '').trim();
      } catch { docTitle = ''; }
      const text = docPlainText(store)
        || (editor.querySelector('editor-host') as HTMLElement | null)?.innerText || editor.innerText || '';
      // `links` rides along with the text so backlinks stay in step with the
      // content that produced them, on the one request that already fires. The
      // server REPLACES the stored set with whatever arrives, so if collection
      // throws we omit the field entirely — sending [] would delete every
      // backlink to this page.
      let links: string[] | undefined;
      try { links = collectPageLinks(store); } catch { links = undefined; }
      fetch(`/api/docs/${docId}/text`, {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 100000), ...(links ? { links } : {}) }),
      }).then(() => onSaved?.()).catch(() => {});
      if (docTitle && docTitle !== lastTitle) {
        lastTitle = docTitle;
        onTitle?.(docTitle);
        fetch(`/api/docs/${docId}`, {
          method: 'PATCH', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: docTitle }),
        }).catch(() => {});
      }
    }, 1200);
  };
  // A read-only viewer never writes back title/search text.
  if (!share && !snapshot) {
    doc.spaceDoc.on('update', push);
    push();
  }

  return {
    editor,
    setMode(m: 'page' | 'edgeless') {
      if (m === 'edgeless') ensureSurface();
      editor.mode = m;
    },
    destroy() {
      if (timer) clearTimeout(timer);
      try { tooltipKiller.disconnect(); } catch { /* noop */ }
      try { detachPresence(); } catch { /* noop */ }
      try { detachComments?.(); } catch { /* noop */ }
      try { detachRefClicks?.(); } catch { /* noop */ }
      try { detachImageAlign(); } catch { /* noop */ }
      try { detachMermaid(); } catch { /* noop */ }
      try { themeObserver.disconnect(); } catch { /* noop */ }
      try { virtualKeyboard.dispose(); } catch { /* noop */ }
      try { doc.spaceDoc.off('update', push); } catch { /* noop */ }
      try { provider?.destroy(); } catch { /* noop */ }
      try { idb?.destroy(); } catch { /* noop */ }
      try { collection.dispose?.(); } catch { /* noop */ }
      root.replaceChildren();
    },
  };
}
