// Typed client for the MetanoiaDocs server. Same-origin (vite proxies /api),
// so the session cookie authenticates every call.

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

export interface TagRow {
  id: string;
  name: string;
  color: string;
  count?: number;
}

export interface DocRow {
  id: string;
  title: string;
  icon: string;
  parent_id: string | null;
  folder_id: string | null;
  position: number;
  updated_at: string;
  role: string;
  visibility: 'team' | 'private';
  shared: boolean;
  favorite: boolean;
  tags: TagRow[];
}

export interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  color: string;
  position: number;
  created_by: string | null;
  created_at: string;
  document_count: number;
  folder_count: number;
}

export function normalizeFolderRows(value: unknown): FolderRow[] {
  return Array.isArray(value) ? value as FolderRow[] : [];
}

export interface AccessRow {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  username: string;
  role?: string;
}

export interface CommentRow {
  id: string;
  block_id: string | null;
  quote: string | null;
  body: string;
  author_name: string;
  parent_id: string | null;
  resolved: boolean;
  created_at: string;
}

export interface VersionRow {
  id: string;
  label: string | null;
  created_at: string;
  author: string | null;
  author_email: string | null;
}

export interface SearchRow {
  id: string;
  title: string;
  snippet: string;
}

/** A page that @-references the one being viewed. */
export interface BacklinkRow {
  id: string;
  title: string;
  icon: string;
  updated_at: string;
}

export interface InboxRow {
  id: string;
  kind: 'mention' | 'comment';
  actor_name: string;
  body: string;
  read_at: string | null;
  created_at: string;
  doc_id: string;
  doc_title: string;
  doc_icon: string;
}

export interface Intelligence {
  summary: string;
  keyphrases: string[];
  related: { id: string; title: string; icon: string; score: number }[];
  tasks: { text: string; checked: boolean }[];
  decisions: { text: string; unresolved: boolean }[];
  risks: { text: string }[];
  deadlines: { text: string; date: string | null }[];
  suggestedTags: { name: string; exists: boolean; tagId?: string }[];
  suggestedLinks: { id: string; title: string; count: number }[];
  changedDeps: { id: string; title: string; updated_at: string }[];
  duplicateOf: { id: string; title: string; similarity: number } | null;
  stale: { months: number } | null;
  collaborators: { id: string; name: string }[];
  templates: { id: string; title: string }[];
  terminology: { term: string; suggest: string; count: number }[];
}

export interface MyDocRow {
  id: string;
  title: string;
  icon: string;
  updated_at: string;
}

