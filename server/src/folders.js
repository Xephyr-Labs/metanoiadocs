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
