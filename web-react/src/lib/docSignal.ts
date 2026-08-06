import { useEffect, useState } from 'react';

// The editor saves on a debounce, and the intelligence layer recomputes on that
// save. The panel that shows those signals is a sibling of the editor in the
// tree, so there is no prop path between them — this is the one wire.
const listeners = new Set<() => void>();

/** Called by the editor after a successful text save. */
export function emitDocSaved() {
  for (const l of listeners) l();
}

/** A counter that increments on every save — use it as an effect dependency. */
export function useDocSaveTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    listeners.add(bump);
    return () => { listeners.delete(bump); };
  }, []);
  return tick;
}
