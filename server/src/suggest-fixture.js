// Test fixture: a page holding one of each pending suggestion, as a doc state.
import * as Y from 'yjs';
import { buildDocState } from './blocks.js';

const S = (id, kind, by = 'u1') => ({ id, kind, by, at: 1 });

/** Paragraphs: "keep NEW OLD" (ins/del runs), "ADDED" (add), "REMOVED" (remove), "Retyped" (type h1, was text). */
export function suggestedState() {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(buildDocState('T', 'keep\n\nADDED\n\nREMOVED\n\nRetyped')));
  const blocks = doc.getMap('blocks');
  const by = (s) => [...blocks.values()].find((b) => b.get('prop:text')?.toString() === s);
  const t = by('keep').get('prop:text');
  t.insert(4, ' NEW', { mnSugg: S('s1', 'ins') });
  t.insert(8, ' OLD', { mnSugg: S('s2', 'del') });
  by('ADDED').set('prop:mnSugg', S('s3', 'add'));
  by('REMOVED').set('prop:mnSugg', S('s4', 'remove'));
  const r = by('Retyped');
  r.set('prop:type', 'h1');
  r.set('prop:mnSugg', { ...S('s5', 'type'), from: { flavour: 'affine:paragraph', type: 'text' } });
  return Y.encodeStateAsUpdate(doc);
}
