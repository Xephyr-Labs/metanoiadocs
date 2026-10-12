import { getSchema } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { spikeExtensions } from './extensions';
import { convertDoc } from './fromBlocksuite.js';

const FIXTURE = process.env.SPIKE_DOCS;

describe.skipIf(!FIXTURE)('BlockSuite → Tiptap on real docs', () => {
  it('every converted doc is valid in the Tiptap schema', () => {
    const schema = getSchema(spikeExtensions());
    const docs = JSON.parse(fs.readFileSync(FIXTURE!, 'utf8')) as { id: string; title: string; state: string }[];
    const bad: string[] = [];
    for (const d of docs) {
      const y = new Y.Doc();
      Y.applyUpdate(y, Buffer.from(d.state, 'base64'));
      const { doc } = convertDoc(y);
      try { Node.fromJSON(schema, doc).check(); } catch (e) { bad.push(`${d.title}: ${(e as Error).message}`); }
    }
    console.log(`${docs.length - bad.length}/${docs.length} valid`);
    expect(bad).toEqual([]);
  });
});
