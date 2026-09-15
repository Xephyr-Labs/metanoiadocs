/**
 * Paste markdown and get markdown, not the characters you typed to make it.
 *
 * BlockSuite already parses markdown on paste — but only from `text/plain`,
 * whose clipboard adapter is registered at priority 70, below `text/html`'s 90.
 * That ordering is right for a copy off a web page, where the HTML carries the
 * formatting and the plain text is the lossy fallback. It is exactly wrong for
 * the places people actually copy markdown FROM: a code editor, a terminal, a
 * notes app, an AI answer. Those put HTML on the clipboard too — but it is
 * syntax-highlight markup around the same characters, with no heading, no
 * list, no emphasis in it. The HTML adapter wins the race, reproduces the
 * characters faithfully, and you get `## Heading` and `**bold**` as literal
 * text in a paragraph.
 *
 * So: when the clipboard's HTML carries no formatting of its own, and its
 * plain text reads as markdown, the paste is replayed carrying only the plain
 * text. BlockSuite's own markdown path then runs, unmodified — this file
 * decides which of its two existing routes the paste takes, and converts
 * nothing itself.
 *
 * Nothing is lost when it fires: HTML with no formatting in it and the plain
 * text beside it are the same characters. Both conditions have to hold, so a
 * real rich-text paste (a styled document, a web page, a table) still goes the
 * way it always did.
 */

/**
 * Markup that means the HTML is carrying something the plain text cannot.
 *
 * `div`, `span`, `p`, `br` and `font` are deliberately absent — a copy out of
 * a code editor is one coloured `<span>` per token inside one `<div>` per
 * line, which is the paste this exists for.
 *
 * `pre` and `code` ARE here, though they carry no styling. They are a claim:
 * whoever wrote that HTML is saying "this block is preformatted". A YAML or
 * diff sample copied from a docs page is full of lines starting `- `, and
 * rewriting it into a bulleted list because of that would destroy the one
 * thing the source was explicit about. Selecting a code block and getting a
 * code block is the right answer; markdown copied as text does not come
 * wearing a `<pre>`.
 */
const FORMATTED =
  /<\s*(a|strong|b|em|i|u|s|mark|small|h[1-6]|ul|ol|li|dl|dt|dd|table|thead|tbody|tfoot|tr|td|th|caption|img|svg|picture|video|audio|blockquote|hr|input|button|select|figure|figcaption|iframe|sub|sup|del|ins|abbr|cite|q|kbd|pre|code|samp|var)\b/i;

/** Whether this HTML is plain text in fancy dress. */
export function isUnformattedHtml(html: string): boolean {
  return !FORMATTED.test(html);
}

/**
 * Whether this text uses at least one markdown construct.
 *
 * Deliberately narrow. Rerouting an ordinary paragraph would produce the same
 * blocks either way, so there is nothing to gain from guessing — and a paste
 * that behaves differently for no visible reason is worse than one that is
 * predictable. Each pattern below is something you cannot type by accident.
 */
const MARKDOWN = [
  /^ {0,3}#{1,6}\s+\S/m, // # heading
  /^ {0,3}[-*+][ \t]+\S/m, // - bullet
  /^ {0,3}\d+[.)][ \t]+\S/m, // 1. numbered
  /^ {0,3}>[ \t]?\S/m, // > quote
  /^ {0,3}(```|~~~)/m, // ``` fence
  /^ {0,3}\|.*\|[ \t]*$/m, // | table | row |
  /^ {0,3}([-*_])[ \t]*\1[ \t]*\1[-*_ \t]*$/m, // --- rule
  /^ {0,3}(- )?\[[ xX]\]\s+\S/m, // - [ ] task
  /\*\*[^*\n]+\*\*/, // **bold**
  /__[^_\n]+__/, // __bold__
  /`[^`\n]+`/, // `code`
  /\[[^\]\n]*\]\([^)\s]*\)/, // [link](href)
  /!\[[^\]\n]*\]\([^)\s]*\)/, // ![image](src)
];

export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN.some((re) => re.test(text));
}

/**
 * The whole decision, as one pure function so it can be tested without a DOM.
 * Returns the plain text to replay the paste with, or null to leave the paste
 * alone.
 */
export function markdownToReplay(text: string, html: string): string | null {
  // No HTML on the clipboard means BlockSuite already reads the markdown —
  // `text/plain` is the only adapter in the running, and it parses.
  if (!html || !text.trim()) return null;
  if (!isUnformattedHtml(html)) return null;
  if (!looksLikeMarkdown(text)) return null;
  return text;
}

/**
 * Watch the editor for pastes worth rerouting.
 *
 * Capture phase on the editor, because BlockSuite listens on `document` in the
 * bubble phase (std/event/control/clipboard) — capturing here is what makes it
 * possible to stop that one and send a different one. Returns a detach fn, the
 * way every other attach* in this folder does.
 */
const FIELD = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function attachMarkdownPaste(host: HTMLElement): () => void {
  // dispatchEvent is synchronous, and the replay bubbles back up through this
  // same listener; without the flag it would reroute itself forever.
  let replaying = false;

  const onPaste = (e: Event) => {
    if (replaying) return;
    const ev = e as ClipboardEvent;
    const data = ev.clipboardData;
    if (!data) return;
    // A file on the clipboard is an image or an attachment, never markdown.
    if (data.files?.length) return;

    const text = markdownToReplay(data.getData('text/plain'), data.getData('text/html'));
    if (text === null) return;

    // Read off composedPath rather than `closest`: the inline editor the caret
    // sits in is inside a shadow root, and closest() stops at that boundary.
    const path = ev.composedPath();
    const els = path.filter((n): n is HTMLElement => n instanceof HTMLElement);
    const target = els[0];
    if (!target) return;

    // The title is one line of text by definition — a heading pasted into it
    // has nowhere to become a heading, and rerouting would only change which
    // code path flattens it.
    if (els.some((n) => n.tagName === 'DOC-TITLE')) return;

    // A form field inside the editor — a code block's language filter, a link
    // popup — is not the document. Stopping the event there would swallow the
    // paste outright: this handler cancels the native one, and the replay
    // would go to the document instead of the field the caret is in.
    //
    // Only form fields. "Is the target editable?" was tried and is wrong: with
    // whole blocks selected rather than a caret, the event target is the
    // editor host, which is not contenteditable — and that is a real paste
    // into the document, the one case where markdown arrives by the handful.
    if (els.some((n) => FIELD.has(n.tagName))) return;

    e.stopImmediatePropagation();
    e.preventDefault();

    const replay = new DataTransfer();
    replay.setData('text/plain', text);
    replaying = true;
    try {
      target.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: replay,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    } finally {
      replaying = false;
    }
  };

  host.addEventListener('paste', onPaste, true);
  return () => host.removeEventListener('paste', onPaste, true);
}
