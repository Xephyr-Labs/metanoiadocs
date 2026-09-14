// Who's in the open doc right now, fed by the Yjs awareness states the sync
// provider already broadcasts. mountEditor attaches the live awareness here;
// the TopBar subscribes to render the Google-Docs-style avatar stack.
import { useEffect, useState } from 'react';

export interface PresenceUser {
  clientId: number;
  name: string;
  color: string;
}

// Minimal structural type — avoids importing y-protocols just for typings.
interface AwarenessLike {
  clientID: number;
  getStates(): Map<number, Record<string, { name?: string; color?: string } | undefined>>;
  on(event: 'change', cb: () => void): void;
  off(event: 'change', cb: () => void): void;
  emit(event: 'change', args: [{ added: number[]; updated: number[]; removed: number[] }, string]): void;
}

/**
 * Make the remote-caret painter notice the people who were already here.
 *
 * BlockSuite's StoreSelectionExtension fills `remoteSelections` only from
 * inside an awareness `change` handler — it never reads the states that were
 * already present when it subscribed. Awareness syncs before the editor
 * finishes mounting, so opening a document where someone is sitting with their
 * cursor parked painted nothing: their avatar appeared in the top bar, their
 * caret did not, and it stayed that way until they happened to move.
 *
 * Re-announcing the clients we can already see runs that handler once against
 * the state we already hold. It is the exact event shape y-protocols emits
 * (`[{added, updated, removed}, origin]`), so nothing downstream can tell this
 * from a real one — and with no remote clients it does nothing at all.
 *
 * Also worth running on reconnect, which lands a fresh set of states the same
 * way a first connection does.
 */
export function primeRemoteSelections(awareness: AwarenessLike): void {
  const others = [...awareness.getStates().keys()].filter((id) => id !== awareness.clientID);
  if (!others.length) return;
  awareness.emit('change', [{ added: others, updated: [], removed: [] }, 'local']);
}

type Listener = (users: PresenceUser[]) => void;
const listeners = new Set<Listener>();
let current: PresenceUser[] = [];
let detachPrev: (() => void) | null = null;

function publish(users: PresenceUser[]) {
  current = users;
  listeners.forEach((l) => l(users));
}

/** Called by mountEditor. Returns a detach fn; a new doc replaces the old feed. */
export function attachPresence(awareness: AwarenessLike): () => void {
  detachPrev?.();
  const read = () => {
    const users: PresenceUser[] = [];
    awareness.getStates().forEach((state, clientId) => {
      const u = state?.user;
      if (clientId !== awareness.clientID && u?.name) {
        users.push({ clientId, name: u.name, color: u.color || '#2383e2' });
      }
    });
    users.sort((a, b) => a.clientId - b.clientId);
    publish(users);
  };
  awareness.on('change', read);
  read();
  const detach = () => {
    awareness.off('change', read);
    if (detachPrev === detach) {
      detachPrev = null;
      publish([]);
    }
  };
  detachPrev = detach;
  return detach;
}

/** Everyone else currently connected to the open doc (empty outside docs). */
export function usePresence(): PresenceUser[] {
  const [users, setUsers] = useState(current);
  useEffect(() => {
    listeners.add(setUsers);
    setUsers(current);
    return () => { listeners.delete(setUsers); };
  }, []);
  return users;
}
