// Wires the column rules in columns-dnd.ts to a live editor: the drop monitor,
// the vertical drop line, and the tidy-up pass that keeps a row from stranding
// an empty half-page. See the header of columns-dnd.ts for why the built-in
// drag handle needs the one small patch this file applies.
import { focusBlockEnd } from '@blocksuite/affine/shared/commands';
import { BlockSelection } from '@blocksuite/std';
import {
  applyColumnDrop, planColumnDrop, sideForDrop, tidyColumns,
  type ColumnDropPlan, type ModelLike, type StoreLike,
} from './columns-dnd';
import { crossColumnRow, exitColumn, type OpsStore, type TextModelLike } from './columns-ops';

interface DropTargetLike {
  element?: (Element & { model?: ModelLike; std?: unknown }) | null;
  data?: { modelId?: string };
}
interface DragSourceLike {
  data?: {
    from?: { docId?: string };
    bsEntity?: {
      type?: string;
      modelIds?: string[];
      snapshot?: { content?: { id: string; flavour: string }[] };
    };
  };
}
interface MonitorArgs {
  location: { current: { dropTargets: DropTargetLike[] } };
  source: DragSourceLike;
}
interface DndLike {
  monitor(args: {
    canMonitor?: (a: { source: DragSourceLike }) => boolean;
    onDrag?: (a: MonitorArgs) => void;
    onDrop?: (a: MonitorArgs) => void;
    onDropTargetChange?: (a: MonitorArgs) => void;
  }): () => void;
}

type DropResultFn = (a: unknown, b: unknown, c: unknown) => unknown;
interface DragWatcher { _getDropResult: DropResultFn }
interface DragHandleWidget { _dragEventWatcher?: DragWatcher }

interface SelectionLike {
  value: { type: string; from?: { blockId: string; length: number } }[];
  create(type: typeof BlockSelection, args: { blockId: string }): BlockSelection;
  setGroup(group: string, selections: BlockSelection[]): void;
}

/** The slice of `std` this file uses, spelled out rather than imported: the
 *  editor arrives here as a plain element, the way mountEditor hands it over. */
interface StdLike {
  dnd?: DndLike;
  selection?: SelectionLike;
  view?: { getBlock(id: string): Element | null };
  host?: { updateComplete: Promise<unknown> };
  command?: { exec(command: unknown, args: Record<string, unknown>): unknown };
}

const INDICATOR_CLASS = 'mn-col-drop-line';

function draggedFrom(source: DragSourceLike) {
  const entity = source.data?.bsEntity;
  const content = entity?.snapshot?.content ?? [];
  return {
    /** Every id in the dragged subtree — used to refuse a drop into itself. */
    ids: entity?.modelIds?.length ? entity.modelIds : content.map(c => c.id),
    /** Only the roots actually move. */
    rootIds: content.map(c => c.id),
    flavours: content.map(c => c.flavour),
  };
}

