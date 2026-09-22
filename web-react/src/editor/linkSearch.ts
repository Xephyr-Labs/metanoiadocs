/* Hallmark · component: page search inside the link popup · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H4 E4 S5 R5 V4
 * states: default · hover · active (keyboard) · no matches · url typed · empty
 * contrast: pass (40-41) · tokens: pass (48)
 */
import { REFERENCE_NODE } from '@blocksuite/affine/shared/consts';
import { rankPages, type LinkTarget } from './pageLinks';

/** Six is the "@" menu's cap too — the same list, so the same depth. */
const MAX_RESULTS = 6;

interface InlineRange {
  index: number;
  length: number;
}

/** The slice of BlockSuite's inline editor this needs. Loosely typed at the
 *  boundary, like pageLinks.ts: the popup hands these over as public fields. */
interface InlineEditorLike {
  isValidInlineRange: (range: InlineRange) => boolean;
  insertText: (range: InlineRange, text: string, attrs?: unknown) => void;
  setInlineRange: (range: InlineRange) => void;
}

interface LinkPopup extends HTMLElement {
  type?: string;
  inlineEditor?: InlineEditorLike;
  targetInlineRange?: InlineRange;
  abortController?: AbortController;
  updateComplete?: Promise<unknown>;
}

/** Anything that is already a web address is not a page title, and offering to
 *  search for one would put a list under every pasted URL. */
const looksLikeUrl = (q: string) => /^(https?:\/\/|www\.)/i.test(q) || q.includes('://');

/**
 * Let the link popup link to a page, not only to a URL.
 *
 * Cmd+K over a selection opens BlockSuite's own popup, which takes an address
 * and nothing else — so the one link people most want to make, to another page
 * in the same workspace, was the one link they could not make from there. They
 * had to know that "@" exists and that it only works from an empty caret.
 *
 * This is a decoration rather than a fork: the popup is a lit element with its
 * fields public (`type`, `inlineEditor`, `targetInlineRange`, `abortController`),
 * so the results go in under the input it already draws and everything it does
 * with an actual URL is untouched. A pasted address behaves exactly as it did.
 *
 * Picking a page writes the same reference node the "@" menu writes — not a
 * `/d/<id>` link — because that is what this app means by a link between pages:
 * the chip tracks the title, the click routing already exists, and
 * `collectPageLinks` counts it, so the backlink shows up on the other side.
 * Which also means the selected words are replaced by the page's own name; a
 * reference is the page, and two names for it is how they drift apart.
 */
export function attachLinkSearch(
  editor: Element,
  { pages, currentId }: { pages: () => LinkTarget[]; currentId: string },
): () => void {
  const enhance = async (popup: LinkPopup) => {
    // 'edit' reopens on an existing link, where the text and the address are
    // already decided and a page picker has nothing to add.
    if (popup.type !== 'create') return;
    await popup.updateComplete;
    // BlockSuite's popup is a ShadowlessElement — it renders into its own light
    // DOM, which is why the results are styled from index.css like the rest of
    // the app rather than through an injected stylesheet.
    const container = popup.querySelector('.popover-container');
    const input = popup.querySelector<HTMLInputElement>('#link-input');
    if (!container || !input) return;

    const list = document.createElement('div');
    list.className = 'mn-doc-results';
    list.hidden = true;
    container.append(list);

    input.placeholder = 'Search pages or paste a link';

    let matches: LinkTarget[] = [];
    let active = 0;

    const pick = (page: LinkTarget) => {
      const range = popup.targetInlineRange;
      const inline = popup.inlineEditor;
      if (inline && range && inline.isValidInlineRange(range)) {
        // insertText over a range with length replaces it — the same call the
        // popup's own confirm makes, and what turns the selection into a chip.
        inline.insertText(range, REFERENCE_NODE, {
          reference: { type: 'LinkedPage', pageId: page.id },
        });
        inline.setInlineRange({ index: range.index + 1, length: 0 });
      }
      popup.abortController?.abort();
    };

    const paint = () => {
      list.replaceChildren();
      list.hidden = !matches.length;
      container.classList.toggle('mn-has-doc-results', matches.length > 0);
      matches.forEach((page, i) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'mn-doc-result';
        row.dataset.active = String(i === active);
        const icon = document.createElement('span');
        icon.textContent = page.icon || '📄';
        const title = document.createElement('span');
        title.className = 'mn-doc-title';
        title.textContent = page.title || 'Untitled';
        row.append(icon, title);
        // pointerdown, not click: the input is about to lose focus either way,
        // and a click after a blur that closed the popup never arrives.
        row.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          pick(page);
        });
        list.append(row);
      });
    };

    const search = () => {
      const query = input.value.trim();
      matches = !query || looksLikeUrl(query)
        ? []
        : rankPages(pages().filter((p) => p.id !== currentId), query).slice(0, MAX_RESULTS);
      active = 0;
      paint();
    };

    // The popup listens for keydown on itself, so a listener on the input runs
    // first and can keep Enter for the list. Everything it does not claim —
    // Escape, Enter with no matches, Enter over a pasted URL — bubbles on
    // untouched.
    const onKeyDown = (e: KeyboardEvent) => {
      if (!matches.length || e.isComposing) return;
      if (e.key === 'ArrowDown') active = (active + 1) % matches.length;
      else if (e.key === 'ArrowUp') active = (active - 1 + matches.length) % matches.length;
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pick(matches[active]); return; }
      else return;
      e.preventDefault();
      e.stopPropagation();
      paint();
    };

    input.addEventListener('input', search);
    input.addEventListener('keydown', onKeyDown);
  };

  // `link-popup` is what BlockSuite registers the element as (its effects.js),
  // not `affine-link-popup` like every other block — matched by suffix so a
  // rename to the house style would not silently turn this off.
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && node.tagName.endsWith('LINK-POPUP')) {
          void enhance(node as LinkPopup);
        }
      }
    }
  });
  observer.observe(editor, { childList: true, subtree: true });
  return () => observer.disconnect();
}
