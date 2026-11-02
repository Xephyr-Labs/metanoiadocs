import { readFileSync } from 'node:fs';
import { Text } from '@blocksuite/affine/store';
import { TestWorkspace } from '@blocksuite/affine/store/test';
import { getTestStoreManager } from '@blocksuite/integration-test/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLEAN_VIEW_CLASS, paintSuggestionBlocks } from './blockMarks';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

/** A block element as the painter sees it: attributes, and a model with props. */
const block = (id: string, mnSugg?: unknown): any => {
  const attrs = new Map<string, string>();
  return {
    id, attrs, model: { props: { mnSugg } },
    getAttribute: (k: string) => attrs.get(k) ?? null,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
  };
};

describe('block suggestion marks', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('paints data-mn-sugg from the block prop and clears it when the prop goes', () => {
    let notify: () => void = () => {};
    vi.stubGlobal('requestAnimationFrame', (f: () => void) => f());
    vi.stubGlobal('MutationObserver', class { constructor(cb: () => void) { notify = cb; } observe() {} disconnect() {} });
    const a = block('a', { id: 's', kind: 'add', by: 'u', at: 1 });
    const r = block('r', { id: 't', kind: 'remove', by: 'u', at: 1 });
    const t = block('t', { id: 'u', kind: 'type', from: 'h1', by: 'u', at: 1 });
    const plain = block('p');
    const host = { querySelectorAll: () => [a, r, t, plain] } as never;
    const stop = paintSuggestionBlocks(host);
    expect([a, r, t, plain].map((b) => b.attrs.get('data-mn-sugg'))).toEqual(['add', 'remove', 'type', undefined]);
    (a.model.props as { mnSugg?: unknown }).mnSugg = undefined;
    notify();
    expect(a.attrs.has('data-mn-sugg')).toBe(false);
    stop();
  });

  it('styles: green ins, red struck del, block bar, dark tokens', () => {
    expect(css).toMatch(/\.mn-sugg-ins\s*{[^}]*text-decoration:\s*underline/);
    expect(css).toMatch(/\.mn-sugg-del\s*{[^}]*line-through/);
    expect(css).toContain('#137333');
    expect(css).toContain('#a50e0e');
    expect(css).toContain('[data-mn-sugg=');
    expect(css).toMatch(/html\.dark\s*{[^}]*--sugg-ins-fg/);
  });

  it('block bar stands off the text; an added block gets a faint green wash', () => {
    const rule = css.match(/\[data-mn-sugg='add'\],\s*\[data-mn-sugg='remove'\],\s*\[data-mn-sugg='type'\]\s*{([^}]*)}/)![1];
    // Two outer shadows: a canvas-coloured gap next to the text, the bar beyond it.
    expect(rule).toMatch(/box-shadow:\s*-\d+px 0 0 0 var\(--canvas\),\s*-\d+px 0 0 0 var\(--sugg-ins-fg\)/);
    expect(rule).not.toMatch(/inset/);
    expect(css).not.toMatch(/\[data-mn-sugg='remove'\][^{]*{[^}]*inset/);
    expect(css).toMatch(/\[data-mn-sugg='add'\]\s*{[^}]*background:\s*var\(--sugg-add-bg\)/);
    expect(css).toContain('--sugg-add-bg: #f3faf5');
    expect(css).toMatch(/html\.dark\s*{[^}]*--sugg-add-bg/);
  });

  it('share/snapshot view: ins hidden, del plain, add blocks hidden, remove blocks normal', () => {
    const c = CLEAN_VIEW_CLASS;
    expect(css).toMatch(new RegExp(`\\.${c} \\.mn-sugg-ins\\s*{[^}]*display:\\s*none`));
    expect(css).toMatch(new RegExp(`\\.${c} \\.mn-sugg-del\\s*{[^}]*text-decoration:\\s*none`));
    expect(css).toMatch(new RegExp(`\\.${c} \\[data-mn-sugg='add'\\]\\s*{[^}]*display:\\s*none`));
    expect(css).not.toMatch(new RegExp(`\\.${c} \\[data-mn-sugg='remove'\\]`));
  });

  it('repaints on a document update when only the Y block changed (no propsUpdated)', () => {
    const collection = new TestWorkspace({ id: 'rp' });
    collection.storeExtensions = getTestStoreManager().get('store');
    collection.start();
    collection.meta.initialize();
    const store = collection.createDoc('rp').getStore({ id: 'rp' });
    store.load();
    const noteId = store.addBlock('affine:note', {}, store.addBlock('affine:page', {}));
    const id = store.addBlock('affine:paragraph', { text: new Text('x') }, noteId);
    const el = block(id);
    el.model = store.getBlock(id)!.model as never;
    const spaceDoc = store.doc.spaceDoc;
    vi.stubGlobal('requestAnimationFrame', (f: () => void) => f());
    vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
    const stop = paintSuggestionBlocks({ querySelectorAll: () => [el] } as never, (cb) => {
      spaceDoc.on('update', cb);
      return () => spaceDoc.off('update', cb);
    });
    expect(el.attrs.has('data-mn-sugg')).toBe(false);
    (spaceDoc.getMap('blocks').get(id) as any).set('prop:mnSugg', { id: 's', kind: 'add', by: 'u', at: 1 });
    expect(el.attrs.get('data-mn-sugg')).toBe('add');
    (spaceDoc.getMap('blocks').get(id) as any).delete('prop:mnSugg');
    expect(el.attrs.has('data-mn-sugg')).toBe(false);
    stop();
  });
});
