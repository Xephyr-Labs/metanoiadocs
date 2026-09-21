import {
  Bot,
  Copy,
  Info,
  KeyRound,
  Moon,
  MoreHorizontal,
  Plus,
  Settings2,
  Shield,
  Sparkles,
  Sun,
  Trash2,
  User,
  UserMinus,
  Users,
  Webhook,
  X,
  Check,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { ActorMark } from '../ui/ActorMark';
import { workspaces } from '../../data/mock';
import { useWorkspace } from '../../store/workspace';
import { notifyEnabled } from '../../lib/desktopNotify';
import {
  alertsDescription,
  disableAlerts,
  enableAlerts,
  pushSupported,
  sendTestPush,
  subscribePush,
  type PushResult,
} from '../../lib/push';
import { useAuth } from '../../store/auth';
import { sendInvite } from '../../lib/api';
import { docsApi, type UserRow } from '../../lib/docsApi';
import { setSmallText, smallText } from '../../lib/docPrefs';
import { avatarFor } from '../../lib/avatar';
import { relativeTime } from '../../lib/time';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
import { field } from '../ui/styles';
import { IconButton } from '../ui/IconButton';
import { LogoMark } from '../brand/Logo';
import { Menu } from '../ui/Menu';
import { Modal } from '../ui/Modal';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Switch } from '../ui/Switch';
import { Webhooks } from './Webhooks';
import { copyText } from '../../lib/clipboard';
import { toast } from '../../lib/toast';

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const a = avatarFor(name);
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: a.color, fontSize: size * 0.4 }}>
      {a.initials}
    </span>
  );
}

type SectionId = 'account' | 'preferences' | 'tokens' | 'members' | 'ai' | 'webhooks' | 'about';

/** A section only an admin may open at all. Everything else is shown to
 *  everyone — the AI panel, for instance, is readable by all and editable by
 *  admins, which is why it is not in here. Webhooks are different: a
 *  collaborator cannot even list them, so offering the screen would answer a
 *  403 with an empty list and tell them the workspace has none. */
const ADMIN_ONLY: ReadonlySet<SectionId> = new Set(['webhooks']);

const NAV: { group: string; items: { id: SectionId; label: string; icon: typeof Settings2 }[] }[] = [
  {
    group: 'Account',
    items: [
      { id: 'account', label: 'My account', icon: Users },
      { id: 'preferences', label: 'Preferences', icon: Settings2 },
      { id: 'tokens', label: 'API tokens', icon: KeyRound },
    ],
  },
  {
    group: 'Workspace',
    items: [
      { id: 'members', label: 'Members', icon: Users },
      { id: 'ai', label: 'AI', icon: Sparkles },
      { id: 'webhooks', label: 'Webhooks', icon: Webhook },
      { id: 'about', label: 'About', icon: Info },
    ],
  },
];

/* ---- small controls -------------------------------------------------- */

