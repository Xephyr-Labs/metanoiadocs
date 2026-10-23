// Rules for spaces that need no database: where a new item lands, and what a
// move takes along. The routes load the rows and apply the answer.

const has = (v) => v !== undefined && v !== null && v !== '';

/**
 * The space a new item gets. A sub-item stays with its parent, a top-level page
 * in a folder stays with the folder, otherwise it is the space asked for, and
 * failing that the default (old clients ask for none).
 */
export function resolveSpace({ parentSpace, folderSpace, requested, fallback }) {
  return [parentSpace, folderSpace, requested, fallback].find(has);
}

// Ids of `seeds` and everything below them. Iterative with a visited set, so a
// cycle in bad data ends the walk instead of hanging it.
function withDescendants(seeds, childrenOf) {
  const seen = new Set();
  const stack = [...seeds];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(childrenOf.get(id) || []));
  }
  return seen;
}

function childMap(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!has(r.parent_id)) continue;
    if (!m.has(r.parent_id)) m.set(r.parent_id, []);
    m.get(r.parent_id).push(r.id);
  }
  return m;
}

/**
 * Everything that moves with `root`, as ids. `clearFolderDocIds` are moved pages
 * filed in a folder that stays behind; their folder_id must be cleared, since a
 * folder lives in one space.
 */
export function collectMove(graph, root) {
  const docs = new Map(graph.docs.map((d) => [d.id, d]));
  const docKids = childMap(graph.docs);
  const folderKids = childMap(graph.folders);
  const projectKids = childMap(graph.projects);

  let folderIds = new Set();
  let projectIds = new Set();
  let docSeeds = [];
  if (root.type === 'doc') {
    docSeeds = [root.id];
  } else if (root.type === 'folder') {
    folderIds = withDescendants([root.id], folderKids);
    docSeeds = graph.docs.filter((d) => !has(d.parent_id) && folderIds.has(d.folder_id)).map((d) => d.id);
  } else {
    projectIds = withDescendants([root.id], projectKids);
    docSeeds = graph.projects.filter((p) => projectIds.has(p.id) && has(p.doc_id)).map((p) => p.doc_id);
    for (const t of graph.tasks) {
      if (projectIds.has(t.project_id) && docs.get(t.doc_id)?.kind === 'task') docSeeds.push(t.doc_id);
    }
  }
  const docIds = withDescendants(docSeeds, docKids);
  const clearFolderDocIds = [...docIds].filter((id) => {
    const f = docs.get(id)?.folder_id;
    return has(f) && !folderIds.has(f);
  });
  return { docIds: [...docIds], folderIds: [...folderIds], projectIds: [...projectIds], clearFolderDocIds };
}

/** A task page or a project's source page moves with its project, never alone. */
export function isProjectOwnedPage(graph, docId) {
  return graph.docs.some((d) => d.id === docId && d.kind === 'task') || graph.projects.some((p) => p.doc_id === docId);
}

/**
 * True when moving `root` would carry a database's own page (a task page or a
 * source page) away from its database. A project root carries its own pages.
 */
export function carriesProjectPage(graph, root) {
  if (root.type === 'project') return false;
  return collectMove(graph, root).docIds.some((id) => isProjectOwnedPage(graph, id));
}

/** Rows in spaces the person has joined first; order kept within each group. */
export function byJoinedFirst(rows, joined) {
  return [...rows.filter((r) => joined.has(r.space_id)), ...rows.filter((r) => !joined.has(r.space_id))];
}

/** Cleans a create-space body. Icon and description fall back to the DB defaults. */
export function spaceInput(raw) {
  const name = String(raw?.name ?? '').trim().slice(0, 80).trim();
  if (!name) return { error: 'Give the space a name.' };
  const icon = String(raw?.icon ?? '').trim().slice(0, 16) || '🗂️';
  const description = String(raw?.description ?? '').trim().slice(0, 500);
  return { name, icon, description };
}
