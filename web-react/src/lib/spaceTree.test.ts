import { describe, expect, it } from 'vitest';
import { groupBySpace } from './spaceTree';
import type { SpaceRow } from './spacesApi';

describe('groupBySpace', () => {
  it('groups items under joined spaces, unknown under the default', () => {
    const spaces = [
      { id: 'g', is_default: true, joined: true }, { id: 'm', is_default: false, joined: true }, { id: 'o', is_default: false, joined: false },
    ] as SpaceRow[];
    const out = groupBySpace([{ id: 1, spaceId: 'm' }, { id: 2, spaceId: null }, { id: 3, spaceId: 'o' }, { id: 4, spaceId: 'x' }], spaces);
    expect([...out.keys()]).toEqual(['g', 'm']);
    expect(out.get('g')!.map((i) => i.id)).toEqual([2, 4]);
    expect(out.get('m')!.map((i) => i.id)).toEqual([1]);
  });
});