export const docsApi = {
  list: (): Promise<DocRow[]> => req('/docs'),
  myDocs: (offset: number, limit = 8): Promise<{ total: number; rows: MyDocRow[] }> =>
    req(`/docs/mine?offset=${offset}&limit=${limit}`),
  folders: async (): Promise<FolderRow[]> => normalizeFolderRows(await req('/folders')),
  createFolder: (body: { name: string; parentId?: string | null }): Promise<FolderRow> =>
    req('/folders', { method: 'POST', body: JSON.stringify(body) }),
  patchFolder: (id: string, body: { name?: string; color?: string; parentId?: string | null }) =>
    req(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeFolder: (id: string) => req(`/folders/${id}`, { method: 'DELETE' }),
  create: (body: { title?: string; icon?: string; folderId?: string | null }): Promise<DocRow> =>
    req('/docs', { method: 'POST', body: JSON.stringify(body) }),
  patch: (id: string, body: { title?: string; icon?: string; folderId?: string | null }) =>
    req(`/docs/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string) => req(`/docs/${id}`, { method: 'DELETE' }),
  trash: (): Promise<{ id: string; title: string; icon: string; deleted_at: string }[]> => req('/docs/trash'),
  backlinks: (id: string): Promise<BacklinkRow[]> => req(`/docs/${id}/backlinks`),
  restore: (id: string) => req(`/docs/${id}/restore`, { method: 'POST' }),
  /** Destroy a trashed page. Owner or admin only; there is no undo. */
  destroy: (id: string) => req(`/docs/${id}/permanent`, { method: 'DELETE' }),
  inbox: (): Promise<InboxRow[]> => req('/inbox'),
  unreadCount: (): Promise<{ count: number }> => req('/notifications/unread-count'),
  markNotificationsRead: () => req('/notifications/read', { method: 'POST' }),

  tags: (): Promise<TagRow[]> => req('/tags'),
  createTag: (name: string, color?: string): Promise<TagRow> =>
    req('/tags', { method: 'POST', body: JSON.stringify({ name, color }) }),
  deleteTag: (id: string) => req(`/tags/${id}`, { method: 'DELETE' }),
  addDocTag: (docId: string, body: { tagId?: string; name?: string; color?: string }): Promise<TagRow> =>
    req(`/docs/${docId}/tags`, { method: 'POST', body: JSON.stringify(body) }),
  removeDocTag: (docId: string, tagId: string) =>
    req(`/docs/${docId}/tags/${tagId}`, { method: 'DELETE' }),
  favorite: (id: string, favorite: boolean) =>
    req(`/docs/${id}/favorite`, { method: 'PUT', body: JSON.stringify({ favorite }) }),
  setVisibility: (id: string, visibility: 'team' | 'private') =>
    req(`/docs/${id}/visibility`, { method: 'PUT', body: JSON.stringify({ visibility }) }),
  access: (id: string): Promise<AccessRow[]> => req(`/docs/${id}/access`),
  shareWith: (id: string, email: string) =>
    req(`/docs/${id}/share`, { method: 'POST', body: JSON.stringify({ email }) }),
  users: (): Promise<UserRow[]> => req('/users'),
  updateMe: (name: string) => req('/me', { method: 'PATCH', body: JSON.stringify({ name }) }),
  listTokens: (): Promise<{ id: string; name: string; created_at: string; last_used_at: string | null }[]> => req('/tokens'),
  createToken: (name: string): Promise<{ id: string; name: string; token: string }> =>
    req('/tokens', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteToken: (id: string) => req(`/tokens/${id}`, { method: 'DELETE' }),
  setUserRole: (id: string, role: 'admin' | 'collaborator') =>
    req(`/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removeUser: (id: string) => req(`/users/${id}`, { method: 'DELETE' }),

  publicGet: (id: string): Promise<{ token: string | null }> => req(`/docs/${id}/public`),
  publicEnable: (id: string): Promise<{ token: string }> => req(`/docs/${id}/public`, { method: 'POST' }),
  publicDisable: (id: string) => req(`/docs/${id}/public`, { method: 'DELETE' }),

  search: (q: string): Promise<SearchRow[]> => req(`/search?q=${encodeURIComponent(q)}`),
  intelligence: (id: string): Promise<Intelligence> => req(`/docs/${id}/intelligence`),

  comments: (id: string): Promise<CommentRow[]> => req(`/docs/${id}/comments`),
  addComment: (id: string, body: string, opts?: { parentId?: string; blockId?: string | null; quote?: string }) =>
    req(`/docs/${id}/comments`, { method: 'POST', body: JSON.stringify({ body, ...opts }) }),
  resolveComment: (cid: string, resolved: boolean) =>
    req(`/comments/${cid}/resolve`, { method: 'POST', body: JSON.stringify({ resolved }) }),
  deleteComment: (cid: string) => req(`/comments/${cid}`, { method: 'DELETE' }),

  versions: (id: string): Promise<VersionRow[]> => req(`/docs/${id}/versions`),
  snapshot: (id: string, label: string) =>
    req(`/docs/${id}/versions`, { method: 'POST', body: JSON.stringify({ label }) }),

  aiConfig: (): Promise<{ baseUrl: string; model: string; enabled: boolean; keySet: boolean }> =>
    req('/settings/ai'),
  saveAiConfig: (body: { baseUrl?: string; model?: string; enabled?: boolean; apiKey?: string }) =>
    req('/settings/ai', { method: 'PUT', body: JSON.stringify(body) }),
};

/** Stream an AI response (SSE over POST). Calls onDelta per token. */
export async function aiStream(
  body: { messages?: { role: string; content: string }[]; action?: string; prompt?: string; selection?: string },
  onDelta: (t: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/ai', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = 'AI request failed';
    try {
      const d = await res.json();
      if (d?.error) msg = d.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const p = JSON.parse(data);
        if (p.text) onDelta(p.text);
        if (p.error) throw new Error(p.error);
      } catch {
        /* ignore partial */
      }
    }
  }
}
