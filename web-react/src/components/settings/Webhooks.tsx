/* Hallmark · component: outgoing webhooks · genre: modern-minimal
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * theme: project tokens (index.css)
 * states: loading · empty · created (secret shown once) · expanded (events +
 *         deliveries) · testing · failing hook · confirming delete
 * note: the status dot is the whole point of the row — a hook that quietly
 *       stopped working looks exactly like one nothing has happened on.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, Plus, RefreshCw, Send, Webhook, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { copyText } from '../../lib/clipboard';
import { docsApi, type DeliveryRow, type WebhookRow } from '../../lib/docsApi';
import { relativeTime } from '../../lib/time';
import { toast } from '../../lib/toast';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { field } from '../ui/styles';

/** Green when the last delivery landed, red when it did not, hollow when
 *  nothing has been sent yet — which is not a failure and must not look like
 *  one. */
function StatusDot({ ok }: { ok: boolean | null | undefined }) {
  return (
    <span
      aria-hidden
      className={cn(
        'h-1.5 w-1.5 shrink-0 rounded-full',
        ok == null ? 'ring-1 ring-line-strong' : ok ? 'bg-accent-strong' : 'bg-danger',
      )}
    />
  );
}

/** `reload` is a counter, not data: the log is fetched once per hook, and a
 *  test delivery sent from the row above has to move it. Without it the header
 *  read "failed just now" while the list under it still said nothing had ever
 *  been sent — the panel contradicting itself in two adjacent lines. */
