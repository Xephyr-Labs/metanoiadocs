/* Hallmark · component: public intake form · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: loading · closed (bad or revoked link) · default · hover · focus ·
 *         invalid (nothing typed) · sending · failed · sent
 * note: the one screen in this app seen by people who have no account, so it
 *       carries its own page chrome rather than the workspace shell.
 */
import { useEffect, useState } from 'react';
import { Check, FileWarning, Loader2, Send } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Logo } from '../brand/Logo';

interface Form {
  name: string;
  icon: string;
  intro: string | null;
}

const field =
  'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none '
  + 'transition-colors placeholder:text-faint hover:border-line-strong '
  + 'focus:border-accent focus:ring-2 focus:ring-accent-soft';

const label = 'mb-1.5 block text-2xs font-medium text-muted';

/**
 * Somewhere to send work from outside the workspace.
 *
 * Two fields and no account. A customer with a bug, another team with a
 * request, somebody who will never have a seat — today all of that arrives as
 * a chat message and is copied into a task by hand, if it is copied at all.
 *
 * Name and email are optional and say so. Making them required would be the
 * obvious thing and the wrong one: a report you can act on from someone who
 * would not leave their address is worth more than no report.
 *
 * What comes back is the task's key. Whoever filled this in has no account and
 * no board to open, so a number they can quote in a follow-up is the whole of
 * what a confirmation can usefully be.
 */
export function FormView({ token }: { token: string }) {
  const [form, setForm] = useState<Form | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  // Match the reader's saved theme, the way the share view does, so a link
  // opened at night is not a white page.
  useEffect(() => {
    const stored = localStorage.getItem('mn-theme');
    const dark = stored ? stored === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', !!dark);
  }, []);

  useEffect(() => {
    let alive = true;
    fetch(`/api/form/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'This form is closed.');
        return body as Form;
      })
      .then((f) => alive && setForm(f))
      .catch((e) => alive && setClosed(e.message));
    return () => { alive = false; };
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || state === 'sending') return;
    setState('sending');
    setError(null);
    try {
      const r = await fetch(`/api/form/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, details, name, email }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || 'Could not send that.');
      setSent(body.key ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that.');
    } finally {
      setState('idle');
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <header className="flex h-[var(--topbar-h)] shrink-0 items-center px-4">
        <a href="/" className="flex items-center gap-2" aria-label="MetanoiaDocs"><Logo size={20} /></a>
      </header>
      {/* 34rem, not the editor's width: this is a form, and a text field the
          width of a page is a field nobody can see the end of. */}
      <main className="mx-auto w-full max-w-[34rem] flex-1 px-4 pb-16 pt-6 sm:pt-12">{children}</main>
    </div>
  );

  if (closed) {
    return shell(
      <div className="flex flex-col items-center gap-4 pt-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface text-faint ring-1 ring-inset ring-line">
          <FileWarning size={20} strokeWidth={1.75} />
        </div>
        <div>
          <p className="text-md font-semibold text-ink">Form unavailable</p>
          <p className="mt-1 text-sm text-muted">{closed}</p>
        </div>
      </div>,
    );
  }

  if (!form) {
    return shell(
      <div className="flex justify-center pt-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent" />
      </div>,
    );
  }

  if (sent !== null) {
    return shell(
      <div className="flex flex-col items-center gap-4 pt-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
          <Check size={22} strokeWidth={2} />
        </div>
        <div>
          <p className="text-md font-semibold text-ink">Sent to {form.name}</p>
          <p className="mt-1 text-sm text-muted">
            {sent
              ? <>It is logged as <span className="font-mono font-semibold text-ink">{sent}</span> — quote that if you follow it up.</>
              : 'The team has it.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setSent(null); setTitle(''); setDetails(''); setError(null); }}
          className="text-sm font-medium text-accent-strong hover:underline"
        >
          Send another
        </button>
      </div>,
    );
  }

  return shell(
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-ink">
          <span aria-hidden="true">{form.icon}</span>{form.name}
        </h1>
        <p className="mt-1.5 text-sm leading-6 text-muted">
          {form.intro || 'Tell the team what you need. It lands on their board.'}
        </p>
      </div>

      <div>
        <label className={label} htmlFor="form-title">What do you need?</label>
        <input
          id="form-title"
          value={title}
          onChange={(e) => { setTitle(e.target.value); setError(null); }}
          maxLength={200}
          required
          autoFocus
          placeholder="One line — the headline"
          className={field}
        />
      </div>

      <div>
        <label className={label} htmlFor="form-details">
          Anything else <span className="font-normal text-faint">— optional</span>
        </label>
        <textarea
          id="form-details"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          maxLength={4000}
          rows={6}
          placeholder="What happened, what you expected, where to look"
          className={cn(field, 'resize-y leading-6')}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="form-name">
            Your name <span className="font-normal text-faint">— optional</span>
          </label>
          <input id="form-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={field} />
        </div>
        <div>
          <label className={label} htmlFor="form-email">
            Email <span className="font-normal text-faint">— optional</span>
          </label>
          <input
            id="form-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={120}
            placeholder="So they can come back to you"
            className={field}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-2xs text-danger-strong">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!title.trim() || state === 'sending'}
          className={cn(
            'flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium text-white transition-opacity',
            'bg-accent-fill hover:opacity-90',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            'disabled:pointer-events-none disabled:opacity-40',
          )}
        >
          {state === 'sending' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {state === 'sending' ? 'Sending…' : 'Send'}
        </button>
        {/* Said before the button is pressed, not after: whoever fills this in
            is handing something to strangers, and what happens to it is worth
            knowing while there is still a chance to change their mind. */}
        <p className="text-3xs leading-4 text-faint">
          Goes straight to the team's board. They will see what you write here.
        </p>
      </div>
    </form>,
  );
}
