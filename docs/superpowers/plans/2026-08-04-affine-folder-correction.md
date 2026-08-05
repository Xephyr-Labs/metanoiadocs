# AFFiNE-style folder correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep documents at the root by default and make folders optional drag-and-drop containers.

**Architecture:** Stop converting legacy document parents into folders. Add a corrective database migration that clears membership only from auto-generated folders, preserves user-created folders, and flattens legacy documents to root. Extend the sidebar tree with native HTML drag-and-drop for document-to-folder movement and retain the action menu fallback.

**Tech Stack:** Node.js, PostgreSQL, Express, React, TypeScript, Tailwind CSS, Node test runner, Vitest.

---

### Task 1: Correct legacy migration semantics

**Files:**
- Modify: `server/src/folders.test.js`
- Modify: `server/src/folders.js`
- Modify: `server/src/db.js`

- [ ] Write a failing test asserting legacy document trees flatten to root and create no folders.
- [ ] Update the pure migration helper to produce root membership for all legacy docs.
- [ ] Add a one-time cleanup migration for the prior auto-generated `source_doc_id` folders.
- [ ] Preserve folders with `source_doc_id IS NULL` and move their contents only when they were nested under an auto folder.

### Task 2: Add drag-to-folder sidebar interaction

**Files:**
- Modify: `web-react/src/components/sidebar/FolderTree.tsx`
- Modify: `web-react/src/components/sidebar/Sidebar.tsx`

- [ ] Make document rows draggable with accessible labels.
- [ ] Make folder rows valid drop targets with visible drag-over feedback.
- [ ] On drop, invoke existing `movePage(docId, folderId)` and expand the target folder.
- [ ] Keep the existing menu move options as a keyboard/touch fallback.

### Task 3: Verify

**Files:**
- Test: `server/src/folders.test.js`

- [ ] Run `node --test` and `npm test`.
- [ ] Run `npm run build`.
- [ ] Verify the frontend remains reachable on LAN/Tailscale.
