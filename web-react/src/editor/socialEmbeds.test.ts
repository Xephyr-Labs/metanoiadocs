import { describe, expect, it } from 'vitest';
import { socialEmbedUrl } from './socialEmbeds';

describe('socialEmbedUrl', () => {
  it('builds the plugin URL for Facebook posts and videos', () => {
    const post = 'https://www.facebook.com/xephyrlabs/posts/pfbid02abc';
    expect(socialEmbedUrl(post)).toBe(`https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(post)}&show_text=true`);
    expect(socialEmbedUrl('https://www.facebook.com/watch/?v=123')).toMatch(/^https:\/\/www\.facebook\.com\/plugins\/video\.php\?href=/);
    expect(socialEmbedUrl('https://fb.watch/abcDEF/')).toMatch(/plugins\/video\.php/);
    expect(socialEmbedUrl('https://www.facebook.com/share/p/1AbCd/')).toMatch(/plugins\/post\.php/);
  });
  it('builds Instagram embed URLs for posts and reels', () => {
    expect(socialEmbedUrl('https://www.instagram.com/p/C1a2B3c4D5e/?igsh=x')).toBe('https://www.instagram.com/p/C1a2B3c4D5e/embed/captioned/');
    expect(socialEmbedUrl('https://www.instagram.com/reels/XyZ_12/')).toBe('https://www.instagram.com/reel/XyZ_12/embed/captioned/');
    expect(socialEmbedUrl('https://www.instagram.com/lattu.ai/p/AbC/')).toBe('https://www.instagram.com/p/AbC/embed/captioned/');
  });
  it('builds LinkedIn embed URLs from a feed urn or a post slug', () => {
    expect(socialEmbedUrl('https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/'))
      .toBe('https://www.linkedin.com/embed/feed/update/urn:li:activity:7123456789012345678');
    expect(socialEmbedUrl('https://www.linkedin.com/posts/xephyr-labs_launch-activity-7123456789012345678-AbCd?utm_source=share'))
      .toBe('https://www.linkedin.com/embed/feed/update/urn:li:activity:7123456789012345678');
  });
  it('leaves profiles, pages and other sites alone', () => {
    expect(socialEmbedUrl('https://www.facebook.com/xephyrlabs')).toBeNull();
    expect(socialEmbedUrl('https://www.instagram.com/lattu.ai/')).toBeNull();
    expect(socialEmbedUrl('https://www.linkedin.com/company/xephyr-labs/')).toBeNull();
    expect(socialEmbedUrl('https://example.com/posts/1')).toBeNull();
    expect(socialEmbedUrl('http://www.facebook.com/x/posts/1')).toBeNull();
    expect(socialEmbedUrl('not a url')).toBeNull();
  });
});
