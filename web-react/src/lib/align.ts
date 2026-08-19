/** Aligning and distributing boxes on the canvas.
 *
 *  Pure geometry, deliberately: this is the one design control BlockSuite does
 *  not ship, and it is the only part of it worth testing. The caller reads the
 *  selection's bounds, passes them through, and writes back whatever changed.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AlignMode =
  | 'left' | 'center-x' | 'right'
  | 'top' | 'middle' | 'bottom'
  | 'distribute-x' | 'distribute-y';

/** Align needs something to align against; distribute needs a gap to divide. */
export const MIN_FOR = (mode: AlignMode): number => (mode.startsWith('distribute') ? 3 : 2);

const minOf = (boxes: Box[], f: (b: Box) => number) => Math.min(...boxes.map(f));
const maxOf = (boxes: Box[], f: (b: Box) => number) => Math.max(...boxes.map(f));

/**
 * Spread boxes so the gaps between them are equal, keeping the first and last
 * where they are — that is what everyone means by "distribute", rather than
 * equal centre spacing, which moves the outer two and looks wrong when the
 * boxes are different sizes.
 *
 * `axis` picks the pair of fields to work on: x/w or y/h.
 */
function distribute(boxes: Box[], axis: 'x' | 'y'): Box[] {
  const size = axis === 'x' ? 'w' : 'h';
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a][axis] - boxes[b][axis]);

  const first = boxes[order[0]];
  const last = boxes[order[order.length - 1]];
  const span = last[axis] + last[size] - first[axis];
  const used = order.reduce((sum, i) => sum + boxes[i][size], 0);
  // Negative when the boxes overlap more than the span allows; the gap simply
  // goes negative too and they stay evenly overlapped, which beats refusing.
  const gap = (span - used) / (order.length - 1);

  const out = boxes.map((b) => ({ ...b }));
  let cursor = first[axis];
  for (const i of order) {
    out[i][axis] = cursor;
    cursor += boxes[i][size] + gap;
  }
  return out;
}

/**
 * The boxes after alignment, in the order they came in. Unchanged boxes are
 * returned as-is so a caller can skip writing them.
 */
export function alignBoxes(boxes: Box[], mode: AlignMode): Box[] {
  if (boxes.length < MIN_FOR(mode)) return boxes.map((b) => ({ ...b }));

  switch (mode) {
    case 'left': {
      const edge = minOf(boxes, (b) => b.x);
      return boxes.map((b) => ({ ...b, x: edge }));
    }
    case 'right': {
      const edge = maxOf(boxes, (b) => b.x + b.w);
      return boxes.map((b) => ({ ...b, x: edge - b.w }));
    }
    case 'center-x': {
      // The centre of the selection's own bounding box, not the average of the
      // centres — otherwise one wide box drags the axis toward itself.
      const centre = (minOf(boxes, (b) => b.x) + maxOf(boxes, (b) => b.x + b.w)) / 2;
      return boxes.map((b) => ({ ...b, x: centre - b.w / 2 }));
    }
    case 'top': {
      const edge = minOf(boxes, (b) => b.y);
      return boxes.map((b) => ({ ...b, y: edge }));
    }
    case 'bottom': {
      const edge = maxOf(boxes, (b) => b.y + b.h);
      return boxes.map((b) => ({ ...b, y: edge - b.h }));
    }
    case 'middle': {
      const centre = (minOf(boxes, (b) => b.y) + maxOf(boxes, (b) => b.y + b.h)) / 2;
      return boxes.map((b) => ({ ...b, y: centre - b.h / 2 }));
    }
    case 'distribute-x':
      return distribute(boxes, 'x');
    case 'distribute-y':
      return distribute(boxes, 'y');
  }
}

/** Which boxes actually moved — the write list. Sub-pixel drift is not a move. */
export function movedBoxes(before: Box[], after: Box[]): number[] {
  const moved: number[] = [];
  for (let i = 0; i < before.length; i += 1) {
    if (Math.abs(before[i].x - after[i].x) > 0.01 || Math.abs(before[i].y - after[i].y) > 0.01) moved.push(i);
  }
  return moved;
}
