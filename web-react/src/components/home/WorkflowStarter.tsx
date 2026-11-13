import { useState } from 'react';
import { ArrowUpRight, ChevronDown, Layers3, Check } from 'lucide-react';
import { field, selectField } from '../ui/styles';
import { useWorkspace } from '../../store/workspace';
import { workflowRequest } from '../../lib/workflowApi';
import { Button } from '../ui/Button';

export function WorkflowStarter() {
  const ws = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const [template, setTemplate] = useState('launch');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ projectId: string; briefId: string; notesId: string } | null>(null);
  async function create() {
    setBusy(true); setError(''); setCreated(null);
    try {
      const result = await workflowRequest<{ projectId: string; briefId: string; notesId: string }>(`/workflow-templates/${template}/use`, { name, spaceId: ws.currentSpaceId || undefined });
      setCreated(result);
      await ws.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create workflow.'); }
    finally { setBusy(false); }
  }
  return (
    <section className="mb-10 rounded-xl bg-surface p-4 sm:p-5" aria-label="Start a workflow">
      <button type="button" aria-expanded={expanded} aria-controls="workflow-setup" onClick={() => setExpanded(!expanded)} className="group flex w-full items-center gap-3 text-left">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-canvas text-muted"><Layers3 size={18} strokeWidth={1.6} /></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">Start a workflow</span><span className="mt-0.5 block text-xs leading-relaxed text-muted">A connected starting point for your next launch or new teammate.</span></span>
        <ChevronDown size={16} className={`shrink-0 text-muted transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && <div id="workflow-setup" className="mt-5 border-t border-line pt-5">
        <p className="mb-4 max-w-prose text-sm leading-relaxed text-muted">Create a brief, project and three milestones, with private meeting notes.</p>
        <form className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] sm:items-end" onSubmit={e => { e.preventDefault(); void create(); }}>
          <label className="flex min-w-0 flex-col gap-2 text-xs font-medium text-muted">Starting point<select value={template} onChange={e => setTemplate(e.target.value)} disabled={busy} className={selectField}><option value="launch">Product launch</option><option value="onboarding">Team onboarding</option></select></label>
          <label className="flex min-w-0 flex-col gap-2 text-xs font-medium text-muted">Project name<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} disabled={busy} placeholder="e.g. Spring release" className={field} /></label>
          <Button variant="primary" type="submit" disabled={busy || !name.trim()} leftIcon={<ArrowUpRight size={15} />}>{busy ? 'Creating…' : 'Create workflow'}</Button>
        </form>
        {error && <p role="alert" className="mt-3 text-sm text-danger-strong">{error}</p>}
        {created && <div role="status" className="mt-5 border-t border-line pt-4"><p className="mb-3 flex items-center gap-2 text-sm font-medium text-ink"><Check size={16} className="text-ok" />Workflow ready</p><div className="flex flex-wrap gap-2"><Button onClick={() => ws.openProject(created.projectId)}>Open project</Button><Button onClick={() => ws.select(created.briefId)}>Open brief</Button><Button onClick={() => ws.select(created.notesId)}>Open private notes</Button></div></div>}
      </div>}
    </section>
  );
}
