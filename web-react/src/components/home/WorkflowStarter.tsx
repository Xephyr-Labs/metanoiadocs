import { useState } from 'react';
import { useWorkspace } from '../../store/workspace';
import { workflowRequest } from '../../lib/workflowApi';
import { Button } from '../ui/Button';

export function WorkflowStarter() {
  const ws = useWorkspace();
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
  return <section className="mb-8 border-b border-line pb-6" aria-label="Start a workflow">
    <h2 className="text-sm font-semibold text-ink">Start a workflow</h2>
    <p className="mt-1 text-sm text-muted">Create a connected brief, project and three milestones, with private meeting notes.</p>
    <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void create(); }}>
      <label className="flex flex-col gap-1 text-xs text-muted">Starting point<select value={template} onChange={e => setTemplate(e.target.value)} disabled={busy} className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm text-ink"><option value="launch">Product launch</option><option value="onboarding">Team onboarding</option></select></label>
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">Project name<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} disabled={busy} placeholder="e.g. Spring release" className="h-9 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink" /></label>
      <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create workflow'}</Button>
    </form>
    {error && <p role="alert" className="mt-2 text-sm text-danger-strong">{error}</p>}
    {created && <div role="status" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted"><span>Workflow ready.</span><Button onClick={() => ws.openProject(created.projectId)}>Open project</Button><Button onClick={() => ws.select(created.briefId)}>Open brief</Button><Button onClick={() => ws.select(created.notesId)}>Open private notes</Button></div>}
  </section>;
}
