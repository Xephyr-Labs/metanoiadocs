import type * as Y from 'yjs';
export function convertDoc(ydoc: Y.Doc): {
  title: string;
  doc: { type: 'doc'; content: object[] };
  kept: Record<string, number>;
  lost: Record<string, number>;
};
