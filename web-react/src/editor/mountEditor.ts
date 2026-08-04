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
} from '@blocksuite/affine/shared/services';
import { ColorScheme } from '@blocksuite/affine/model';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Signal } from '@preact/signals-core';
import { takePendingSeed } from './pendingSeed';
import { attachMermaidPreviews } from './mermaidPreview';

let effectsInstalled = false;
function installEffects() {
  if (effectsInstalled) return;
  itEffects();
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
  onTitle?: (title: string) => void;
  onSaved?: () => void;
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

export async function mountEditor(root: HTMLElement, { docId, title, mode, userName, share, onTitle, onSaved }: MountArgs) {
  installEffects();
  const viewManager = getTestViewManager();
  const storeManager = getTestStoreManager();

  const schema = new Schema();
  schema.register(AffineSchemas);

  const collection = new TestWorkspace({ id: docId, blobSources: { main: new HttpBlobSource(share) } });
  collection.storeExtensions = storeManager.get('store');
  collection.start();
  collection.meta.initialize();

  const doc = collection.getDoc(docId) ?? collection.createDoc(docId);
  if (!doc) throw new Error('doc did not materialize: ' + docId);
  const store = doc.getStore({ id: docId });

  // Live sync to our server. Cookie authenticates a member; a share token
  // authenticates a read-only public viewer.
  const provider = new HocuspocusProvider({
    url: wsBase(),
    name: docId,
    document: doc.spaceDoc,
    parameters: share ? { doc: docId, share } : { doc: docId },
    awareness: collection.awarenessStore.awareness,
  });

  // Local-first persistence: edits are written to IndexedDB, so the doc opens
  // instantly and survives being offline; Hocuspocus merges everything back on
  // reconnect (Yjs is a CRDT, so offline + remote edits combine without conflict).
  // Public read-only viewers don't need a local cache.
  const idb = share ? null : new IndexeddbPersistence(`mn-doc-${docId}`, doc.spaceDoc);

  const palette = ['#2383e2', '#12b8a0', '#e8794b', '#b84be8', '#4b9be8', '#e84b7a'];
  const cid = collection.awarenessStore.awareness.clientID;
  collection.awarenessStore.awareness.setLocalStateField('user', {
    name: userName || 'Someone',
    color: palette[cid % palette.length],
  });

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    provider.on('synced', finish);
    setTimeout(finish, 4000);
  });

  store.load();

  // Public viewer: read-only. Set before the editor mounts so no caret/tools show.
  if (share) store.readonly = true;

  // Only the first client to reach a still-empty doc seeds the skeleton (page ->
  // surface + note + blocks). A read-only viewer never seeds. If the doc was
  // created from a template, seed its blocks; otherwise a single empty paragraph.
  if (!share && !store.root) {
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
  ];
  editor.pageSpecs = [...viewManager.get('page'), ...common];
  editor.edgelessSpecs = [...viewManager.get('edgeless'), ...common];

  root.replaceChildren(editor);
  await editor.updateComplete;

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
      const docTitle = (editor.querySelector('doc-title') as HTMLElement | null)?.innerText?.trim() || '';
      const text = (editor.querySelector('editor-host') as HTMLElement | null)?.innerText || editor.innerText || '';
      fetch(`/api/docs/${docId}/text`, {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 100000) }),
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
  if (!share) {
    doc.spaceDoc.on('update', push);
    push();
  }

  return {
    editor,
    setMode(m: 'page' | 'edgeless') { editor.mode = m; },
    destroy() {
      if (timer) clearTimeout(timer);
      try { detachMermaid(); } catch { /* noop */ }
      try { themeObserver.disconnect(); } catch { /* noop */ }
      try { doc.spaceDoc.off('update', push); } catch { /* noop */ }
      try { provider.destroy(); } catch { /* noop */ }
      try { idb?.destroy(); } catch { /* noop */ }
      try { collection.dispose?.(); } catch { /* noop */ }
      root.replaceChildren();
    },
  };
}