function Row({ title, desc, control }: { title: string; desc?: string; control: ReactNode }) {
  // Stack title/desc above the control on phones so neither gets crushed into a
  // narrow column; side-by-side from 600px up.
  return (
    <div className="flex flex-col gap-2 py-3.5 min-[600px]:flex-row min-[600px]:items-center min-[600px]:justify-between min-[600px]:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{title}</p>
        {desc && <p className="mt-0.5 text-xs leading-snug text-muted">{desc}</p>}
      </div>
      <div className="w-full min-[600px]:w-auto min-[600px]:shrink-0">{control}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-1 text-lg font-semibold text-ink">{children}</h2>;
}

/* ---- section bodies -------------------------------------------------- */

function Account() {
  const { user, updateName } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = name.trim() !== (user?.name ?? '') && name.trim().length > 0;

  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    const res = await updateName(name.trim());
    setBusy(false);
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 1800); }
  };

  return (
    <div>
      <SectionTitle>My account</SectionTitle>
      <p className="mb-5 text-sm text-muted">Your profile and how others see you.</p>
      <div className="mb-6 flex items-center gap-4">
        <Avatar name={name || user?.name || 'You'} size={64} />
        <div>
          <p className="text-md font-semibold text-ink">{name || user?.name}</p>
          <p className="text-sm text-muted">@{user?.username}</p>
        </div>
      </div>
      <div className="divide-y divide-line border-t border-line">
        <Row
          title="Name"
          desc="Shown to teammates; your avatar is drawn from it."
          control={
            <div className="flex items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
                className={cn(field, "min-[600px]:w-40")}
              />
              {dirty ? (
                <Button size="sm" variant="primary" onClick={save} disabled={busy}
                  leftIcon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}>Save</Button>
              ) : saved ? (
                <span className="flex items-center gap-1 text-xs text-accent-strong"><Check size={14} /> Saved</span>
              ) : null}
            </div>
          }
        />
        <Row title="Username" control={<span className="text-sm text-muted">@{user?.username}</span>} />
        <Row title="Email" desc="Used to sign in and for notifications." control={<span className="text-sm text-muted">{user?.email}</span>} />
        {/* Read, not set. The browser already knows, and a picker over four
            hundred IANA names is a worse answer than the right one by default.
            Shown because it decides when the morning summary arrives and which
            day a task counts as due on, and a wrong one should be visible. */}
        <Row
          title="Time zone"
          desc="Detected from this browser. Dates, reminders and the daily summary follow it."
          control={<span className="text-sm text-muted">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>}
        />
        <PasswordRow />
      </div>
    </div>
  );
}

/**
 * Change-password, asked in place like the member and token rows. Collapsed it
 * is one more line in the account list; open it is the three fields, because
 * there is no reset flow to catch a typo in the new one.
 */
