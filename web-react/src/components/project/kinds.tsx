import { createContext, useContext, type ReactNode } from 'react';
import type { TaskKindRow } from '../../lib/tasksApi';

/**
 * The open project's task types.
 *
 * Every card, row and gantt bar draws a type chip, so the alternative is
 * threading one list through five view components that otherwise take only
 * tasks. Empty until the fetch lands — a chip with no row simply doesn't draw.
 */
const KindsContext = createContext<TaskKindRow[]>([]);

export function KindsProvider({ kinds, children }: { kinds: TaskKindRow[]; children: ReactNode }) {
  return <KindsContext.Provider value={kinds}>{children}</KindsContext.Provider>;
}

export const useKinds = () => useContext(KindsContext);

/** The row for a task's `kind`, or undefined while the list is still loading. */
export const useKind = (key: string) => useKinds().find((k) => k.key === key);
