export type PageId = string;

export interface Tag {
  id: string;
  name: string;
  color: string;
  count?: number;
}

export interface Page {
  id: PageId;
  title: string;
  icon: string;
  parentId: PageId | null;
  folderId: string | null;
  position: number;
  shared: boolean;
  favorite: boolean;
  role: string; // owner | editor | viewer
  visibility: 'team' | 'private';
  /** A design opens on the canvas; everything else about it is a document. */
  kind: 'doc' | 'design';
  /** Who saved it last. Null on a page nobody has edited since it was made. */
  updatedByName: string | null;
  updatedAt: string;
  /** Pages this one @-references. Drives the sidebar disclosure arrow. */
  linkCount: number;
  tags: Tag[];
  children: PageId[];
  expanded?: boolean;
}

export interface Folder {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
  position: number;
  documentIds: PageId[];
  children: string[];
  expanded?: boolean;
}

/** `slides` is the edgeless canvas with deck chrome — same doc, same blocks. */
export type EditorMode = 'page' | 'edgeless' | 'slides';

export interface Workspace {
  id: string;
  name: string;
  icon: string;
}
