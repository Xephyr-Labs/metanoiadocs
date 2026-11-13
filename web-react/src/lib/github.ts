export interface GitHubLink {
  id: string;
  url: string;
  owner: string;
  repo: string;
  kind: 'issue' | 'pull';
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged' | 'draft';
  reviews: null | { approved: number; changesRequested: number; requested: number; partial: boolean };
  refreshedAt: string;
}

async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method, credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}). Try again.`);
  return data;
}
const base = (id: string) => `/tasks/${encodeURIComponent(id)}/github`;
export const githubApi = {
  list: (taskId: string) => request<GitHubLink[]>(base(taskId)),
  link: (taskId: string, url: string) => request<GitHubLink>(base(taskId), 'POST', { url }),
  refresh: (taskId: string, id: string) => request<GitHubLink>(`${base(taskId)}/${encodeURIComponent(id)}/refresh`, 'POST'),
  remove: (taskId: string, id: string) => request<{ ok: true }>(`${base(taskId)}/${encodeURIComponent(id)}`, 'DELETE'),
};
