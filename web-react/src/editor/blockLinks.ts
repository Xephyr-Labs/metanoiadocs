// "Copy link to block" on every block's toolbar.
//
// BlockSuite resolves a block's toolbar by merging four module ids, the last of
// which is the wildcard `custom:affine:*` — so one module reaches paragraphs,
// headings, lists, code, images, tables and anything added later, instead of
// one registration per flavour.
import { toast } from '@blocksuite/affine/components/toast';
import { ActionPlacement, ToolbarModuleExtension, type ToolbarContext } from '@blocksuite/affine/shared/services';
import { BlockFlavourIdentifier, TextSelection } from '@blocksuite/affine/std';
import { LinkIcon } from '@blocksuite/icons/lit';
import { docUrl } from '../lib/route';
import { copyText } from '../lib/clipboard';

/** Actions to add to every block toolbar in `docId`'s editor. */
export function blockLinkExtensions(docId: string) {
  return [
    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:affine:*'),
      config: {
        actions: [
          {
            // The More menu is sorted by id, and BlockSuite's own Delete is
            // `c.delete` — a `b.` prefix lands this above it rather than
            // stranding it under the destructive action.
            placement: ActionPlacement.More,
            id: 'b.metanoia-block-link',
            label: 'Copy link to block',
            icon: LinkIcon(),
            run: (ctx: ToolbarContext) => {
              // `getCurrentModel()` only reads a *block* selection (an image,
              // a code block, a dragged-over row). The toolbar most people see
              // is the one over selected text, and there it returned null — so
              // the item closed the menu and silently did nothing. Fall back to
              // the block the text selection starts in.
              const blockId =
                ctx.getCurrentModel()?.id ??
                ctx.getCurrentModelBy(TextSelection)?.id ??
                ctx.selection.find(TextSelection)?.from.blockId;
              if (!blockId) {
                toast(ctx.host, 'Select a block to copy its link');
                return;
              }
              const url = docUrl(docId, blockId);
              // Clipboard writes need a user gesture and a secure context; a
              // toolbar click is one, but http:// on a LAN address is not —
              // there `navigator.clipboard` is absent entirely, which is why
              // this has to go through the fallback rather than optional-chain
              // into nothing.
              copyText(url).then((ok) =>
                toast(ctx.host, ok ? 'Link to block copied' : 'Could not copy — your browser blocked clipboard access'),
              );
            },
          },
        ],
      },
    }),
  ];
}
