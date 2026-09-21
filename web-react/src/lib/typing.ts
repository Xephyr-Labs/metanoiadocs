/**
 * True when a keystroke belongs to whatever the person is typing into.
 *
 * This is what makes single-letter shortcuts safe to have at all. The editor is
 * a contenteditable, every task title in the grid is a textarea, and a `c` that
 * made a new page in the middle of a sentence would be worse than no shortcut.
 *
 * `closest` rather than a tag check: BlockSuite nests its editable regions
 * several elements deep, so the event's target is the innermost one, not the
 * one carrying the attribute.
 */
export function isTyping(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  return !!el.closest(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"]',
  );
}
