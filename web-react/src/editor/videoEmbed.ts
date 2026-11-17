// Videos play in the page. BlockSuite's attachment block already has a video
// player (affine-block-attachment's embed.js, the 'video' config), but only
// shows it when the block's `embed` is on, and a pasted or dropped file comes
// in with it off: a file card you had to download to watch. So a video this
// person adds is switched to its player as it lands. Blocks loaded with the
// page are left alone; changing them would be an edit nobody made.
import { FileSizeLimitProvider } from '@blocksuite/affine/shared/services';

/** What PUT /api/blob takes (server index.js). Over it, BlockSuite says so with
 *  a toast instead of the upload failing after the block is already there. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const uploadLimitExtension = {
  setup: (di: { override: (a: unknown, b: unknown) => void }) =>
    di.override(FileSizeLimitProvider, () => ({ maxFileSize: MAX_UPLOAD_BYTES })),
};

type AddEvent = {
  type: string;
  init?: boolean;
  isLocal?: boolean;
  flavour?: string;
  model?: { props: { type?: string; embed?: boolean } };
};
type StoreLike = {
  slots: { blockUpdated: { subscribe: (fn: (e: AddEvent) => void) => { unsubscribe: () => void } } };
  updateBlock: (model: unknown, props: Record<string, unknown>) => void;
};

export const shouldEmbedVideo = (e: AddEvent) =>
  e.type === 'add' && !e.init && !!e.isLocal && e.flavour === 'affine:attachment' &&
  !!e.model && /^video\//i.test(e.model.props.type ?? '') && !e.model.props.embed;

export function attachVideoEmbed(store: StoreLike): () => void {
  const sub = store.slots.blockUpdated.subscribe((e) => {
    // Not inside the add itself: that is still the transaction creating it.
    if (shouldEmbedVideo(e)) queueMicrotask(() => store.updateBlock(e.model, { embed: true }));
  });
  return () => sub.unsubscribe();
}
