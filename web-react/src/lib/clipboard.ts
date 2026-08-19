/**
 * Copying, on the origins this app actually runs on.
 *
 * `navigator.clipboard` only exists in a secure context. Served over plain
 * http at a LAN address — which is how most of this workspace is reached —
 * the whole object is `undefined`, so `navigator.clipboard?.writeText(url)`
 * evaluates to `undefined` and every "Copy link" in the app did nothing, said
 * nothing, and in one place reported success anyway.
 *
 * So: try the async API, fall back to the legacy `execCommand` path (which
 * still works on an insecure origin during a user gesture), and tell the truth
 * about the result.
 */

import { toast } from './toast';

export interface CopyBackends {
  /** The async Clipboard API, when the browser exposes it. */
  writeAsync?: (text: string) => Promise<void>;
  /** The legacy synchronous path. Returns whether the copy took. */
  writeLegacy?: (text: string) => boolean;
}

/**
 * Select a detached textarea, copy from it, and put the user's own selection
 * back — copying a link must not clear the text they had highlighted.
 *
 * Two things this has to survive, both learned the hard way:
 *
 *  · `execCommand('copy')` returns **true** when it copied nothing. Every one
 *    of these menus lives inside a Radix dropdown, whose focus scope grabs
 *    focus back the moment `select()` moves it — the selection is gone before
 *    the copy runs, and the return value still says success. So the payload is
 *    written from a `copy` listener and success is taken from that listener
 *    firing, never from the return value.
 *  · The listener also makes the copy independent of *what* ended up selected:
 *    whatever the browser thinks it is copying, the clipboard gets `text`.
 */
function legacyWrite(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  // Off-screen rather than hidden: `display:none` cannot hold a selection.
  area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
  document.body.appendChild(area);

  const selection = document.getSelection();
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  let wrote = false;
  const onCopy = (event: ClipboardEvent) => {
    event.preventDefault();
    event.clipboardData?.setData('text/plain', text);
    wrote = true;
  };
  document.addEventListener('copy', onCopy, true);

  try {
    area.select();
    area.setSelectionRange(0, text.length); // iOS ignores select() alone
    document.execCommand('copy');
  } catch {
    /* wrote stays false */
  } finally {
    document.removeEventListener('copy', onCopy, true);
    area.remove();
    if (previous && selection) {
      selection.removeAllRanges();
      selection.addRange(previous);
    }
  }
  return wrote;
}

const defaultBackends = (): CopyBackends => ({
  writeAsync:
    typeof navigator !== 'undefined' && navigator.clipboard
      ? (text) => navigator.clipboard.writeText(text)
      : undefined,
  writeLegacy: legacyWrite,
});

/**
 * Put `text` on the clipboard. Resolves to whether it actually got there.
 *
 * `backends` is the seam the tests drive; callers pass nothing.
 */
export async function copyText(text: string, backends: CopyBackends = defaultBackends()): Promise<boolean> {
  const { writeAsync, writeLegacy } = backends;
  if (writeAsync) {
    try {
      await writeAsync(text);
      return true;
    } catch {
      // Permission refused, or a browser that exposes the API and then denies
      // it. The legacy path below may still be allowed.
    }
  }
  return writeLegacy ? writeLegacy(text) : false;
}

/** Copy a link and say what happened. The shape every menu item wants. */
export async function copyLink(url: string, okMessage = 'Link copied'): Promise<void> {
  toast((await copyText(url)) ? okMessage : 'Could not copy — your browser blocked clipboard access');
}
