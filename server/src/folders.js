/** Pure folder-tree helpers, kept tiny and directly testable. */

export function wouldFolderCycle(parentById, movingId, proposedParentId) {
  if (!proposedParentId) return false;
  if (movingId === proposedParentId) return true;
  const seen = new Set();
  let current = proposedParentId;
  while (current && !seen.has(current)) {
    if (current === movingId) return true;
    seen.add(current);
    current = parentById.get(current) || null;
  }
  return false;
}

/** The subset of `ids` that may legally sit under `parentId`, in the given
 *  order. A bulk reorder carries a whole sibling list, and one bad id in it
 *  must not reject the other nine — the cyclic ones are simply left where
 *  they are, the same way an inaccessible doc is skipped by /api/docs/reorder. */
export function safeFolderOrder(parentById, ids, parentId) {
  return ids.filter((id) => !wouldFolderCycle(parentById, id, parentId));
}
