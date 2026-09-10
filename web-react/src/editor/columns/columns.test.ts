import { describe, expect, it } from 'vitest';
import {
  applyColumnDrop, insertColumnRow, planColumnDrop, sideForDrop, tidyColumns,
  type ModelLike, type Side, type StoreLike,
} from './columns-dnd';
import { allowColumnChildren, COLUMN_FLAVOUR, COLUMNS_FLAVOUR } from './columns-model';

/** Just enough of a Store to move blocks around a tree. */
function fakeStore() {
  let seq = 0;
  const parents = new Map<string, ModelLike>();
  const byId = new Map<string, ModelLike>();

  const add = (flavour: string, parent?: ModelLike | string, index?: number): ModelLike => {
    const node: ModelLike = { id: `b${++seq}`, flavour, children: [] };
    byId.set(node.id, node);
    const target = typeof parent === 'string' ? byId.get(parent) : parent;
    if (target) {
      const kids = target.children!;
      kids.splice(index ?? kids.length, 0, node);
      parents.set(node.id, target);
    }
    return node;
  };
  const detach = (node: ModelLike) => {
    const parent = parents.get(node.id);
    if (!parent) return;
    parent.children = parent.children!.filter(c => c.id !== node.id);
    parents.delete(node.id);
  };

  const store: StoreLike & { add: typeof add; byId: typeof byId } = {
    add,
    byId,
    getParent: (model) => parents.get(model.id) ?? null,
    getModelById: (id) => byId.get(id) ?? null,
    addBlock: (flavour, _props, parent, index) => add(flavour, parent, index).id,
    moveBlocks: (models, newParent, sibling, before) => {
      for (const model of models) {
        detach(model);
        const kids = newParent.children!;
        const at = sibling ? kids.indexOf(sibling) + (before ? 0 : 1) : kids.length;
        kids.splice(at < 0 ? kids.length : at, 0, model);
        parents.set(model.id, newParent);
      }
    },
    deleteBlock: (model) => { detach(model); byId.delete(model.id); },
    captureSync: () => {},
  };
  return store;
}

/** note > [p1, p2] — the shape every drop starts from. */
function noteWithTwo() {
  const store = fakeStore();
  const note = store.add('affine:note');
  const p1 = store.add('affine:paragraph', note);
  const p2 = store.add('affine:paragraph', note);
  return { store, note, p1, p2 };
}

const plan = (
  store: ReturnType<typeof fakeStore>,
  side: Side | null,
  target: ModelLike | null,
  dragged: ModelLike[],
  sameDoc = true,
) => planColumnDrop({
  store,
  side,
  target,
  draggedIds: dragged.map(d => d.id),
  draggedFlavours: dragged.map(d => d.flavour),
  sameDoc,
});

describe('sideForDrop', () => {
  // A paragraph: wide and short, the case BlockSuite's own nearest-edge answer
  // gets wrong (it would say top/bottom nearly everywhere).
  const paragraph = { left: 400, width: 700 };

  it('claims a band at each end and nothing in between', () => {
    expect(sideForDrop(paragraph, 410)).toBe('left');
    expect(sideForDrop(paragraph, 1090)).toBe('right');
    expect(sideForDrop(paragraph, 750)).toBeNull();
  });

  it('caps the band so a wide block keeps most of its middle', () => {
    // 20% of 700 is 140, capped to 96.
    expect(sideForDrop(paragraph, 400 + 95)).toBe('left');
    expect(sideForDrop(paragraph, 400 + 97)).toBeNull();
  });

  it('keeps a usable band on a narrow block', () => {
    const narrow = { left: 0, width: 120 };
    expect(sideForDrop(narrow, 20)).toBe('left');
    expect(sideForDrop(narrow, 100)).toBe('right');
    expect(sideForDrop(narrow, 60)).toBeNull();
  });

  it('ignores a block with no width', () => {
    expect(sideForDrop({ left: 0, width: 0 }, 0)).toBeNull();
  });
});

