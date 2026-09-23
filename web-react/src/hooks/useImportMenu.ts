import { FileDown, FileText, Folder, Upload } from 'lucide-react';
import type { MenuItem } from '../components/ui/Menu';
import { pickImportFiles } from '../lib/docFiles';
import type { PageId } from '../lib/types';
import { useWorkspace } from '../store/workspace';

/**
 * The two things a file can arrive as, as menu rows.
 *
 * Import used to have exactly one destination per place it was offered: the
 * sidebar's row always made an unfiled page, a folder's own row always filed it
 * there. So filing an import meant finding the folder in the tree first, and
 * putting a file INTO a document meant importing a stray page and copying it
 * across by hand.
 */

/**
 * "Import →" with a folder to land in. Falls back to a plain row when the
 * workspace has no folders, so an empty submenu never opens.
 */
export function useImportToFolder(): MenuItem {
  const ws = useWorkspace();
  const run = (folderId: string | null) => {
    void pickImportFiles().then((files) => { if (files.length) void ws.importFiles(files, folderId); });
  };
  // Flat, like "Move to": a folder's name is what people pick by, and nesting
  // the submenu would make the common case (a handful of folders) two hops.
  const folders = Object.values(ws.folders).sort((a, b) => a.name.localeCompare(b.name));
  if (!folders.length) return { icon: Upload, label: 'Import…', onSelect: () => run(null) };
  return {
    icon: Upload,
    label: 'Import',
    items: [
      { icon: FileText, label: 'Top level', onSelect: () => run(null) },
      ...folders.map((folder) => ({
        icon: Folder,
        label: folder.name,
        onSelect: () => run(folder.id),
      })),
    ],
  };
}

/**
 * "Import into this page" — the file's blocks are appended to a document that
 * already exists, rather than becoming one. Null for a canvas, which has no
 * body to append to.
 */
export function useImportIntoPage(id: PageId | null | undefined): MenuItem | null {
  const ws = useWorkspace();
  if (!id || ws.pages[id]?.kind === 'design') return null;
  return {
    icon: FileDown,
    label: 'Import into this page',
    onSelect: () => {
      void pickImportFiles().then((files) => { if (files.length) void ws.importFiles(files, null, id); });
    },
  };
}
