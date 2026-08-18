/** A row that knows which page it was nested under. */
export interface NestableRow {
  id: string;
  parentId: string | null;
}

/**
 * Where each page sits in the sidebar.
 *
 * A page nested under another one belongs to that page and nowhere else — which
 * is the whole point: it must leave the top level, or the same title shows twice.
 * Two rows never make that true on their own, so this is also where the sidebar
 * defends itself: a parent that is not in the list (trashed, or private to
 * someone else) hands its children back to the top rather than swallowing them,
 * and a parent chain that loops is broken at the row that closes it — the tree
 * renders by recursing through `childrenOf`, so a cycle here would hang it.
 *
 * `rows` are consumed in order, so siblings keep the caller's sort.
 */
export function nestByParent<T extends NestableRow>(rows: readonly T[]): {
  roots: string[];
  childrenOf: Map<string, string[]>;
} {
  const parentOf = new Map<string, string | null>(rows.map((r) => [r.id, r.parentId]));
  const roots: string[] = [];
  const childrenOf = new Map<string, string[]>();

  const homeOf = (row: T): string | null => {
    const seen = new Set<string>([row.id]);
    let parent = row.parentId;
    while (parent) {
      if (seen.has(parent)) return null; // a loop: this row stays at the top
      if (!parentOf.has(parent)) return null; // no such parent: an orphan is a root
      seen.add(parent);
      parent = parentOf.get(parent) ?? null;
    }
    return row.parentId;
  };

  for (const row of rows) {
    const home = homeOf(row);
    if (!home) roots.push(row.id);
    else childrenOf.set(home, [...(childrenOf.get(home) ?? []), row.id]);
  }
  return { roots, childrenOf };
}
