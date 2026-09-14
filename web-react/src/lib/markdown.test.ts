import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline } from './markdown';

describe('parseInline', () => {
  it('styles bold, italic, code and links', () => {
    expect(parseInline('a **b** c `d` [e](http://x)')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' c ' },
      { kind: 'code', text: 'd' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'e', href: 'http://x' },
    ]);
  });

  it('leaves a marker that is still being typed as text', () => {
    expect(parseInline('half **way')).toEqual([{ kind: 'text', text: 'half **way' }]);
  });
});

describe('parseBlocks', () => {
  it('reads headings, lists and paragraphs', () => {
    const blocks = parseBlocks('## Plan\n\n- one\n- two\n\nA line.\nAnd its wrap.');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'list', 'paragraph']);
    expect(blocks[0]).toMatchObject({ level: 2 });
    expect(blocks[1]).toMatchObject({ ordered: false, items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two' }]] });
    expect(blocks[2]).toMatchObject({ spans: [{ kind: 'text', text: 'A line.\nAnd its wrap.' }] });
  });

  it('keeps numbered lists ordered and separate from bullets', () => {
    const blocks = parseBlocks('1. first\n2. second');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: true });
  });

  it('takes an unterminated fence as code rather than losing the rest', () => {
    const blocks = parseBlocks('text\n\n```js\nconst a = 1;');
    expect(blocks[1]).toEqual({ kind: 'code', text: 'const a = 1;' });
  });

  it('reads quotes and rules', () => {
    expect(parseBlocks('> quoted\n\n---').map((b) => b.kind)).toEqual(['quote', 'rule']);
  });
});
