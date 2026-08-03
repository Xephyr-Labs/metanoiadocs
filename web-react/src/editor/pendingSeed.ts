import type { SeedBlock } from '../data/templates';

// A transient hand-off: when a doc is created from a template, its blocks are
// stashed here by doc id and consumed once by mountEditor when the (empty) doc
// first mounts. Not React state — it's write-once, read-once.
const pending = new Map<string, SeedBlock[]>();

export function setPendingSeed(docId: string, blocks: SeedBlock[]) {
  pending.set(docId, blocks);
}

export function takePendingSeed(docId: string): SeedBlock[] | undefined {
  const b = pending.get(docId);
  pending.delete(docId);
  return b;
}
