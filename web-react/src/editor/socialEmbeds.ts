// Facebook, Instagram and LinkedIn posts as embeds ("Embed view" on a pasted
// link, or /embed).
//
// BlockSuite's catch-all provider framed the post's own page, which all three
// refuse to be framed in, so the block came up blank. Each has an embed URL of
// its own that may be framed; these providers build it from the post's link.
// They go ahead of BlockSuite's in the store extensions: the first provider
// that matches a link is the one used.
import { EmbedIframeConfigExtension } from '@blocksuite/affine/shared/services';

const host = (url: URL) => url.hostname.replace(/^(www|m|web)\./, '');

/** The frameable embed URL for a social post, or null for anything else (a
 *  profile, a page, a search — none of which has one). */
export function socialEmbedUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const h = host(url);
  const path = url.pathname;

  if (h === 'facebook.com' || h === 'fb.watch') {
    const video = h === 'fb.watch' || /\/(videos|reel|watch)\b/.test(path) || url.searchParams.has('v');
    const post = video || /\/(posts|permalink\.php|photo|story\.php|share\/[pv]\/)/.test(path) || url.searchParams.has('story_fbid');
    if (!post) return null;
    const href = encodeURIComponent(raw);
    return video
      ? `https://www.facebook.com/plugins/video.php?href=${href}&show_text=true`
      : `https://www.facebook.com/plugins/post.php?href=${href}&show_text=true`;
  }

  if (h === 'instagram.com') {
    const m = path.match(/^\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/);
    return m ? `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/embed/captioned/` : null;
  }

  if (h === 'linkedin.com') {
    // /feed/update/urn:li:activity:123 — already the urn.
    const urn = decodeURIComponent(path).match(/urn:li:(activity|share|ugcPost):(\d+)/);
    if (urn) return `https://www.linkedin.com/embed/feed/update/urn:li:${urn[1]}:${urn[2]}`;
    // /posts/name_slug-activity-7123…-abcd — the id is in the slug.
    const slug = path.match(/^\/posts\/.*-(activity|share|ugcPost)-(\d{10,})/);
    if (slug) return `https://www.linkedin.com/embed/feed/update/urn:li:${slug[1]}:${slug[2]}`;
    return null;
  }
  return null;
}

const provider = (name: string, hosts: string[], heightInNote: number) => EmbedIframeConfigExtension({
  name,
  match: (raw: string) => {
    try { if (!hosts.includes(host(new URL(raw)))) return false; } catch { return false; }
    return socialEmbedUrl(raw) !== null;
  },
  buildOEmbedUrl: (raw: string) => socialEmbedUrl(raw) ?? undefined,
  // The built URL is the iframe's src; there is no oEmbed JSON to fetch (all
  // three gate theirs behind an app token).
  useOEmbedUrlDirectly: true,
  options: {
    widthInSurface: 520,
    heightInSurface: heightInNote,
    heightInNote,
    widthPercent: 100,
    allow: 'autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share',
    allowFullscreen: true,
    containerBorderRadius: 8,
  },
});

export const socialEmbedExtensions = [
  provider('metanoia-facebook', ['facebook.com', 'fb.watch'], 640),
  provider('metanoia-instagram', ['instagram.com'], 720),
  provider('metanoia-linkedin', ['linkedin.com'], 600),
];
