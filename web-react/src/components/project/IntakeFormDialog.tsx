/* Hallmark · component: intake-form settings · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: loading · off (no form yet) · on · hover · focus · saving ·
 *         error · copied · confirming (turn off / replace address)
 */
import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { tasksApi, type AskableProp, type FormField } from '../../lib/tasksApi';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { field } from '../ui/styles';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
}

const button =
  'h-7 shrink-0 rounded border border-line px-2.5 text-xs font-medium text-ink '
  + 'transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 '
  + 'focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50';

/**
 * A public link that writes instead of reads.
 *
 * Share links publish a page read-only, which covers "here is what we decided"
 * and nothing of "here is what I need". This is the other direction: a bug
 * report from a customer, a request from another team, an idea from someone
 * who will never have a seat.
 *
 * Off by default and off in one click, because the whole of what this does is
 * let strangers write to a board. The two dangerous actions — turning it off,
 * and replacing the address — both arm rather than asking in a second dialog:
 * each breaks a link people may already have, which is worth one deliberate
 * click and not a modal on top of a modal.
 */
export function IntakeFormDialog({ open, onOpenChange, projectId, projectName }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [intro, setIntro] = useState('');
  const [fields, setFields] = useState<FormField[]>([]);
  const [askable, setAskable] = useState<AskableProp[]>([]);
  const [state, setState] = useState<'loading' | 'idle' | 'working'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [arming, setArming] = useState<'off' | 'rotate' | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => { timers.current.forEach(window.clearTimeout); }, []);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };

  useEffect(() => {
    if (!open) return;
    setState('loading');
    setError(null);
    setArming(null);
    setCopied(false);
    let alive = true;
    tasksApi.form(projectId)
      .then((f) => {
        if (!alive) return;
        setUrl(f.url);
        setIntro(f.intro);
        setFields(f.fields ?? []);
        setAskable(f.askable ?? []);
        setState('idle');
      })
      .catch(() => { if (alive) { setError('Could not read this database’s form.'); setState('idle'); } });
    return () => { alive = false; };
  }, [open, projectId]);

  const save = async (b: { intro?: string; rotate?: boolean; fields?: FormField[] }) => {
    setState('working');
    setError(null);
    setArming(null);
    try {
      const f = await tasksApi.saveForm(projectId, b);
      setUrl(f.url);
      setIntro(f.intro);
      setFields(f.fields ?? []);
      setAskable(f.askable ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setState('idle');
    }
  };

  const close = async () => {
    setState('working');
    setError(null);
    setArming(null);
    try {
      await tasksApi.closeForm(projectId);
      setUrl(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn it off.');
    } finally {
      setState('idle');
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      later(() => setCopied(false), 1400);
    } catch {
      setError('Could not copy — select the address above instead.');
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Intake form" width={480} focusPanel>
      <div className="px-4 py-3.5">
        {state === 'loading' ? (
          <p className="py-6 text-center text-sm text-faint">Checking…</p>
        ) : !url ? (
          <>
            <p className="text-sm leading-6 text-muted">
              Publish a page that anyone can fill in. What they send arrives as a task in{' '}
              <span className="font-medium text-ink">{projectName}</span> — no account, no seat.
            </p>
            {/* Not buried in fine print: this is the whole of what the feature
                does, and it is the part worth reading twice. */}
            <p className="mt-2 text-2xs leading-4 text-faint">
              Anyone with the address can add a task. They cannot see the board, the other
              submissions, or anything else in the workspace.
            </p>
            <div className="mt-3.5 flex items-center gap-2">
              <Button variant="primary" size="sm" disabled={state === 'working'} onClick={() => void save({ intro: '' })}>
                {state === 'working' ? 'Opening…' : 'Open a form'}
              </Button>
              {state === 'working' && <Loader2 size={14} className="animate-spin text-faint" />}
            </div>
          </>
        ) : (
          <>
            <label className="mb-1.5 block text-2xs font-medium text-muted" htmlFor="form-url">Address</label>
            <div className="flex items-center gap-1.5">
              <input
                id="form-url"
                readOnly
                value={url}
                onFocus={(e) => e.target.select()}
                className="h-7 min-w-0 flex-1 rounded border border-line bg-surface px-2 font-mono text-3xs text-muted"
              />
              <button type="button" onClick={copy} className={button}>{copied ? 'Copied' : 'Copy'}</button>
              <a href={url} target="_blank" rel="noreferrer" className={cn(button, 'flex items-center gap-1')}>
                <ExternalLink size={12} /> Open
              </a>
            </div>

            <label className="mb-1.5 mt-3.5 block text-2xs font-medium text-muted" htmlFor="form-intro">
              What the form says above the fields
            </label>
            <textarea
              id="form-intro"
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              onBlur={() => { if (intro !== undefined) void save({ intro }); }}
              maxLength={500}
              rows={3}
              placeholder="Tell the team what you need. It lands on their board."
              className={cn(field, 'h-auto resize-y py-2 leading-5')}
            />
            <p className="mt-1 text-2xs text-faint">
              Left empty, the form uses that line. Saved when you click away.
            </p>

            <p className="mb-1.5 mt-3.5 text-2xs font-medium text-muted">What it asks for</p>
            <div className="rounded border border-line">
              <div className="flex items-center justify-between px-2.5 py-1.5 text-2xs text-faint">
                <span>Always asks for a headline, and optionally a name and an email.</span>
              </div>
              {askable.length === 0 ? (
                <p className="border-t border-line px-2.5 py-2 text-2xs text-faint">
                  This database has no properties a stranger could fill in yet. Add a text, select,
                  date, number or checkbox property and it will show up here.
                </p>
              ) : (
                <ul className="border-t border-line">
                  {askable.map((prop) => {
                    const on = fields.find((f) => f.id === prop.id);
                    const write = (next: FormField[]) => { setFields(next); void save({ fields: next }); };
                    return (
                      <li key={prop.id} className="flex items-center gap-2 border-b border-line px-2.5 py-1.5 last:border-b-0">
                        <input
                          id={`ff-${prop.id}`}
                          type="checkbox"
                          checked={!!on}
                          onChange={(e) => write(e.target.checked
                            ? [...fields, { id: prop.id, required: false }]
                            : fields.filter((f) => f.id !== prop.id))}
                          className="h-3.5 w-3.5 rounded border-line text-accent-fill focus:ring-2 focus:ring-accent"
                        />
                        <label htmlFor={`ff-${prop.id}`} className="min-w-0 flex-1 truncate text-xs text-ink">
                          {prop.label}
                          <span className="ml-1.5 text-3xs text-faint">{prop.type.replace('_', ' ')}</span>
                        </label>
                        <label className={cn('flex items-center gap-1 text-3xs', on ? 'text-muted' : 'text-faint')}>
                          <input
                            type="checkbox"
                            disabled={!on}
                            checked={on?.required === true}
                            onChange={(e) => write(fields.map((f) => (
                              f.id === prop.id ? { ...f, required: e.target.checked } : f
                            )))}
                            className="h-3.5 w-3.5 rounded border-line text-accent-fill focus:ring-2 focus:ring-accent disabled:opacity-40"
                          />
                          Needed
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <p className="mt-1 text-2xs text-faint">
              People, relations and files are not offered: answering any of those means knowing
              what is already in the workspace, which this link deliberately does not grant.
            </p>

            <div className="mt-3.5 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
              {arming === 'rotate' ? (
                <>
                  <span className="text-2xs text-muted">Everyone with the old address loses it.</span>
                  <button type="button" onClick={() => void save({ rotate: true })} className={cn(button, 'border-danger-strong text-danger-strong')}>
                    Replace it
                  </button>
                  <button type="button" onClick={() => setArming(null)} className={button}>Keep</button>
                </>
              ) : arming === 'off' ? (
                <>
                  <span className="text-2xs text-muted">The address stops working, and is not kept.</span>
                  <button type="button" onClick={() => void close()} className={cn(button, 'border-danger-strong text-danger-strong')}>
                    Turn it off
                  </button>
                  <button type="button" onClick={() => setArming(null)} className={button}>Cancel</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setArming('rotate')} className={cn(button, 'text-muted')}>New address</button>
                  <button type="button" onClick={() => setArming('off')} className={cn(button, 'ml-auto text-danger-strong')}>
                    Turn off the form
                  </button>
                </>
              )}
              {state === 'working' && <Loader2 size={14} className="animate-spin text-faint" />}
              {copied && <Check size={14} className="text-ok" />}
            </div>
          </>
        )}

        {error && <p role="alert" className="mt-2.5 text-2xs text-danger-strong">{error}</p>}
      </div>
    </Modal>
  );
}
