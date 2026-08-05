# Sidebar Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the left sidebar feel calmer and more polished by correcting workspace-header alignment, increasing row breathing room, and preserving the existing quiet productivity visual language.

**Architecture:** Keep the current Sidebar/PageTree component ownership and data flow. Adjust shared row sizing and spacing at the component level, use the existing Inter token for sidebar chrome, and avoid state or navigation changes.

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3, lucide-react, Vite, Vitest.

---

### Task 1: Normalize sidebar typography and row rhythm

**Files:**
- Modify: `web-react/src/components/sidebar/Sidebar.tsx`
- Modify: `web-react/src/components/sidebar/PageTree.tsx`
- Modify: `web-react/src/index.css` only if a sidebar-specific font token/class is needed

- [ ] **Step 1: Update shared navigation row dimensions**

  Increase `NavItem`, `DocRow`, tag rows, and template rows from their current 27–29px heights to a consistent approximately 32px rhythm. Keep the same padding, labels, icons, handlers, active classes, and trailing affordances.

- [ ] **Step 2: Correct the workspace switcher alignment**

  Give the workspace trigger a consistent 20px icon slot, vertically center the LogoMark and text, and retain truncation and hover-only disclosure behavior. Use the existing UI font family/token rather than introducing a new typeface.

- [ ] **Step 3: Increase section separation without changing hierarchy**

  Add modest vertical spacing around section labels and between content groups. Keep labels uppercase/muted and preserve the collapsible Templates behavior.

- [ ] **Step 4: Apply matching rhythm to nested page rows**

  Update `PageTree` row height and keep its depth indentation, icon/chevron overlay, hover actions, keyboard behavior, and animation unchanged.

### Task 2: Verify production behavior and visual result

**Files:**
- Test/inspect: `web-react/src/components/sidebar/Sidebar.tsx`
- Test/inspect: `web-react/src/components/sidebar/PageTree.tsx`

- [ ] **Step 1: Run the web test suite**

  Run `npm test` from `web-react/`. Expected: all existing tests pass.

- [ ] **Step 2: Run the production build**

  Run `npm run build` from `web-react/`. Expected: Vite completes without TypeScript or bundling errors.

- [ ] **Step 3: Inspect the live sidebar at desktop width**

  Open the running Vite app and verify the workspace logo/name baseline, primary navigation spacing, section rhythm, active/hover states, footer alignment, and resize separator.

- [ ] **Step 4: Inspect the mobile drawer**

  Verify the sidebar remains usable in the existing mobile drawer width and that no horizontal overflow is introduced.

- [ ] **Step 5: Review the diff**

  Run `git diff --check` and inspect the final diff to confirm only the approved sidebar polish is included.

