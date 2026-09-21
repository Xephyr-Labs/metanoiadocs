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

/**
 * True when a modal dialog owns the keyboard.
 *
 * The bug this exists for: reading the `?` shortcut sheet and pressing `c` to
 * see what it does made a page behind the dialog and navigated to it. Radix
 * traps focus inside a dialog but a keystroke still reaches window, so a bare
 * letter has to be refused by whoever is listening up there.
 *
 * Modified keys are deliberately not covered — ⌘K over a settings dialog is
 * the palette doing what it says, and no dialog wants that combination.
 */
export function isInDialog(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  return !!el.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"]');
}
