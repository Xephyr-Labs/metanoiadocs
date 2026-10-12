// The bar over a phone's keyboard, with the text styles on it.
//
// BlockSuite's default bar keeps bold, italic, underline, strikethrough, code,
// link and colour one level down, behind "Aa" — reached only by tapping it, or
// by selecting text first. Writing on a phone wants them a thumb away, the way
// Notion's and Google Docs' bars have them. So the "Aa" level is flattened into
// the bar: insert (+), turn-into (Aa), the styles, then BlockSuite's own items
// (image, undo/redo, indent, lists, …) — the bar scrolls sideways.
import { getTextStyle } from '@blocksuite/affine/inlines/preset';
import {
  defaultKeyboardToolbarConfig,
  KeyboardToolbarConfigExtension,
  type KeyboardToolbarItem,
} from '@blocksuite/affine/widgets/keyboard-toolbar';

export function flattenTextStyles(items: KeyboardToolbarItem[]): KeyboardToolbarItem[] {
  // The "Aa" level is the one sub-toolbar that opens itself on a selection.
  const at = items.findIndex((i) => 'items' in i && 'autoShow' in i);
  if (at < 0) return items;
  const styles = (items[at] as { items: KeyboardToolbarItem[] }).items
    .filter((i) => !('name' in i) || i.name !== 'InlineTex')
    .map(sharedShading);
  return [...items.slice(0, at), ...styles, ...items.slice(at + 1)];
}

// Each style button shades itself by asking for the selection's styles, and
// the bar re-renders on every keystroke now that they are on it: five full
// look-ups of the selection, several times per key. One per render is shared, and the
// shade is the app's selected colour, not a fixed black that vanished in dark.
const STYLE_KEY: Record<string, 'bold' | 'italic' | 'underline' | 'strike' | 'code'> = {
  Bold: 'bold', Italic: 'italic', UnderLine: 'underline', StrikeThrough: 'strike', Code: 'code',
};
let shared: { std: unknown; style: Record<string, unknown> | null } | null = null;
function textStyleOf(std: { command: { exec: (c: unknown) => unknown } }) {
  if (shared?.std !== std) {
    const [, ctx] = std.command.exec(getTextStyle) as [unknown, { textStyle?: Record<string, unknown> }];
    shared = { std, style: ctx?.textStyle ?? null };
    // All the buttons render in one synchronous pass; the next render looks
    // again, so a style changed in between is never shown stale.
    queueMicrotask(() => { shared = null; });
  }
  return shared.style;
}
function sharedShading(item: KeyboardToolbarItem): KeyboardToolbarItem {
  const key = 'name' in item ? STYLE_KEY[item.name as string] : undefined;
  if (!key || !('background' in item)) return item;
  return { ...item, background: ({ std }) => (textStyleOf(std as never)?.[key] ? 'var(--selected)' : '') };
}

/** The "+" panel's "New page" makes a doc that is never saved — the text
 *  linked to it is lost on reload (noLinkedDocConvert.ts). "Linked page" stays:
 *  it opens the "@" menu, which makes real pages. */
export function dropNewPage(items: KeyboardToolbarItem[]): KeyboardToolbarItem[] {
  return items.map((item) =>
    'groups' in item
      ? {
        ...item,
        groups: item.groups.map((g) =>
          'items' in g ? { ...g, items: g.items.filter((i) => i.name !== 'NewPage') } : g,
        ),
      }
      : item,
  );
}

export const keyboardToolbarExtension = () =>
  KeyboardToolbarConfigExtension({ items: dropNewPage(flattenTextStyles(defaultKeyboardToolbarConfig.items)) });

/**
 * With the styles on the bar, BlockSuite's floating toolbar over a text
 * selection is a second copy of them — wider than a phone, cut off at the
 * right edge, and laid over the very words just selected. It lives in the
 * toolbar widget's shadow root, so the rule is adopted there.
 *
 * Only while the page's own text has focus, which is when the bar is up. A
 * table or database cell is an editing host of its own: focus moves into it,
 * the bar goes away, and the floating toolbar (which marks itself the same
 * way, `data-inline`) is the only formatting a cell has — so it stays.
 */
export function hideFloatingTextToolbar(root: Element): () => void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync('editor-toolbar[data-inline] { display: none !important; }');
  const sync = () => { sheet.disabled = document.activeElement?.tagName !== 'AFFINE-PAGE-ROOT'; };
  sync();
  let host: ShadowRoot | null = null;
  const adopt = () => {
    const sr = root.querySelector('affine-toolbar-widget')?.shadowRoot ?? null;
    if (!sr || sr === host) return;
    host = sr;
    sr.adoptedStyleSheets = [...sr.adoptedStyleSheets, sheet];
    mo.disconnect();
  };
  // The widget comes with the page's first render, after this runs.
  // ponytail: a page/edgeless switch makes a new widget without the rule;
  // keep observing if phones start switching modes.
  const mo = new MutationObserver(adopt);
  mo.observe(root, { childList: true, subtree: true });
  adopt();
  document.addEventListener('focusin', sync);
  document.addEventListener('focusout', sync);
  return () => {
    mo.disconnect();
    document.removeEventListener('focusin', sync);
    document.removeEventListener('focusout', sync);
    if (host) host.adoptedStyleSheets = host.adoptedStyleSheets.filter((s) => s !== sheet);
  };
}
