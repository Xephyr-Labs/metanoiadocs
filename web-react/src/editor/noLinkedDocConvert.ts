// BlockSuite's "Create Linked Doc" is switched off: the toolbar button over a
// selection (and over an embed), and its shortcut Ctrl/Cmd+Shift+L.
//
// It moves the selected blocks into a new doc and leaves a card in their place.
// That new doc is made in the browser's in-memory workspace, which this app
// never saves — our pages are rows the server creates. So the text left the
// page for a doc that existed nowhere, and the card read "Deleted page". On 11
// Oct it emptied a whole page ("Team Video Brief"); a version restore got it
// back. A linked page is still one "@" or "/" away, and those make a real one.

// BlockSuite has several ways to move text into a "linked doc" it creates
// with `workspace.createDoc()` — a doc that lives only in this tab and is never
// saved. After a reload the text is gone and a "Deleted page" card or a dead
// link is left in its place (Team Video Brief, 11 Oct). Every way in is shut
// here; the "@" menu is ours (pageLinks.ts) and makes real pages.
import { LinkedDocSlashMenuConfigIdentifier } from '@blocksuite/affine/blocks/embed-doc';
import { ToolbarModuleExtension, type ToolbarModuleConfig } from '@blocksuite/affine/shared/services';
import { BlockFlavourIdentifier } from '@blocksuite/affine/std';

/** Merged over BlockSuite's own action of the same id, in the toolbar module
 *  that reaches every block (blockLinks.ts). */
export const noLinkedDocConvertAction = { id: 'e.convert-to-linked-doc', when: () => false };

const isConvertShortcut = (e: KeyboardEvent) =>
  (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l';

/** Swallow the shortcut before BlockSuite's two bindings of it see it. Both
 *  act only on whole selected blocks, and picking blocks blurs the text, so
 *  the key then arrives on the body — listened for on the document, as
 *  BlockSuite itself does. */
export function attachNoLinkedDocShortcut(editor: HTMLElement): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === '[' && keepBrackets(editor)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!isConvertShortcut(e)) return;
    const t = e.target;
    if (!(t instanceof Node) || !(editor.contains(t) || t === document.body)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  document.addEventListener('keydown', onKeyDown, true);
  return () => document.removeEventListener('keydown', onKeyDown, true);
}

/** On the canvas the same conversion lives in the ⋯ menu ("Turn into linked
 *  doc", "Create linked doc"), nested in its conversions group. */
export const noLinkedDocConvertCanvasExtension = () => ToolbarModuleExtension({
  id: BlockFlavourIdentifier('custom:affine:surface:*'),
  config: {
    actions: [{
      id: 'd.conversions',
      actions: [
        { id: 'a.turn-into-linked-doc', when: () => false },
        { id: 'b.create-linked-doc', when: () => false },
      ],
    }],
  } as unknown as ToolbarModuleConfig,
});

/** The text before and after a selection inside one line of text. */
export function bracketed(before: string, after: string) {
  return before.endsWith('[') && after.startsWith(']');
}

interface InlineEditorLike {
  yText: { toString(): string };
  getInlineRange(): { index: number; length: number } | null;
  insertText(range: { index: number; length: number }, text: string): void;
  setInlineRange(range: { index: number; length: number }): void;
}

/**
 * "[" typed over a selection that already sits between "[" and "]" — the
 * second "[" of "[[" — is where BlockSuite deletes "[text]" and moves the text
 * into a new unsaved doc. Done here instead, through the line's own inline
 * editor (the document, not just the screen): the selection is wrapped once
 * more, the way BlockSuite wraps it on the first "[", so "[[" over a word
 * leaves "[[word]]" in the line with the word still selected.
 * True when it was handled (the key must then go no further).
 */
function keepBrackets(editor: HTMLElement): boolean {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const node = sel.getRangeAt(0).startContainer;
  const line = (node instanceof Element ? node : node.parentElement)?.closest('[data-v-root]');
  if (!line || !editor.contains(line)) return false;
  const inline = (line as Element & { inlineEditor?: InlineEditorLike }).inlineEditor;
  const range = inline?.getInlineRange();
  if (!inline || !range || !range.length) return false;
  const text = inline.yText.toString();
  if (!bracketed(text.slice(0, range.index), text.slice(range.index + range.length))) return false;
  inline.insertText(range, `[${text.slice(range.index, range.index + range.length)}]`);
  inline.setInlineRange({ index: range.index + 1, length: range.length });
  return true;
}

/** "/New Doc" makes one of those docs too. Its menu entry lives in a config
 *  object BlockSuite reads each time the menu opens; the entry is taken out
 *  of it. "/Linked Doc" stays — it opens the "@" menu. */
export function dropNewDocSlashItem(std: { getOptional: (id: unknown) => unknown }) {
  const cfg = std.getOptional(LinkedDocSlashMenuConfigIdentifier) as { items?: unknown } | null;
  if (cfg && Array.isArray(cfg.items)) {
    cfg.items = cfg.items.filter((i: { name?: string }) => i.name !== 'New Doc');
  }
}

/** A table-view database row's peek offers "Click to create a linked doc",
 *  which also swaps the row's title for a link to such a doc. Not offered. */
export function dropDatabaseRowDoc() {
  const NoteRenderer = customElements.get('database-datasource-note-renderer');
  if (NoteRenderer) (NoteRenderer.prototype as { renderNote: () => unknown }).renderNote = () => null;
}
