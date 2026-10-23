// Client for the spaces endpoints. Same-origin and cookie-authed, matching docsApi.
export interface SpaceRow {
  id: string;
  name: string;
  icon: string;
  description: string;
  is_default: boolean;
  created_by: string | null;
  member_count: number;
  /** Whether you are a member. Only joined spaces show in your sidebar. */
  joined: boolean;
  position: number;
}

/** How much a move carries along: the item plus its whole tree, as counts. */
export interface MoveSet {
  docs: number;
  folders: number;
  projects: number;
}
export interface MovePreview extends MoveSet {
  /** `docs` counts only pages you can see; true when more move with them. */
  hidden: boolean;
  /** The move would carry a database's own page and is refused; absent from older servers. */
  owned?: boolean;
}

export interface SpaceMember {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  kind: string | null;
}
export type MoveType = 'doc' | 'folder' | 'project';

async function req(path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: opts.body ? { 'Content-Type': 'application/json', ...(opts.headers || {}) } : opts.headers,
    ...opts,
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const d = await res.json();
      if (d?.error) msg = d.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

const post = (path: string, body?: unknown) =>
  req(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

const MOVE_PATH: Record<MoveType, string> = { doc: 'docs', folder: 'folders', project: 'projects' };

export const spacesApi = {
  list: (): Promise<SpaceRow[]> => req('/spaces'),
  create: (b: { name: string; icon?: string; description?: string; memberIds?: string[] }): Promise<SpaceRow> =>
    post('/spaces', b),
  patch: (id: string, b: { name?: string; icon?: string; description?: string }): Promise<SpaceRow> =>
    req(`/spaces/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  /** 409 with a message when the space is the default or still holds items. */
  remove: (id: string) => req(`/spaces/${id}`, { method: 'DELETE' }),
  join: (id: string) => post(`/spaces/${id}/join`),
  leave: (id: string) => post(`/spaces/${id}/leave`),
  addMembers: (id: string, userIds: string[]) => post(`/spaces/${id}/members`, { userIds }),
  members: (id: string): Promise<SpaceMember[]> => req(`/spaces/${id}/members`),
  /** `ids` is every space in its new order. */
  reorder: (ids: string[]) => req('/spaces/order', { method: 'PUT', body: JSON.stringify({ ids }) }),
  /** Dry run of a move: what travels with it, and how much of it you cannot see. */
  movePreview: (type: MoveType, id: string, spaceId: string): Promise<MovePreview> =>
    req(`/move-preview?${new URLSearchParams({ type, id, spaceId })}`),
  /** Moves the item and its whole tree. 409 "Move the database instead" for a task page. */
  moveToSpace: (type: MoveType, id: string, spaceId: string): Promise<MoveSet> =>
    post(`/${MOVE_PATH[type]}/${id}/space`, { spaceId }),
};