export function attachColumns({
  editor, store, onChange,
}: {
  editor: Element & { std?: StdLike };
  store: StoreLike & { id?: string; doc?: { id?: string }; root?: ModelLike | null };
  onChange: (cb: () => void) => () => void;
}): () => void {
  const docIds = [store.id, store.doc?.id].filter(Boolean) as string[];

  // Where the pointer is right now. The drop payload's own `edge` cannot answer
  // "which side of this block" (see columns-dnd.ts), and `_getDropResult` — the
  // function patched below — is handed no pointer at all, so the position is
  // tracked here instead. `dragover` is what a pragmatic-drag-and-drop drag
  // actually emits; capture, so nothing can swallow it first.
  let pointerX = 0;
  const trackPointer = (event: DragEvent) => { pointerX = event.clientX; };
  document.addEventListener('dragover', trackPointer, true);

  const plan = (target: DropTargetLike | undefined, source: DragSourceLike): ColumnDropPlan | null => {
    const element = target?.element;
    if (!element?.model) return null;
    const { ids, flavours } = draggedFrom(source);
    return planColumnDrop({
      store,
      side: sideForDrop(element.getBoundingClientRect(), pointerX),
      target: element.model,
      draggedIds: ids,
      draggedFlavours: flavours,
      sameDoc: !!source.data?.from?.docId && docIds.includes(source.data.from.docId),
    });
  };

  // ── the drop line ─────────────────────────────────────────────────────────
  let line: HTMLElement | null = null;
  const hideLine = () => { line?.remove(); line = null; };
  const showLine = (el: Element, side: 'left' | 'right') => {
    const rect = el.getBoundingClientRect();
    if (!line) {
      line = document.createElement('div');
      line.className = INDICATOR_CLASS;
      document.body.append(line);
    }
    line.style.top = `${rect.top}px`;
    line.style.height = `${rect.height}px`;
    line.style.left = `${(side === 'left' ? rect.left : rect.right) - 1}px`;
  };

  // ── stand the built-in handler down for the drops we claim ────────────────
  // Its `_getDropResult` is the single gate every page drop and every drop
  // indicator goes through, and null is already its own "not mine". Patched
  // lazily and re-checked per drag, because switching between page and canvas
  // rebuilds the widget.
  //
  // What it reads is `claim`, decided once per drag frame, NOT a fresh
  // computation — the two drop handlers run in an order neither of us controls,
  // and the moment ours has moved a block the question "which side of the
  // target is the pointer on" has a different answer, because the target is now
  // in a column half the width. Recomputing there let the built-in handler
  // conclude the drop was not ours after all and re-drop the block on top of
  // the layout we had just built.
  const patched = new WeakSet<DragWatcher>();
  const undo: (() => void)[] = [];
  let claim: { plan: ColumnDropPlan; targetId: string } | null = null;
  const standDown = () => {
    const widget = editor.querySelector('affine-drag-handle-widget') as (Element & DragHandleWidget) | null;
    const watcher = widget?._dragEventWatcher;
    if (!watcher || patched.has(watcher)) return;
    patched.add(watcher);
    const original = watcher._getDropResult;
    watcher._getDropResult = (dropBlock: unknown, dragPayload: unknown, dropPayload: unknown) =>
      (claim ? null : original(dropBlock, dragPayload, dropPayload));
    undo.push(() => { watcher._getDropResult = original; });
  };

  const stop = editor.std?.dnd?.monitor({
    canMonitor: ({ source }) => source.data?.bsEntity?.type === 'blocks',
    onDrag: ({ location, source }) => {
      standDown();
      const target = location.current.dropTargets[0];
      const found = plan(target, source);
      claim = found && target?.element?.model ? { plan: found, targetId: target.element.model.id } : null;
      if (claim && target?.element) showLine(target.element, found!.side);
      else hideLine();
    },
    onDropTargetChange: () => hideLine(),
    onDrop: ({ location, source }) => {
      hideLine();
      const found = claim;
      // Not cleared inline: the built-in handler may not have run yet, and it
      // has to see the claim too. A timeout lands after every synchronous drop
      // handler and before any new drag can start.
      setTimeout(() => { claim = null; }, 0);
      if (!found) return;
      // A cancelled drag (Escape, or released off any block) still arrives here,
      // with no current drop target — acting on the last claim would build a
      // layout the reader just backed out of.
      if (location.current.dropTargets[0]?.element?.model?.id !== found.targetId) return;
      const { rootIds } = draggedFrom(source);
      const models = rootIds.map(id => store.getModelById(id)).filter((m): m is ModelLike => !!m);
      if (models.length !== rootIds.length) return; // document moved under us
      applyColumnDrop(store, found.plan, models);
    },
  });

  // ── a selection dragged across the gutter ─────────────────────────────────
  // No text range can span two columns as far as the editor is concerned: the
  // browser paints the selection, but BlockSuite keeps a text selection on the
  // first block alone, so copy, delete and the format bar all act on a fraction
  // of what looks selected. Once the gesture ends, that becomes a block
  // selection of the whole row instead — which is what the reader was reaching
  // for, and what every command already knows how to act on.
  const blockIdAt = (node: Node | null): string | null => {
    const element = node instanceof Element ? node : node?.parentElement ?? null;
    return element?.closest('[data-block-id]')?.getAttribute('data-block-id') ?? null;
  };
  const modelAt = (node: Node | null): ModelLike | null => {
    const id = blockIdAt(node);
    return id ? store.getModelById(id) : null;
  };
  const claimCrossColumn = () => {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const row = crossColumnRow(store, modelAt(range.startContainer), modelAt(range.endContainer));
    const api = editor.std?.selection;
    if (!row || !api) return;
    selection.removeAllRanges();
    api.setGroup('note', [api.create(BlockSelection, { blockId: row.id })]);
  };
  // Capture on document: the drag ends wherever the pointer happens to be, and
  // a release outside the editor still has to settle the selection it left.
  const onPointerUp = () => { requestAnimationFrame(claimCrossColumn); };
  const onKeyUp = (event: KeyboardEvent) => { if (event.key === 'Shift') claimCrossColumn(); };
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('keyup', onKeyUp, true);

  // ── Enter on the empty last line of a column ──────────────────────────────
  // It steps out below the row, instead of making the column one line taller
  // forever. Bound here rather than on the column block: the editor keeps DOM
  // focus on `affine-page-root`, so a keydown never travels through the column
  // element at all. Capture on document, so this runs before BlockSuite's own
  // Enter binding and can take the keystroke off it.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || store.readonly) return;
    if (event.target instanceof Node && !editor.contains(event.target)) return;
    const std = editor.std;
    const from = std?.selection?.value.find((s) => s.type === 'text')?.from;
    // A selection with a length is text about to be replaced, not a caret.
    if (!from || from.length) return;
    const moved = exitColumn(store as OpsStore, store.getModelById(from.blockId) as TextModelLike | null);
    if (!moved) return;
    event.preventDefault();
    event.stopPropagation();
    std?.host?.updateComplete
      .then(() => {
        const block = std.view?.getBlock(moved);
        if (block) std.command?.exec(focusBlockEnd, { focusBlock: block });
      })
      .catch(() => { /* the paragraph moved either way */ });
  };
  document.addEventListener('keydown', onKeyDown, true);

  // Empty columns can also appear without us — a backspace, or the built-in
  // handler moving a column's last block away — so the sweep runs on document
  // change, one frame later so it sees the finished state.
  let frame = 0;
  const sweep = () => {
    frame = 0;
    try { tidyColumns(store, store.root); } catch { /* mid-transaction: next change */ }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(sweep); };
  const off = onChange(schedule);

  return () => {
    if (frame) cancelAnimationFrame(frame);
    document.removeEventListener('dragover', trackPointer, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('keydown', onKeyDown, true);
    hideLine();
    try { stop?.(); } catch { /* noop */ }
    try { off(); } catch { /* noop */ }
    for (const restore of undo) { try { restore(); } catch { /* noop */ } }
  };
}
