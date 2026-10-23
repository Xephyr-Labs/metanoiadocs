import { FilePlus, FolderPlus, Info, KanbanSquare, LogOut, MoreHorizontal, Pencil, Plus, Table2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { nestByParent } from '../../lib/pageTree';
import { placeAt } from '../../lib/reorder';
import { spacesApi, type SpaceRow } from '../../lib/spacesApi';
import { tasksApi, type ProjectMode, type ProjectRow } from '../../lib/tasksApi';
import { toast } from '../../lib/toast';
import type { RailSection } from '../../lib/sidebarPrefs';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import { Menu } from '../ui/Menu';
import { rowAction } from '../ui/styles';
import { SpaceDialog } from '../spaces/SpaceDialog';
import { FolderTree } from './FolderTree';
import { DOC_MIME, FOLDER_MIME, SPACE_MIME, dragSource, useRowDrop } from './rowDrag';
import { confirmSpaceMove } from '../../hooks/useMoveToSpace';
import { spaceOf } from '../../lib/spaceTree';
import { cn } from '../../lib/cn';
import { Capped, CollapsibleSection, DocRow, FavoriteFolderRow, ProjectRows, SectionLabel } from './Sidebar';

const openKey = (id: string) => `mn-space-open:${id}`;

/** Per browser, like the other sections' folds. Absent = open. */
function readOpen(id: string): boolean {
  try {
    return localStorage.getItem(openKey(id)) !== '0';
  } catch {
    return true;
  }
}

function writeOpen(id: string, open: boolean) {
  try {
    localStorage.setItem(openKey(id), open ? '1' : '0');
  } catch {
    /* private window — still folds, just unremembered */
  }
}

const emptyRow =
  'mt-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-faint hover:bg-hover hover:text-muted coarse:min-h-11';

/**
 * One joined space in the sidebar: its header (drag to reorder, `+` to make
 * something in it, `⋯` to edit or leave it) over the same Pinned, Projects,
 * Folders and Designs blocks the sidebar has always drawn, cut to this space.
 *
 * The database naming input lives here, one per space: `namingParent` is which
 * row shows it — undefined = none, null = a new top-level database in this
 * space, a string = a new sub-database of that project id.
 */
export function SpaceSection({ space, order, shows, collapsed, onToggle }: {
  space: SpaceRow;
  /** Every joined space id in sidebar order — reorder sends the whole list. */
  order: string[];
  shows: (s: RailSection) => boolean;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
}) {
  const ws = useWorkspace();
  const auth = useAuth();
  const tree = ws.spaceTrees.get(space.id);
  const [open, setOpen] = useState(() => readOpen(space.id));
  const [editing, setEditing] = useState(false);
  const [namingParent, setNamingParent] = useState<string | null | undefined>(undefined);
  const [namingMode, setNamingMode] = useState<ProjectMode>('tasks');
  const key = `space:${space.id}`;
  // '' is the stand-in section shown when no spaces loaded: nothing to send
  // as a space, so the server picks the default, and no menu or drag.
  const sid = space.id || undefined;

  // A header takes another header (reorder) or a page or folder row, which
  // moves that item's whole tree into this space, after asking.
  const drop = useRowDrop({
    accept: { [SPACE_MIME]: 'halves', [DOC_MIME]: 'whole', [FOLDER_MIME]: 'whole' },
    enabled: !!sid,
    onDrop: async (mime, draggedId, zone) => {
      if (mime === SPACE_MIME) {
        const next = placeAt(order, draggedId, space.id, zone === 'before' ? 'before' : 'after');
        if (next) ws.reorderSpaces(next);
        return;
      }
      const type = mime === DOC_MIME ? 'doc' : 'folder';
      const from = type === 'doc' ? ws.pages[draggedId]?.spaceId : ws.folders[draggedId]?.spaceId;
      if (spaceOf(from, ws.spaces) === space.id) return;
      if (await confirmSpaceMove(type, draggedId, space)) await ws.moveToSpace(type, draggedId, space.id);
    },
  });

  // Same rules as groupBySpace: a project whose space is unknown sits in the
  // default one. Nested once here so an archived parent leaves its children
  // at the top rather than hiding them.
  const projectTree = useMemo(() => {
    const known = new Set(ws.spaces.map((s) => s.id));
    const mine = ws.projects.filter((p) => (p.space_id && known.has(p.space_id) ? p.space_id === space.id : space.is_default));
    return { count: mine.length, ...nestByParent(mine.map((p) => ({ id: p.id, parentId: p.parent_id }))) };
  }, [ws.projects, ws.spaces, space.id, space.is_default]);

  const toggle = () => {
    setOpen((v) => {
      writeOpen(space.id, !v);
      return !v;
    });
  };

  const startNaming = (parentId: string | null, mode: ProjectMode) => {
    setNamingMode(mode);
    setNamingParent(parentId);
    if (!open) toggle();
  };
  const createProject = async (name: string) => {
    const p = await tasksApi.createProject({ name, parentId: namingParent ?? null, mode: namingMode, spaceId: sid });
    await ws.refreshProjects();
    setNamingParent(undefined);
    ws.openProject(p.id);
  };

  /** Switching mode hides fields, it never drops them: the task columns keep
   *  their values underneath, so this is reversible from the same menu. */
  const setProjectMode = async (project: ProjectRow, mode: ProjectMode) => {
    try {
      await tasksApi.patchProject(project.id, { mode });
    } catch {
      toast(`Could not change ${project.name}.`);
      return;
    }
    await ws.refreshProjects();
    toast(mode === 'data'
      ? `${project.name} is a data database. Its task fields are hidden, not deleted.`
      : `${project.name} is a task database again.`);
  };

  /** Archiving hides a database and its rows without destroying either, so the
   *  toast offers the way back rather than a confirmation before the fact. */
  const archiveProject = async (project: ProjectRow) => {
    try {
      await tasksApi.archiveProject(project.id);
    } catch {
      toast(`Could not archive ${project.name}.`);
      return;
    }
    if (ws.activeProjectId === project.id) ws.openHome();
    await ws.refreshProjects();
    toast(`Archived ${project.name}.`, {
      label: 'Undo',
      onSelect: () => {
        tasksApi
          .patchProject(project.id, { archived: false })
          .then(() => ws.refreshProjects())
          .catch(() => toast(`Could not restore ${project.name}.`));
      },
    });
  };

  const deleteSpace = async () => {
    if (!window.confirm(`Delete the space "${space.name}"?`)) return;
    try {
      await spacesApi.remove(space.id);
    } catch (e) {
      // The server says why: the default space, or one that still holds things.
      toast(e instanceof Error ? e.message : 'Could not delete that space.');
      return;
    }
    await ws.refreshSpaces();
    toast(`Deleted the space ${space.name}.`);
  };

  const canManage = space.created_by === auth.user?.id || auth.user?.role === 'admin';
  const pinned = (tree?.pinnedFolderIds.length ?? 0) + (tree?.pinnedIds.length ?? 0);
  const count = pinned + projectTree.count + (tree?.designIds.length ?? 0) + (tree?.folderRootIds.length ?? 0) + (tree?.unfiledIds.length ?? 0);

  return (
    <section className="mb-5">
      <CollapsibleSection
        sectionKey={key}
        label={`${space.icon} ${space.name}`}
        collapsed={open ? new Set() : new Set([key])}
        onToggle={toggle}
        count={count}
        headProps={sid
          ? { ...dragSource(SPACE_MIME, space.id), ...drop.props, className: cn('group/space rounded-md', drop.zone === 'inside' && 'bg-accent-soft') }
          : { className: 'group/space' }}
        dropZone={drop.zone}
        action={
          <span className="flex items-center gap-0.5 opacity-0 transition-opacity duration-120 focus-within:opacity-100 group-hover/space:opacity-100">
            {sid && <Menu
              align="end"
              trigger={<button type="button" className={rowAction} aria-label={`Actions for ${space.name}`}><MoreHorizontal size={14} /></button>}
              items={[
                { icon: Info, label: 'Open space page', onSelect: () => ws.openSpace(space.id) },
                { icon: Pencil, label: 'Edit space', onSelect: () => setEditing(true) },
                { icon: LogOut, label: 'Leave space', separatorBefore: true, onSelect: () => { ws.leaveSpace(space.id); } },
                ...(canManage && !space.is_default
                  ? [{ icon: Trash2, label: 'Delete space', danger: true, onSelect: () => { deleteSpace(); } }]
                  : []),
              ]}
            />}
            <Menu
              align="end"
              trigger={<button type="button" className={rowAction} aria-label={`New in ${space.name}`}><Plus size={14} /></button>}
              items={[
                { icon: FilePlus, label: 'Page', onSelect: () => { ws.createPage(null, sid); } },
                { icon: FolderPlus, label: 'Folder', onSelect: () => { ws.createFolder(null, sid); } },
                { icon: KanbanSquare, label: 'Database', onSelect: () => startNaming(null, 'tasks') },
              ]}
            />
          </span>
        }
      >
        <div>
          {shows('docs') && pinned > 0 && tree && (
            <div className="mb-3">
              <CollapsibleSection collapsed={collapsed} onToggle={onToggle} sectionKey="pinned" label="Pinned" count={pinned}>
                <div className="space-y-px">
                  <Capped>
                    {[...tree.pinnedFolderIds.map((id) => <FavoriteFolderRow key={`f${id}`} id={id} />),
                      ...tree.pinnedIds.map((id) => <DocRow key={id} id={id} />)]}
                  </Capped>
                </div>
              </CollapsibleSection>
            </div>
          )}

          {shows('projects') && (
            <div className="mb-3">
              <SectionLabel
                sectionKey="projects"
                action={
                  <Menu
                    align="end"
                    trigger={<button type="button" className={rowAction} aria-label={`New database in ${space.name}`}><Plus size={14} /></button>}
                    items={[
                      { icon: KanbanSquare, label: 'New database', onSelect: () => startNaming(null, 'tasks') },
                      { icon: Table2, label: 'New data database', onSelect: () => startNaming(null, 'data') },
                    ]}
                  />
                }
              >
                Projects
              </SectionLabel>
              {projectTree.count || namingParent !== undefined ? (
                <div className="space-y-px">
                  <ProjectRows
                    parentId={null}
                    depth={0}
                    roots={projectTree.roots}
                    childrenOf={projectTree.childrenOf}
                    namingParent={namingParent}
                    onNewUnder={startNaming}
                    onArchive={archiveProject}
                    onSetMode={setProjectMode}
                    onCommitName={createProject}
                    onCancelName={() => setNamingParent(undefined)}
                  />
                </div>
              ) : (
                <button onClick={() => startNaming(null, 'tasks')} className={emptyRow}>
                  <Plus size={14} /> New project
                </button>
              )}
            </div>
          )}

          {shows('docs') && tree && (
            <div className="mb-3">
              <SectionLabel
                sectionKey="folders"
                action={
                  <button type="button" onClick={() => ws.createFolder(null, sid)} className={rowAction} aria-label={`New folder in ${space.name}`}>
                    <Plus size={14} />
                  </button>
                }
              >
                Folders
              </SectionLabel>
              {tree.folderRootIds.length || tree.unfiledIds.length ? (
                <FolderTree roots={tree.folderRootIds} unfiled={tree.unfiledIds} />
              ) : (
                <button onClick={() => ws.createFolder(null, sid)} className={emptyRow}>
                  <Plus size={14} /> New folder
                </button>
              )}
            </div>
          )}

          {/* Designs are documents that open on the canvas, so they also show
              up in folders and search — this is the shortcut to them. */}
          {shows('designs') && tree && (
            <div>
              <SectionLabel
                sectionKey="designs"
                action={
                  <button type="button" onClick={() => { ws.createDesign(sid); }} className={rowAction} aria-label={`New design in ${space.name}`}>
                    <Plus size={14} />
                  </button>
                }
              >
                Designs
              </SectionLabel>
              {tree.designIds.length ? (
                <div className="space-y-px">{tree.designIds.map((id) => <DocRow key={id} id={id} />)}</div>
              ) : (
                <button onClick={() => { ws.createDesign(sid); }} className={emptyRow}>
                  <Plus size={14} /> New design
                </button>
              )}
            </div>
          )}
        </div>
      </CollapsibleSection>
      {sid && <SpaceDialog open={editing} onOpenChange={setEditing} space={space} />}
    </section>
  );
}