function PasswordRow() {
  const { changePassword } = useAuth();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reset = () => { setCurrent(''); setNext(''); setConfirm(''); };
  const close = () => { setOpen(false); reset(); setMsg(null); };

  const problem =
    next.length > 0 && next.length < 8 ? 'New password must be at least 8 characters.'
    : confirm.length > 0 && next !== confirm ? "Those two don't match."
    : null;
  const ready = current.length > 0 && next.length >= 8 && next === confirm && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setMsg(null);
    const res = await changePassword(current, next);
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: res.error ?? 'Could not change your password.' }); return; }
    reset();
    setOpen(false);
    setMsg({
      ok: true,
      text: res.signedOut
        ? `Password changed. ${res.signedOut} other ${res.signedOut === 1 ? 'session was' : 'sessions were'} signed out.`
        : 'Password changed.',
    });
  };

  if (!open) {
    return (
      <div className="py-3.5">
        <div className="flex flex-col gap-2 min-[600px]:flex-row min-[600px]:items-center min-[600px]:justify-between min-[600px]:gap-6">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">Password</p>
            <p className="mt-0.5 text-xs leading-snug text-muted">
              Changing it signs out every other browser and device you're on.
            </p>
          </div>
          <div className="w-full min-[600px]:w-auto min-[600px]:shrink-0">
            <Button size="sm" onClick={() => { setMsg(null); setOpen(true); }} leftIcon={<KeyRound size={14} />}>
              Change
            </Button>
          </div>
        </div>
        {msg?.ok && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-accent-strong">
            <Check size={14} /> {msg.text}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="py-3.5">
      <p className="text-sm font-medium text-ink">Change password</p>
      <div className="mt-3 space-y-2">
        <input
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          type="password"
          autoComplete="current-password"
          placeholder="Current password"
          className={field}
        />
        <input
          value={next}
          onChange={(e) => setNext(e.target.value)}
          type="password"
          autoComplete="new-password"
          placeholder="New password — at least 8 characters"
          className={field}
        />
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          type="password"
          autoComplete="new-password"
          placeholder="New password again"
          className={field}
        />
      </div>
      {(problem || msg) && !msg?.ok && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-danger-strong">
          <AlertCircle size={14} /> {problem ?? msg?.text}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={submit}
          disabled={!ready}
          leftIcon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}
        >
          Change password
        </Button>
        <Button size="sm" onClick={close} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}

function Preferences() {
  const ws = useWorkspace();
  const auth = useAuth();
  // Same switch as the page menu's "Small text" — one owner of the key and the
  // attribute (lib/docPrefs), so the two can't disagree about what is on.
  const [small, setSmall] = useState(smallText);
  const toggleSmall = (v: boolean) => {
    setSmall(v);
    setSmallText(v);
  };

  // The browser's own permission is the real switch; ours only records that
  // this person wants them, so revoking permission in site settings turns them
  // off here too without any syncing.
  const canNotify = typeof Notification !== 'undefined';
  const [notify, setNotify] = useState(
    () => canNotify && notifyEnabled() && Notification.permission === 'granted',
  );
  const [denied, setDenied] = useState(() => canNotify && Notification.permission === 'denied');
  const [busy, setBusy] = useState(false);
  // Whether this device is registered for alerts with Metanoia closed, which is
  // the half nothing used to report. Re-subscribing is an upsert, so asking on
  // every visit costs one row write and heals a subscription the server lost.
  const [push, setPush] = useState<PushResult | null>(null);
  const [tested, setTested] = useState<string | null>(null);

  // Email is the half that works with no browser at all — no permission, no
  // subscription, nothing per-device. It had no switch until now, so this
  // starts on for everybody, which is what they already had.
  const [mail, setMail] = useState(auth.user?.emailNotify !== false);
  const toggleMail = async (v: boolean) => {
    setMail(v);
    if (!(await auth.setEmailNotify(v))) setMail(!v);
  };

  useEffect(() => {
    if (!notify || !pushSupported()) return;
    let alive = true;
    subscribePush()
      .then((r) => alive && setPush(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [notify]);

  const toggleNotify = async (v: boolean) => {
    setBusy(true);
    setTested(null);
    try {
      if (!v) {
        await disableAlerts();
        setNotify(false);
        setPush(null);
        return;
      }
      const { permission, push: result } = await enableAlerts();
      setDenied(permission === 'denied');
      setNotify(permission === 'granted');
      setPush(result);
    } finally {
      setBusy(false);
    }
  };

  // The whole chain end to end — subscription row, VAPID, push service, service
  // worker — on demand. "I get no notifications" is otherwise a report nobody
  // can reproduce, least of all the person making it.
  const runTest = async () => {
    setTested('Sending…');
    const { devices } = await sendTestPush().catch(() => ({ devices: 0 }));
    setTested(
      devices > 0
        ? `Sent to ${devices} device${devices === 1 ? '' : 's'}. Nothing shown? Check your system notification settings.`
        : 'No device is registered for background alerts on this account yet.',
    );
  };
  return (
    <div>
      <SectionTitle>Preferences</SectionTitle>
      <p className="mb-5 text-sm text-muted">Customize how Metanoia looks and behaves for you.</p>
      <div className="divide-y divide-line border-t border-line">
        <Row
          title="Appearance"
          desc="Pick a light or dark theme."
          control={
            <SegmentedControl
              aria-label="Theme"
              value={ws.theme}
              onChange={(v) => v !== ws.theme && ws.toggleTheme()}
              segments={[
                { value: 'light', label: 'Light', icon: <Sun size={14} /> },
                { value: 'dark', label: 'Dark', icon: <Moon size={14} /> },
              ]}
            />
          }
        />
        <Row title="Smaller text" desc="Reduce the editor font size." control={<Switch on={small} onChange={toggleSmall} />} />
        {canNotify && (
          <Row
            title="Desktop notifications"
            desc={alertsDescription({ denied, on: notify, push, supported: pushSupported() })}
            control={<Switch on={notify} onChange={toggleNotify} disabled={busy} />}
          />
        )}
        <Row
          title="Email notifications"
          desc={
            mail
              ? `Mentions, comments, assignments and your morning digest are also emailed to ${auth.user?.email ?? 'you'}.`
              : 'No email. Mentions and assignments still reach your inbox here.'
          }
          control={<Switch on={mail} onChange={toggleMail} />}
        />
        <CalendarFeed />
        {canNotify && notify && (
          <Row
            title="Test notifications"
            desc={tested ?? 'Send yourself one now to check it arrives.'}
            control={
              <button
                type="button"
                onClick={runTest}
                className="h-7 rounded border border-line px-2.5 text-xs font-medium text-ink transition-colors hover:bg-hover"
              >
                Send test
              </button>
            }
          />
        )}
      </div>
    </div>
  );
}

/**
 * Subscribe to your dated work in whatever calendar you actually look at.
 *
 * Deliberately not a switch. A feed either exists or it does not, and what is
 * useful is the address — so the control is the address, with one button to
 * make it and one to replace it. Nothing is created by opening this screen:
 * the URL is a credential, and everyone who ever looked at Settings should not
 * be left holding one.
 *
 * The URL is shown in full rather than behind a "Copy" button alone. It is
 * going to be pasted into another application, sometimes on another device,
 * and a secret you cannot read is one you cannot type in.
 */
function CalendarFeed() {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'working'>('loading');
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    docsApi.calendarToken()
      .then((r) => { if (alive) { setUrl(r.url); setState('idle'); } })
      .catch(() => { if (alive) setState('idle'); });
    return () => { alive = false; };
  }, []);

  const mint = async (rotate: boolean) => {
    setState('working');
    setError(null);
    setConfirming(false);
    try {
      setUrl((await docsApi.makeCalendarToken(rotate)).url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make that link.');
    } finally {
      setState('idle');
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // A clipboard the browser will not hand over is why the URL is on screen.
      setError('Could not copy — select the address above instead.');
    }
  };

  const button =
    'h-7 shrink-0 rounded border border-line px-2.5 text-xs font-medium text-ink '
    + 'transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-50';

  return (
    <Row
      title="Calendar subscription"
      desc={
        error
          ? error
          : url
            ? 'Add this address in Google Calendar, Apple Calendar or Outlook. It shows the tasks assigned to you that have dates, and it updates itself.'
            : 'Put the tasks assigned to you into the calendar you already use. Anyone with the address can read them, so treat it like a password.'
      }
      control={
        url ? (
          <div className="flex w-full min-w-0 flex-col items-stretch gap-1.5 sm:w-[300px]">
            <input
              readOnly
              value={url}
              aria-label="Calendar address"
              onFocus={(e) => e.target.select()}
              className="h-7 w-full rounded border border-line bg-surface px-2 font-mono text-3xs text-muted"
            />
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={copy} className={button}>
                {copied ? 'Copied' : 'Copy'}
              </button>
              {confirming ? (
                <>
                  <button type="button" onClick={() => void mint(true)} disabled={state === 'working'} className={cn(button, 'border-danger-strong text-danger-strong')}>
                    Replace it
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} className={button}>Keep</button>
                </>
              ) : (
                // Arms rather than asking in a dialog: replacing the address
                // breaks every calendar already subscribed to it, which is
                // worth one deliberate second click and not a modal.
                <button type="button" onClick={() => setConfirming(true)} className={cn(button, 'text-muted')}>
                  New address
                </button>
              )}
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => void mint(false)} disabled={state !== 'idle'} className={button}>
            {state === 'working' ? 'Making…' : state === 'loading' ? 'Checking…' : 'Create a link'}
          </button>
        )
      }
    />
  );
}

function Members() {
  const { user } = useAuth();
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const reload = () => docsApi.users().then(setRows).catch(() => setRows([]));
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);
  const isAdmin = user?.role === 'admin';
  // Both of these can be refused server-side (last admin, self-removal). Say so
  // — a silent catch plus a reload just looks like the click did nothing.
  const changeRole = async (m: UserRow, role: 'admin' | 'collaborator') => {
    setMsg(null);
    await docsApi
      .setUserRole(m.id, role)
      .catch((e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not change that role.' }));
    reload();
  };
  // Marking an account an agent is what makes its edits legible everywhere else
  // — the activity feed and every page byline read this.
  const changeKind = async (m: UserRow, kind: 'person' | 'agent') => {
    setMsg(null);
    await docsApi
      .setUserKind(m.id, kind)
      .catch((e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not change that.' }));
    reload();
  };
  // Removing someone is the one action here with no undo, so it takes two
  // deliberate clicks in the row itself — no browser dialog, and the row can
  // say what removal costs while it asks.
  const remove = async (m: UserRow) => {
    const who = m.name || m.email;
    setMsg(null);
    setRemoving(m.id);
    await docsApi
      .removeUser(m.id)
      .then(() => setMsg({ ok: true, text: `${who} removed. Their pages are now yours.` }))
      .catch((e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not remove that member.' }));
    setRemoving(null);
    setConfirming(null);
    reload();
  };

  const invite = async () => {
    if (busy) return;
    setMsg(null);
    setBusy(true);
    const res = await sendInvite(email);
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: `Invitation emailed to ${email.trim()}.` });
      setEmail('');
    } else {
      setMsg({ ok: false, text: res.error ?? 'Could not send invite.' });
    }
  };

  return (
    <div>
      <div className="mb-4">
        <SectionTitle>Members</SectionTitle>
        <p className="text-sm text-muted">{rows ? `${rows.length} people in this workspace.` : 'Loading…'}</p>
      </div>
      <div className="border-b border-line pb-3">
        <div className="flex gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && invite()}
            type="email"
            placeholder="Invite a teammate by email…"
            className={cn(field, "flex-1")}
          />
          <Button variant="primary" size="sm" onClick={invite} disabled={busy} leftIcon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}>
            Invite
          </Button>
        </div>
        {msg && (
          <p className={cn('mt-2 flex items-center gap-1.5 text-xs', msg.ok ? 'text-accent-strong' : 'text-danger-strong')}>
            {msg.ok ? <Check size={14} /> : <AlertCircle size={14} />}
            {msg.text}
          </p>
        )}
      </div>
      <div className="divide-y divide-line">
        {(rows ?? []).map((m) => {
          const asking = confirming === m.id;
          const busyRow = removing === m.id;
          return (
            <div key={m.id} className="flex items-center gap-3 py-3">
              <Avatar name={m.name || m.email} size={32} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium text-ink">
                  <span className="truncate">{m.name}</span>
                  {/* An admin can mark an account an agent; they have to be able to
                      see which ones already are. */}
                  <ActorMark kind={m.kind} name={m.name} />
                  {m.id === user?.id && <span className="shrink-0 text-faint">(you)</span>}
                </p>
                {asking ? (
                  <p className="text-xs text-danger-strong">
                    Their pages transfer to you and their comments keep their name. Sign-in, tokens and favourites are deleted.
                  </p>
                ) : (
                  <p className="truncate text-xs text-faint">{m.email}</p>
                )}
              </div>
              {asking ? (
                <>
                  <button
                    onClick={() => setConfirming(null)}
                    disabled={busyRow}
                    className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors duration-120 hover:bg-selected hover:text-ink disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => remove(m)}
                    disabled={busyRow}
                    className="flex shrink-0 items-center gap-1.5 rounded-md bg-danger px-2 py-1 text-xs font-medium text-white transition-[filter] duration-120 hover:brightness-95 disabled:opacity-60"
                  >
                    {busyRow ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Remove
                  </button>
                </>
              ) : isAdmin && m.id !== user?.id ? (
                <Menu
                  align="end"
                  items={[
                    m.role === 'admin'
                      ? { icon: UserMinus, label: 'Make collaborator', onSelect: () => changeRole(m, 'collaborator') }
                      : { icon: Shield, label: 'Make admin', onSelect: () => changeRole(m, 'admin') },
                    m.kind === 'agent'
                      ? { icon: User, label: 'Mark as a person', onSelect: () => changeKind(m, 'person') }
                      : { icon: Bot, label: 'Mark as an agent', onSelect: () => changeKind(m, 'agent') },
                    { icon: Trash2, label: 'Remove from workspace', danger: true, separatorBefore: true, onSelect: () => { setMsg(null); setConfirming(m.id); } },
                  ]}
                  trigger={
                    <button className="flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-hover">
                      <span className={cn('rounded-full px-2 py-0.5 text-2xs font-medium', m.role === 'admin' ? 'bg-accent-soft text-accent-strong' : 'text-muted')}>
                        {m.role === 'admin' ? 'Admin' : 'Collaborator'}
                      </span>
                      <MoreHorizontal size={16} className="text-faint" />
                    </button>
                  }
                />
              ) : m.role === 'admin' ? (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent-strong">Admin</span>
              ) : (
                <span className="text-sm text-muted">Collaborator</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * AI provider credentials. Admin-only — the server enforces that on PUT, and
 * this form reflects it rather than letting a collaborator type into fields
 * whose Save can only 403.
 *
 * The key is write-only by design: GET reports whether one is stored, never
 * what it is, so leaving the field blank keeps the existing key and there is no
 * request anywhere that can hand it back to a browser.
 */
function AiSettings() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [loaded, setLoaded] = useState(false);
  const [keySet, setKeySet] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [saved, setSaved] = useState<{ baseUrl: string; model: string; enabled: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    docsApi
      .aiConfig()
      .then((c) => {
        setBaseUrl(c.baseUrl);
        setModel(c.model);
        setEnabled(c.enabled);
        setKeySet(c.keySet);
        setSaved({ baseUrl: c.baseUrl, model: c.model, enabled: c.enabled });
      })
      .catch((e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not load AI settings.' }))
      .finally(() => setLoaded(true));
  }, []);

  const dirty =
    !!saved && (baseUrl.trim() !== saved.baseUrl || model.trim() !== saved.model || enabled !== saved.enabled || apiKey.length > 0);
  // Turning it on without somewhere to send the request just produces a 503 at
  // the first prompt, so say so here instead.
  const missing = enabled && (!baseUrl.trim() || !model.trim() || (!keySet && !apiKey.trim()));

  const save = async () => {
    if (!dirty || busy || missing) return;
    setBusy(true);
    setMsg(null);
    try {
      await docsApi.saveAiConfig({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        enabled,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      if (apiKey.trim()) setKeySet(true);
      setApiKey('');
      setSaved({ baseUrl: baseUrl.trim(), model: model.trim(), enabled });
      setMsg({ ok: true, text: 'AI settings saved.' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not save AI settings.' });
    }
    setBusy(false);
  };

  return (
    <div>
      <SectionTitle>AI</SectionTitle>
      <p className="mb-5 text-sm text-muted">
        Connect any OpenAI-compatible provider to power the copilot, the ✨ writing actions and summaries.
      </p>

      {!isAdmin && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-xs leading-snug text-muted">
          <Shield size={14} className="mt-px shrink-0 text-faint" />
          Only workspace admins can change these. AI is currently{' '}
          <span className="font-medium text-ink">{enabled ? 'on' : 'off'}</span> for everyone.
        </p>
      )}

      <fieldset disabled={!isAdmin || !loaded} className="divide-y divide-line border-t border-line disabled:opacity-60">
        <Row
          title="Enabled"
          desc="Off hides every AI entry point in the editor."
          control={<Switch on={enabled} onChange={setEnabled} />}
        />
        <Row
          title="Provider URL"
          desc="The API base, e.g. https://api.openai.com/v1"
          control={
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
              autoComplete="off"
              className={cn(field, 'min-[600px]:w-64')}
            />
          }
        />
        <Row
          title="Model"
          desc="Sent verbatim to the provider."
          control={
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4o-mini"
              spellCheck={false}
              autoComplete="off"
              className={cn(field, 'min-[600px]:w-64')}
            />
          }
        />
        <Row
          title="API key"
          desc={keySet ? 'A key is stored. Type a new one to replace it.' : 'Stored on the server; never sent back to a browser.'}
          control={
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              type="password"
              autoComplete="off"
              placeholder={keySet ? '••••••••••••  (unchanged)' : 'sk-…'}
              className={cn(field, 'min-[600px]:w-64')}
            />
          }
        />
      </fieldset>

      {isAdmin && (
        <div className="mt-4 flex items-center gap-3">
          <Button
            size="sm"
            variant="primary"
            onClick={save}
            disabled={!dirty || busy || missing}
            leftIcon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}
          >
            Save
          </Button>
          {missing ? (
            <span className="flex items-center gap-1.5 text-xs text-danger-strong">
              <AlertCircle size={14} /> Add a provider URL, a model and a key before turning it on.
            </span>
          ) : msg ? (
            <span className={cn('flex items-center gap-1.5 text-xs', msg.ok ? 'text-accent-strong' : 'text-danger-strong')}>
              {msg.ok ? <Check size={14} /> : <AlertCircle size={14} />} {msg.text}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function About() {
  const rows = [
    ['Plan', 'Free · unlimited members, forever'],
    ['Version', '0.1.0'],
    ['Editor', 'BlockSuite 0.22.4'],
    ['Workspace', workspaces[0].name],
    ['Build', 'web-react · dev'],
  ];
  return (
    <div>
      <SectionTitle>About</SectionTitle>
      <p className="mb-5 text-sm text-muted">Version and workspace information.</p>
      <dl className="divide-y divide-line border-t border-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between py-3 text-sm">
            <dt className="text-muted">{k}</dt>
            <dd className="font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Tokens() {
  const [rows, setRows] = useState<{ id: string; name: string; created_at: string; last_used_at: string | null }[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null); // plaintext shown once
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = () => docsApi.listTokens().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const t = await docsApi.createToken(name.trim() || 'API token');
      setFresh(t.token);
      setName('');
      load();
    } finally { setBusy(false); }
  };
  // Same two-click confirm as the member rows — the row asks, in place.
  const revoke = async (id: string) => {
    setRevoking(id);
    await docsApi.deleteToken(id).catch(() => {});
    setRevoking(null);
    setConfirming(null);
    load();
  };

  return (
    <div>
      <SectionTitle>API tokens</SectionTitle>
      <p className="mb-5 text-sm text-muted">
        Personal access tokens let programmatic clients — like the MetanoiaDocs MCP server — act as you. They carry your access; keep them secret.
      </p>

      <div className="border-b border-line pb-3">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="Token name (e.g. Claude MCP)…"
            className={cn(field, "flex-1")}
          />
          <Button variant="primary" size="sm" onClick={create} disabled={busy}
            leftIcon={busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}>Create</Button>
        </div>
        {fresh && (
          <div className="mt-3 rounded-lg border border-line bg-accent-soft p-3">
            <p className="mb-1.5 text-xs font-medium text-ink">Copy your token now — it won't be shown again.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-canvas px-2 py-1.5 text-xs text-ink ring-1 ring-inset ring-line">{fresh}</code>
              <IconButton
                icon={copied ? <Check size={16} className="text-accent-strong" /> : <Copy size={16} />}
                label="Copy"
                onClick={async () => {
                  // This token is shown once. Claiming it was copied when it
                  // wasn't loses it for good, so the tick waits for the truth.
                  if (!(await copyText(fresh))) { toast('Could not copy — select the token and copy it by hand'); return; }
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="divide-y divide-line">
        {rows === null ? (
          <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin text-faint" /></div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-faint">No tokens yet.</p>
        ) : rows.map((t) => {
          const asking = confirming === t.id;
          const busyRow = revoking === t.id;
          return (
            <div key={t.id} className="flex items-center gap-3 py-3">
              <KeyRound size={16} className="shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{t.name}</p>
                {asking ? (
                  <p className="text-xs text-danger-strong">Anything signed in with this token stops working.</p>
                ) : (
                  <p className="truncate text-xs text-faint">
                    Created {relativeTime(t.created_at)}
                    {t.last_used_at ? ` · last used ${relativeTime(t.last_used_at)}` : ' · never used'}
                  </p>
                )}
              </div>
              {asking ? (
                <>
                  <button
                    onClick={() => setConfirming(null)}
                    disabled={busyRow}
                    className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors duration-120 hover:bg-selected hover:text-ink disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => revoke(t.id)}
                    disabled={busyRow}
                    className="flex shrink-0 items-center gap-1.5 rounded-md bg-danger px-2 py-1 text-xs font-medium text-white transition-[filter] duration-120 hover:brightness-95 disabled:opacity-60"
                  >
                    {busyRow ? <Loader2 size={14} className="animate-spin" /> : null} Revoke
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirming(t.id)}
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-danger-strong transition-colors duration-120 hover:bg-danger-soft"
                >
                  Revoke
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const BODIES: Record<SectionId, () => JSX.Element> = {
  account: Account,
  preferences: Preferences,
  tokens: Tokens,
  members: Members,
  ai: AiSettings,
  webhooks: Webhooks,
  about: About,
};

/* ---- shell ----------------------------------------------------------- */

export function SettingsDialog() {
  const ws = useWorkspace();
  const { user } = useAuth();
  const [section, setSection] = useState<SectionId>('account');
  const isAdmin = user?.role === 'admin';
  const nav = isAdmin
    ? NAV
    : NAV.map((g) => ({ ...g, items: g.items.filter((it) => !ADMIN_ONLY.has(it.id)) }))
        .filter((g) => g.items.length);
  // Someone demoted while the dialog is open is still looking at the section
  // they had; fall back rather than render a body that can only 403.
  const current = !isAdmin && ADMIN_ONLY.has(section) ? 'account' : section;
  const Body = BODIES[current];

  return (
    <Modal
      open={ws.settingsOpen}
      onOpenChange={ws.setSettingsOpen}
      title="Settings"
      bare
      width={900}
      className="h-[92vh] md:h-[min(640px,88vh)] md:flex-row"
    >
      {/* section rail — vertical on desktop, a horizontal scroll strip on mobile */}
      <nav className="flex shrink-0 gap-2 overflow-x-auto border-b border-line bg-surface-2 p-2 md:w-[212px] md:flex-col md:gap-4 md:overflow-x-visible md:overflow-y-auto md:border-b-0 md:border-r md:p-3">
        <div className="hidden items-center gap-2 px-2 pt-1 md:flex">
          <LogoMark size={20} />
          <span className="text-sm font-semibold text-ink">{workspaces[0].name}</span>
        </div>
        {nav.map((g) => (
          <div key={g.group} className="flex shrink-0 items-center gap-1 md:block">
            <p className="hidden px-2 pb-1 text-2xs font-semibold uppercase tracking-wide text-faint md:block">{g.group}</p>
            <div className="flex gap-1 md:block md:space-y-0.5">
              {g.items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setSection(it.id)}
                  className={cn(
                    'flex h-8 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 text-sm transition-colors duration-120 md:w-full md:px-2',
                    current === it.id ? 'bg-selected font-medium text-ink' : 'text-muted hover:bg-hover',
                  )}
                >
                  <it.icon size={16} className="shrink-0 opacity-80" />
                  {it.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* content */}
      <div className="relative min-w-0 flex-1">
        <div className="absolute right-4 top-4 z-10">
          <IconButton icon={<X size={16} />} label="Close settings" onClick={() => ws.setSettingsOpen(false)} />
        </div>
        <div className="scrollarea h-full overflow-y-auto px-5 py-6 md:px-8 md:py-7">
          <div className="mx-auto max-w-[520px]">
            <Body />
          </div>
        </div>
      </div>
    </Modal>
  );
}
