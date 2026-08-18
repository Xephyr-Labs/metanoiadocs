import type { LinkTarget } from './pageLinks';

/** The shape BlockSuite's `WorkspaceMeta.addDocMeta` expects. */
export interface DocMetaLike {
  id: string;
  title: string;
  tags: string[];
  createDate: number;
}

/**
 * Which pages the editor's collection still has to be told about.
 *
 * A reference chip renders struck-through whenever `workspace.meta.docMetas`
 * has no entry for its target — BlockSuite reads existence from there, not from
 * DocDisplayMetaProvider, which only supplies the title and icon. Our collection
 * holds a single doc, so without this every @-reference reads as deleted.
 *
 * Only the id has to be right; the title shown on the chip still comes from the
 * live provider, so a stale one here is harmless.
 */
export function missingDocMetas(
  existing: readonly { id: string }[],
  targets: readonly LinkTarget[],
  now: number,
): DocMetaLike[] {
  const known = new Set(existing.map((m) => m.id));
  const out: DocMetaLike[] = [];
  for (const t of targets) {
    if (!t.id || known.has(t.id)) continue;
    known.add(t.id);
    out.push({ id: t.id, title: t.title || 'Untitled', tags: [], createDate: now });
  }
  return out;
}
