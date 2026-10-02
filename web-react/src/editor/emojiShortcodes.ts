// ":tada:" typed in a page becomes 🎉, the way it does in a chat box.
//
// Only a complete, known shortcode is replaced, and only one just typed (in
// the last few words before the caret) — so a time like 10:30: or a pasted
// ":unknown:" is left alone, and undo puts the letters back.
import { TextSelection } from '@blocksuite/affine/std';
import { shortcodeEmoji } from '../lib/emoji';

interface TextLike { toString(): string; replace(index: number, length: number, content: string): void }
interface StdLike {
  store: { readonly: boolean; getModelById(id: string): { text?: TextLike | null } | null };
  selection: {
    value: { type: string; from?: { blockId: string; index: number; length: number } }[];
    create(type: typeof TextSelection, args: unknown): unknown;
    setGroup(group: string, selections: unknown[]): void;
  };
}

export function attachEmojiShortcodes(editor: Element & { std?: StdLike }): () => void {
  // After BlockSuite has written the colon into the model. Safe to run twice
  // for one keystroke: once replaced, the shortcode is no longer there.
  const check = () => requestAnimationFrame(() => {
    const std = editor.std;
    if (!std || std.store.readonly) return;
    const sel = std.selection.value.find((s) => s.type === 'text');
    const from = sel?.from;
    if (!from || from.length) return;
    const text = std.store.getModelById(from.blockId)?.text;
    if (!text) return;
    // Look a little way back, not only at the caret: a fast typist is often a
    // few letters past the closing colon by the time this runs.
    const reach = Math.max(0, from.index - 48);
    const recent = text.toString().slice(reach, from.index);
    let hit: { at: number; length: number; emoji: string } | null = null;
    for (const m of recent.matchAll(/:([a-z0-9_+-]{1,32}):/gi)) {
      const emoji = shortcodeEmoji(m[1]);
      if (emoji) hit = { at: reach + (m.index ?? 0), length: m[0].length, emoji };
    }
    if (!hit) return;
    text.replace(hit.at, hit.length, hit.emoji);
    const caret = from.index - hit.length + hit.emoji.length;
    std.selection.setGroup('note', [
      std.selection.create(TextSelection, { from: { blockId: from.blockId, index: caret, length: 0 }, to: null }),
    ]);
  });
  // BlockSuite's inline editor takes typing over in `beforeinput` and cancels
  // it, so no `input` event ever follows. A physical keyboard reports the
  // colon on keyup; a phone keyboard only through beforeinput's data.
  const onKeyUp = (event: Event) => {
    const key = (event as KeyboardEvent).key;
    if (key === ':' || key === ' ') check();
  };
  const onBeforeInput = (event: Event) => {
    const data = (event as InputEvent).data;
    if (data && /[: ]$/.test(data)) setTimeout(check, 0);
  };
  editor.addEventListener('keyup', onKeyUp, true);
  editor.addEventListener('beforeinput', onBeforeInput, true);
  return () => {
    editor.removeEventListener('keyup', onKeyUp, true);
    editor.removeEventListener('beforeinput', onBeforeInput, true);
  };
}
