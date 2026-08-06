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
  updatedAt: string;
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

export type EditorMode = 'page' | 'edgeless';

export interface Workspace {
  id: string;
  name: string;
  icon: string;
}
