import { useEffect, useState } from 'react';
import { workflowRequest } from '../../lib/workflowApi';
import { field } from '../ui/styles';
import { FileText, Copy, Check, ArrowUpRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { MakeTasksDialog } from '../editor/MakeTasksDialog';
import { SuggestTasksDialog } from '../editor/SuggestTasksDialog';

export function MeetingFollowthrough({ docId }: { docId: string }) {
  const [recap, setRecap] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [tasks, setTasks] = useState(false);
  const [suggest, setSuggest] = useState(false);
  useEffect(() => { setRecap(null); setSourceUrl(null); setError(''); setCopied(false); setTasks(false); setSuggest(false); }, [docId]);
  async function review() {
    setBusy(true); setError(''); setCopied(false);
    try { const result = await workflowRequest<{ markdown: string; sourceUrl: string }>(`/docs/${encodeURIComponent(docId)}/meeting-recap`, {}); setRecap(result.markdown); setSourceUrl(result.sourceUrl); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load recap.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 border-t border-line pt-5" aria-label="Meeting follow-through">
    <h3 className="flex items-center gap-2 text-sm font-semibold text-ink"><FileText size={16} className="text-muted" />Follow through</h3>
    <p className="max-w-prose text-sm leading-relaxed text-muted">Review your private notes, turn action items into tasks, then copy an edited recap to share.</p>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="primary" leftIcon={<ArrowUpRight size={14} />} disabled={busy} onClick={() => void review()}>{busy ? 'Loading…' : 'Review recap'}</Button><Button size="sm" onClick={() => setTasks(true)}>Make tasks from to-dos</Button><Button size="sm" onClick={() => setSuggest(true)}>Suggest tasks with AI</Button></div>
    {error && <p role="alert" className="text-xs text-danger-strong">{error}</p>}
    {recap !== null && <div className="space-y-3 rounded-lg bg-surface p-4">{sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-accent-strong underline underline-offset-2">Open source notes</a>}<label className="block text-xs text-muted">Recap to copy<textarea value={recap} onChange={e => { setRecap(e.target.value); setCopied(false); }} rows={8} className={`${field} mt-2 h-auto min-h-56 resize-y bg-canvas p-3 leading-relaxed`} /></label><Button size="sm" leftIcon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={async () => { try { await navigator.clipboard.writeText(recap); setCopied(true); } catch { setError('Could not copy. Select the recap text and copy it manually.'); } }}>{copied ? 'Copied' : 'Copy recap'}</Button><p className="text-xs text-muted">Edits here affect this copy. Check private details before sharing.</p></div>}
    <MakeTasksDialog docId={docId} open={tasks} onOpenChange={setTasks} />
    <SuggestTasksDialog docId={docId} open={suggest} onOpenChange={setSuggest} />
  </section>;
}
