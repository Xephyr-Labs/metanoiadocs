// Emoji for comments: the reactions offered, and turning typed shortcodes
// (":thumbsup:", ":)") into the emoji they stand for.

/** One tap under every comment: agree, disagree, love it, sad. */
export const QUICK_REACTIONS = ['👍', '👎', '❤️', '😢'] as const;
/** Behind the "+": the rest of the set. Must match server/src/reactions.js. */
export const MORE_REACTIONS = ['😂', '🎉', '👀', '🙏', '🔥', '✅', '😮', '🚀', '💯', '🤔', '👏', '😍'] as const;

export interface Reaction { emoji: string; count: number; mine?: boolean; names?: string[] }

const SHORTCODES: Record<string, string> = {
  '+1': '👍', thumbsup: '👍', thumbs_up: '👍', '-1': '👎', thumbsdown: '👎', thumbs_down: '👎',
  heart: '❤️', love: '❤️', cry: '😢', sob: '😭', joy: '😂', laughing: '😆', smile: '😄', smiley: '😃',
  grin: '😁', wink: '😉', blush: '😊', heart_eyes: '😍', thinking: '🤔', tada: '🎉', party: '🎉',
  fire: '🔥', eyes: '👀', pray: '🙏', clap: '👏', rocket: '🚀', '100': '💯', check: '✅',
  white_check_mark: '✅', x: '❌', warning: '⚠️', star: '⭐', sparkles: '✨', ok_hand: '👌',
  wave: '👋', muscle: '💪', bulb: '💡', sweat_smile: '😅', confused: '😕', open_mouth: '😮',
  scream: '😱', rage: '😡', sunglasses: '😎', zap: '⚡', memo: '📝', bug: '🐛', coffee: '☕',
};

// Text faces only where they stand alone, so "a:)b" or a URL is left as is.
const EMOTICONS: [RegExp, string][] = [
  [/(^|\s)<3(?=\s|$)/g, '$1❤️'],
  [/(^|\s):-?\)(?=\s|$)/g, '$1🙂'],
  [/(^|\s):-?\((?=\s|$)/g, '$1🙁'],
  [/(^|\s):-?D(?=\s|$)/g, '$1😄'],
  [/(^|\s);-?\)(?=\s|$)/g, '$1😉'],
  [/(^|\s):'\((?=\s|$)/g, '$1😢'],
  [/(^|\s):-?[pP](?=\s|$)/g, '$1😛'],
];

/** The emoji a shortcode (without its colons) stands for, if any. */
export const shortcodeEmoji = (code: string): string | null => SHORTCODES[code.toLowerCase()] ?? null;

/** ":thumbsup: looks good :)" → "👍 looks good 🙂". Unknown codes stay as typed. */
export function emojify(text: string): string {
  if (!text) return text;
  let out = text.replace(/:([a-z0-9_+-]{1,32}):/gi, (m, code: string) => SHORTCODES[code.toLowerCase()] ?? m);
  for (const [re, emoji] of EMOTICONS) out = out.replace(re, emoji);
  return out;
}

/** Your reaction toggled in a list, before the server answers. */
export function toggleLocal(list: Reaction[] | undefined, emoji: string, me = 'You'): Reaction[] {
  const out = [...(list ?? [])];
  const at = out.findIndex((r) => r.emoji === emoji);
  if (at >= 0 && out[at].mine) {
    const left = out[at].count - 1;
    if (left > 0) out[at] = { ...out[at], count: left, mine: false };
    else out.splice(at, 1);
  } else if (at >= 0) out[at] = { ...out[at], count: out[at].count + 1, mine: true };
  else out.push({ emoji, count: 1, mine: true, names: [me] });
  return out;
}
