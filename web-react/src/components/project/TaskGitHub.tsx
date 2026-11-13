import { useEffect, useRef, useState } from 'react';
import { Github, GitPullRequest, CircleDot, RefreshCw, X } from 'lucide-react';
import { githubApi, type GitHubLink } from '../../lib/github';
import { relativeTime } from '../../lib/time';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { field } from '../ui/styles';

/** A task's linked engineering work. Fetches only when explicitly linked/refreshed. */
export function TaskGitHub({ taskId }: { taskId: string }) {
  const [links, setLinks] = useState<GitHubLink[]>([]);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(taskId);
  current.current = taskId;
  const load = () => {
    setLoading(true); setError(null);
    return githubApi.list(taskId)
      .then((rows) => { if (current.current === taskId) setLinks(rows); })
      .catch((e) => { if (current.current === taskId) setError(e.message); })
      .finally(() => { if (current.current === taskId) setLoading(false); });
  };
  useEffect(() => { setLinks([]); setUrl(''); setBusy(null); void load(); }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { current.current = ''; }, []);
  const act = async (id: string, run: () => Promise<GitHubLink | void>) => {
    setBusy(id); setError(null);
    try {
      const link = await run();
      if (current.current !== taskId) return;
      if (link) setLinks((rows) => rows.some((r) => r.id === link.id) ? rows.map((r) => r.id === link.id ? link : r) : [...rows, link]);
      else setLinks((rows) => rows.filter((r) => r.id !== id));
      if (id === 'new') setUrl('');
    } catch (e) { if (current.current === taskId) setError(e instanceof Error ? e.message : 'Could not update the GitHub link. Try again.'); }
    finally { if (current.current === taskId) setBusy(null); }
  };
  return (
    <section className="border-t border-line px-4 py-4" aria-label="GitHub">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-ink"><Github size={15} className="text-muted" />GitHub</h3>
      {loading ? <p role="status" className="py-2 text-xs text-muted">Loading linked work…</p> : (
        <>
          {links.length === 0 && !error && <p className="mb-3 text-xs leading-relaxed text-muted">Connect an issue or pull request to keep its status beside the task.</p>}
          <ul className="mb-3 space-y-3">
            {links.map((link) => (
              <li key={link.id} className="flex min-w-0 items-start gap-2">
                {link.kind === 'pull' ? <GitPullRequest size={15} className="mt-0.5 shrink-0 text-muted" /> : <CircleDot size={15} className="mt-0.5 shrink-0 text-muted" />}
                <div className="min-w-0 flex-1">
                  <a href={link.url} target="_blank" rel="noreferrer" className="block break-words text-sm font-medium text-ink underline-offset-2 hover:underline">{link.title}</a>
                  <p className="mt-0.5 break-words text-xs text-muted">{link.owner}/{link.repo} #{link.number} · {link.state}</p>
                  {link.reviews && <p className="mt-1 text-xs leading-relaxed text-muted">
                    {link.reviews.partial ? 'First 100 reviews: ' : 'Submitted reviews: '}
                    {link.reviews.approved} approved · {link.reviews.changesRequested} changes requested
                    {link.reviews.requested > 0 && ` · ${link.reviews.requested} awaiting review`}
                  </p>}
                  <p className="mt-1 text-2xs text-faint">Checked {relativeTime(link.refreshedAt)}</p>
                </div>
                <IconButton size="sm" icon={<RefreshCw size={14} />} label={`Refresh ${link.owner}/${link.repo} #${link.number}`} disabled={!!busy} onClick={() => void act(link.id, () => githubApi.refresh(taskId, link.id))} />
                <IconButton size="sm" icon={<X size={14} />} label={`Remove link to #${link.number}`} disabled={!!busy} onClick={() => void act(link.id, async () => { await githubApi.remove(taskId, link.id); })} />
              </li>
            ))}
          </ul>
          <form onSubmit={(e) => { e.preventDefault(); if (url.trim() && !busy) void act('new', () => githubApi.link(taskId, url.trim())); }} className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 basis-48 text-xs text-muted">
              Issue or pull request URL
              <input type="url" required value={url} disabled={!!busy} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/team/repo/pull/42" className={`${field} mt-1 w-full`} />
            </label>
            <Button size="sm" type="submit" disabled={!url.trim() || !!busy}>{busy === 'new' ? 'Linking…' : 'Link'}</Button>
          </form>
        </>
      )}
      {error && <div role="alert" className="mt-2 text-xs leading-relaxed text-danger-strong">{error}{loading ? null : <button type="button" onClick={() => void load()} className="ml-2 underline underline-offset-2">Reload links</button>}</div>}
    </section>
  );
}
