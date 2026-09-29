// Android keyboards compose over text that is already there.
//
// BlockSuite (0.22.4) lets the browser change the DOM during a composition and
// only touches the model when it ends: it re-renders the line from the model,
// then INSERTS the composed word where the composition started. That is right
// for a desktop IME, which only ever composes new text at the caret. Gboard and
// friends also compose over existing words — backspace, autocorrect, a tapped
// suggestion and tapping into a word all reopen the word under the caret — so
// whatever the keyboard deleted or replaced never reaches the model: the old
// word stays and the new one lands beside it ("hello" + backspace becomes
// "hellohell"; deleting a whole word does nothing).
//
// What the keyboard left in the DOM is the truth. When the composition ends,
// read the line's text before BlockSuite re-renders it, diff it against the
// model, and hand BlockSuite exactly that replacement instead.

type Range = { index: number; length: number };
type Ctx = { inlineRange: Range; data?: string | null };
type Delta = { insert: string };
type InlineEditorLike = {
  hooks: { compositionEnd?: (ctx: Ctx) => void };
  rootElement: HTMLElement | null;
  yTextDeltas: Delta[];
  isEmbed: (delta: Delta) => boolean;
  deleteText: (range: Range) => void;
  setInlineRange: (range: Range) => void;
};

// One character per embed (a page mention, a latex chip) on both sides, so the
// two strings index alike; a change that touches one is left to BlockSuite.
const EMBED = '\uFFFC';
// BlockSuite's placeholders for an empty line and around embeds; never content.
const FILLER = /[\u200B\u200C]/g;

/** The smallest replacement turning `before` into `after`. Repeated letters
 *  make that ambiguous ("hel|lo" + "l"), so the change is kept from reaching
 *  past `caret` — where the keyboard actually typed. */
export function diffText(before: string, after: string, caret: number | null): Range & { text: string } {
  const suffixMax = Math.min(before.length, caret === null ? after.length : after.length - caret);
  let suffix = 0;
  while (suffix < suffixMax && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const prefixMax = Math.min(before.length, after.length) - suffix;
  let prefix = 0;
  while (prefix < prefixMax && before[prefix] === after[prefix]) prefix++;
  return { index: prefix, length: before.length - suffix - prefix, text: after.slice(prefix, after.length - suffix) };
}

/** The line's text as the keyboard left it, plus the caret's offset in it. */
function domText(root: HTMLElement, caretNode: Node | null, caretOffset: number) {
  let text = '';
  let caret: number | null = null;
  let lines = 0;
  const walk = (node: Node, inText = false) => {
    if (node.nodeType === Node.TEXT_NODE) {
      // Outside <v-text> is Lit's template whitespace, not content.
      if (!inText) return;
      const data = (node as Text).data;
      if (node === caretNode) caret = text.length + data.slice(0, caretOffset).replace(FILLER, '').length;
      text += data.replace(FILLER, '');
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.getAttribute('data-v-embed') === 'true') { text += EMBED; return; }
    if (node.tagName === 'V-LINE' && lines++) text += '\n';
    // A caret between children counts the ones before it.
    const childInText = inText || node.tagName === 'V-TEXT';
    node.childNodes.forEach((child, i) => { if (node === caretNode && i === caretOffset) caret = text.length; walk(child, childInText); });
    if (node === caretNode && caret === null) caret = text.length;
  };
  walk(root);
  return { text, caret };
}

function modelText(editor: InlineEditorLike) {
  return editor.yTextDeltas.map((d) => (editor.isEmbed(d) ? EMBED.repeat(d.insert.length) : d.insert)).join('');
}

/** The paragraph's inline editor under the caret. Not the event's target:
 *  the whole page is one contenteditable, so that is always the page root. */
function editorAtCaret(): InlineEditorLike | null {
  const node = document.getSelection()?.anchorNode ?? null;
  const el = node instanceof Element ? node : node?.parentElement;
  const root = el?.closest('[data-v-root="true"]') as (Element & { inlineEditor?: InlineEditorLike }) | null;
  return root?.inlineEditor ?? null;
}

type Ended = { editor: InlineEditorLike; change: Range & { text: string } };
let ended: Ended | null = null;

const patched = new WeakSet<InlineEditorLike>();
function patch(editor: InlineEditorLike) {
  if (patched.has(editor)) return;
  patched.add(editor);
  const original = editor.hooks.compositionEnd;
  editor.hooks.compositionEnd = (ctx) => {
    const state = ended;
    ended = null;
    if (state?.editor === editor) {
      ctx.inlineRange = { index: state.change.index, length: state.change.length };
      ctx.data = state.change.text;
    }
    original?.(ctx);
    // BlockSuite only writes when there is text to insert; a pure deletion
    // (backspacing a reopened word) is ours to apply.
    if (state?.editor === editor && !ctx.data && ctx.inlineRange.length) {
      editor.deleteText(ctx.inlineRange);
      editor.setInlineRange({ index: ctx.inlineRange.index, length: 0 });
    }
  };
}

export function fixAndroidRecompose(root: HTMLElement): () => void {
  // Capture on an ancestor runs before BlockSuite's own compositionend
  // handler, which re-renders the line from the model and erases the evidence.
  const onEnd = () => {
    ended = null;
    const editor = editorAtCaret();
    const line = editor?.rootElement;
    if (!editor || !line) return;
    const before = modelText(editor);
    const sel = document.getSelection();
    const after = domText(line, sel?.anchorNode ?? null, sel?.anchorOffset ?? 0);
    const change = diffText(before, after.text, after.caret);
    // Leave embeds and anything unrecognisable to BlockSuite.
    if (/[\u200B\u200C]/.test(before) || before.slice(change.index, change.index + change.length).includes(EMBED) || change.text.includes(EMBED)) return;
    patch(editor);
    ended = { editor, change };
  };
  root.addEventListener('compositionend', onEnd, true);
  return () => root.removeEventListener('compositionend', onEnd, true);
}
