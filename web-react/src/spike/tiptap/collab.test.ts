import { getSchema } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { spikeExtensions } from './extensions';
import { convertDoc } from './fromBlocksuite.js';

const FIXTURE = process.env.SPIKE_DOCS;

describe.skipIf(!FIXTURE)('converted docs in Yjs (what collaboration syncs)', () => {
  it('round-trips every doc through a Yjs fragment, and two editors merge', () => {
    const schema = getSchema(spikeExtensions({ collab: true }));
    const docs = JSON.parse(fs.readFileSync(FIXTURE!, 'utf8')) as { title: string; state: string }[];
    let bytesBs = 0, bytesTt = 0;
    for (const d of docs) {
      const bs = new Y.Doc();
      Y.applyUpdate(bs, Buffer.from(d.state, 'base64'));
      const { doc } = convertDoc(bs);
      const tt = prosemirrorJSONToYDoc(schema, doc, 'default');
      // Same document by ProseMirror's own equality (attribute defaults and
      // key order aside).
      expect(Node.fromJSON(schema, yDocToProsemirrorJSON(tt, 'default')).eq(Node.fromJSON(schema, doc))).toBe(true);
      bytesBs += Y.encodeStateAsUpdate(bs).length;
      bytesTt += Y.encodeStateAsUpdate(tt).length;
    }
    process.stdout.write(`stored size: BlockSuite ${(bytesBs / 1e6).toFixed(1)} MB, Tiptap ${(bytesTt / 1e6).toFixed(1)} MB\n`);

    // Two people edit the same page offline, then sync.
    const a = prosemirrorJSONToYDoc(schema, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] }, 'default');
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const para = (y: Y.Doc) => (y.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText;
    para(a).insert(5, ' world');
    para(b).insert(0, '>> ');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(para(a).toString()).toBe('>> hello world');
    expect(para(b).toString()).toBe(para(a).toString());
  });
});
