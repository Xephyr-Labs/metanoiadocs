import { afterEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Text } from '@blocksuite/affine/store';
import { TestWorkspace } from '@blocksuite/affine/store/test';
import { getTestStoreManager } from '@blocksuite/integration-test/store';
import { decide, listSuggestions } from '../../editor/suggest/model';
import { cardsInline, focusSuggestion, highlightSuggestion, stackCards, stepActive, takeWanted, toCards } from '../../editor/suggest/rail';
import { SuggestionRail } from './SuggestionRail';

const S = (id: string, kind: string, by = 'u1') => ({ id, kind, by, at: 1 });

function page() {
  const ws = new TestWorkspace({ id: 'r' });
  ws.storeExtensions = getTestStoreManager().get('store');
  ws.start();
  ws.meta.initialize();
  const store = ws.createDoc('d').getStore({ id: 'd' });
  store.load();
  const pageId = store.addBlock('affine:page', {});
  const noteId = store.addBlock('affine:note', {}, pageId);
  const p1 = store.addBlock('affine:paragraph', { text: new Text('x') }, noteId);
  const p2 = store.addBlock('affine:paragraph', { text: new Text('New one') }, noteId);
  const p3 = store.addBlock('affine:paragraph', { text: new Text('Title') }, noteId);
  const t = (store.getBlock(p1)!.model as any).text.yText;
  t.delete(0, t.length);
  t.insert(0, 'Due ', { mnSugg: null });
  t.insert(4, '20 October', { mnSugg: { ...S('r', 'del', 'u9'), via: 'ai' } });
  t.insert(14, '27 October', { mnSugg: { ...S('r', 'ins', 'u9'), via: 'ai' } });
  (store.getBlock(p2)!.model as any).yBlock.set('prop:mnSugg', S('add', 'add', 'andy'));
  store.updateBlock(store.getBlock(p3)!.model, { type: 'h2' } as never);
  (store.getBlock(p3)!.model as any).yBlock.set('prop:mnSugg', { ...S('typ', 'type', 'andy'), from: { flavour: 'affine:paragraph', type: 'text' } });
  return store;
}

const names = new Map([['u9', 'Sara'], ['andy', 'Andy']]);
const cardsOf = (store: ReturnType<typeof page>) => toCards(listSuggestions(store), (id) => names.get(id));

/** The element tree with every function component called through. The rail's
 *  components are hook-free on purpose, so this stands in for a DOM. */
function expand(node: ReactNode): any {
  if (Array.isArray(node)) return node.map(expand);
  if (!isValidElement(node)) return node;
  const el = node as any;
  if (typeof el.type === 'function') return expand(el.type(el.props));
  return { type: el.type, props: { ...el.props, children: expand(el.props.children) } };
}
function findAll(tree: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (Array.isArray(tree)) tree.forEach((t) => findAll(t, pred, out));
  else if (tree && typeof tree === 'object' && tree.props) {
    if (pred(tree)) out.push(tree);
    findAll(tree.props.children, pred, out);
  }
  return out;
}

const rail = (cards: ReturnType<typeof cardsOf>, extra: Partial<Parameters<typeof SuggestionRail>[0]> = {}) => (
  <SuggestionRail cards={cards} active={null} canDecide onDecide={() => {}} onHover={() => {}} onActivate={() => {}} {...extra} />
);

afterEach(() => { vi.unstubAllGlobals(); });

