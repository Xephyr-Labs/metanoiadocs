import { ChevronRight, FileText, Folder, FolderOpen, MoreHorizontal, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/cn';
import type { PageId } from '../../lib/types';
import { useWorkspace } from '../../store/workspace';
import { DocIcon } from '../ui/DocIcon';
import { Menu } from '../ui/Menu';

function DocumentRow({ id, depth }: { id: PageId; depth: number }) {
  const ws = useWorkspace();
  const page = ws.pages[id];
  const [hover, setHover] = useState(false);
  if (!page) return null;
  const selected = ws.currentId === id;
  const fav = ws.favoriteIds.includes(id);
  const folderOptions = Object.values(ws.folders)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((folder) => ({
      icon: Folder,
      label: `Move to ${folder.name}`,
      onSelect: () => ws.movePage(id, folder.id),
    }));
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
      className={cn('group/row flex h-8 cursor-pointer items-center rounded-md pr-1 text-[14px] leading-5 transition-colors duration-120', selected ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-hover')}
      style={{ paddingLeft: 8 + depth * 16 }}
      role="treeitem"
      aria-selected={selected}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') ws.select(id); }}
    >
      <span className={cn('mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center', selected ? 'text-accent' : 'text-faint')}>
        <DocIcon size={16} />
      </span>
      <span className={cn('flex h-5 min-w-0 flex-1 items-center truncate', selected && 'font-medium text-accent')}>
        {page.title}
      </span>
      <span className={cn('flex shrink-0 items-center gap-0.5 transition-opacity', hover ? 'opacity-100' : 'opacity-0')}>
        <Menu
          trigger={<button type="button" onClick={(e) => e.stopPropagation()} className="flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-line-strong/60 hover:text-muted" aria-label="Document actions"><MoreHorizontal size={15} /></button>}
          items={[
            { icon: Star, label: fav ? 'Remove from Favorites' : 'Add to Favorites', onSelect: () => ws.toggleFavorite(id) },
            { icon: FileText, label: 'Open', onSelect: () => ws.select(id) },
            ...folderOptions,
            ...(page.folderId ? [{ icon: FileText, label: 'Move to root', onSelect: () => ws.movePage(id, null), separatorBefore: true }] : []),
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
  if (!folder) return null;
  const hasChildren = folder.children.length > 0 || folder.documentIds.length > 0;
  const rename = () => {
    const name = window.prompt('Rename folder', folder.name)?.trim();
    if (name && name !== folder.name) ws.renameFolder(id, name);
  };
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
        className={cn('group/row flex h-8 items-center rounded-md pr-1 text-[14px] leading-5 text-ink hover:bg-hover', dragOver && 'bg-accent-soft text-accent')}
        style={{ paddingLeft: 8 + depth * 16 }}
        role="treeitem"
        aria-expanded={hasChildren ? !!folder.expanded : undefined}
      >
        <button type="button" onClick={() => ws.toggleFolder(id)} className="relative mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint hover:bg-line-strong/60" aria-label={folder.expanded ? 'Collapse folder' : 'Expand folder'}>
          {hasChildren && <ChevronRight size={13} className={cn('transition-transform duration-150', folder.expanded && 'rotate-90')} />}
        </button>
        <button type="button" onClick={() => ws.toggleFolder(id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {folder.expanded ? <FolderOpen size={16} className="shrink-0 text-faint" /> : <Folder size={16} className="shrink-0 text-faint" />}
          <span className="truncate">{folder.name}</span>
        </button>
        <span className={cn('flex shrink-0 items-center gap-0.5 transition-opacity', hover ? 'opacity-100' : 'opacity-0')}>
          <Menu
            trigger={<button type="button" onClick={(e) => e.stopPropagation()} className="flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-line-strong/60 hover:text-muted" aria-label="Folder actions"><MoreHorizontal size={15} /></button>}
            items={[
              { icon: Plus, label: 'New page', onSelect: () => ws.createPage(id) },
              { icon: Folder, label: 'New subfolder', onSelect: () => ws.createFolder(id) },
              { icon: FileText, label: 'Rename', onSelect: rename },
              { icon: Trash2, label: 'Delete folder', danger: true, separatorBefore: true, onSelect: () => ws.deleteFolder(id) },
            ]}
          />
          <button type="button" onClick={() => ws.createPage(id)} className="flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-line-strong/60 hover:text-muted" aria-label="New page in folder"><Plus size={15} /></button>
        </span>
      </div>
      {folder.expanded && (
        <div role="group">
          {folder.documentIds.map((docId) => <DocumentRow key={docId} id={docId} depth={depth + 1} />)}
          {folder.children.map((childId) => <FolderRow key={childId} id={childId} depth={depth + 1} />)}
        </div>
      )}
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
