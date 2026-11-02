// The emoji that replaces a typed ":shortcode:" takes the shortcode's own
// attributes, never the text before it — which may be someone's suggestion
// (ruling R6), and in Suggesting mode the shortcode was my own insertion.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Text } from '@blocksuite/affine/store';
import { attachEmojiShortcodes } from './emojiShortcodes';

const attached = () => new Text(new Y.Doc().getText('t'));
const THEM = { id: 't', kind: 'ins', by: 'them', at: 1 };
const MINE = { id: 'm', kind: 'ins', by: 'me', at: 2 };

function typed(text: Text) {
  const listeners: Record<string, (e: Event) => void> = {};
  const std = {
    store: { readonly: false, getModelById: () => ({ text }) },
    selection: {
      value: [{ type: 'text', from: { blockId: 'b', index: text.length, length: 0 } }],
      create: (_: unknown, args: unknown) => args,
      setGroup: () => {},
    },
  };
  const editor = { std, addEventListener: (t: string, f: (e: Event) => void) => { listeners[t] = f; }, removeEventListener: () => {} };
  attachEmojiShortcodes(editor as never);
  listeners.keyup({ key: ':' } as KeyboardEvent);
}

describe('emoji shortcodes', () => {
  beforeEach(() => { vi.stubGlobal('requestAnimationFrame', (f: () => void) => f()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("after someone's suggestion, the emoji is plain like the shortcode was", () => {
    const text = attached();
    text.insert('Hi', 0, { mnSugg: THEM });
    text.insert(':tada:', 2, {});
    typed(text);
    expect(text.yText.toDelta()).toEqual([{ insert: 'Hi', attributes: { mnSugg: THEM } }, { insert: '🎉' }]);
  });

  it('a shortcode I typed as a suggestion becomes an emoji in that suggestion', () => {
    const text = attached();
    text.insert('Hi', 0, {});
    text.insert(':tada:', 2, { mnSugg: MINE });
    typed(text);
    expect(text.yText.toDelta()).toEqual([{ insert: 'Hi' }, { insert: '🎉', attributes: { mnSugg: MINE } }]);
  });

  it('a shortcode whose letters are styled differently is left alone', () => {
    const text = attached();
    text.insert(':ta', 0, { mnSugg: THEM });
    text.insert('da:', 3, {});
    typed(text);
    expect(text.toString()).toBe(':tada:');
  });
});
