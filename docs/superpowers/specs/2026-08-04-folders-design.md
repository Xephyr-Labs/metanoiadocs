# Folders and subfolders — design

Date: 2026-08-04

## Goal

Replace parent-document nesting with an AFFiNE-style organization tree where
folders contain documents and subfolders, while preserving every existing
document and its content.

## Data model

Add a `folders` table with `id`, `name`, `parent_id`, `position`, `created_by`,
`created_at`, and `deleted_at`. Add nullable `docs.folder_id` referencing
`folders(id)` with `ON DELETE SET NULL`. Keep `docs.parent_id` temporarily for
rollback/diagnostics, but stop using it for new reads and writes.

The migration is idempotent and runs inside schema initialization:

1. Create a folder for every live document that has at least one live child,
   using the document's id as a deterministic folder id.
2. Make that folder's parent the folder created for the old document parent.
3. Put the original parent document in its matching folder.
4. Put every other document in the folder corresponding to its old parent, or
   at the root when it had no parent.
5. Mark the migration complete with a singleton setting so it never repeats.

For a fresh database, documents are created directly with `folder_id`; folders
are created independently. A folder is never an editor surface.

## API

- `GET /api/folders` returns the visible folder tree and folder metadata.
- `POST /api/folders` creates a root or nested folder.
- `PATCH /api/folders/:id` renames or moves a folder with cycle/access guards.
- `DELETE /api/folders/:id` soft-deletes a folder and moves its contents to the
  deleted folder's parent (recoverable document content is not deleted).
- `POST /api/folders/reorder` updates sibling folder/document ordering.
- `docs` list/create/patch responses use `folder_id`; old `parentId` input is
  rejected for new writes after migration.

## Frontend

The sidebar gets a `Folders` section with nested folder rows. Each folder row
can expand/collapse, create a subfolder, create a document in that folder,
rename, and move through the existing menu affordance. Documents render beneath
their folder and keep their existing select/favorite/delete behavior.

The workspace store owns one folder tree and document map. It exposes
`createFolder`, `renameFolder`, `toggleFolder`, `deleteFolder`, and
`createPage(folderId)`; `Page.parentId` and `children` are removed from the
sidebar organization path after migration.

## Safety and compatibility

- Existing docs, doc states, access grants, favorites, tags, shares, and recent
  ids remain intact.
- Folder visibility is derived from contained accessible documents; private
  folders are not exposed to users without access to at least one descendant.
- Cycles are rejected server-side for both folder moves and reorder requests.
- Folder deletion is recoverable and never deletes documents.
- The local Vite server stays bound to all interfaces for LAN/Tailscale review.

## Verification

- Unit tests cover migration mapping and cycle guards.
- Existing server and frontend test suites remain green.
- Production build succeeds.
- The Vite URL returns HTTP 200 from the host LAN address.
