import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLEAN_VIEW_CLASS, paintSuggestionBlocks } from './blockMarks';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

/** A block element as the painter sees it: attributes, and a model with props. */
const block = (id: string, mnSugg?: unknown) => {
  const attrs = new Map<string, string>();
  return {
    id, attrs, model: { props: { mnSugg }, propsUpdated: { subscribe: () => ({ unsubscribe() {} }) } },
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

  it('share/snapshot view: ins hidden, del plain, add blocks hidden, remove blocks normal', () => {
    const c = CLEAN_VIEW_CLASS;
    expect(css).toMatch(new RegExp(`\\.${c} \\.mn-sugg-ins\\s*{[^}]*display:\\s*none`));
    expect(css).toMatch(new RegExp(`\\.${c} \\.mn-sugg-del\\s*{[^}]*text-decoration:\\s*none`));
    expect(css).toMatch(new RegExp(`\\.${c} \\[data-mn-sugg='add'\\]\\s*{[^}]*display:\\s*none`));
    expect(css).not.toMatch(new RegExp(`\\.${c} \\[data-mn-sugg='remove'\\]`));
  });
});
