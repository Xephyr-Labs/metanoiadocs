import { describe, expect, it } from 'vitest';
import { previewLine } from './preview';

describe('previewLine', () => {
  it('returns null when there is no page or the page is empty', () => {
    expect(previewLine(null)).toBeNull();
    expect(previewLine('')).toBeNull();
    expect(previewLine('   \n\t  ')).toBeNull();
  });

  it('collapses the whitespace a block-based document leaves behind', () => {
    // extractText joins blocks with newlines, so a two-paragraph page arrives
    // with runs of \n that would otherwise render as gaps inside the card.
    expect(previewLine('First para.\n\n\nSecond para.')).toBe('First para. Second para.');
    expect(previewLine('  padded\ttext  ')).toBe('padded text');
  });

  it('keeps the title out of the preview when the page repeats it', () => {
    // A row's page opens with its own title as the first line; showing it again
    // directly under the card title reads as a duplicate.
    expect(previewLine('Fix login\nToken expiry check uses <', 'Fix login')).toBe(
      'Token expiry check uses <',
    );
    expect(previewLine('Fix login', 'Fix login')).toBeNull();
    // Only an exact first-line match is dropped — a page that merely mentions
    // the title keeps its text.
    expect(previewLine('About fix login later', 'Fix login')).toBe('About fix login later');
  });

  it('truncates on a word boundary and marks the cut', () => {
    const long = `${'word '.repeat(60)}end`;
    const out = previewLine(long)!;
    expect(out.length).toBeLessThanOrEqual(181);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });

  it('leaves text that already fits untouched', () => {
    expect(previewLine('Short enough.')).toBe('Short enough.');
  });
});
