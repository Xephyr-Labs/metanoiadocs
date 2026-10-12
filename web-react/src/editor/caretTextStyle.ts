// The formatting at the caret (or over a selection inside one block), for the
// pressed state of the bold/italic/… buttons.
//
// BlockSuite's getTextStyle answers the same question for any selection, but
// gets there by testing every block on the page against the selection — and
// the buttons ask on every keystroke, so a long page made typing slower the
// longer it got. A selection inside one block (nearly every caret) asks that
// block's own line directly, which is what getTextStyle ends up doing for it
// anyway (getCombinedTextStyle → inlineEditor.getFormat over its range).
// Anything wider returns null and the caller falls back to getTextStyle.

interface InlineEditorLike {
  getInlineRange(): { index: number; length: number } | null;
  getFormat(range: { index: number; length: number }): Record<string, unknown>;
}

interface StdLike {
  selection?: { value?: { type?: string; from?: { blockId: string }; to?: { blockId: string } | null }[] };
  view?: { getBlock(id: string): Element | null | undefined };
}

export function caretTextStyle(std: StdLike): Record<string, unknown> | null {
  const sel = std.selection?.value?.find((s) => s.type === 'text');
  if (!sel?.from || (sel.to && sel.to.blockId !== sel.from.blockId)) return null;
  const block = std.view?.getBlock(sel.from.blockId);
  const inline = (block?.querySelector('rich-text') as { inlineEditor?: InlineEditorLike } | null)?.inlineEditor;
  const range = inline?.getInlineRange();
  if (!inline || !range) return null;
  return inline.getFormat(range);
}
