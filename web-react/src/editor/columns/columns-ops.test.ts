import { describe, expect, it } from 'vitest';
import {
  addColumn, columnOf, deleteColumn, ensureTrailingParagraph, evenWidths,
  crossColumnRow, exitColumn, MAX_COLUMNS, rowOf, setColumnCount, type OpsStore, type TextModelLike,
} from './columns-ops';
import { COLUMN_FLAVOUR, COLUMNS_FLAVOUR } from './columns-model';

/** A store that also carries props and text, which the ops read. */
function fakeStore() {
  let seq = 0;
  const parents = new Map<string, TextModelLike>();
  const byId = new Map<string, TextModelLike>();

  const add = (flavour: string, props: Record<string, unknown>, parent?: TextModelLike | string, index?: number) => {
    const node: TextModelLike = { id: `b${++seq}`, flavour, children: [], props: { ...props } };
    byId.set(node.id, node);
    const target = typeof parent === 'string' ? byId.get(parent) : parent;
    if (target) {
      const kids = target.children!;
      kids.splice(index ?? kids.length, 0, node);
      parents.set(node.id, target);
    }
    return node;
  };
  const detach = (node: TextModelLike) => {
    const parent = parents.get(node.id);
    if (!parent) return;
    parent.children = parent.children!.filter((c) => c.id !== node.id);
    parents.delete(node.id);
  };

  const store: OpsStore & { add: typeof add; byId: typeof byId } = {
    add,
    byId,
    getParent: (model) => parents.get(model.id) ?? null,
    getModelById: (id) => byId.get(id) ?? null,
    addBlock: (flavour, props, parent, index) =>
      add(flavour, (props ?? {}) as Record<string, unknown>, parent as TextModelLike, index).id,
    moveBlocks: (models, newParent, sibling, before) => {
      for (const model of models) {
        detach(model as TextModelLike);
        const kids = (newParent as TextModelLike).children!;
        const at = sibling ? kids.indexOf(sibling as TextModelLike) + (before ? 0 : 1) : kids.length;
        kids.splice(at < 0 ? kids.length : at, 0, model as TextModelLike);
        parents.set(model.id, newParent as TextModelLike);
      }
    },
    deleteBlock: (model) => { detach(model as TextModelLike); byId.delete(model.id); },
    updateBlock: (model, props) => { Object.assign((model as TextModelLike).props!, props); },
    captureSync: () => {},
  };
  return store;
}

/** note > row > [column(p), column(p)] — what the slash menu leaves behind. */
function twoColumnRow(count = 2) {
  const store = fakeStore();
  const note = store.add('affine:note', {});
  const row = store.add(COLUMNS_FLAVOUR, {}, note);
  const columns = Array.from({ length: count }, () => {
    const column = store.add(COLUMN_FLAVOUR, { width: 1 }, row);
    store.add('affine:paragraph', {}, column);
    return column;
  });
  return { store, note, row, columns };
}

const flavours = (m: TextModelLike) => (m.children ?? []).map((c) => c.flavour);

describe('addColumn', () => {
  it('inserts on the side asked for, with a paragraph to type in', () => {
    const { store, row, columns } = twoColumnRow();
    const id = addColumn(store, columns[0], 'left');
    expect(row.children).toHaveLength(3);
    expect(row.children![0].id).toBe(id);
    expect(flavours(row.children![0] as TextModelLike)).toEqual(['affine:paragraph']);
  });

  it('sizes the new column like the ones already in the row', () => {
    const { store, row, columns } = twoColumnRow();
    store.updateBlock(columns[0], { width: 3 });
    store.updateBlock(columns[1], { width: 1 });
    const id = addColumn(store, columns[1], 'right');
    expect((store.getModelById(id!) as TextModelLike).props!.width).toBe(2);
    expect(row.children).toHaveLength(3);
  });

  it('refuses past the readable maximum', () => {
    const { store, columns } = twoColumnRow(MAX_COLUMNS);
    expect(addColumn(store, columns[0], 'right')).toBeNull();
  });
});

describe('deleteColumn', () => {
  it('takes the column and its content away', () => {
    const { store, row, columns } = twoColumnRow(3);
    deleteColumn(store, columns[1]);
    expect(row.children).toHaveLength(2);
    expect(store.getModelById(columns[1].id)).toBeNull();
  });

  it('unwraps the row when one column is left, keeping it where the row was', () => {
    const { store, note, row, columns } = twoColumnRow();
    const kept = columns[0].children![0];
    const tail = store.add('affine:paragraph', {}, note);
    deleteColumn(store, columns[1]);
    expect(store.getModelById(row.id)).toBeNull();
    expect(note.children!.map((c) => c.id)).toEqual([kept.id, tail.id]);
  });
});