describe('SuggestionRail', () => {
  it('one card per suggestion id, in page order, with its words', () => {
    const cards = cardsOf(page());
    expect(cards.map((c) => c.id)).toEqual(['r', 'add', 'typ']);
    const html = renderToStaticMarkup(rail(cards));
    expect(html.match(/data-sugg-card=/g)).toHaveLength(3);
    expect(html).toContain('Replace &quot;20 October&quot; with &quot;27 October&quot;');
    expect(html).toContain('Add paragraph');
    expect(html).toContain('Changed to Heading 2');
    expect(html.indexOf('Replace')).toBeLessThan(html.indexOf('Add paragraph'));
    expect(html.indexOf('Add paragraph')).toBeLessThan(html.indexOf('Changed to'));
  });

  it('labels an Ask AI change with the asker, and anyone else by name', () => {
    const cards = cardsOf(page());
    expect(cards.map((c) => c.author)).toEqual(['Ask AI · Sara', 'Andy', 'Andy']);
    expect(toCards([{ id: 'x', by: 'ghost', at: 1, blockId: 'b', blockIds: ['b'], kind: 'insert', before: '', after: 'y' }], () => undefined)[0].author).toBe('Someone');
  });

  it('a viewer sees the cards without accept or reject', () => {
    const cards = cardsOf(page());
    const html = renderToStaticMarkup(rail(cards, { canDecide: false }));
    expect(html.match(/data-sugg-card=/g)).toHaveLength(3);
    expect(html).not.toContain('aria-label="Accept');
    expect(html).not.toContain('aria-label="Reject');
    expect(renderToStaticMarkup(rail(cards))).toContain('aria-label="Accept');
  });

  it('clicking ✓ accepts that suggestion and its card goes', () => {
    const store = page();
    const onDecide = vi.fn((id: string, v: 'accept' | 'reject') => decide(store, id, v));
    const tree = expand(rail(cardsOf(store), { onDecide }));
    const accept = findAll(tree, (n) => n.type === 'button' && n.props['aria-label']?.startsWith('Accept'))[0];
    accept.props.onClick({ stopPropagation() {} });
    expect(onDecide).toHaveBeenCalledWith('r', 'accept');
    const after = renderToStaticMarkup(rail(cardsOf(store)));
    expect(after.match(/data-sugg-card=/g)).toHaveLength(2);
    expect(after).not.toContain('Replace');
  });

  it('hovering a card highlights its text as mn-sugg-active', () => {
    const highlights = new Map<string, unknown>();
    class Highlight { ranges: unknown[]; constructor(...r: unknown[]) { this.ranges = r; } }
    vi.stubGlobal('CSS', { highlights, escape: (s: string) => s });
    vi.stubGlobal('Highlight', Highlight);
    vi.stubGlobal('document', { createRange: () => ({ selectNodeContents(n: unknown) { (this as any).node = n; } }) });
    const spans = [{ tag: 'del' }, { tag: 'ins' }];
    const root = { querySelectorAll: (sel: string) => (sel === '[data-sugg-id="r"]' ? spans : []) } as unknown as Element;

    const tree = expand(rail(cardsOf(page()), { onHover: (id: string | null) => highlightSuggestion(root, id) }));
    const card = findAll(tree, (n) => n.props['data-sugg-card'] === 'r')[0];
    card.props.onMouseEnter();
    const hl = highlights.get('mn-sugg-active') as Highlight;
    expect(hl.ranges.map((r: any) => r.node)).toEqual(spans);
    card.props.onMouseLeave();
    expect(highlights.has('mn-sugg-active')).toBe(false);
  });
});

describe('navigation and layout', () => {
  it('next and previous wrap around', () => {
    const ids = ['a', 'b', 'c'];
    expect(stepActive(ids, null, 1)).toBe('a');
    expect(stepActive(ids, null, -1)).toBe('c');
    expect(stepActive(ids, 'b', 1)).toBe('c');
    expect(stepActive(ids, 'c', 1)).toBe('a');
    expect(stepActive(ids, 'a', -1)).toBe('c');
    expect(stepActive([], null, 1)).toBeNull();
  });

  it('stacks cards in page order without overlapping', () => {
    expect(stackCards([{ top: 10, height: 50 }, { top: 20, height: 40 }, { top: 200, height: 30 }], 8))
      .toEqual([10, 68, 200]);
  });
});

describe('margin or inline', () => {
  it('margin cards whenever a card fits right of the text; inline on phones and narrow panes', () => {
    // 1600px window (controller's measure): text ends at 1309, editor at 1590.
    expect(cardsInline({ phone: false, textRight: 1309, areaRight: 1590 })).toBe(false);
    // 1280px window with the sidebar open: about 120px to spare.
    expect(cardsInline({ phone: false, textRight: 1149, areaRight: 1270 })).toBe(true);
    // A phone is inline whatever the numbers say.
    expect(cardsInline({ phone: true, textRight: 100, areaRight: 1000 })).toBe(true);
  });
});

describe('opening a suggestion from a link or the inbox (focusSuggestion)', () => {
  it('waits for the page that has it, which takes it once', () => {
    focusSuggestion('s1');
    expect(takeWanted((id) => id === 'other')).toBeNull();
    expect(takeWanted((id) => id === 's1')).toBe('s1');
    expect(takeWanted(() => true)).toBeNull();
  });
});
