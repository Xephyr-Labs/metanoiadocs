import { describe, expect, it } from 'vitest';
import { shouldEmbedVideo } from './videoEmbed';

const add = (over = {}) => ({
  type: 'add', init: false, isLocal: true, flavour: 'affine:attachment',
  model: { props: { type: 'video/mp4', embed: false } }, ...over,
});

describe('shouldEmbedVideo', () => {
  it('embeds a video this person just added', () => expect(shouldEmbedVideo(add())).toBe(true));
  it('leaves blocks loaded with the page', () => expect(shouldEmbedVideo(add({ init: true }))).toBe(false));
  it('leaves remote adds to their author', () => expect(shouldEmbedVideo(add({ isLocal: false }))).toBe(false));
  it('leaves other files as cards', () =>
    expect(shouldEmbedVideo(add({ model: { props: { type: 'application/pdf', embed: false } } }))).toBe(false));
  it('does nothing when already embedded', () =>
    expect(shouldEmbedVideo(add({ model: { props: { type: 'video/webm', embed: true } } }))).toBe(false));
});
