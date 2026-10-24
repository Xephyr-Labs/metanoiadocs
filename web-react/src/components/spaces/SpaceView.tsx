import { Folder, Layers } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { spaceOf } from '../../lib/spaceTree';
import { spacesApi, type SpaceMember } from '../../lib/spacesApi';
import { useWorkspace } from '../../store/workspace';
import { DocRow } from '../docs/AllDocsView';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { SpaceAvatar } from './SpaceAvatar';
import { EmptyState } from '../ui/EmptyState';

const heading = 'mb-2 text-2xs font-semibold uppercase tracking-wide text-faint';

/**
 * A space's overview at /s/<id>: what it is for, who is in it, what the team
 * pinned there, and what changed lately. Reads the store for pages and
 * folders (they already carry their space); only the members are fetched.
 */
export function SpaceView() {
  const ws = useWorkspace();
  const space = ws.spaces.find((s) => s.id === ws.activeSpaceId);
  const [members, setMembers] = useState<SpaceMember[] | null>(null);
  const [busy, setBusy] = useState(false);

  const id = space?.id;
  const joined = space?.joined;
  // Re-read after Join/Leave: the list is the visible proof it worked.
  useEffect(() => {
    if (!id) return;
    let alive = true;
    spacesApi.members(id).then((m) => { if (alive) setMembers(m); }).catch(() => { if (alive) setMembers([]); });
    return () => { alive = false; };
  }, [id, joined]);

  const { pinnedPages, pinnedFolders, recent } = useMemo(() => {
    const here = (sid: string | null) => !!id && spaceOf(sid, ws.spaces) === id;
    const pages = Object.values(ws.pages).filter((p) => here(p.spaceId) && p.kind !== 'task');
    return {
      pinnedPages: pages.filter((p) => p.pinned),
      pinnedFolders: Object.values(ws.folders).filter((f) => here(f.spaceId) && f.pinned),
      recent: [...pages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10),
    };
  }, [ws.pages, ws.folders, ws.spaces, id]);

  if (!space) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <EmptyState icon={Layers} title={ws.spaces.length ? 'This space is gone' : 'Loading…'} hint={ws.spaces.length ? 'It may have been deleted.' : undefined} />
      </div>
    );
  }

  const toggle = async () => {
    setBusy(true);
    await (space.joined ? ws.leaveSpace(space.id) : ws.joinSpace(space.id));
    setBusy(false);
  };

  return (
    <div className="scrollarea h-full overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-[1100px] px-6 py-8 md:px-10">
        <header className="mb-8 flex items-start gap-4">
          <SpaceAvatar space={space} size={40} className="rounded-lg" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-semibold leading-7 tracking-[-0.03em] text-ink md:text-3xl">{space.name}</h1>
            <p className="mt-1 text-sm text-muted">{space.description || 'No description yet.'}</p>
          </div>
          <Button size="sm" variant={space.joined ? 'secondary' : 'primary'} disabled={busy} onClick={() => { void toggle(); }}>
            {space.joined ? 'Leave space' : 'Join'}
          </Button>
        </header>

        <div className="grid gap-8 md:grid-cols-[1fr_240px]">
          <div className="min-w-0 space-y-8">
            {(pinnedPages.length > 0 || pinnedFolders.length > 0) && (
              <section>
                <h2 className={heading}>Pinned</h2>
                <div className="rounded-lg border border-line">
                  {pinnedFolders.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => ws.openFolder(f.id)}
                      className="flex w-full items-center gap-2.5 border-b border-line px-3 py-2.5 text-left text-sm text-ink transition-colors duration-120 last:border-0 hover:bg-hover"
                    >
                      <Folder size={16} className="shrink-0 text-faint" />
                      <span className="truncate">{f.name}</span>
                    </button>
                  ))}
                  {pinnedPages.map((p) => <DocRow key={p.id} page={p} />)}
                </div>
              </section>
            )}
            <section>
              <h2 className={heading}>Recent pages</h2>
              {recent.length ? (
                <div className="rounded-lg border border-line">
                  {recent.map((p) => <DocRow key={p.id} page={p} />)}
                </div>
              ) : (
                <p className="text-sm text-faint">Nothing here yet.</p>
              )}
            </section>
          </div>

          <aside>
            <h2 className={heading}>Members{members ? ` · ${members.length}` : ''}</h2>
            <ul className="space-y-1">
              {(members ?? []).map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-sm text-ink">
                  <Avatar name={m.name || m.username || '?'} size={22} />
                  <span className="truncate">{m.name || m.username}</span>
                </li>
              ))}
              {members && !members.length && <li className="text-sm text-faint">Nobody has joined.</li>}
            </ul>
          </aside>
        </div>
      </div>
    </div>
  );
}
