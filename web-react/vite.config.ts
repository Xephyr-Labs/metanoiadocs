import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import wasm from 'vite-plugin-wasm';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_PATHS } from './src/lib/route';

// BlockSuite ships thousands of ESM sub-packages that Vite's dep-optimizer must
// NOT pre-bundle (they use import.meta / wasm / vanilla-extract). This exclude
// list mirrors the vanilla app's working config; keep them in sync.
const blocksuiteExclude = [
  '@blocksuite/affine',
  '@blocksuite/affine-model',
  '@blocksuite/integration-test',
  '@blocksuite/affine-block-attachment',
  '@blocksuite/affine-block-bookmark',
  '@blocksuite/affine-block-callout',
  '@blocksuite/affine-block-code',
  '@blocksuite/affine-block-database',
  '@blocksuite/affine-block-data-view',
  '@blocksuite/affine-block-divider',
  '@blocksuite/affine-block-edgeless-text',
  '@blocksuite/affine-block-embed',
  '@blocksuite/affine-block-embed-doc',
  '@blocksuite/affine-block-frame',
  '@blocksuite/affine-block-image',
  '@blocksuite/affine-block-latex',
  '@blocksuite/affine-block-list',
  '@blocksuite/affine-block-note',
  '@blocksuite/affine-block-paragraph',
  '@blocksuite/affine-block-root',
  '@blocksuite/affine-block-surface',
  '@blocksuite/affine-block-surface-ref',
  '@blocksuite/affine-block-table',
  '@blocksuite/affine-components',
  '@blocksuite/affine-ext-loader',
  '@blocksuite/affine-foundation',
  '@blocksuite/affine-fragment-adapter-panel',
  '@blocksuite/affine-fragment-doc-title',
  '@blocksuite/affine-fragment-frame-panel',
  '@blocksuite/affine-fragment-outline',
  '@blocksuite/affine-gfx-brush',
  '@blocksuite/affine-gfx-connector',
  '@blocksuite/affine-gfx-group',
  '@blocksuite/affine-gfx-link',
  '@blocksuite/affine-gfx-mindmap',
  '@blocksuite/affine-gfx-note',
  '@blocksuite/affine-gfx-pointer',
  '@blocksuite/affine-gfx-shape',
  '@blocksuite/affine-gfx-template',
  '@blocksuite/affine-gfx-text',
  '@blocksuite/affine-gfx-turbo-renderer',
  '@blocksuite/affine-inline-footnote',
  '@blocksuite/affine-inline-latex',
  '@blocksuite/affine-inline-link',
  '@blocksuite/affine-inline-mention',
  '@blocksuite/affine-inline-preset',
  '@blocksuite/affine-inline-reference',
  '@blocksuite/affine-model',
  '@blocksuite/affine-rich-text',
  '@blocksuite/affine-shared',
  '@blocksuite/affine-widget-drag-handle',
  '@blocksuite/affine-widget-edgeless-auto-connect',
  '@blocksuite/affine-widget-edgeless-dragging-area',
  '@blocksuite/affine-widget-edgeless-selected-rect',
  '@blocksuite/affine-widget-edgeless-toolbar',
  '@blocksuite/affine-widget-edgeless-zoom-toolbar',
  '@blocksuite/affine-widget-frame-title',
  '@blocksuite/affine-widget-keyboard-toolbar',
  '@blocksuite/affine-widget-linked-doc',
  '@blocksuite/affine-widget-note-slicer',
  '@blocksuite/affine-widget-page-dragging-area',
  '@blocksuite/affine-widget-remote-selection',
  '@blocksuite/affine-widget-scroll-anchoring',
  '@blocksuite/affine-widget-slash-menu',
  '@blocksuite/affine-widget-toolbar',
  '@blocksuite/affine-widget-viewport-overlay',
  '@blocksuite/data-view',
  '@blocksuite/global',
  '@blocksuite/icons',
  '@blocksuite/std',
  '@blocksuite/store',
  '@blocksuite/sync',
];

export default defineConfig({
  // React lives in src/**; BlockSuite web components mount imperatively via a ref.
  plugins: [
    react(),
    wasm(),
    vanillaExtractPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['pwa-192.png', 'pwa-512.png'],
      manifest: {
        name: 'MetanoiaDocs',
        short_name: 'Metanoia',
        description: 'Self-hosted, real-time collaborative docs workspace.',
        theme_color: '#2383e2',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Push and notification-click handling. generateSW owns sw.js, so the
        // handlers are imported into it rather than replacing it wholesale.
        importScripts: ['push-sw.js'],
        // The editor chunk is large; allow it in the precache so the app loads offline.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // The fallback answers for the app's own addresses only. Everything else on
        // this origin — the API, live sync, share links, the sibling apps Caddy
        // routes to — goes to the network.
        navigateFallbackAllowlist: APP_PATHS,
        // The shell was already precached, so opening the app on a train
        // rendered a frame with nothing in it: every list it draws comes from
        // the API, and every one of those requests failed. These five are the
        // reads the shell needs to look like itself — who you are, your
        // pages, your folders, your databases, your tags — plus Home, so the
        // first screen is the workspace you left rather than "Failed to fetch".
        //
        // NetworkFirst, not StaleWhileRevalidate: online, the answer must be
        // today's, and a three-second timeout is the point at which a flaky
        // connection is worse than a slightly old sidebar.
        //
        // Reads only. Nothing here queues a write — a PATCH that looks like it
        // worked and is silently lost is worse than one that fails in front of
        // you, and the editor's own offline story (Yjs in IndexedDB, merged on
        // reconnect) is the one path where writing offline is actually safe.
        //
        // `mn-api` is deleted on sign-out: on a shared machine the next person
        // must not find the last one's sidebar waiting in a cache.
        runtimeCaching: [
          {
            urlPattern: ({ url, request, sameOrigin }) =>
              sameOrigin
              && request.method === 'GET'
              && /^\/api\/(me|home|docs|folders|projects|tags)(\?|$)/.test(url.pathname + url.search),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'mn-api',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  esbuild: { target: 'es2018' },
  // The Express API + Hocuspocus ws server run separately (docker: 127.0.0.1:8092).
  // Proxy /api and /sync so the frontend is same-origin and the session cookie works.
  server: {
    host: true,
    port: 5174,
    allowedHosts: true,
    proxy: {
      '/api': { target: 'http://localhost:8092', changeOrigin: true },
      '/sync': { target: 'http://localhost:8092', ws: true, changeOrigin: true },
    },
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
    proxy: {
      '/api': { target: 'http://localhost:8092', changeOrigin: true },
      '/sync': { target: 'http://localhost:8092', ws: true, changeOrigin: true },
    },
  },
  optimizeDeps: {
    exclude: blocksuiteExclude,
    // CJS/interop deps BlockSuite pulls in must be pre-bundled or their default
    // exports break under native ESM. Mirrors the vanilla app's include list.
    include: [
      'extend',
      'bind-event-listener',
      'bytes',
      'debug',
      'lodash.ismatch',
      'lodash.merge',
      'lodash.clonedeep',
      'lz-string',
      '@atlaskit/pragmatic-drag-and-drop',
      '@atlaskit/pragmatic-drag-and-drop-auto-scroll',
      '@atlaskit/pragmatic-drag-and-drop-hitbox',
      'html2canvas',
      'pdf-lib',
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react-dom/client',
      'nanoid',
      'zod',
      '@preact/signals-core',
      'lit',
      '@floating-ui/dom',
      'yjs',
      'rxjs',
      '@hocuspocus/provider',
    ],
    esbuildOptions: { target: 'es2018' },
  },
});
