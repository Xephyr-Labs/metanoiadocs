// URL ↔ open document.
//
// The app used to keep the open page only in memory, so every page shared the
// one address: a link somebody pasted into chat opened whatever document the
// reader had open last, the back button left the workspace entirely, and there
// was nothing for "copy link to block" to copy. A page is /d/<id>, and a block
// inside it is the fragment.
//
// Deliberately not a router: there is one route with one parameter, and pulling
// in react-router to express that would be more moving parts than the feature.

/** `/share/<token>` is handled in main.tsx before the app mounts. */
const DOC_PATH = /^\/d\/([^/?#]+)/;
const FOLDER_PATH = /^\/f\/([^/?#]+)/;
/** A database, and optionally which of its saved views. */
const DB_PATH = /^\/db\/([^/?#]+)(?:\/([^/?#]+))?/;

/** Every address this app answers, and nothing else on the origin.
 *
 *  The service worker's navigation fallback is allowlisted to exactly these:
 *  docs.xephyrlabs.com also serves sibling apps under /bexpharma, /taskgantt and
 *  /jira, and a fallback that covered the whole origin handed them the app shell
 *  out of the precache instead of letting the request reach Caddy. A new route
 *  here is a new route there — that is the point of the shared list. */
export const APP_PATHS = [/^\/$/, DOC_PATH, FOLDER_PATH, DB_PATH];

export const docUrl = (docId: string, blockId?: string) =>
  `${location.origin}/d/${encodeURIComponent(docId)}${blockId ? `#${encodeURIComponent(blockId)}` : ''}`;

/**
 * The address of a database, and of one of its views.
 *
 * Databases had no address at all, which is why "open in a new tab" worked for
 * a document and not for a board, and why a link to "the sprint view" could
 * only be a link to the workspace plus instructions. The view is a second
 * segment rather than a query parameter so it reads as what it is — one of the
 * things inside the database.
 */
export const dbPath = (projectId: string, viewId?: string | null) =>
  `/db/${encodeURIComponent(projectId)}${viewId ? `/${encodeURIComponent(viewId)}` : ''}`;

export const dbUrl = (projectId: string, viewId?: string) => `${location.origin}${dbPath(projectId, viewId)}`;

/** The address of a folder, for "Copy link". Folders are workspace-wide, so any
 *  signed-in member who follows one lands on the same folder — there is no
 *  per-folder grant to check, the way there is for a document. */
export const folderUrl = (folderId: string) =>
  `${location.origin}/f/${encodeURIComponent(folderId)}`;

export interface Route {
  docId: string | null;
  folderId: string | null;
  projectId: string | null;
  viewId: string | null;
  blockId: string | null;
}

/** The parsing half, kept apart from `location` so it can be tested without a
 *  DOM — this suite runs in node, and a route is exactly the sort of thing
 *  worth a test. */
export function parseRoute(pathname: string, hash = ''): Route {
  const doc = DOC_PATH.exec(pathname);
  const folder = FOLDER_PATH.exec(pathname);
  const db = DB_PATH.exec(pathname);
  const fragment = hash.replace(/^#/, '');
  return {
    docId: doc ? decodeURIComponent(doc[1]) : null,
    folderId: folder ? decodeURIComponent(folder[1]) : null,
    projectId: db ? decodeURIComponent(db[1]) : null,
    viewId: db?.[2] ? decodeURIComponent(db[2]) : null,
    blockId: fragment ? decodeURIComponent(fragment) : null,
  };
}

/** What the current address says is open. Every part may be absent. */
export function readRoute(): Route {
  return parseRoute(location.pathname, location.hash);
}

/**
 * Point the address at a document without reloading. `replace` is for the
 * initial sync — restoring the last-open page on sign-in should not leave a
 * history entry the back button lands on.
 */
export function showDoc(docId: string, { replace = false } = {}): void {
  const path = `/d/${encodeURIComponent(docId)}`;
  if (location.pathname === path && !location.hash) return;
  history[replace ? 'replaceState' : 'pushState']({ docId }, '', path);
}

/** Point the address at a database, optionally at one of its views. Same
 *  contract as `showDoc`. */
export function showDatabase(projectId: string, viewId?: string | null, { replace = false } = {}): void {
  const path = dbPath(projectId, viewId);
  if (location.pathname === path && !location.hash) return;
  history[replace ? 'replaceState' : 'pushState']({ projectId, viewId }, '', path);
}

/** Point the address at a folder. Same contract as `showDoc`. */
export function showFolder(folderId: string, { replace = false } = {}): void {
  const path = `/f/${encodeURIComponent(folderId)}`;
  if (location.pathname === path && !location.hash) return;
  history[replace ? 'replaceState' : 'pushState']({ folderId }, '', path);
}

export function showHome({ replace = false } = {}): void {
  if (location.pathname === '/' && !location.hash) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', '/');
}

/**
 * Scroll a block into view and mark it, once the editor has rendered it.
 *
 * BlockSuite mounts asynchronously and images/embeds settle later still, so
 * this polls briefly rather than assuming the block exists on the first frame.
 * Returns a cancel function — navigating away mid-wait must not scroll the next
 * document to a block id it doesn't contain.
 */
export function revealBlock(blockId: string, root: ParentNode = document): () => void {
  let tries = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = () => {
    const el = root.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('mn-block-flash');
      setTimeout(() => el.classList.remove('mn-block-flash'), 2000);
      return;
    }
    if (tries++ < 40) timer = setTimeout(tick, 150); // ~6s, then give up quietly
  };
  tick();
  return () => { if (timer) clearTimeout(timer); };
}
