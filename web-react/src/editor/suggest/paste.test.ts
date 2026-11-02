import { describe, expect, it } from 'vitest';
import { Subject } from 'rxjs';
import { stripSuggestions, stripSuggestionsMiddleware } from './inlineSpec';

const S = { id: 's1', kind: 'ins', by: 'u1', at: 1 };
const slice = () => ({
  content: [{
    flavour: 'affine:paragraph',
    props: { type: 'text', mnSugg: { ...S, kind: 'add' }, text: { delta: [{ insert: 'a', attributes: { bold: true, mnSugg: S } }, { insert: 'b' }] } },
    children: [],
  }],
});

describe('suggestions do not travel through the clipboard', () => {
  it('stripSuggestions drops the mark from deltas and block props, keeping other marks', () => {
    const s = slice();
    stripSuggestions(s);
    expect(s.content[0].props).not.toHaveProperty('mnSugg');
    expect(s.content[0].props.text.delta).toEqual([{ insert: 'a', attributes: { bold: true } }, { insert: 'b' }]);
  });

  it('the middleware strips a pasted slice and a copied one', () => {
    const slots = { beforeImport: new Subject<{ snapshot: unknown }>(), afterExport: new Subject<{ snapshot: unknown }>() };
    stripSuggestionsMiddleware({ slots });
    for (const slot of [slots.beforeImport, slots.afterExport]) {
      const snapshot = slice();
      slot.next({ snapshot });
      expect(JSON.stringify(snapshot)).not.toContain('mnSugg');
    }
  });
});
