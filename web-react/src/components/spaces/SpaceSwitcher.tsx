import { Info, LayoutGrid, LogOut, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { SpaceMenuIcon } from '../../hooks/useMoveToSpace';
import { spacesApi, type SpaceRow } from '../../lib/spacesApi';
import { toast } from '../../lib/toast';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import { Menu, type MenuItem } from '../ui/Menu';
import { BrowseSpaces } from './BrowseSpaces';
import { SpaceDialog } from './SpaceDialog';

/** The space you are in, or null while no spaces have loaded. */
export function useCurrentSpace(): SpaceRow | null {
  const ws = useWorkspace();
  return ws.spaces.find((sp) => sp.id === ws.currentSpaceId) ?? null;
}

/**
 * The space switcher's menu, Notion-workspace style: your spaces with a tick on
 * the current one, Browse and New, then the current space's own actions, then
 * `extra`. One component, so the sidebar's and the phone bar's never drift.
 */
export function SpaceSwitcher({ trigger, extra = [], fallbackLabel, width = 248 }: {
  trigger: ReactElement;
  extra?: MenuItem[];
  /** The one row shown while no spaces have loaded. */
  fallbackLabel: string;
  width?: number;
}) {
  const ws = useWorkspace();
  const auth = useAuth();
  const space = useCurrentSpace();
  const [browseOpen, setBrowseOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const joined = ws.spaces.filter((sp) => sp.joined);

  const switchTo = (id: string) => {
    if (id === ws.currentSpaceId) return;
    ws.switchSpace(id);
    // From a page, folder or database, land on the new space's Home: staying
    // there would pull you straight back into the old space. Home, Docs and
    // Tasks follow the space, so they stay put.
    if (ws.view !== 'home' && ws.view !== 'docs' && ws.view !== 'tasks') ws.openHome();
  };
  const canManage = !!space && (space.created_by === auth.user?.id || auth.user?.role === 'admin');
  const deleteSpace = async () => {
    if (!space || !window.confirm(`Delete the space "${space.name}"?`)) return;
    try {
      await spacesApi.remove(space.id);
    } catch (e) {
      // The server says why: the default space, or one that still holds things.
      toast(e instanceof Error ? e.message : 'Could not delete that space.');
      return;
    }
    await ws.refreshSpaces();
    ws.openHome();
    toast(`Deleted the space ${space.name}.`);
  };

  const items: MenuItem[] = [
    ...(joined.length ? joined.map((sp) => ({
      icon: SpaceMenuIcon(sp),
      label: sp.name,
      checked: sp.id === ws.currentSpaceId,
      onSelect: () => switchTo(sp.id),
    })) : [{ label: fallbackLabel }]),
    ...(ws.spaces.length ? [
      { icon: LayoutGrid, label: 'Browse spaces', separatorBefore: true, onSelect: () => setBrowseOpen(true) },
      { icon: Plus, label: 'New space', onSelect: () => setCreating(true) },
    ] : []),
    ...(space ? [
      { icon: Info, label: 'Space overview', separatorBefore: true, onSelect: () => ws.openSpace(space.id) },
      { icon: Pencil, label: 'Edit space', onSelect: () => setEditing(true) },
      // Your only space cannot be left (the server refuses): you would be left
      // in none, with nothing to show.
      ...(joined.length > 1 ? [{ icon: LogOut, label: `Leave ${space.name}`, onSelect: () => { void ws.leaveSpace(space.id).then(ws.openHome); } }] : []),
      ...(canManage && !space.is_default
        ? [{ icon: Trash2, label: 'Delete space', danger: true, onSelect: () => { void deleteSpace(); } }]
        : []),
    ] : []),
    ...extra,
  ];

  return (
    <>
      <Menu width={width} items={items} trigger={trigger} />
      <BrowseSpaces open={browseOpen} onOpenChange={setBrowseOpen} />
      <SpaceDialog open={creating} onOpenChange={setCreating} />
      {space && <SpaceDialog open={editing} onOpenChange={setEditing} space={space} />}
    </>
  );
}
