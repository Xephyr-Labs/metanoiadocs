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

export const docUrl = (docId: string, blockId?: string) =>
  `${location.origin}/d/${encodeURIComponent(docId)}${blockId ? `#${encodeURIComponent(blockId)}` : ''}`;

/** What the current address says is open. Both parts may be absent. */
export function readRoute(): { docId: string | null; blockId: string | null } {
  const m = DOC_PATH.exec(location.pathname);
  const hash = location.hash.slice(1);
  return {
    docId: m ? decodeURIComponent(m[1]) : null,
    blockId: hash ? decodeURIComponent(hash) : null,
  };
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
