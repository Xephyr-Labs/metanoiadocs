// The one toolbar module for `affine:image`.
//
// It has to be one: BlockSuite keys toolbar modules by variant in its DI
// container, and a second `custom:affine:image` module throws
// DuplicateServiceDefinitionError at mount. So alignment (imageAlign.ts) and
// the download fix below share this registration, and anything else we add to
// the image toolbar later belongs here too.
//
// The download override: BlockSuite's own `Download` builds a detached <a>,
// points it at the block's live object URL and fires a synthetic
// `MouseEvent('click')` at it. An element that was never inserted into the
// document, activated by an untrusted event, is the shape of a download that
// browsers decline — and the object URL it borrows belongs to the block's
// resource controller, which revokes it whenever the image reloads. It also
// names every file `image`, with no extension, so even where it lands the file
// is one the OS can't open by double-clicking.
//
// This replaces it with the boring version: fetch the blob, mint our own URL,
// put a real anchor in the document, click it, clean up. An action carrying an
// existing id merges over the built-in one (see the toolbar registry's
// `group()`), so this is a replacement rather than a second button.
import { ActionPlacement, ToolbarModuleExtension, type ToolbarContext } from '@blocksuite/affine/shared/services';
import { BlockFlavourIdentifier } from '@blocksuite/affine/std';
import { DownloadIcon } from '@blocksuite/icons/lit';
import { imageAlignActions } from './imageAlign';

interface ImageModelLike {
  props?: { sourceId?: string; caption?: string };
  store?: { blobSync?: { get(key: string): Promise<Blob | null> } };
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

/** A caption makes a far better file name than "image", but it is free text —
 *  strip what a file name may not carry and keep it short. */
function fileNameFor(caption: string | undefined, type: string): string {
  const stem = (caption ?? '')
    // Characters a file name may not carry on Windows or POSIX, control
    // characters included; runs of them collapse rather than pile up.
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'image';
  const extension = EXTENSIONS[type] ?? type.split('/')[1]?.replace(/[^a-z0-9]/gi, '') ?? 'png';
  return stem.toLowerCase().endsWith(`.${extension}`) ? stem : `${stem}.${extension}`;
}

export async function downloadImage(model: ImageModelLike | null): Promise<boolean> {
  const sourceId = model?.props?.sourceId;
  const blob = sourceId ? await model?.store?.blobSync?.get(sourceId) : null;
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileNameFor(model?.props?.caption, blob.type || 'image/png');
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    // In the document, and a real click: a detached anchor and a synthetic
    // MouseEvent are exactly what BlockSuite's version got wrong.
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoking straight away races the browser's own read of the URL.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return true;
}

export function imageToolbarExtensions() {
  return [
    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:affine:image'),
      config: {
        actions: [
          {
            placement: ActionPlacement.Normal,
            id: 'a.download',
            tooltip: 'Download',
            icon: DownloadIcon(),
            run: (ctx: ToolbarContext) => {
              const model = ctx.getCurrentModel() as unknown as ImageModelLike | null;
              downloadImage(model).catch(console.error);
            },
          },
          ...imageAlignActions(),
        ],
      },
    }),
  ];
}
