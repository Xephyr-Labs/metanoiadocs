/* Hallmark · component: quick actions + agent runs on one task · genre: modern-minimal
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * theme: project tokens (index.css)
 * states: no agents · idle · queued · running · done · failed · cancelled
 * note: a queued run is the interesting state — the work is real but nothing is
 *       happening yet, and only the runner on someone's machine can change that.
 */
import { useEffect, useState } from 'react';
import { Bot, Loader2, Play, Zap } from 'lucide-react';
import { cn } from '../../lib/cn';
import { relativeTime } from '../../lib/time';
import { toast } from '../../lib/toast';
import {
  tasksApi,
  type AgentRow,
  type AgentRunRow,
  type AutomationRow,
  type RunStatus,
} from '../../lib/tasksApi';
import { Button } from '../ui/Button';
import { SearchSelect } from '../ui/SearchSelect';

/** How often an open panel re-reads a run in flight. Only while something is
 *  actually queued or running — a finished list never polls. */
const POLL_MS = 5_000;

const STATUS_TEXT: Record<RunStatus, string> = {
  queued: 'waiting for a runner',
  running: 'running',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
};

function RunRow({ run, onCancel }: { run: AgentRunRow; onCancel: () => void }) {
  const open = run.status === 'queued' || run.status === 'running';
  return (
    <li className="rounded-md px-1.5 py-1.5 text-xs hover:bg-hover">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            run.status === 'running' ? 'animate-pulse bg-accent'
              : run.status === 'done' ? 'bg-accent-strong'
              : run.status === 'failed' ? 'bg-danger-strong'
              : 'ring-1 ring-line-strong',
          )}
        />
        <span className="min-w-0 flex-1 truncate text-ink">
          {run.agent_name || 'Agent'}
          <span className="text-faint"> · {STATUS_TEXT[run.status]}</span>
        </span>
        <span className="shrink-0 text-faint">{relativeTime(run.finished_at ?? run.created_at)}</span>
        {open && (
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded px-1.5 py-0.5 text-2xs text-danger-strong transition-colors duration-120 hover:bg-danger-soft"
          >
            Cancel
          </button>
        )}
      </div>
      {run.status === 'failed' && run.error && (
        <p className="mt-1 pl-[14px] text-2xs leading-4 text-danger-strong">{run.error.slice(0, 300)}</p>
      )}
    </li>
  );
}

/**
 * The two ways a task gets handed to something other than a person: a quick
 * action, which is an automation nobody automated, and an agent run, which is
 * work put on a queue for a runner on someone's own machine.
 *
 * They share a section because they answer the same question — "can this be
 * done without me doing it" — and because a task with neither shows nothing at
 * all rather than two empty headings.
 */
export function TaskAgents({ taskId, projectId, onChanged }: {
  taskId: string;
  projectId: string;
  onChanged: () => void;
}) {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [actions, setActions] = useState<AutomationRow[]>([]);
  const [runs, setRuns] = useState<AgentRunRow[]>([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);

  const loadRuns = () => tasksApi.taskRuns(taskId).then(setRuns).catch(() => {});

  useEffect(() => {
    tasksApi.agents().then(setAgents).catch(() => setAgents([]));
  }, []);

  useEffect(() => {
    tasksApi.automations(projectId)
      .then((rows) => setActions(rows.filter((r) => r.active && r.trigger_kind === 'manual')))
      .catch(() => setActions([]));
  }, [projectId]);

  useEffect(() => { loadRuns(); }, [taskId]);

  // Poll only while there is something to hear about. A run is finished by a
  // machine somewhere else, so nothing else tells this panel it changed.
  const waiting = runs.some((r) => r.status === 'queued' || r.status === 'running');
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(loadRuns, POLL_MS);
    return () => clearInterval(t);
  }, [waiting, taskId]);

  if (!agents.length && !actions.length && !runs.length) return null;

  const hand = async () => {
    if (!pick || busy) return;
    setBusy(true);
    try {
      await tasksApi.startRun(taskId, pick);
      await loadRuns();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not queue that run');
    } finally { setBusy(false); }
  };

  return (
    <section className="px-4 py-3">
      <h3 className="mb-1.5 text-2xs font-semibold uppercase text-muted">Actions</h3>

      {actions.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {actions.map((a) => (
            <Button
              key={a.id}
              size="sm"
              variant="subtle"
              leftIcon={<Zap size={14} />}
              onClick={async () => {
                await tasksApi.runAutomation(taskId, a.id).catch(() => toast('That action did not run'));
                onChanged();
              }}
            >
              {a.name || 'Quick action'}
            </Button>
          ))}
        </div>
      )}

      {agents.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Bot size={14} className="shrink-0 text-faint" />
          {/* The same picker the rest of this panel chooses people with. A
              native select here would be the one control in the peek the
              platform draws, at its own size, with its own chevron. */}
          <SearchSelect
            variant="field"
            label="Agent"
            value={pick || null}
            placeholder="Hand this to…"
            empty="No agent accounts yet."
            options={agents.map((a) => ({ value: a.id, label: a.name || a.email }))}
            onChange={setPick}
            className="h-7 flex-1 text-xs"
          />
          {/* An icon at rest as well as while running — a button that grows
              when you press it is a button that moves out from under you. */}
          <Button size="sm" variant="secondary" disabled={!pick || busy}
            leftIcon={busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            onClick={hand}>
            Run
          </Button>
        </div>
      )}

      {runs.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {runs.map((r) => (
            <RunRow
              key={r.id}
              run={r}
              onCancel={async () => { await tasksApi.cancelRun(r.id).catch(() => {}); loadRuns(); }}
            />
          ))}
        </ul>
      )}

      {/* Guarded on agents: a workspace with quick actions but no agent
          accounts would otherwise be told how agents reply. */}
      {agents.length > 0 && (
        <p className="mt-1.5 text-2xs leading-4 text-faint">
          An agent's reply lands as a comment on this page. Assigning a task to an agent
          account queues a run too — this is for handing one over without assigning it.
        </p>
      )}
    </section>
  );
}
