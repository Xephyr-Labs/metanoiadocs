import { describe, expect, it } from 'vitest';
import { emojify } from './emoji';

describe('emojify', () => {
  it('turns shortcodes into emoji', () => {
    expect(emojify(':thumbsup: ship it :tada:')).toBe('👍 ship it 🎉');
    expect(emojify(':+1: :heart: :cry:')).toBe('👍 ❤️ 😢');
  });
  it('leaves unknown codes and times alone', () => {
    expect(emojify(':notacode: at 10:30:45')).toBe(':notacode: at 10:30:45');
  });
  it('converts standalone faces only', () => {
    expect(emojify('nice :) thanks <3')).toBe('nice 🙂 thanks ❤️');
    expect(emojify('see http://x.io/a:)b')).toBe('see http://x.io/a:)b');
  });
});
