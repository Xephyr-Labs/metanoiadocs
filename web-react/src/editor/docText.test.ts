import { describe, it, expect } from 'vitest';
import { docPlainText } from './docText';

const block = (flavour: string, props: Record<string, unknown>, children: unknown[] = []) =>
  ({ flavour, props, children });
const text = (s: string) => ({ toString: () => s });

describe('docPlainText', () => {
  const store = {
    root: {
      children: [
        block('affine:note', {}, [
          block('affine:paragraph', { type: 'text', text: text('Sprint notes') }),
          block('affine:list', { type: 'todo', checked: false, text: text('Ship the release notes') }),
          block('affine:list', { type: 'todo', checked: true, text: text('Reviewed the plan') }),
          block('affine:list', { type: 'bulleted', text: text('Just a bullet') }),
          block('affine:database', {
            cells: { r1: { c1: { value: 'Alice' }, c2: { value: 30 }, c3: { value: '' } } },
          }, [block('affine:paragraph', { type: 'text', text: text('row title') })]),
        ]),
      ],
    },
  };

  it('keeps todo markers with their checked state', () => {
    const lines = docPlainText(store).split('\n');
    expect(lines).toContain('- [ ] Ship the release notes');
    expect(lines).toContain('- [x] Reviewed the plan');
    expect(lines).toContain('Just a bullet'); // non-todo lists get no marker
  });

  it('walks nested blocks in tree order', () => {
    expect(docPlainText(store).split('\n')[0]).toBe('Sprint notes');
  });

  it('includes database cell values but not empty ones', () => {
    const lines = docPlainText(store).split('\n');
    expect(lines).toContain('Alice');
    expect(lines).toContain('30');
    expect(lines).toContain('row title');
    expect(lines).not.toContain('');
  });

  it('returns empty string for a store with no root (caller falls back to innerText)', () => {
    expect(docPlainText(null)).toBe('');
    expect(docPlainText({})).toBe('');
  });
});

describe('docPlainText with suggestions pending', () => {
  const S = (kind: string) => ({ mnSugg: { id: 'x', kind, by: 'u', at: 1 } });
  const delta = (...ops: [string, string?][]) => ({
    toString: () => ops.map(([t]) => t).join(''), // includes the suggested insertion, as the live text does
    toDelta: () => ops.map(([t, k]) => (k ? { insert: t, attributes: S(k) } : { insert: t })),
  });
  const store = {
    root: {
      children: [
        block('affine:note', {}, [
          block('affine:paragraph', { type: 'text', text: delta(['keep '], ['NEW', 'ins'], [' '], ['OLD', 'del']) }),
          block('affine:paragraph', { type: 'text', text: text('ADDED'), mnSugg: { id: 'a', kind: 'add' } }),
          block('affine:paragraph', { type: 'text', text: text('REMOVED'), mnSugg: { id: 'r', kind: 'remove' } }),
          block('affine:paragraph', {
            type: 'h1', text: text('Retyped'),
            mnSugg: { id: 't', kind: 'type', from: { flavour: 'affine:list', type: 'todo' } },
          }),
        ]),
      ],
    },
  };
  it('reads the page with nothing accepted', () => {
    expect(docPlainText(store).split('\n')).toEqual(['keep  OLD', 'REMOVED', '- [ ] Retyped']);
  });
});
