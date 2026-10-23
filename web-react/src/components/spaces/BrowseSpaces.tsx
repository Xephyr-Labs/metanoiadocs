import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useWorkspace } from '../../store/workspace';
import { Button } from '../ui/Button';
import { Modal, ModalBody } from '../ui/Modal';
import { SpaceDialog } from './SpaceDialog';

/**
 * Every space, joined or not. Joining puts a space in your sidebar; leaving is
 * done from the space's own menu there, so this list only ever adds.
 */
export function BrowseSpaces({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const ws = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Member counts change as other people join; read them fresh on open.
  const { refreshSpaces } = ws;
  useEffect(() => {
    if (open) refreshSpaces();
  }, [open, refreshSpaces]);

  const join = async (id: string) => {
    setBusy(id);
    await ws.joinSpace(id);
    setBusy(null);
  };

  return (
    <>
      <Modal open={open} onOpenChange={onOpenChange} title="Spaces" width={480} className="max-h-[80vh]">
        <ModalBody>
          <ul className="space-y-px">
            {ws.spaces.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-hover">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center text-lg leading-none" aria-hidden>{s.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{s.name}</p>
                  <p className="truncate text-2xs text-faint">
                    {s.member_count} member{s.member_count === 1 ? '' : 's'}
                    {s.description ? ` · ${s.description}` : ''}
                  </p>
                </div>
                {s.joined ? (
                  <span className="shrink-0 px-2.5 text-sm text-muted">Joined</span>
                ) : (
                  <Button size="sm" disabled={busy === s.id} onClick={() => { join(s.id); }} aria-label={`Join ${s.name}`}>
                    Join
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </ModalBody>
        <div className="flex shrink-0 justify-end border-t border-line px-3 py-2.5">
          <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreating(true)}>
            New space
          </Button>
        </div>
      </Modal>
      <SpaceDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
