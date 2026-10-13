import { css, type CSSResultOrNative } from 'lit';

/**
 * Give the "/" menu the same face as the "@" menu (linkedDocMenu.ts).
 *
 * Both open from a keystroke in the same line of text, and they looked like two
 * products: the "@" panel is ours (12px radius, 32px rows, small caps group
 * labels), the slash menu was stock BlockSuite (8px radius, 44px rows, every
 * icon boxed in its own bordered tile, different type). Same tokens and the
 * same measurements now, so one reads as the sibling of the other.
 *
 * The menu lives in a shadow root, so this stylesheet has to be one of its
 * own. Lit adopts a class's `elementStyles` into every new instance's shadow
 * root, which makes appending to that list a style for every menu and sub-menu
 * opened from now on. Rules written from in here also outrank the rows' own
 * `:host` styles, which is what lets a row's height and padding change.
 */
const SLASH_CSS = css`
  .slash-menu {
    width: min(320px, calc(100vw - 16px));
    padding: 4px;
    border-radius: 12px;
    font-family: var(--font-body);
    /* Read inside each row's own shadow root, so they inherit there. */
    --affine-font-sm: 13px;
    --affine-font-xs: 11px;
    --affine-line-height: 18px;
    --light-textColor-textSecondaryColor: var(--faint);
  }
  .slash-menu-group + .slash-menu-group { margin-top: 4px; }
  .slash-menu-group-name {
    margin: 6px 8px 2px;
    padding: 0;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    line-height: 16px;
    text-transform: uppercase;
    color: var(--faint);
  }
  .slash-menu-item {
    height: auto;
    min-height: 32px;
    padding: 4px 8px;
    gap: 8px;
    border-radius: 6px;
    font-family: inherit;
  }
  .slash-menu-item[hover='true'] { background: var(--hover); }
  .slash-menu-item-icon {
    width: 20px;
    height: 20px;
    padding: 1px;
    border: 0;
    background: transparent;
    color: var(--muted);
  }
`;

let installed = false;
export function styleSlashMenu() {
  if (installed) return;
  installed = true;
  // Defined by the editor's view extensions during the first mount, which is
  // after this runs; the first menu is opened long after that.
  void customElements.whenDefined('inner-slash-menu').then((menu) => {
    const styles = (menu as unknown as { elementStyles?: CSSResultOrNative[] }).elementStyles;
    // A BlockSuite upgrade that changes how this is built: the stock menu still works.
    styles?.push(SLASH_CSS);
  });
}
