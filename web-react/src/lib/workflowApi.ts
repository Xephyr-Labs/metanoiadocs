export async function workflowRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: 'include', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not complete this request. Try again.');
  return data;
}
