// Opening a project from outside the app's React tree.
//
// The database block mounts its own React root (editor/database/database-block.ts
// creates it), a separate tree from the app's — `useWorkspace()` cannot cross
// that boundary, which is why the embedded database fetches over REST rather
// than reading the store. Navigation has the same problem in reverse: the block
// knows which project to open and has no way to say so.
//
// One wire, the same shape as docSignal's.
const listeners = new Set<(projectId: string) => void>();

/** Ask the app to open a project. No-ops if nothing is listening. */
export function requestOpenProject(projectId: string): void {
  for (const l of listeners) l(projectId);
}

/** Subscribe. Returns the unsubscribe, for an effect's cleanup. */
export function onOpenProjectRequest(fn: (projectId: string) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
