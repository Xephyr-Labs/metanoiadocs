/**
 * The two edges a row can have, read from a list of rows.
 *
 * A task is tied to others twice over and the two ties mean different things.
 * `parent_id` is containment — an epic holds stories, a story holds tasks —
 * and it nests. `deps` is order — this cannot start until that is done — and
 * it does not nest, because the row it waits on usually lives somewhere else
 * in the same list and drawing it as a child would be a second copy of it.
 *
 * Both are built here, from rows the view already has, so no screen pays a
 * request to find out what it is looking at. Pure functions: the views call
 * them inside a memo, and the tests call them with plain objects.
 */
import type { TaskRow } from './tasksApi';

export interface TaskNode {
  task: TaskRow;
  /** 0 for a row at the top of the list, 1 for its children, and so on. */
  depth: number;
  children: TaskNode[];
}

export interface TaskLinks {
  /** Rows this one waits on that are not done yet — the reason it is blocked. */
  blockedBy: TaskRow[];
  /** Rows it waits on that are already done. A count, because a met condition
   *  is worth knowing about and not worth naming. */
  met: number;
  /** Dependencies on rows this list does not contain — a filtered view, or a
   *  row somebody archived. Counted separately because nothing true can be
   *  said about their state from here. */
  unknown: number;
  /** Rows waiting on this one. */
  blocking: TaskRow[];
}

export const NO_LINKS: TaskLinks = { blockedBy: [], met: 0, unknown: 0, blocking: [] };

/** Whether this row's own state stops anything waiting on it. */
const isDone = (t: TaskRow) => t.status === 'done';

/**
 * Every row's dependency state, in one pass over the list.
 *
 * Built as an index rather than asked per card: "what waits on me" is the
 * reverse of an edge each row carries, and answering it per row means walking
 * the whole list once per row. A board of two hundred rows would do forty
 * thousand comparisons to draw one column.
 */
export function buildLinkIndex(rows: TaskRow[]): Map<string, TaskLinks> {
  const byId = new Map(rows.map((t) => [t.id, t]));
  const index = new Map<string, TaskLinks>();
  const links = (id: string) => {
    let l = index.get(id);
    if (!l) index.set(id, (l = { blockedBy: [], met: 0, unknown: 0, blocking: [] }));
    return l;
  };

  for (const row of rows) {
    const mine = links(row.id);
    for (const depId of row.deps ?? []) {
      const dep = byId.get(depId);
      if (!dep) {
        mine.unknown += 1;
        continue;
      }
      if (isDone(dep)) mine.met += 1;
      else mine.blockedBy.push(dep);
      // The other half of the same edge, written while we are here: the row
      // being depended on is the one that wants to know who is waiting.
      links(dep.id).blocking.push(row);
    }
  }
  return index;
}

/**
 * The rows, nested by `parent_id`.
 *
 * A row whose parent is missing from `rows` is a root here, not a dropped row:
 * a sprint section holds a story whose epic sits in the backlog, and a story
 * that vanished because its epic was filtered out would be a planning tool
 * hiding the work. Input order is kept within every level, so whatever the
 * caller sorted by still holds.
 */
export function buildTaskTree(rows: TaskRow[]): TaskNode[] {
  const nodes = new Map<string, TaskNode>(
    rows.map((task) => [task.id, { task, depth: 0, children: [] }]),
  );
  const roots: TaskNode[] = [];

  for (const node of nodes.values()) {
    const parent = node.task.parent_id ? nodes.get(node.task.parent_id) : undefined;
    // A parent chain that loops back on itself would recurse forever in the
    // renderer. The server refuses to create one, but a row arriving from an
    // import or an older build is not this component's problem to trust.
    if (!parent || isAncestor(node, parent, nodes)) roots.push(node);
    else parent.children.push(node);
  }

  const setDepth = (node: TaskNode, depth: number) => {
    node.depth = depth;
    for (const child of node.children) setDepth(child, depth + 1);
  };
  for (const root of roots) setDepth(root, 0);
  return roots;
}

/** Is `candidate` already underneath `node`? Walks up from the candidate. */
function isAncestor(node: TaskNode, candidate: TaskNode, nodes: Map<string, TaskNode>): boolean {
  let cursor: TaskNode | undefined = candidate;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor.task.id === node.task.id) return true;
    if (seen.has(cursor.task.id)) return true;
    seen.add(cursor.task.id);
    cursor = cursor.task.parent_id ? nodes.get(cursor.task.parent_id) : undefined;
  }
  return false;
}

/** Every row in a subtree, the node itself included — what a roll-up counts. */
export function flattenTree(nodes: TaskNode[]): TaskRow[] {
  const out: TaskRow[] = [];
  const walk = (node: TaskNode) => {
    out.push(node.task);
    node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

/** Done and total for everything under a row — an epic's real progress, which
 *  is its stories *and* their tasks, not only the children one level down. */
export function subtreeProgress(node: TaskNode): { done: number; total: number } {
  const rows = flattenTree(node.children);
  return { done: rows.filter(isDone).length, total: rows.length };
}

/**
 * Every row's subtree progress, counted over the whole list it was given.
 *
 * Built from all of a project's rows rather than from the section being drawn:
 * a sprint holds three of an epic's nine stories, and "3/3" on the epic there
 * would be a planning screen quietly redefining the epic as the part of it
 * that happens to be committed.
 */
export function subtreeIndex(rows: TaskRow[]): Map<string, { done: number; total: number }> {
  const index = new Map<string, { done: number; total: number }>();
  const walk = (node: TaskNode): { done: number; total: number } => {
    let done = 0;
    let total = 0;
    for (const child of node.children) {
      const under = walk(child);
      total += under.total + 1;
      done += under.done + (isDone(child.task) ? 1 : 0);
    }
    index.set(node.task.id, { done, total });
    return { done, total };
  };
  buildTaskTree(rows).forEach(walk);
  return index;
}
