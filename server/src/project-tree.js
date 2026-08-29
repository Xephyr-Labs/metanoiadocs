/**
 * Would parenting `id` under `newParentId` close a loop? Walks up from the
 * proposed parent; reaching `id` means the move would swallow its own
 * ancestor. `seen` also makes this terminate on data that is already cyclic.
 *
 * Same shape as wouldFolderCycle in folders.js — folders and databases are
 * separate trees, so they get separate guards rather than a shared generic one.
 */
export function wouldProjectCycle(parents, id, newParentId) {
  let cur = newParentId;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    if (cur === id) return true;
    seen.add(cur);
    cur = parents.get(cur) ?? null;
  }
  return false;
}
