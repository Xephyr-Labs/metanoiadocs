import { useState, type DragEvent } from 'react';
import { dropZone, type DropZone } from '../../lib/reorder';

/** What a dragged sidebar row is. Two mime types rather than one payload with a
 *  kind field, so a row can accept pages without ever accepting folders. */
export const DOC_MIME = 'application/x-metanoia-document';
export const FOLDER_MIME = 'application/x-metanoia-folder';

/**
 * How a row splits under the pointer:
 *   thirds — outer quarters reorder, middle half nests (pages, folders)
 *   halves — reorder only, no nesting
 *   whole  — the entire row means "put it in here" (a page dropped on a folder)
 */
export type DropMode = 'thirds' | 'halves' | 'whole';

/** Props that make a row draggable. */
export function dragSource(mime: string, id: string) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.stopPropagation(); // a nested row travels alone, not with its container
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(mime, id);
    },
  };
}

/**
 * Props that make a row a drop target, plus the zone it is currently showing.
 *
 * `accept` maps each mime type this row takes to how it splits for that type —
 * a folder row nests a dropped page anywhere on it, but splits into thirds for
 * another folder so it can be reordered as well as nested.
 */
export function useRowDrop({
  accept,
  enabled = true,
  onDrop,
}: {
  accept: Record<string, DropMode>;
  enabled?: boolean;
  onDrop: (mime: string, draggedId: string, zone: DropZone) => void;
}) {
  const [zone, setZone] = useState<DropZone | null>(null);

  // Read afresh on every event: dataTransfer hands out values only during the
  // drop itself, and a drop can land without a preceding dragover on this row.
  const read = (e: DragEvent): [string, DropZone] | null => {
    const mime = Object.keys(accept).find((m) => e.dataTransfer.types.includes(m));
    if (!mime) return null;
    const mode = accept[mime];
    if (mode === 'whole') return [mime, 'inside'];
    const box = e.currentTarget.getBoundingClientRect();
    return [mime, dropZone(e.clientY - box.top, box.height, mode === 'thirds')];
  };

  return {
    zone: enabled ? zone : null,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!enabled) return;
        const hit = read(e);
        if (!hit) return;
        e.preventDefault();
        e.stopPropagation(); // an enclosing row must not also claim this drop
        e.dataTransfer.dropEffect = 'move';
        setZone(hit[1]);
      },
      onDragLeave: () => setZone(null),
      onDrop: (e: DragEvent) => {
        if (!enabled) return;
        const hit = read(e);
        setZone(null);
        if (!hit) return;
        e.preventDefault();
        e.stopPropagation();
        const draggedId = e.dataTransfer.getData(hit[0]);
        if (draggedId) onDrop(hit[0], draggedId, hit[1]);
      },
    },
  };
}
