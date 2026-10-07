# Traditional Chinese UI scan

Scanned `web-react/src`.

- TypeScript / TSX files: 296
- TSX components: 114
- Literal `t(...)` calls found: 75
- Existing zh-TW dictionary keys before this patch: 133
- Missing dictionary keys used by `t(...)`: 2 unique keys (`New database under {{name}}`, `Actions for {{name}}`)
- Static English UI candidates found by JSX/attribute scan: about 499 (heuristic; includes some false positives/code fragments)

## Main cause

Most React components do not import or call `t()`. Before this patch, i18n imports existed only in `main.tsx`, `LanguageSelector.tsx`, and `Sidebar.tsx`. Therefore expanding only `zhTW` could not translate most of the interface.

## Patch in this archive

- Added the missing interpolated dictionary keys.
- Added a `zhTWStaticUI` dictionary for common hard-coded UI across authentication, editor, projects/tasks, comments, settings, webhooks, top bar, home, and accessibility labels.
- Added `installDOMTranslations()` to translate hard-coded React text nodes and common UI attributes (`placeholder`, `title`, `aria-label`, `alt`) in zh-TW mode.
- Added a `MutationObserver` so dialogs, menus, panels, and other dynamically mounted React UI are translated when they appear.
- Enabled the translator from `main.tsx` immediately after `initLanguage()`.

## Verification limitation

The uploaded source archive does not contain `node_modules`. `npm run build` could not start because the local `vite` executable is absent. The source was patched, but a full Vite/TypeScript build still needs to be run after dependencies are installed.
