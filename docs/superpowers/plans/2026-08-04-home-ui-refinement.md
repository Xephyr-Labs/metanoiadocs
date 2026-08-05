# Home UI refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recent documents the primary home-page action while reducing visual competition from dashboard panels.

**Architecture:** Keep the existing Home data model and card components. Recompose the page in `Home.tsx`, then adjust only the shared home card presentation in `cards.tsx` so recents feel primary and supporting content feels secondary.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, lucide-react, Vitest/Vite.

---

### Task 1: Recompose the home hierarchy

**Files:**
- Modify: `web-react/src/components/home/Home.tsx`

- [ ] Make recent documents render immediately after the greeting/actions.
- [ ] Keep stats as a compact summary after recents instead of the first visual block.
- [ ] Preserve the existing loading, error, empty, and click-through behavior.
- [ ] Keep the responsive layout at two columns for recents on narrow screens.

### Task 2: Reduce supporting-card visual weight

**Files:**
- Modify: `web-react/src/components/home/cards.tsx`

- [ ] Add a lightweight recent-card treatment with less panel emphasis and a clearer document title.
- [ ] Keep project cards and task/activity rows functionally unchanged.
- [ ] Preserve keyboard focus and hover states.

### Task 3: Verify

**Files:**
- Test: `web-react` build and existing test suite

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Start Vite on `0.0.0.0` and verify it is reachable at the Tailscale IP `100.77.147.15:5174`.
