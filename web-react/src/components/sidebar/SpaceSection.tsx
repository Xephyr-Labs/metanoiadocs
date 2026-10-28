import { KanbanSquare, Plus, Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { nestByParent } from '../../lib/pageTree';
import { type SpaceRow } from '../../lib/spacesApi';
import { tasksApi, type ProjectMode, type ProjectRow } from '../../lib/tasksApi';
import { toast } from '../../lib/toast';
import type { RailSection } from '../../lib/sidebarPrefs';
import { useWorkspace } from '../../store/workspace';
import { Menu } from '../ui/Menu';
import { rowAction } from '../ui/styles';
import { FolderTree } from './FolderTree';
import { Capped, CollapsibleSection, DocRow, FavoriteFolderRow, ProjectRows, SectionLabel } from './Sidebar';

const emptyRow =
  'mt-0.5 flex h-7 coarse:h-11 w-full items-center gap-2 rounded-md px-2 text-sm text-muted transition-colors duration-120 hover:bg-hover hover:text-ink';

/**
 * The space you are in, as the sidebar draws it: the same Pinned, Projects,
 * Folders and Designs blocks it has always drawn, cut to this space. There is
 * no header: the switcher at the top of the sidebar names the space and holds
 * its menu, as a Notion workspace's does.
 *
 * The database naming input lives here, one per space: `namingParent` is which
 * row shows it — undefined = none, null = a new top-level database in this
 * space, a string = a new sub-database of that project id.
 */
export function SpaceSection({ space, shows, collapsed, onToggle }: {
  space: SpaceRow;
  shows: (s: RailSection) => boolean;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
}) {
  const ws = useWorkspace();
  const tree = ws.spaceTrees.get(space.id);
  const [namingParent, setNamingParent] = useState<string | null | undefined>(undefined);
  const [namingMode, setNamingMode] = useState<ProjectMode>('tasks');
  // '' is the stand-in section shown when no spaces loaded: nothing to send
  // as a space, so the server picks the default, and no menu or drag.
  const sid = space.id || undefined;

  // Same rules as groupBySpace: a project whose space is unknown sits in the
  // default one. Nested once here so an archived parent leaves its children
  // at the top rather than hiding them.
  const projectTree = useMemo(() => {
    const known = new Set(ws.spaces.map((s) => s.id));
    const mine = ws.projects.filter((p) => (p.space_id && known.has(p.space_id) ? p.space_id === space.id : space.is_default));
    return { count: mine.length, ...nestByParent(mine.map((p) => ({ id: p.id, parentId: p.parent_id }))) };
  }, [ws.projects, ws.spaces, space.id, space.is_default]);

  const startNaming = (parentId: string | null, mode: ProjectMode) => {
    setNamingMode(mode);
    setNamingParent(parentId);
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

  const pinned = (tree?.pinnedFolderIds.length ?? 0) + (tree?.pinnedIds.length ?? 0);

  return (
    <section className="mb-5">
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
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center"><Plus size={14} /></span> New project
                </button>
              )}
            </div>
          )}

          {shows('docs') && tree && (
            <div className="mb-3">
              <SectionLabel
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
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center"><Plus size={14} /></span> New folder
                </button>
              )}
            </div>
          )}

          {/* Designs are documents that open on the canvas, so they also show
              up in folders and search — this is the shortcut to them. */}
          {shows('designs') && tree && (
            <div>
              <SectionLabel
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
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center"><Plus size={14} /></span> New design
                </button>
              )}
            </div>
          )}
        </div>
    </section>
  );
}