describe('planColumnDrop', () => {
  it('wraps a loose block dropped on its side', () => {
    const { store, p1, p2 } = noteWithTwo();
    expect(plan(store, 'right', p1, [p2])).toEqual({ kind: 'wrap', targetId: p1.id, side: 'right' });
  });

  it('leaves a drop down the middle of a block to BlockSuite', () => {
    const { store, p1, p2 } = noteWithTwo();
    expect(plan(store, null, p1, [p2])).toBeNull();
  });

  it('leaves a drag from another document alone', () => {
    const { store, p1, p2 } = noteWithTwo();
    expect(plan(store, 'left', p1, [p2], false)).toBeNull();
  });

  it('refuses to drop a block inside itself', () => {
    const { store, note } = noteWithTwo();
    const outer = store.add('affine:paragraph', note);
    const inner = store.add('affine:paragraph', outer);
    expect(plan(store, 'right', inner, [outer])).toBeNull();
  });

  it('keeps the right edge of a list meaning "nest as a sub-list"', () => {
    const { store, note } = noteWithTwo();
    const list = store.add('affine:list', note);
    const dragged = store.add('affine:list', note);
    expect(plan(store, 'right', list, [dragged])).toBeNull();
    // …but a paragraph on a list's right edge has no other meaning, so it is ours.
    const paragraph = store.add('affine:paragraph', note);
    expect(plan(store, 'right', list, [paragraph])).toEqual(
      { kind: 'wrap', targetId: list.id, side: 'right' },
    );
  });

  it('adds a column when the target is already in a row', () => {
    const { store, note, p1 } = noteWithTwo();
    const row = store.add(COLUMNS_FLAVOUR, note);
    const column = store.add(COLUMN_FLAVOUR, row);
    const inside = store.add('affine:paragraph', column);
    expect(plan(store, 'left', inside, [p1])).toEqual({ kind: 'beside', columnId: column.id, side: 'left' });
    expect(plan(store, 'right', column, [p1])).toEqual({ kind: 'beside', columnId: column.id, side: 'right' });
  });

  it('leaves containers that own their own layout alone', () => {
    const { store, note, p1 } = noteWithTwo();
    const callout = store.add('affine:callout', note);
    const inside = store.add('affine:paragraph', callout);
    expect(plan(store, 'right', inside, [p1])).toBeNull();
  });
});

describe('applyColumnDrop', () => {
  it('builds a row with the dropped block on the side it was dropped', () => {
    const { store, note, p1, p2 } = noteWithTwo();
    const row = applyColumnDrop(store, { kind: 'wrap', targetId: p1.id, side: 'left' }, [p2]);
    expect(row?.flavour).toBe(COLUMNS_FLAVOUR);
    // Plus the line the row leaves behind it, so the page can carry on under
    // the columns — see ensureTrailingParagraph.
    expect(note.children!.map(c => c.flavour)).toEqual([COLUMNS_FLAVOUR, 'affine:paragraph']);
    expect(note.children![0]).toBe(row);
    const [left, right] = row!.children!;
    expect(left.children!.map(c => c.id)).toEqual([p2.id]);
    expect(right.children!.map(c => c.id)).toEqual([p1.id]);
  });

  it('drops on the right of the target when asked', () => {
    const { store, p1, p2 } = noteWithTwo();
    const row = applyColumnDrop(store, { kind: 'wrap', targetId: p1.id, side: 'right' }, [p2]);
    expect(row!.children!.map(c => c.children!.map(b => b.id))).toEqual([[p1.id], [p2.id]]);
  });

  it('inserts one more column beside an existing one', () => {
    const { store, note, p1 } = noteWithTwo();
    const row = store.add(COLUMNS_FLAVOUR, note);
    const a = store.add(COLUMN_FLAVOUR, row);
    const b = store.add(COLUMN_FLAVOUR, row);
    applyColumnDrop(store, { kind: 'beside', columnId: b.id, side: 'left' }, [p1]);
    expect(row.children!.length).toBe(3);
    expect(row.children![1].children!.map(c => c.id)).toEqual([p1.id]);
    expect(row.children![0].id).toBe(a.id);
    expect(row.children![2].id).toBe(b.id);
  });
});

