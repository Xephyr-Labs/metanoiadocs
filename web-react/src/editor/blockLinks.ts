// "Copy link to block" on every block's toolbar.
//
// BlockSuite resolves a block's toolbar by merging four module ids, the last of
// which is the wildcard `custom:affine:*` — so one module reaches paragraphs,
// headings, lists, code, images, tables and anything added later, instead of
// one registration per flavour.
import { toast } from '@blocksuite/affine/components/toast';
import { ActionPlacement, ToolbarModuleExtension, type ToolbarContext } from '@blocksuite/affine/shared/services';
import { BlockFlavourIdentifier } from '@blocksuite/affine/std';
import { LinkIcon } from '@blocksuite/icons/lit';
import { docUrl } from '../lib/route';

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
              const blockId = ctx.getCurrentModel()?.id;
              if (!blockId) return;
              const url = docUrl(docId, blockId);
              // Clipboard writes need a user gesture and a secure context; a
              // toolbar click is one, but http:// on a LAN address is not, so
              // say when it failed rather than leaving the click silent.
              navigator.clipboard
                ?.writeText(url)
                .then(() => toast(ctx.host, 'Link to block copied'))
                .catch(() => toast(ctx.host, 'Could not copy — your browser blocked clipboard access'));
            },
          },
        ],
      },
    }),
  ];
}
