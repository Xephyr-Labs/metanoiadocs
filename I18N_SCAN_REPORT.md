# Traditional Chinese UI scan — second pass

Scanned `web-react/src` again from the latest uploaded repository.

## What was fixed in this pass

- Expanded Traditional Chinese coverage for Home/dashboard, documents/editor, projects/tasks, review/comments, public pages/forms, sharing/navigation, folders, history/intelligence, settings/auth/system UI.
- Added dynamic Traditional Chinese handling for relative time (`1d ago`, `2h ago`, `5m ago`).
- Added dynamic greeting translation (`Still up, NAME`, `Good morning, NAME`, etc.).
- Added activity sentence translation (`NAME edited TITLE`, `NAME created TITLE`).
- Kept the existing MutationObserver coverage for dynamically mounted dialogs, menus, tooltips and common accessibility attributes.
- Preserved product names, API names, URLs, model names, code/formula examples, keyboard shortcuts and user-created content instead of blindly translating them.

## Important implementation note

The application still contains many hard-coded English React literals. The compatibility translator in `src/lib/i18n.ts` translates these at render time in `zh-TW` mode. This avoids a risky mass rewrite of dozens of components while providing broad UI coverage. Long-term, these literals can be migrated to `t()` component-by-component.

## Areas checked

- Authentication
- Home/dashboard
- Sidebar/navigation
- Documents/editor/slides
- Tags/folders/trash
- Tasks/projects/backlog/sprints
- Board/table/gallery/calendar/gantt/dashboard
- Filters/sorts/properties/views
- Comments/review/AI side panel
- Public pages/forms/guest comments
- Share/access controls
- Settings/members/AI/API tokens/webhooks
- Command palette/history/intelligence rail
- Tooltips/placeholders/aria-label/title/alt attributes

## Intentionally retained English / technical text

Examples include `Metanoia`, `MetanoiaDocs`, `API`, `Webhook`, `Sprint`, `CSV`, provider URLs, model identifiers such as `gpt-4o-mini`, HTTP header names, signatures/hashes, keyboard shortcuts, IDs/task keys, formulas/code and user-created page/project names.

## Verification

The source-level scan and patch completed successfully. A full Vite build still depends on installed `node_modules`; if dependencies are present locally, run `npm run build` in `web-react` before deployment.
