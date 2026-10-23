import { Shuffle } from 'lucide-react';
import { createElement } from 'react';
import type { MenuItem } from '../components/ui/Menu';
import { moveSummary, spaceOf } from '../lib/spaceTree';
import { spacesApi, type MoveType, type SpaceRow } from '../lib/spacesApi';
import { toast } from '../lib/toast';
import { useWorkspace } from '../store/workspace';

/** A space's emoji in a menu row's icon slot. */
export const EmojiIcon = (emoji: string) =>
  function Emoji({ className }: { size?: number | string; strokeWidth?: number | string; className?: string }) {
    return createElement('span', { 'aria-hidden': true, className: `w-4 text-center text-sm leading-none ${className ?? ''}` }, emoji);
  };

/**
 * Asks before anything changes space, naming what comes along. A move carries
 * the whole tree, pages you cannot see included, so a bare "are you sure"
 * would hide the one thing worth knowing.
 */
export async function confirmSpaceMove(type: MoveType, id: string, space: SpaceRow): Promise<boolean> {
  let summary: string;
  try {
    summary = moveSummary(await spacesApi.movePreview(type, id, space.id));
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Could not move that.');
    return false;
  }
  return window.confirm(`Move to ${space.icon} ${space.name}?\n\n${summary}.`);
}

/**
 * For a drag or a "Move to" folder pick: true to go ahead. Same space (or no
 * spaces known) passes without asking; a different one asks first.
 */
export function okToCross(
  spaces: SpaceRow[], type: MoveType, id: string, from: string | null | undefined, to: string | null | undefined,
): Promise<boolean> {
  const a = spaceOf(from, spaces);
  const b = spaceOf(to, spaces);
  const target = spaces.find((s) => s.id === b);
  if (!target || a === b) return Promise.resolve(true);
  return confirmSpaceMove(type, id, target);
}

/**
 * The "Move to space →" submenu for a page, folder or database: every other
 * space, joined ones first (the order `spaces` already has). Null when there is
 * no other space, so callers can spread it in. Not a hook, so a list of rows
 * (the sidebar's databases) can build one per row.
 */
export function moveToSpaceItem(
  ws: Pick<ReturnType<typeof useWorkspace>, 'spaces' | 'moveToSpace'>,
  type: MoveType, id: string | null | undefined, current: string | null | undefined,
): MenuItem | null {
  if (!id) return null;
  const here = spaceOf(current, ws.spaces);
  const targets = ws.spaces.filter((s) => s.id !== here);
  if (!targets.length) return null;
  return {
    icon: Shuffle,
    label: 'Move to space',
    items: targets.map((s) => ({
      icon: EmojiIcon(s.icon),
      label: s.name,
      onSelect: () => {
        void (async () => {
          if (await confirmSpaceMove(type, id, s)) await ws.moveToSpace(type, id, s.id);
        })();
      },
    })),
  };
}

export function useMoveToSpace(type: MoveType, id: string | null | undefined, current: string | null | undefined): MenuItem | null {
  return moveToSpaceItem(useWorkspace(), type, id, current);
}
