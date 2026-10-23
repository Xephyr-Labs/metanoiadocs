import { useEffect, useState } from 'react';
import { docsApi, type UserRow } from '../../lib/docsApi';
import { spacesApi, type SpaceRow } from '../../lib/spacesApi';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import { Button } from '../ui/Button';
import { CheckList } from '../ui/CheckList';
import { Modal } from '../ui/Modal';
import { field } from '../ui/styles';

/**
 * Create a space, or edit one when `space` is given: name, icon, description,
 * and people to add. Adding is all there is — the server has no "remove a
 * member", and anyone can leave a space from its own menu.
 */
export function SpaceDialog({ open, onOpenChange, space }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space?: SpaceRow;
}) {
  const ws = useWorkspace();
  const auth = useAuth();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [description, setDescription] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset on every open, so a cancelled draft does not come back next time.
  useEffect(() => {
    if (!open) return;
    setName(space?.name ?? '');
    setIcon(space?.icon ?? '🗂️');
    setDescription(space?.description ?? '');
    setPeople([]);
    setError(null);
    docsApi.users().then(setUsers).catch(() => setUsers([]));
  }, [open, space]);

  const save = async () => {
    if (saving) return;
    if (!name.trim()) {
      setError('Give the space a name.');
      return;
    }
    setSaving(true);
    try {
      if (space) {
        await spacesApi.patch(space.id, { name, icon, description });
        if (people.length) await spacesApi.addMembers(space.id, people);
        await ws.refreshSpaces();
      } else {
        const row = await ws.createSpace({ name, icon, description, memberIds: people });
        if (!row) return; // createSpace has already said why
      }
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that space.');
    } finally {
      setSaving(false);
    }
  };

  const others = users.filter((u) => u.id !== auth.user?.id && u.kind !== 'agent');

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={space ? 'Edit space' : 'New space'} width={440}>
      <form
        className="space-y-3 px-4 py-3.5"
        onSubmit={(e) => { e.preventDefault(); void save(); }}
      >
        <div className="flex gap-2">
          <label className="w-16 shrink-0">
            <span className="mb-1 block text-2xs font-medium text-muted">Icon</span>
            <input value={icon} maxLength={16} onChange={(e) => setIcon(e.target.value)} className={`${field} text-center`} />
          </label>
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-2xs font-medium text-muted">Name</span>
            <input
              autoFocus
              value={name}
              maxLength={80}
              aria-invalid={error ? true : undefined}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              className={field}
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-2xs font-medium text-muted">Description</span>
          <textarea
            value={description}
            maxLength={500}
            rows={2}
            onChange={(e) => setDescription(e.target.value)}
            className={`${field} h-auto py-1.5`}
          />
        </label>
        <div>
          <span className="mb-1 block text-2xs font-medium text-muted">Add people</span>
          <CheckList
            className="w-full"
            options={others.map((u) => ({ value: u.id, label: u.name || u.username }))}
            chosen={people}
            onToggle={(id) => setPeople((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))}
            onClear={() => setPeople([])}
            empty="Nobody else here yet."
          />
        </div>
        {error && <p role="alert" className="text-2xs text-danger-strong">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" disabled={saving}>
            {space ? 'Save' : 'New space'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
