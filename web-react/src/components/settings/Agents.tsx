/* Workspace agents: saved Ask AI requests that run by themselves.
 * states: loading · AI not set up · empty · expanded (edit + recent runs) ·
 *         running · failed run · confirming delete
 * Laid out like Webhooks: a row per agent, its status dot the last run.
 */
import { useEffect, useMemo, useState } from 'react';
import { Bot, ChevronRight, Loader2, Play, Plus } from 'lucide-react';
import { cn } from '../../lib/cn';
import { docsApi, type AgentInput, type AgentRow, type AgentRunRow, type AgentTrigger, type FolderRow, type SkillRow } from '../../lib/docsApi';
import { spacesApi, type SpaceRow } from '../../lib/spacesApi';
import { relativeTime } from '../../lib/time';
import { toast } from '../../lib/toast';
import { useWorkspace } from '../../store/workspace';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { field } from '../ui/styles';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mondays and Fridays at 09:00", "Every day at 07:30", "When a page in Specs changes". */
export function describeTrigger(t: AgentTrigger, placeName?: string): string {
  if (t.kind === 'schedule') {
    const days = t.days.length === 0 || t.days.length === 7 ? 'Every day' : t.days.map((d) => DAYS[d]).join(', ');
    return `${days} at ${t.time}`;
  }
  if (t.kind === 'page_changed') return `When a page in ${placeName || 'a folder'} changes`;
  return 'Run by hand';
}

function StatusDot({ status }: { status?: AgentRunRow['status'] | null }) {
  return (
    <span
      aria-hidden
      className={cn(
        'h-1.5 w-1.5 shrink-0 rounded-full',
        !status ? 'ring-1 ring-line-strong' : status === 'failed' ? 'bg-danger-strong' : status === 'running' ? 'bg-accent animate-pulse' : 'bg-accent-strong',
      )}
    />
  );
}

const TRIGGER_LABEL: Record<AgentRunRow['trigger_kind'], string> = {
  schedule: 'Scheduled', page_changed: 'Page changed', manual: 'Run by hand', agent: 'Called by AI',
};

