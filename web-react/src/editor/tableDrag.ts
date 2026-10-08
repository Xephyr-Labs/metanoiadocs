// Dragging out a range of table cells past the edge of the screen.
//
// BlockSuite's table measures every row and column once, when the button goes
// down, and from then on compares the pointer against those measurements. They
// are positions on the screen, so the moment anything scrolls — the page under
// the wheel, or the table's own horizontal scroller, which the browser moves by
// itself when a drag that started in a cell's text reaches its edge — they
// describe cells that are no longer there: the range stopped growing, or grew
// in the wrong place. And nothing scrolled the page down at all, so a range
// could never reach a row below the bottom of the screen.
//
// So the drag is replaced. The cell it started in is remembered as a row and a
// column, not a point; the cell under the pointer is measured afresh on every
// move and every scroll; and the page scrolls while the pointer is held near
// its top or bottom edge, with BlockSuite's own helper for that.
import { autoScroll, domToOffsets, getScrollContainer } from '@blocksuite/affine/shared/utils';
import type { TableSelectionData } from './tableFormat';

/** Which of the bands between sorted `edges` the point `at` falls in, clamped
 *  to the first and the last, so a pointer past the table means its last row. */
export function bandAt(edges: number[], at: number): number {
  let i = 0;
  while (i < edges.length - 2 && at >= edges[i + 1]) i++;
  return i;
}

interface Cell { row: number; column: number }

/** The rectangle of cells between two corners, in either direction. */
export function areaBetween(a: Cell, b: Cell): TableSelectionData {
  return {
    type: 'area',
    rowStartIndex: Math.min(a.row, b.row),
    rowEndIndex: Math.max(a.row, b.row),
    columnStartIndex: Math.min(a.column, b.column),
    columnEndIndex: Math.max(a.column, b.column),
  };
}

interface DragController {
  host: HTMLElement;
  setSelected(selection: TableSelectionData): void;
  onDragStart(event: MouseEvent): void;
}

function onDragStart(this: DragController, event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const host = this.host;
  const cellAt = (x: number, y: number): Cell | null => {
    const offsets = domToOffsets(host, 'tr', 'td');
    return offsets ? { row: bandAt(offsets.rows, y), column: bandAt(offsets.columns, x) } : null;
  };
  const start = cellAt(event.clientX, event.clientY);
  if (!start) return;
  let x = event.clientX;
  let y = event.clientY;
  // As BlockSuite has it: inside the cell it started in, a drag selects that
  // cell's text, and only on leaving it does it become a range of cells.
  let ranging = !target.closest('affine-table-cell');
  const select = () => {
    const end = cellAt(x, y);
    if (!end) return;
    if (!ranging && end.row === start.row && end.column === start.column) return;
    ranging = true;
    this.setSelected(areaBetween(start, end));
  };

  // From the parent: the table element itself computes as scrollable on the
  // vertical axis (its horizontal scroller forces that), with nothing to scroll.
  const page = getScrollContainer(host.parentElement ?? host);
  let frame = 0;
  const scroll = () => {
    frame = 0;
    if (!ranging) return;
    const top = page === document.body ? 0 : page.getBoundingClientRect().top;
    // The scroll event that follows re-measures the selection.
    if (autoScroll(page, y - top)) frame = requestAnimationFrame(scroll);
  };
  const onMove = (e: MouseEvent) => {
    x = e.clientX;
    y = e.clientY;
    select();
    if (!frame) scroll();
  };
  const onUp = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.removeEventListener('scroll', select, true);
    document.removeEventListener('selectionchange', select);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  // Capture, because a scroll does not bubble: this hears the page, the
  // table's own scroller, and a wheel turned in the middle of the drag.
  document.addEventListener('scroll', select, true);
  // The browser keeps extending the text selection the drag started as, inside
  // the first cell, and moves it again on every scroll; that cell answers by
  // selecting itself alone. Put the range back each time — the same tick, so
  // the single cell is never painted.
  document.addEventListener('selectionchange', select);
}

/**
 * Put this drag in place of BlockSuite's. Its controller class is not
 * exported, so it is reached through the first table that is pressed on, from
 * a capturing mousedown, which runs before the table's own listener does.
 */
export function attachTableDrag(): () => void {
  const onMouseDown = (event: MouseEvent) => {
    const table = event.target instanceof Element
      ? event.target.closest('affine-table') as (Element & { selectionController?: DragController }) | null
      : null;
    const controller = table?.selectionController;
    if (!controller) return;
    Object.getPrototypeOf(controller).onDragStart = onDragStart;
    document.removeEventListener('mousedown', onMouseDown, true);
  };
  document.addEventListener('mousedown', onMouseDown, true);
  return () => document.removeEventListener('mousedown', onMouseDown, true);
}