describe('setColumnCount', () => {
  it('grows with empty columns', () => {
    const { store, row } = twoColumnRow();
    expect(setColumnCount(store, row, 3)).toBe(true);
    expect(row.children).toHaveLength(3);
    expect(flavours(row.children![2] as TextModelLike)).toEqual(['affine:paragraph']);
  });

  it('shrinking moves the dropped columns content into the last one kept', () => {
    const { store, row, columns } = twoColumnRow(3);
    const orphan = columns[2].children![0];
    setColumnCount(store, row, 2);
    expect(row.children).toHaveLength(2);
    expect(row.children![1].children!.map((c) => c.id)).toContain(orphan.id);
  });

  it('evens the widths it leaves behind', () => {
    const { store, row, columns } = twoColumnRow();
    store.updateBlock(columns[0], { width: 3 });
    setColumnCount(store, row, 3);
    expect((row.children as TextModelLike[]).map((c) => c.props!.width)).toEqual([1, 1, 1]);
  });

  it('one column is no row at all — it unwraps', () => {
    const { store, note, row, columns } = twoColumnRow();
    const first = columns[0].children![0];
    setColumnCount(store, row, 1);
    expect(store.getModelById(row.id)).toBeNull();
    expect(note.children!.map((c) => c.id)).toContain(first.id);
  });
});

describe('evenWidths', () => {
  it('resets a dragged row to equal shares', () => {
    const { store, row, columns } = twoColumnRow();
    store.updateBlock(columns[0], { width: 2.4 });
    store.updateBlock(columns[1], { width: 0.6 });
    evenWidths(store, row);
    expect((row.children as TextModelLike[]).map((c) => c.props!.width)).toEqual([1, 1]);
  });
});

describe('exitColumn', () => {
  it('moves an empty last line out to just below the row', () => {
    const { store, note, row, columns } = twoColumnRow();
    // Something else in the column, so the column survives the move.
    store.add('affine:paragraph', {}, columns[0]);
    const last = columns[0].children![1] as TextModelLike;
    expect(exitColumn(store, last)).toBe(last.id);
    expect(note.children!.map((c) => c.id)).toEqual([row.id, last.id]);
  });

  it('leaves a line with text where it is', () => {
    const { store, columns } = twoColumnRow();
    const line = columns[0].children![0] as TextModelLike;
    line.text = { length: 4 };
    expect(exitColumn(store, line)).toBeNull();
  });

  it('leaves a column with only one line alone — it would take the row with it', () => {
    const { store, columns } = twoColumnRow();
    expect(exitColumn(store, columns[0].children![0] as TextModelLike)).toBeNull();
  });

  it('leaves a line that is not the last one in its column', () => {
    const { store, columns } = twoColumnRow();
    store.add('affine:paragraph', {}, columns[0]);
    const first = columns[0].children![0] as TextModelLike;
    expect(exitColumn(store, first)).toBeNull();
  });

  it('ignores a paragraph that is not in a column', () => {
    const { store, note } = twoColumnRow();
    expect(exitColumn(store, store.add('affine:paragraph', {}, note))).toBeNull();
  });
});

describe('ensureTrailingParagraph', () => {
  it('adds a line under a row that ends the page', () => {
    const { store, note, row } = twoColumnRow();
    ensureTrailingParagraph(store, row);
    expect(note.children!.map((c) => c.flavour)).toEqual([COLUMNS_FLAVOUR, 'affine:paragraph']);
  });

  it('adds nothing when the page already continues', () => {
    const { store, note, row } = twoColumnRow();
    store.add('affine:paragraph', {}, note);
    ensureTrailingParagraph(store, row);
    expect(note.children).toHaveLength(2);
  });
});

describe('crossColumnRow', () => {
  it('answers the row when the ends are in different columns of it', () => {
    const { store, row, columns } = twoColumnRow();
    const left = columns[0].children![0];
    const right = columns[1].children![0];
    expect(crossColumnRow(store, left, right)?.id).toBe(row.id);
  });

  it('stays out of a selection inside one column', () => {
    const { store, columns } = twoColumnRow();
    store.add('affine:paragraph', {}, columns[0]);
    const [a, b] = columns[0].children!;
    expect(crossColumnRow(store, a, b)).toBeNull();
  });

  it('stays out of a selection that never enters a row', () => {
    const { store, note, columns } = twoColumnRow();
    const loose = store.add('affine:paragraph', {}, note);
    expect(crossColumnRow(store, loose, store.add('affine:paragraph', {}, note))).toBeNull();
    // One end inside, one end outside: not a row-wide selection either.
    expect(crossColumnRow(store, loose, columns[0].children![0])).toBeNull();
  });

  it('picks the inner row when rows are nested', () => {
    const { store, columns } = twoColumnRow();
    // A row inside the left column, with two columns of its own.
    const inner = store.add(COLUMNS_FLAVOUR, {}, columns[0]);
    const innerColumns = [0, 1].map(() => {
      const c = store.add(COLUMN_FLAVOUR, { width: 1 }, inner);
      store.add('affine:paragraph', {}, c);
      return c;
    });
    const a = innerColumns[0].children![0];
    const b = innerColumns[1].children![0];
    expect(crossColumnRow(store, a, b)?.id).toBe(inner.id);
  });
});

describe('rowOf / columnOf', () => {
  it('find the row and column a nested block belongs to', () => {
    const { store, row, columns } = twoColumnRow();
    const line = columns[1].children![0];
    expect(rowOf(store, line)?.id).toBe(row.id);
    expect(columnOf(store, line)?.id).toBe(columns[1].id);
  });

  it('answer null outside a row', () => {
    const { store, note } = twoColumnRow();
    const loose = store.add('affine:paragraph', {}, note);
    expect(rowOf(store, loose)).toBeNull();
    expect(columnOf(store, loose)).toBeNull();
  });
});
