# Sidebar Polish Design

## Goal

Improve the left sidebar's visual comfort and polish while preserving its existing navigation structure and behavior. The desired tone is a quiet productivity tool: clear, calm, and efficient rather than editorial or decorative.

## Scope

- Align the workspace logo, name, and disclosure control on one visual baseline.
- Increase navigation and document row breathing room so the sidebar does not feel crammed.
- Establish a consistent vertical rhythm between sidebar sections.
- Keep Inter as the sidebar UI typeface, using the existing font token rather than introducing a new font.
- Preserve active, hover, keyboard-focus, resize, collapse, mobile drawer, and data-driven navigation behavior.

## Visual treatment

The selected direction is the balanced default treatment:

- Workspace header uses a consistent 20px icon slot and vertically centered contents.
- Primary navigation rows target approximately 32px height with consistent horizontal padding and icon/text spacing.
- Document, tag, and template rows use a modestly taller rhythm than the current 27px rows.
- Section labels remain small, uppercase, and muted, with a little more space above each section.
- Existing semantic colors and active/hover surfaces remain in use.
- Sidebar text remains neutral UI sans; Fraunces continues to be used for document content only.

## Implementation boundaries

The work is limited to the sidebar components and any sidebar-specific token/class adjustments needed in the existing styling system. No route, state, or data model changes are required.

## Verification

- Run the web build.
- Inspect the sidebar in the running app at desktop width.
- Confirm workspace header alignment, row spacing, active/hover states, and footer alignment.
- Confirm mobile drawer still renders at the existing width and does not introduce horizontal overflow.

