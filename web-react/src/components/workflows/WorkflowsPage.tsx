import { useEffect, useState } from 'react';
import { ArrowRight, Zap } from 'lucide-react';
import { useWorkspace } from '../../store/workspace';
import { tasksApi, type AutomationRow } from '../../lib/tasksApi';
import { WorkflowStarter } from '../home/WorkflowStarter';

export function WorkflowsPage() {
  const ws = useWorkspace();
  const [groups, setGroups] = useState<{ id: string; name: string; rules: AutomationRow[] }[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setGroups(null); setFailed(false);
    Promise.all(ws.projects.map(async p => {
      try { return { id: p.id, name: p.name, rules: await tasksApi.automations(p.id), failed: false }; }
      catch { return { id: p.id, name: p.name, rules: [], failed: true }; }
    })).then(rows => { if (alive) { setGroups(rows.filter(r => r.rules.length)); setFailed(rows.some(r => r.failed)); } });
    return () => { alive = false; };
  }, [ws.projects]);
  const rules = groups?.flatMap(g => g.rules) ?? [];
  const active = rules.filter(r => r.active).length;
  return <div className="scrollarea h-full overflow-y-auto bg-canvas"><main className="mx-auto max-w-[1000px] px-5 py-8 sm:px-10 sm:py-12">
    <header className="mb-9"><h1 className="font-display text-2xl font-semibold text-ink sm:text-4xl">Workflows</h1><p className="mt-2 max-w-prose text-sm leading-relaxed text-muted">Start connected projects and see the automations your team has set up.</p></header>
    <WorkflowStarter />
    <section aria-label="Existing automations"><div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-base font-semibold text-ink">Existing automations</h2><p className="mt-1 text-sm text-muted">Rules across your projects</p></div>{groups && <div className="text-sm tabular-nums text-muted"><span className="font-semibold text-accent-strong">{active}</span> active · {rules.length} total</div>}</div>
      {groups && rules.length > 0 && <div className="mb-6 h-2 overflow-hidden rounded-full bg-surface" role="img" aria-label={`${active} of ${rules.length} automations active`}><div className="h-full rounded-full bg-accent-fill" style={{ width: `${active / rules.length * 100}%` }} /></div>}
      {failed && <p role="alert" className="mb-4 text-sm text-danger-strong">Some project automations could not be loaded.</p>}
      {!groups ? <p role="status" className="py-8 text-sm text-muted">Loading workflows…</p> : groups.length === 0 ? <div className="rounded-lg bg-surface p-6 text-sm text-muted"><Zap size={20} className="mb-3 text-accent-strong" />No automations yet. Create them from a project’s Automations menu.</div> : groups.map(group => <div key={group.id} className="border-t border-line py-5"><button onClick={() => ws.openProject(group.id)} className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink hover:text-accent-strong">{group.name}<ArrowRight size={14} /></button><ul className="space-y-2">{group.rules.map(rule => <li key={rule.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-surface px-4 py-3"><span className={`h-2 w-2 rounded-full ${rule.active ? 'bg-accent-fill' : 'bg-line-strong'}`} /><span className="min-w-0 flex-1 text-sm font-medium text-ink">{rule.name}</span><span className="text-xs text-muted">{rule.trigger_kind === 'manual' ? 'Manual' : rule.trigger_kind} · {rule.actions.length} actions · {rule.active ? 'Active' : 'Paused'}</span></li>)}</ul></div>)}
    </section>
  </main></div>;
}
