import type { Workspace } from '../lib/types';

// The only non-server-backed value: the workspace label shown in the switcher.
// (There is no multi-workspace concept in the backend yet.)
export const workspaces: Workspace[] = [{ id: 'ws-metanoia', name: 'Metanoia', icon: '◆' }];