describe('tidyColumns', () => {
  it('drops a column nothing is left in', () => {
    const { store, note } = noteWithTwo();
    const row = store.add(COLUMNS_FLAVOUR, note);
    const a = store.add(COLUMN_FLAVOUR, row);
    store.add('affine:paragraph', a);
    const b = store.add(COLUMN_FLAVOUR, row);
    store.add(COLUMN_FLAVOUR, row); // empty, and so is b
    expect(tidyColumns(store, note)).toBe(true);
    // One column left, so the row unwraps back into the note.
    expect(note.children!.map(c => c.flavour)).toEqual(['affine:paragraph', 'affine:paragraph', 'affine:paragraph']);
    expect(store.byId.has(row.id)).toBe(false);
    expect(store.byId.has(b.id)).toBe(false);
  });

  it('unwraps the last column back where the row was, not at the end', () => {
    const { store, note, p1, p2 } = noteWithTwo();
    const row = store.add(COLUMNS_FLAVOUR, note, 1); // note > [p1, row, p2]
    const kept = store.add(COLUMN_FLAVOUR, row);
    const inside = store.add('affine:paragraph', kept);
    store.add(COLUMN_FLAVOUR, row); // emptied by a drag out
    expect(tidyColumns(store, note)).toBe(true);
    expect(note.children!.map(c => c.id)).toEqual([p1.id, inside.id, p2.id]);
  });

  it('leaves a healthy row alone', () => {
    const { store, note } = noteWithTwo();
    const row = store.add(COLUMNS_FLAVOUR, note);
    for (const _ of [0, 1]) store.add('affine:paragraph', store.add(COLUMN_FLAVOUR, row));
    expect(tidyColumns(store, note)).toBe(false);
    expect(row.children!.length).toBe(2);
  });

  it('never writes to a read-only document', () => {
    const { store, note } = noteWithTwo();
    const row = store.add(COLUMNS_FLAVOUR, note);
    store.add(COLUMN_FLAVOUR, row);
    store.readonly = true;
    expect(tidyColumns(store, note)).toBe(false);
    expect(row.children!.length).toBe(1);
  });
});

describe('insertColumnRow', () => {
  it('seeds every column with somewhere to type', () => {
    const { store, note, p1 } = noteWithTwo();
    const id = insertColumnRow(store, p1, 3);
    const row = store.getModelById(id!)!;
    expect(note.children![1]).toBe(row);
    expect(row.children!.length).toBe(3);
    for (const column of row.children!) {
      expect(column.children!.map(c => c.flavour)).toEqual(['affine:paragraph']);
    }
  });
});

describe('allowColumnChildren', () => {
  it('opens up exactly the flavours a note accepts', () => {
    const paragraph = { model: { parent: ['affine:note', 'affine:list'] } };
    const surfaceOnly = { model: { parent: ['affine:surface'] } };
    const unrestricted = { model: {} };
    allowColumnChildren([paragraph, surfaceOnly, unrestricted]);
    expect(paragraph.model.parent).toContain(COLUMN_FLAVOUR);
    expect(surfaceOnly.model.parent).not.toContain(COLUMN_FLAVOUR);
    expect(unrestricted.model).toEqual({});
  });

  it('is safe to run twice', () => {
    const paragraph = { model: { parent: ['affine:note'] } };
    allowColumnChildren([paragraph]);
    allowColumnChildren([paragraph]);
    expect(paragraph.model.parent.filter(p => p === COLUMN_FLAVOUR).length).toBe(1);
  });
});
