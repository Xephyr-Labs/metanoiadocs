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
  role: string; // owner | editor | suggester | commenter | viewer
  /** What any workspace member may do here while the page is team-visible. */
  teamRole: string;
  visibility: 'team' | 'private';
  /** A design opens on the canvas; a task is a database row's page. */
  kind: 'doc' | 'design' | 'task';
  /** Who saved it last. Null on a page nobody has edited since it was made. */
  updatedByName: string | null;
  /** Whether that last save came from a person or from an agent. */
  updatedByKind: 'person' | 'agent';
  /** 'ai' when the copilot made that last save, not the person typing. */
  updatedVia: 'human' | 'ai';
  updatedAt: string;
  /** Who made the page and when — fixed, unlike the editor above. */
  createdByName: string | null;
  createdAt: string | null;
  /** Loves from the whole team, and whether one of them is yours. */
  loveCount: number;
  loved: boolean;
  /** Pages this one @-references. Drives the sidebar disclosure arrow. */
  linkCount: number;
  tags: Tag[];
  /** Someone else changed it since you last opened it — bold in your sidebar. */
  unseen: boolean;
  /** Pinned for the whole workspace, as opposed to `favorite`, which is yours. */
  pinned: boolean;
  /** Offered as a starting point for new pages. A template is an ordinary page
   *  that happens to be marked — it stays in the sidebar, in search and in All
   *  documents, and is edited like any other. */
  isTemplate: boolean;
  /** Offered as a template in every space, not only its own. */
  templateEverywhere: boolean;
  /** Page property values, keyed by DocPropRow.id. Sparse: only what is set. */
  props: Record<string, unknown>;
  /** The space it lives in; null until the server sends one. */
  spaceId: string | null;
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
  favorite: boolean;
  /** Pinned for the whole workspace, as opposed to `favorite`, which is yours. */
  pinned: boolean;
  spaceId: string | null;
}

/** `slides` is the edgeless canvas with deck chrome — same doc, same blocks. */
export type EditorMode = 'page' | 'edgeless' | 'slides';

export interface Workspace {
  id: string;
  name: string;
  icon: string;
}