function Runs({ id, reload }: { id: string; reload: number }) {
  const [rows, setRows] = useState<AgentRunRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => docsApi.agentRuns(id).then((r) => { if (alive) setRows(r); }).catch(() => { if (alive) setRows([]); });
    load();
    // A run started here finishes on the server; look again while one is going.
    const t = window.setInterval(load, 3000);
    return () => { alive = false; window.clearInterval(t); };
  }, [id, reload]);
  if (rows === null) return <p className="py-2 text-2xs text-faint">Loading…</p>;
  if (!rows.length) return <p className="py-2 text-2xs text-faint">Not run yet.</p>;
  return (
    <ul className="space-y-1.5 py-1">
      {rows.map((r) => (
        <li key={r.id} className="text-2xs">
          <details>
            <summary className="flex cursor-pointer items-center gap-2 tabular-nums">
              <StatusDot status={r.status} />
              <span className="text-muted">{TRIGGER_LABEL[r.trigger_kind] ?? r.trigger_kind}</span>
              <span className="text-faint">{r.status === 'running' ? 'running…' : r.status}{r.tool_calls.length ? ` · ${r.tool_calls.length} tool calls` : ''}</span>
              <span className="ml-auto shrink-0 text-faint">{relativeTime(r.started_at)}</span>
            </summary>
            <div className="mt-1 space-y-1 pl-3.5">
              {r.error && <p className="text-danger-strong">{r.error}</p>}
              {r.tool_calls.map((c, i) => (
                <p key={i} className="font-mono text-faint">{c.name}{c.hint ? ` · ${c.hint}` : ''}{c.error ? ` — ${c.error}` : ''}</p>
              ))}
              {r.output && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 text-xs text-ink">{r.output}</pre>}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

function AgentEditor({ agent, aiReady, folders, spaces, skills, onChanged }: {
  agent: AgentRow; aiReady: boolean; folders: FolderRow[]; spaces: SpaceRow[]; skills: SkillRow[]; onChanged: () => void;
}) {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AgentInput & { trigger: AgentTrigger }>(() => ({
    name: agent.name, instructions: agent.instructions, trigger: agent.trigger, targetDocId: agent.target_doc_id,
    outputMode: agent.output_mode, skillIds: agent.skills.map((k) => k.id),
  }));
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pages = useMemo(
    () => Object.values(ws.pages).filter((p) => p.kind === 'doc').sort((a, b) => a.title.localeCompare(b.title)),
    [ws.pages],
  );
  // A skill edited since it was attached: runs still use the attached copy
  // until the owner has looked and taken the new one.
  const stale = agent.skills.filter((k) => {
    const now = skills.find((x) => x.id === k.id);
    return now && new Date(now.updated_at) > new Date(k.updated_at);
  });
  const t = draft.trigger;
  const placeName = t.kind === 'page_changed'
    ? folders.find((f) => f.id === t.folderId)?.name ?? spaces.find((s) => s.id === t.spaceId)?.name
    : undefined;
  const setTrigger = (kind: AgentTrigger['kind']) => setDraft((d) => ({
    ...d,
    trigger: kind === 'schedule' ? { kind, time: '09:00', days: [1] }
      : kind === 'page_changed' ? { kind, ...(folders[0] ? { folderId: folders[0].id } : spaces[0] ? { spaceId: spaces[0].id } : {}) }
        : { kind },
  }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Attached skills keep their copies (the server re-copies only on refreshSkills).
      await docsApi.patchAgent(agent.id, draft);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the agent.');
    } finally { setSaving(false); }
  };
  const run = async () => {
    setRunning(true);
    try {
      await docsApi.runAgent(agent.id);
      setRan((n) => n + 1);
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not run the agent');
    } finally { setRunning(false); }
  };

  return (
    <div className="py-3">
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <ChevronRight size={14} className={cn('shrink-0 text-faint transition-transform duration-120', open && 'rotate-90')} />
          <StatusDot status={agent.last_run?.status} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{agent.name}</span>
            <span className="block truncate text-xs text-faint">
              {describeTrigger(agent.trigger, placeName)}
              {agent.target_title ? ` · into ${agent.target_title}` : ''}
              {agent.last_run ? ` · last run ${relativeTime(agent.last_run.started_at)}` : ' · never run'}
            </span>
            {agent.last_run?.status === 'failed' && (
              <span className="block truncate text-xs text-danger-strong">{agent.last_run.error}</span>
            )}
          </span>
        </button>
        <Switch
          on={agent.enabled}
          label={`${agent.name} on`}
          onChange={async (v) => { await docsApi.patchAgent(agent.id, { enabled: v }).catch(() => toast('Could not save that')); onChanged(); }}
        />
      </div>

      {open && (
        <div className="mt-3 space-y-3 pl-[26px]">
          <label className="block">
            <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-faint">Name</span>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={cn(field, 'w-full')} />
          </label>
          <label className="block">
            <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-faint">Instructions</span>
            <textarea
              value={draft.instructions}
              onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
              rows={5}
              placeholder="Summarise the open risks across the Roadmap folder, newest first."
              className={cn(field, 'h-auto w-full py-2 leading-relaxed')}
            />
          </label>

          <div>
            <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-faint">When it runs</span>
            <select value={t.kind} onChange={(e) => setTrigger(e.target.value as AgentTrigger['kind'])} className={cn(field, 'w-full')}>
              <option value="manual">Only when I run it</option>
              <option value="schedule">On a schedule</option>
              <option value="page_changed">When a page changes</option>
            </select>
            {t.kind === 'schedule' && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {DAYS.map((d, i) => {
                  const on = t.days.includes(i);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setDraft({ ...draft, trigger: { ...t, days: on ? t.days.filter((x) => x !== i) : [...t.days, i].sort() } })}
                      className={cn('h-7 rounded-md px-2 text-xs font-medium transition-colors duration-120', on ? 'bg-accent-soft text-accent-strong' : 'text-muted hover:bg-hover')}
                    >
                      {d}
                    </button>
                  );
                })}
                <input type="time" value={t.time} onChange={(e) => setDraft({ ...draft, trigger: { ...t, time: e.target.value } })} className={cn(field, 'ml-1 w-32')} aria-label="Time" />
                <span className="w-full text-2xs text-faint">No days ticked means every day. Your own time zone.</span>
              </div>
            )}
            {t.kind === 'page_changed' && (
              <>
                <select
                  value={t.folderId ? `f:${t.folderId}` : t.spaceId ? `s:${t.spaceId}` : ''}
                  onChange={(e) => {
                    const [k, id] = [e.target.value.slice(0, 1), e.target.value.slice(2)];
                    setDraft({ ...draft, trigger: k === 'f' ? { kind: 'page_changed', folderId: id } : { kind: 'page_changed', spaceId: id } });
                  }}
                  className={cn(field, 'mt-2 w-full')}
                  aria-label="Where to watch"
                >
                  {folders.length > 0 && (
                    <optgroup label="Folders">
                      {folders.map((f) => <option key={f.id} value={`f:${f.id}`}>{f.name}</option>)}
                    </optgroup>
                  )}
                  <optgroup label="Spaces">
                    {spaces.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.name}</option>)}
                  </optgroup>
                </select>
                <span className="mt-1 block text-2xs text-faint">Runs once editing has stopped for 10 minutes. Its own suggestions never set it off.</span>
              </>
            )}
          </div>

          <div className="grid gap-2 min-[600px]:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-faint">Answer goes to</span>
              <select value={draft.targetDocId ?? ''} onChange={(e) => setDraft({ ...draft, targetDocId: e.target.value || null })} className={cn(field, 'w-full')}>
                <option value="">Only the run log</option>
                {draft.targetDocId && !pages.some((p) => p.id === draft.targetDocId) && (
                  <option value={draft.targetDocId}>{agent.target_title ?? 'Current page'}</option>
                )}
                {pages.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.title}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-faint">As</span>
              <select
                value={draft.outputMode}
                disabled={!draft.targetDocId}
                onChange={(e) => setDraft({ ...draft, outputMode: e.target.value as 'suggest' | 'comment' })}
                className={cn(field, 'w-full')}
              >
                <option value="suggest">A suggested edit</option>
                <option value="comment">A comment</option>
              </select>
            </label>
          </div>

          {skills.length > 0 && (
            <div>
              <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-faint">Skills</span>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {skills.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-xs text-muted" title={s.description}>
                    <input
                      type="checkbox"
                      checked={!!draft.skillIds?.includes(s.id)}
                      onChange={(e) => setDraft({ ...draft, skillIds: e.target.checked ? [...(draft.skillIds ?? []), s.id] : (draft.skillIds ?? []).filter((x) => x !== s.id) })}
                      className="h-3.5 w-3.5 accent-[var(--accent)]"
                    />
                    <span className="font-mono">/{s.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {stale.length > 0 && (
            <div className="rounded-lg border border-line bg-surface p-2.5 text-xs text-muted">
              <p>
                {stale.map((k) => <span key={k.id} className="font-mono text-ink">/{k.name} </span>)}
                {stale.length === 1 ? 'was' : 'were'} edited since you attached {stale.length === 1 ? 'it' : 'them'}.
                This agent still runs the version you attached — review the change under Settings → Skills.
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="mt-1.5"
                onClick={async () => {
                  await docsApi.patchAgent(agent.id, { skillIds: agent.skills.map((k) => k.id), refreshSkills: true }).catch((e) => toast(e.message));
                  onChanged();
                }}
              >
                Use the new version
              </Button>
            </div>
          )}
          {error && <p className="text-xs text-danger-strong">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" disabled={saving} onClick={save} leftIcon={saving ? <Loader2 size={14} className="animate-spin" /> : undefined}>
              Save
            </Button>
            <Button size="sm" variant="ghost" disabled={running || !aiReady} onClick={run}
              leftIcon={running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}>
              Run now
            </Button>
            {confirming ? (
              <>
                <button onClick={() => setConfirming(false)} className="rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors duration-120 hover:bg-selected hover:text-ink">Cancel</button>
                <button onClick={async () => { await docsApi.deleteAgent(agent.id); onChanged(); }} className="rounded-md bg-danger px-2 py-1 text-xs font-medium text-white transition-[filter] duration-120 hover:brightness-95">Delete</button>
              </>
            ) : (
              <button onClick={() => setConfirming(true)} className="ml-auto rounded-md px-2 py-1 text-xs text-danger-strong transition-colors duration-120 hover:bg-danger-soft">Delete</button>
            )}
          </div>

          <div>
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">Recent runs</p>
            <Runs id={agent.id} reload={ran} />
          </div>
        </div>
      )}
    </div>
  );
}

export function Agents() {
  const [data, setData] = useState<{ aiReady: boolean; agents: AgentRow[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => docsApi.agents()
    .then((d) => { setData(d); setLoadError(null); })
    .catch((e) => { setData({ aiReady: false, agents: [] }); setLoadError(e instanceof Error ? e.message : 'Could not load agents.'); });
  useEffect(() => {
    load();
    docsApi.folders().then(setFolders).catch(() => {});
    spacesApi.list().then((s) => setSpaces(s.filter((x) => x.joined))).catch(() => {});
    docsApi.skills().then(setSkills).catch(() => {});
  }, []);

  const create = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      await docsApi.createAgent({ name: name.trim(), instructions: '', trigger: { kind: 'manual' } });
      setName('');
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create that agent');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold text-ink">Agents</h2>
      <p className="mb-5 text-sm text-muted">
        Instructions that run by themselves — on a schedule, when pages change, or when you press Run. An agent
        acts with exactly your access, and its edits arrive as suggestions for you to accept. Only you see your agents.
      </p>

      {data && !data.aiReady && (
        <p className="mb-4 rounded-lg border border-line bg-surface p-3 text-sm text-muted">
          AI is not set up for this workspace, so agents cannot run. An admin turns it on in Settings → AI.
        </p>
      )}

      <div className="border-b border-line pb-3">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="Weekly risk summary"
            className={cn(field, 'flex-1')}
            aria-label="New agent name"
          />
          <Button variant="primary" size="sm" onClick={create} disabled={busy}
            leftIcon={busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}>
            Add
          </Button>
        </div>
      </div>

      <div className="divide-y divide-line">
        {data === null ? (
          <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin text-faint" /></div>
        ) : loadError ? (
          <p className="py-8 text-center text-sm text-danger-strong">{loadError}</p>
        ) : data.agents.length === 0 ? (
          <p className="flex flex-col items-center gap-2 py-8 text-center text-sm text-faint">
            <Bot size={20} className="opacity-60" />
            No agents yet.
          </p>
        ) : data.agents.map((a) => (
          <AgentEditor key={a.id} agent={a} aiReady={data.aiReady} folders={folders} spaces={spaces} skills={skills} onChanged={load} />
        ))}
      </div>
    </div>
  );
}
