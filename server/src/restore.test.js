import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDocState } from './blocks.js';
import { rewriteDoc, cloneValue, RESTORE_ORIGIN } from './restore.js';
import { extractText } from './blocks.js';

const load = (state) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  return doc;
};

test('restores the snapshot content over later edits', () => {
  const snapshot = buildDocState('Plan', '# Plan\n\nFirst draft.\n');
  const live = load(snapshot);

  // Later editing: a new paragraph, and the original text rewritten.
  const blocks = live.getMap('blocks');
  for (const [, b] of blocks) {
    const t = b.get('prop:text');
    if (t instanceof Y.Text && t.toString() === 'First draft.') {
      live.transact(() => { t.delete(0, t.length); t.insert(0, 'Second draft, all changed.'); });
    }
  }
  assert.match(extractText(Y.encodeStateAsUpdate(live)).text, /Second draft/);

  rewriteDoc(live, snapshot);

  const after = extractText(Y.encodeStateAsUpdate(live)).text;
  assert.match(after, /First draft\./);
  assert.doesNotMatch(after, /Second draft/);
});

test('a connected client converges on the restored content', () => {
  const snapshot = buildDocState('Notes', '- one\n- two\n');
  const live = load(snapshot);

  // The client is a peer that already holds the *edited* document.
  live.transact(() => {
    for (const [, b] of live.getMap('blocks')) {
      const t = b.get('prop:text');
      if (t instanceof Y.Text && t.toString() === 'one') { t.insert(t.length, ' (edited)'); break; }
    }
  });
  const client = load(Y.encodeStateAsUpdate(live));

  // Hocuspocus forwards the restore transaction's update to every connection.
  const forwarded = [];
  live.on('update', (update, origin) => { if (origin === RESTORE_ORIGIN) forwarded.push(update); });
  rewriteDoc(live, snapshot);
  assert.equal(forwarded.length, 1, 'restore emits exactly one update');
  Y.applyUpdate(client, forwarded[0]);

  // Both sides end up on the snapshot — no resurrected "(edited)" text, and no
  // divergence between the server's document and the editor still open on it.
  assert.deepEqual(client.getMap('blocks').toJSON(), live.getMap('blocks').toJSON());
  assert.doesNotMatch(extractText(Y.encodeStateAsUpdate(client)).text, /edited/);
});

test('cloneValue keeps marks, nesting and rejects what it cannot copy', () => {
  const src = new Y.Doc();
  const text = src.getText('t');
  text.insert(0, 'bold plain');
  text.format(0, 4, { bold: true });
  const map = src.getMap('m');
  map.set('list', new Y.Array());
  map.get('list').push([1, 'two', true]);

  // A detached Y type queues its content and only materialises once it joins a
  // document — which is what the rewrite does with it — so read the copies there.
  const dest = new Y.Doc();
  const holder = dest.getMap('blocks');
  holder.set('text', cloneValue(text));
  holder.set('map', cloneValue(map));

  assert.deepEqual(holder.get('text').toDelta(), text.toDelta(), 'marks survive');
  assert.deepEqual(holder.get('map').toJSON(), map.toJSON());
  assert.notEqual(holder.get('map').get('list'), map.get('list'), 'nested types are rebuilt, not re-parented');

  assert.throws(() => cloneValue(new Y.XmlFragment()), /cannot clone/);
});

test('refuses an empty snapshot rather than wiping the document', () => {
  const live = load(buildDocState('Keep', 'still here\n'));
  assert.throws(() => rewriteDoc(live, Y.encodeStateAsUpdate(new Y.Doc())), /no blocks/);
  assert.match(extractText(Y.encodeStateAsUpdate(live)).text, /still here/);
});
