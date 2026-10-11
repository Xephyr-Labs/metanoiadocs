// BlockSuite's "Create Linked Doc" is switched off: the toolbar button over a
// selection (and over an embed), and its shortcut Ctrl/Cmd+Shift+L.
//
// It moves the selected blocks into a new doc and leaves a card in their place.
// That new doc is made in the browser's in-memory workspace, which this app
// never saves — our pages are rows the server creates. So the text left the
// page for a doc that existed nowhere, and the card read "Deleted page". On 11
// Oct it emptied a whole page ("Team Video Brief"); a version restore got it
// back. A linked page is still one "@" or "/" away, and those make a real one.

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
