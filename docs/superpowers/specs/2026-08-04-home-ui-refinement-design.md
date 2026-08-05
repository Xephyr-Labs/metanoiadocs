# Home UI refinement — design

Date: 2026-08-04

## Goal

Make the home page a calm recent-document launcher first, while keeping task,
activity, and project information available as quieter supporting content.

## Design

- Preserve the existing `/api/home` payload and all click-through behavior.
- Keep the greeting and `New page` action at the top, but reduce the stat row to
  a compact summary so it does not compete with documents.
- Move recent documents directly under the header and give them the strongest
  visual treatment: a simple four-column shelf on desktop and a two-column shelf
  on small screens.
- Put tasks and activity in a balanced secondary row with restrained panel chrome.
- Keep projects at the bottom as compact list-like cards, with progress rings
  retained as useful status signals.
- Use the existing warm neutral palette, Inter/Fraunces typography, hairline
  borders, and current motion tokens. No new dependencies or decorative art.

## Responsive behavior

- At 768px and below, recent documents remain above all supporting content.
- At 640px and below, the header actions remain one line and the recent shelf
  stays two columns; supporting panels stack.
- Interactive labels remain single-line and focus states continue to use the
  global accessible ring.

## Files

- Modify `web-react/src/components/home/Home.tsx` for composition and hierarchy.
- Modify `web-react/src/components/home/cards.tsx` for lighter card treatments.
- Do not delete files or change API contracts.
