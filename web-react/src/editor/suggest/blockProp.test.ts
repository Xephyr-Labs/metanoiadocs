// Does a `prop:mnSugg` key on a block's Yjs map reach the model in the browser?
import { describe, expect, it } from 'vitest';
import { Text } from '@blocksuite/affine/store';
import { TestWorkspace } from '@blocksuite/affine/store/test';
import { getTestStoreManager } from '@blocksuite/integration-test/store';

function page() {
  const collection = new TestWorkspace({ id: 'bp' });
  collection.storeExtensions = getTestStoreManager().get('store');
  collection.start();
  collection.meta.initialize();
  const store = collection.createDoc('bp').getStore({ id: 'bp' });
  store.load();
  const pageId = store.addBlock('affine:page', {});
  const noteId = store.addBlock('affine:note', {}, pageId);
  const id = store.addBlock('affine:paragraph', { text: new Text('x') }, noteId);
  return { store, id };
}

describe('block-level mnSugg on a real store', () => {
  it('is readable from the Yjs block map', () => {
    const { store, id } = page();
    const sg = { id: 's', kind: 'add', by: 'u', at: 1 };
    (store.doc.spaceDoc.getMap('blocks').get(id) as any).set('prop:mnSugg', sg);
    const model = store.getBlock(id)!.model as any;
    expect(model.props.mnSugg).toEqual(sg);
  });

  it('also on a list block', () => {
    const { store, id } = page();
    const note = store.getBlock(id)!.model.parent!.id;
    const lid = store.addBlock('affine:list', { type: 'todo', text: new Text('t') }, note);
    (store.doc.spaceDoc.getMap('blocks').get(lid) as any).set('prop:mnSugg', { id: 's', kind: 'add', by: 'u', at: 1 });
    expect((store.getBlock(lid)!.model as any).props.mnSugg.kind).toBe('add');
  });
});
