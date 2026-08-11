import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDocState, appendPageReference, extractText, docToMarkdown } from './blocks.js';

/** A doc the way the rest of the system stores one. */
function liveDoc(markdown = 'First paragraph.') {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(buildDocState('Parent', markdown)));
  return doc;
}

const refs = (doc) => {
  const out = [];
  for (const [, b] of doc.getMap('blocks')) {
    const t = b.get('prop:text');
    if (!(t instanceof Y.Text)) continue;
    for (const op of t.toDelta()) {
      if (op.attributes?.reference) out.push(op.attributes.reference);
    }
  }
  return out;
};

test('a reference paragraph is appended as a real block, last in the note', () => {
  const doc = liveDoc();
  assert.equal(appendPageReference(doc, 'child-123'), true);

  assert.deepEqual(refs(doc), [{ type: 'LinkedPage', pageId: 'child-123' }]);

  // It must be a child of the note, or the editor renders nothing.
  let note = null;
  for (const [, b] of doc.getMap('blocks')) {
    if (b.get('sys:flavour') === 'affine:note') { note = b; break; }
  }
  const kids = note.get('sys:children').toArray();
  const last = doc.getMap('blocks').get(kids[kids.length - 1]);
  assert.equal(last.get('sys:flavour'), 'affine:paragraph');
  assert.ok(last.get('prop:text').toDelta()[0].attributes.reference, 'the last block is the reference');
});

test('the existing content is left alone', () => {
  const doc = liveDoc('Keep me.');
  appendPageReference(doc, 'child-123');
  const { text } = extractText(Y.encodeStateAsUpdate(doc));
  assert.match(text, /Keep me\./);
});

test('several children stack up rather than replacing each other', () => {
  const doc = liveDoc();
  appendPageReference(doc, 'a');
  appendPageReference(doc, 'b');
  assert.deepEqual(refs(doc).map((r) => r.pageId), ['a', 'b']);
});

test('the reference survives a round trip through the wire format', () => {
  const doc = liveDoc();
  appendPageReference(doc, 'child-123');
  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
  assert.deepEqual(refs(reopened), [{ type: 'LinkedPage', pageId: 'child-123' }]);
  // And the exporter resolves it, which is the same path the sidebar's link
  // collection walks.
  const { markdown } = docToMarkdown(Y.encodeStateAsUpdate(reopened), {
    resolveTitle: (id) => (id === 'child-123' ? 'The Child' : null),
  });
  assert.match(markdown, /\[\[The Child\]\]/);
});

test('a document with no note is refused rather than corrupted', () => {
  const doc = new Y.Doc();
  doc.getMap('blocks'); // empty
  assert.equal(appendPageReference(doc, 'child-123'), false);
});
