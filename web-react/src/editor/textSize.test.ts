import { describe, expect, it } from 'vitest';
import { sizedBlocks } from './textSize';

const block = (id: string, flavour: string, size?: string, type = 'text', children: unknown[] = []) => ({
  id, flavour, props: { type }, children,
  yBlock: { get: (k: string) => (k === 'prop:mnSize' ? size : undefined), set() {}, delete() {} },
});

describe('sizedBlocks', () => {
  it('finds sized body blocks at any depth, and skips headings and unsized ones', () => {
    const root = block('page', 'affine:page', undefined, 'text', [
      block('note', 'affine:note', undefined, 'text', [
        block('a', 'affine:paragraph', 'small'),
        block('b', 'affine:paragraph'),
        block('h', 'affine:paragraph', 'large', 'h2'),
        block('l', 'affine:list', undefined, 'bulleted', [block('c', 'affine:list', 'large', 'bulleted')]),
      ]),
    ]);
    expect([...sizedBlocks(root as never)]).toEqual([['a', 'small'], ['c', 'large']]);
  });
});