function Deliveries({ id, reload }: { id: string; reload: number }) {
  const [rows, setRows] = useState<DeliveryRow[] | null>(null);
  useEffect(() => { docsApi.webhookDeliveries(id).then(setRows).catch(() => setRows([])); }, [id, reload]);

  if (rows === null) return <p className="py-2 text-2xs text-faint">Loading…</p>;
  if (!rows.length) return <p className="py-2 text-2xs text-faint">Nothing sent yet.</p>;
  return (
    <ul className="space-y-1 py-1">
      {rows.map((d) => (
        <li key={d.id} className="flex items-center gap-2 text-2xs tabular-nums">
          <StatusDot ok={d.ok} />
          <span className="font-mono text-muted">{d.event}</span>
          <span className="text-faint">
            {d.status_code ?? d.error ?? 'no response'}
            {d.attempts > 1 && ` · ${d.attempts} attempts`}
          </span>
          <span className="ml-auto shrink-0 text-faint">{relativeTime(d.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A secret is shown once. The tick waits for the clipboard to actually say yes
 *  — claiming it was copied when it wasn't loses it for good. */
function SecretOnce({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-lg border border-line bg-accent-soft p-3">
      <p className="mb-1.5 text-xs font-medium text-ink">
        Copy this signing secret now — it won't be shown again.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-canvas px-2 py-1.5 text-xs text-ink ring-1 ring-inset ring-line">{secret}</code>
        <button
          type="button"
          aria-label="Copy secret"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-120 hover:bg-hover hover:text-ink"
          onClick={async () => {
            if (!(await copyText(secret))) { toast('Could not copy — select the secret and copy it by hand'); return; }
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={16} className="text-accent-strong" /> : <Copy size={16} />}
        </button>
      </div>
    </div>
  );
}

function HookRow({ hook, events, onChanged }: {
  hook: WebhookRow;
  events: string[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [sent, setSent] = useState(0);
  const [rotating, setRotating] = useState(false);
  const rotatingLock = useRef(false);
  // Subscriptions are edited one checkbox at a time but sent as a whole list,
  // so the row holds its own copy rather than re-reading after every tick.
  const [chosen, setChosen] = useState<string[]>(hook.events);

  const saveEvents = async (next: string[]) => {
    setChosen(next);
    await docsApi.patchWebhook(hook.id, { events: next }).catch(() => toast('Could not save that'));
  };

  const test = async () => {
    setBusy(true);
    try {
      const out = await docsApi.testWebhook(hook.id);
      // Silent on success: the dot turns green and a row appears in the log
      // below, both in view. A toast saying the same thing is the third telling.
      if (!out.ok) toast(`Failed: ${out.error ?? out.statusCode}`);
      onChanged();
      setSent((n) => n + 1);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send');
    } finally { setBusy(false); }
  };

  // Rotating twice kills the secret the first rotation showed before anyone has
  // copied it, and there is no way back to it.
  //
  // The lock is a ref, not the state below. `if (state) return` is the obvious
  // way to write this and it does not work: clicks that land in one tick all
  // read the same pre-render value and all get through — three rotations, two
  // secrets lost. The ref updates synchronously, so the second click sees the
  // first. The state is only what paints the button.
  const rotate = async () => {
    if (rotatingLock.current) return;
    rotatingLock.current = true;
    setRotating(true);
    try {
      const out = await docsApi.rotateWebhook(hook.id);
      setSecret(out.secret);
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not issue a new secret');
    } finally {
      rotatingLock.current = false;
      setRotating(false);
    }
  };

  return (
    <div className="py-3">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <ChevronRight size={14} className={cn('shrink-0 text-faint transition-transform duration-120', open && 'rotate-90')} />
          <StatusDot ok={hook.last_ok} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{hook.url}</span>
            <span className="block truncate text-xs text-faint">
              {chosen.length ? `${chosen.length} events` : 'All events'}
              {hook.last_at ? ` · last sent ${relativeTime(hook.last_at)}` : ' · never sent'}
            </span>
          </span>
        </button>
        <Switch
          on={hook.active}
          label={`${hook.url} enabled`}
          onChange={async (v) => { await docsApi.patchWebhook(hook.id, { active: v }); onChanged(); }}
        />
      </div>

      {open && (
        <div className="mt-2 space-y-3 pl-[26px]">
          <div>
            <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
              Events — none ticked means all of them
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {events.map((e) => (
                <label key={e} className="flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={chosen.includes(e)}
                    onChange={(ev) => saveEvents(
                      ev.target.checked ? [...chosen, e] : chosen.filter((x) => x !== e)
                    )}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  <span className="font-mono">{e}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" disabled={busy}
              leftIcon={busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              onClick={test}>
              Send a test
            </Button>
            <Button size="sm" variant="ghost" disabled={rotating}
              leftIcon={rotating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              onClick={rotate}>
              New secret
            </Button>
            {confirming ? (
              <>
                <button
                  onClick={() => setConfirming(false)}
                  className="rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors duration-120 hover:bg-selected hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => { await docsApi.deleteWebhook(hook.id); onChanged(); }}
                  className="rounded-md bg-danger px-2 py-1 text-xs font-medium text-white transition-[filter] duration-120 hover:brightness-95"
                >
                  Delete
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="ml-auto rounded-md px-2 py-1 text-xs text-danger transition-colors duration-120 hover:bg-danger-soft"
              >
                Delete
              </button>
            )}
          </div>

          {secret && <SecretOnce secret={secret} />}

          <div>
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">Recent deliveries</p>
            <Deliveries id={hook.id} reload={sent} />
          </div>
        </div>
      )}
    </div>
  );
}

export function Webhooks() {
  const [rows, setRows] = useState<WebhookRow[] | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // A failed list is not an empty list. Swallowing the error here rendered
  // "No webhooks yet" at anyone the server had just refused — the one sentence
  // a reader would act on and the one that was not true.
  const load = () => docsApi.webhooks()
    .then((r) => { setRows(r); setLoadError(null); })
    .catch((e) => { setRows([]); setLoadError(e instanceof Error ? e.message : 'Could not load webhooks.'); });
  useEffect(() => {
    load();
    docsApi.webhookEvents().then(setEvents).catch(() => setEvents([]));
  }, []);

  const create = async () => {
    if (busy || !url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // A new hook subscribes to everything. Narrowing it is one expand away,
      // and a hook that arrives silent is a hook people think is broken.
      const out = await docsApi.createWebhook({ url: url.trim(), events: [] });
      setFresh(out.secret);
      setUrl('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that hook.');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold text-ink">Webhooks</h2>
      <p className="mb-5 text-sm text-muted">
        POST every workspace event to a URL you control, so CI, a chat channel or a script
        of yours hears about a change instead of polling for it. Each delivery is signed
        with the hook's secret.
      </p>

      <div className="border-b border-line pb-3">
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="https://example.com/hooks/metanoia"
            className={cn(field, 'flex-1')}
          />
          <Button variant="primary" size="sm" onClick={create} disabled={busy}
            leftIcon={busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}>
            Add
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        {fresh && <SecretOnce secret={fresh} />}
      </div>

      <div className="divide-y divide-line">
        {rows === null ? (
          <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin text-faint" /></div>
        ) : loadError ? (
          <p className="py-8 text-center text-sm text-danger">{loadError}</p>
        ) : rows.length === 0 ? (
          <p className="flex flex-col items-center gap-2 py-8 text-center text-sm text-faint">
            <Webhook size={20} className="opacity-60" />
            No webhooks yet.
          </p>
        ) : rows.map((h) => (
          <HookRow key={h.id} hook={h} events={events} onChanged={load} />
        ))}
      </div>

      <details className="mt-6 text-xs text-muted">
        <summary className="cursor-pointer text-ink">Verifying a delivery</summary>
        <p className="mt-2 leading-relaxed">
          Each POST carries <code className="font-mono">X-Metanoia-Event</code>,{' '}
          <code className="font-mono">X-Metanoia-Timestamp</code> and{' '}
          <code className="font-mono">X-Metanoia-Signature</code>. The signature is{' '}
          <code className="font-mono">sha256=</code> followed by an HMAC-SHA256 of{' '}
          <code className="font-mono">{'`${timestamp}.${rawBody}`'}</code> keyed with the secret.
          The timestamp is inside the signed string, so reject anything more than a few
          minutes old and a captured delivery cannot be replayed at you later.
        </p>
      </details>
    </div>
  );
}
