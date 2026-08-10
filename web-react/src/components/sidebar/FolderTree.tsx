import { ChevronRight, Download, FileText, Folder, FolderInput, FolderOpen, MoreHorizontal, Plus, Printer, Star, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/cn';
import { downloadMarkdown, pickMarkdownFiles, printDoc } from '../../lib/docFiles';
import { TAG_COLORS, swatch } from '../../lib/tagColors';
import type { PageId } from '../../lib/types';
import { useWorkspace } from '../../store/workspace';
import { PageIcon } from '../ui/PageIcon';
import { Menu } from '../ui/Menu';
import { RowInput } from '../ui/RowInput';
import { rowAction } from '../ui/styles';

/** Folder icon tint per palette color; gray stays the quiet default. */
const FOLDER_TINT: Record<string, string> = {
  gray: 'text-faint',
  red: 'text-red-500',
  orange: 'text-orange-500',
  yellow: 'text-yellow-500',
  green: 'text-green-500',
  teal: 'text-teal-500',
  blue: 'text-blue-500',
  purple: 'text-purple-500',
  pink: 'text-pink-500',
};

const ColorDot = (color: string) =>
  function Dot({ className }: { size?: number | string; strokeWidth?: number | string; className?: string }) {
    return <span className={cn('h-3 w-3 rounded-full', swatch(color).dot, className)} />;
  };

function DocumentRow({ id, depth }: { id: PageId; depth: number }) {
  const ws = useWorkspace();
  const page = ws.pages[id];
  const [hover, setHover] = useState(false);
  if (!page) return null;
  const selected = ws.currentId === id;
  const fav = ws.favoriteIds.includes(id);
  // Every folder used to be its own "Move to X" row, so this menu grew a line
  // per folder and eventually ran off the bottom of the screen. They live in a
  // submenu now, and the folder the page is already in isn't offered.
  const moveTargets = [
    ...(page.folderId ? [{ icon: FileText, label: 'Top level', onSelect: () => ws.movePage(id, null) }] : []),
    ...Object.values(ws.folders)
      .filter((folder) => folder.id !== page.folderId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((folder) => ({
        icon: Folder,
        label: folder.name,
        onSelect: () => ws.movePage(id, folder.id),
      })),
  ];
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-metanoia-document', id);
      }}
      onClick={() => ws.select(id)}
      className={cn('group/row flex h-8 cursor-pointer items-center rounded-md pr-1 text-base leading-5 transition-colors duration-120', selected ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-hover')}
      style={{ paddingLeft: 8 + depth * 16 }}
      role="treeitem"
      aria-selected={selected}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') ws.select(id); }}
    >
      <span className={cn('mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center', selected ? 'text-accent' : 'text-faint')}>
        <PageIcon icon={page.icon} size={16} className={selected ? 'shrink-0 text-accent' : 'shrink-0 text-faint'} />
      </span>
      <span className={cn('flex h-5 min-w-0 flex-1 items-center truncate', selected && 'font-medium text-accent')}>
        {page.title}
      </span>
      <span className={cn('flex shrink-0 items-center gap-0.5 transition-opacity', hover ? 'opacity-100' : 'opacity-0')}>
        <Menu
          trigger={<button type="button" onClick={(e) => e.stopPropagation()} className={rowAction} aria-label="Document actions"><MoreHorizontal size={16} /></button>}
          items={[
            { icon: Star, label: fav ? 'Remove from Favorites' : 'Add to Favorites', onSelect: () => ws.toggleFavorite(id) },
            { icon: FileText, label: 'Open', onSelect: () => ws.select(id) },
            { icon: Download, label: 'Export Markdown', onSelect: () => downloadMarkdown(id) },
            { icon: Printer, label: 'Export PDF', onSelect: () => printDoc(id) },
            ...(moveTargets.length ? [{ icon: FolderInput, label: 'Move to', separatorBefore: true, items: moveTargets }] : []),
            { icon: Trash2, label: 'Delete', danger: true, separatorBefore: true, onSelect: () => ws.deletePage(id) },
          ]}
        />
      </span>
    </div>
  );
}

function FolderRow({ id, depth }: { id: string; depth: number }) {
  const ws = useWorkspace();
  const folder = ws.folders[id];
  const [hover, setHover] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [renaming, setRenaming] = useState(false);
  if (!folder) return null;
  const hasChildren = folder.children.length > 0 || folder.documentIds.length > 0;
  const tint = FOLDER_TINT[folder.color] ?? 'text-faint';
  const children = folder.expanded && (
    <div role="group">
      {folder.documentIds.map((docId) => <DocumentRow key={docId} id={docId} depth={depth + 1} />)}
      {folder.children.map((childId) => <FolderRow key={childId} id={childId} depth={depth + 1} />)}
    </div>
  );

  // Renaming replaces the row rather than opening anything — the folder keeps
  // its icon and its place in the tree while the name is being typed.
  if (renaming) {
    return (
      <div>
        <RowInput
          icon={<Folder size={16} className={cn('shrink-0', tint)} />}
          depth={depth}
          defaultValue={folder.name}
          label={`Rename ${folder.name}`}
          onCommit={async (name) => { await ws.renameFolder(id, name); setRenaming(false); }}
          onCancel={() => setRenaming(false)}
        />
        {children}
      </div>
    );
  }

  return (
    <div>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-metanoia-document')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const documentId = e.dataTransfer.getData('application/x-metanoia-document');
          if (!documentId) return;
          ws.movePage(documentId, id);
          if (!folder.expanded) ws.toggleFolder(id);
        }}
        className={cn('group/row flex h-8 items-center rounded-md pr-1 text-base leading-5 text-ink hover:bg-hover', dragOver && 'bg-accent-soft text-accent')}
        style={{ paddingLeft: 8 + depth * 16 }}
        role="treeitem"
        aria-expanded={hasChildren ? !!folder.expanded : undefined}
      >
        {/* One w-5 slot shared with doc rows so names line up: folder icon at
            rest, chevron while hovering the row. */}
        <button type="button" onClick={() => ws.toggleFolder(id)} className="mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-hover" aria-label={folder.expanded ? 'Collapse folder' : 'Expand folder'}>
          {hover && hasChildren ? (
            <ChevronRight size={14} className={cn('text-muted transition-transform duration-180', folder.expanded && 'rotate-90')} />
          ) : folder.expanded ? (
            <FolderOpen size={16} className={cn('shrink-0', tint)} />
          ) : (
            <Folder size={16} className={cn('shrink-0', tint)} />
          )}
        </button>
        <button type="button" onClick={() => ws.toggleFolder(id)} className="flex min-w-0 flex-1 items-center text-left">
          <span className="truncate">{folder.name}</span>
        </button>
        <span className={cn('flex shrink-0 items-center gap-0.5 transition-opacity', hover ? 'opacity-100' : 'opacity-0')}>
          <Menu
            trigger={<button type="button" onClick={(e) => e.stopPropagation()} className={rowAction} aria-label="Folder actions"><MoreHorizontal size={16} /></button>}
            items={[
              { icon: Plus, label: 'New page', onSelect: () => ws.createPage(id) },
              { icon: Folder, label: 'New subfolder', onSelect: () => ws.createFolder(id) },
              { icon: Upload, label: 'Import Markdown…', onSelect: () => pickMarkdownFiles().then((f) => f.length && ws.importMarkdown(f, id)) },
              { icon: FileText, label: 'Rename', onSelect: () => setRenaming(true) },
              // Nine swatches inline made this menu taller than the sidebar.
              // The trigger wears the folder's current colour, so the row still
              // says which one is set without being opened.
              {
                icon: ColorDot(folder.color),
                label: 'Color',
                separatorBefore: true,
                items: TAG_COLORS.map((c) => ({
                  icon: ColorDot(c),
                  label: c[0].toUpperCase() + c.slice(1),
                  onSelect: () => ws.setFolderColor(id, c),
                })),
              },
              { icon: Trash2, label: 'Delete folder', danger: true, separatorBefore: true, onSelect: () => ws.deleteFolder(id) },
            ]}
          />
          <button type="button" onClick={() => ws.createPage(id)} className={rowAction} aria-label="New page in folder"><Plus size={16} /></button>
        </span>
      </div>
      {children}
    </div>
  );
}

export function FolderTree({ roots, unfiled }: { roots: string[]; unfiled: PageId[] }) {
  return (
    <div role="tree" className="space-y-px">
      {roots.map((id) => <FolderRow key={id} id={id} depth={0} />)}
      {unfiled.map((id) => <DocumentRow key={id} id={id} depth={0} />)}
    </div>
  );
}
