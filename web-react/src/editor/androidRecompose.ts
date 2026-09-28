// Android keyboards reopen the word under the cursor for editing.
//
// Tap into the middle of "onboarding" and Gboard marks the whole word as the
// text being composed (so it can offer corrections). BlockSuite assumes every
// composition starts empty at the caret: when this one ends it inserts the
// composed word at the caret, next to the original, and "onboarding" becomes
// "onboonboardingarding" — on hiding the keyboard, tapping away, or accepting
// a suggestion.
//
// The browser shows it: after compositionstart (whose data is empty on
// Chrome for Android) comes a compositionupdate carrying the existing word,
// with no beforeinput in between — nothing was typed, the keyboard just
// picked the word up. Find that word around the caret, and when the
// composition ends have BlockSuite replace it instead of inserting beside it.
// Once anything is typed the reopened span stays as found, so an edited or
// autocorrected word still replaces the original.

type Range = { index: number; length: number };
type Ctx = { inlineRange: Range; data?: string | null };
type InlineEditorLike = {
  hooks: { compositionEnd?: (ctx: Ctx) => void };
  getInlineRange: () => Range | null;
  yText: { toString: () => string };
};

/** The occurrence of `word` in `text` that the caret sits inside or at an edge of. */
export function regionAround(text: string, caret: number, word: string): Range | null {
  if (!word) return null;
  for (let start = Math.max(0, caret - word.length); start <= caret; start++) {
    if (text.startsWith(word, start)) return { index: start, length: word.length };
  }
  return null;
}

const patched = new WeakSet<InlineEditorLike>();

type Composing = { editor: InlineEditorLike; caret: number; text: string; typed: boolean; region: Range | null };
let composing: Composing | null = null;

/** The paragraph's inline editor under the caret. Not the event's target:
 *  the whole page is one contenteditable, so that is always the page root. */
function editorAtCaret(): InlineEditorLike | null {
  const node = document.getSelection()?.anchorNode ?? null;
  const el = node instanceof Element ? node : node?.parentElement;
  const root = el?.closest('[data-v-root="true"]') as (Element & { inlineEditor?: InlineEditorLike }) | null;
  return root?.inlineEditor ?? null;
}

function patch(editor: InlineEditorLike) {
  if (patched.has(editor)) return;
  patched.add(editor);
  const original = editor.hooks.compositionEnd;
  editor.hooks.compositionEnd = (ctx) => {
    original?.(ctx);
    const state = composing;
    composing = null;
    if (state?.editor === editor && state.region) ctx.inlineRange = state.region;
  };
}

export function fixAndroidRecompose(root: HTMLElement): () => void {
  const onStart = () => {
    composing = null;
    const editor = editorAtCaret();
    const caret = editor?.getInlineRange();
    if (!editor || !caret || caret.length) return;
    patch(editor);
    composing = { editor, caret: caret.index, text: editor.yText.toString(), typed: false, region: null };
  };
  const onBeforeInput = () => { if (composing) composing.typed = true; };
  const onUpdate = (e: Event) => {
    const data = (e as CompositionEvent).data;
    if (!composing || composing.typed || !data) return;
    const region = regionAround(composing.text, composing.caret, data);
    if (region) composing.region = region;
  };
  // Capture, so these run before BlockSuite's own handlers.
  root.addEventListener('compositionstart', onStart, true);
  root.addEventListener('beforeinput', onBeforeInput, true);
  root.addEventListener('compositionupdate', onUpdate, true);
  return () => {
    root.removeEventListener('compositionstart', onStart, true);
    root.removeEventListener('beforeinput', onBeforeInput, true);
    root.removeEventListener('compositionupdate', onUpdate, true);
  };
}
