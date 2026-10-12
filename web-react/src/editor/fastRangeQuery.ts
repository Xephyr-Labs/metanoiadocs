// Which blocks a selection touches, without testing every block on the page.
//
// BlockSuite answers this (RangeManager.getSelectedBlockComponentsByRange) by
// querying every block element in the editor and asking the browser whether
// the range intersects each one. It asks on every caret move — every
// keystroke — so typing cost grew with the length of the page: about six
// times as much per key in a 300-block page as in a three-line one.
//
// Nearly always the selection sits inside one line of one block's text: a
// caret, or a few words. Then the blocks it intersects are exactly the blocks containing
// it — that block and its ancestors — which are found by walking up the DOM.
// Only that case is answered here, with the same filters, order and modes as
// the original; anything wider (a selection across blocks) goes to it.
import { RangeManager } from '@blocksuite/affine/std/inline';

const BLOCK = '[data-block-id]';
const EXCLUDED = 'data-range-query-exclude';
const LINE = '[data-v-root]';

type Block = Element;
type Options = { match?: (el: Block) => boolean; mode?: 'all' | 'flat' | 'highest' };

const elementOf = (n: Node) => (n instanceof Element ? n : n.parentElement);

/** The blocks containing `node`, outermost first, as far up as `host`. */
export function containingBlocks(node: Node, host: Element): Block[] {
  const out: Block[] = [];
  for (let el = elementOf(node)?.closest(BLOCK) ?? null; el && host.contains(el); el = el.parentElement?.closest(BLOCK) ?? null) {
    out.push(el);
  }
  return out.reverse();
}

let installed = false;
export function installFastRangeQuery() {
  if (installed) return;
  installed = true;
  const proto = RangeManager.prototype as unknown as {
    getSelectedBlockComponentsByRange(range: Range, options?: Options): Block[];
    getClosestBlock(node: Node): Block | null;
    std: { host: Element };
  };
  const original = proto.getSelectedBlockComponentsByRange;
  proto.getSelectedBlockComponentsByRange = function (this: typeof proto, range: Range, options: Options = {}) {
    // Both ends inside the same line of text (an inline root), which never
    // holds a block — only then is "the blocks containing it" the whole answer.
    // Ends merely in the same block can still have its child blocks between
    // them. Anything else: the full query.
    const line = elementOf(range.startContainer)?.closest(LINE);
    const first = this.getClosestBlock(range.startContainer);
    if (!line || !first || elementOf(range.endContainer)?.closest(LINE) !== line || line.closest(BLOCK) !== first) {
      return original.call(this, range, options);
    }
    const { mode = 'all', match = () => true } = options;
    const hits = containingBlocks(range.startContainer, this.std.host)
      .filter((el) => el.getAttribute(EXCLUDED) !== 'true' && match(el));
    const at = hits.indexOf(first);
    if (at === -1) return [];
    // The containing blocks are a chain of ancestors ending at `first`, so
    // "flat" and "highest" (everything from the first block on, then only the
    // outermost of nested ones) both come down to that block alone.
    return mode === 'all' ? hits : [first];
  };
}
