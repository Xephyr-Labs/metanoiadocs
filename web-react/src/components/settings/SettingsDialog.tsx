import { motion } from 'framer-motion';
import {
  Copy,
  Info,
  KeyRound,
  Moon,
  MoreHorizontal,
  Plus,
  Settings2,
  Shield,
  Sun,
  Trash2,
  UserMinus,
  Users,
  X,
  Check,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { workspaces } from '../../data/mock';
import { useWorkspace } from '../../store/workspace';
import { useAuth } from '../../store/auth';
import { sendInvite } from '../../lib/api';
import { docsApi, type UserRow } from '../../lib/docsApi';
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

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const a = avatarFor(name);
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: a.color, fontSize: size * 0.4 }}>
      {a.initials}
    </span>
  );
}

type SectionId = 'account' | 'preferences' | 'tokens' | 'members' | 'about';

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
      { id: 'about', label: 'About', icon: Info },
    ],
  },
];

/* ---- small controls -------------------------------------------------- */

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn('relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-180', on ? 'bg-accent' : 'bg-line-strong')}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 34 }}
        className={cn('absolute top-[3px] h-4 w-4 rounded-full bg-white shadow', on ? 'left-[19px]' : 'left-[3px]')}
      />
    </button>
  );
}

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
                <span className="flex items-center gap-1 text-xs text-accent"><Check size={14} /> Saved</span>
              ) : null}
            </div>
          }
        />
        <Row title="Username" control={<span className="text-sm text-muted">@{user?.username}</span>} />
        <Row title="Email" desc="Used to sign in and for notifications." control={<span className="text-sm text-muted">{user?.email}</span>} />
      </div>
    </div>
  );
}

function Preferences() {
  const ws = useWorkspace();
  const [small, setSmall] = useState(() => localStorage.getItem('mn-text-size') === 'small');
  const toggleSmall = (v: boolean) => {
    setSmall(v);
    localStorage.setItem('mn-text-size', v ? 'small' : '');
    document.documentElement.dataset.textSize = v ? 'small' : '';
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
      </div>
    </div>
  );
}

function Members() {
  const { user } = useAuth();
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
  const remove = async (m: UserRow) => {
    const who = m.name || m.email;
    if (!window.confirm(`Remove ${who} from the workspace?\n\nEvery page they own transfers to you, and their comments keep their name. Their sign-in, tokens and favourites are deleted.`)) return;
    setMsg(null);
    await docsApi
      .removeUser(m.id)
      .then(() => setMsg({ ok: true, text: `${who} removed. Their pages are now yours.` }))
      .catch((e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not remove that member.' }));
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
          <p className={cn('mt-2 flex items-center gap-1.5 text-xs', msg.ok ? 'text-accent' : 'text-danger')}>
            {msg.ok ? <Check size={14} /> : <AlertCircle size={14} />}
            {msg.text}
          </p>
        )}
      </div>
      <div className="divide-y divide-line">
        {(rows ?? []).map((m) => (
          <div key={m.id} className="flex items-center gap-3 py-3">
            <Avatar name={m.name || m.email} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{m.name} {m.id === user?.id && <span className="text-faint">(you)</span>}</p>
              <p className="truncate text-xs text-faint">{m.email}</p>
            </div>
            {isAdmin && m.id !== user?.id ? (
              <Menu
                align="end"
                items={[
                  m.role === 'admin'
                    ? { icon: UserMinus, label: 'Make collaborator', onSelect: () => changeRole(m, 'collaborator') }
                    : { icon: Shield, label: 'Make admin', onSelect: () => changeRole(m, 'admin') },
                  { icon: Trash2, label: 'Remove from workspace', danger: true, separatorBefore: true, onSelect: () => remove(m) },
                ]}
                trigger={
                  <button className="flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-hover">
                    <span className={cn('rounded-full px-2 py-0.5 text-2xs font-medium', m.role === 'admin' ? 'bg-accent-soft text-accent' : 'text-muted')}>
                      {m.role === 'admin' ? 'Admin' : 'Collaborator'}
                    </span>
                    <MoreHorizontal size={16} className="text-faint" />
                  </button>
                }
              />
            ) : m.role === 'admin' ? (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent">Admin</span>
            ) : (
              <span className="text-sm text-muted">Collaborator</span>
            )}
          </div>
        ))}
      </div>
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
  const revoke = async (id: string) => {
    if (!window.confirm('Revoke this token? Anything using it will stop working.')) return;
    await docsApi.deleteToken(id).catch(() => {});
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
          <div className="mt-3 rounded-lg border border-accent/40 bg-accent-soft/50 p-3">
            <p className="mb-1.5 text-xs font-medium text-ink">Copy your token now — it won't be shown again.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-canvas px-2 py-1.5 text-xs text-ink ring-1 ring-inset ring-line">{fresh}</code>
              <IconButton
                icon={copied ? <Check size={16} className="text-accent" /> : <Copy size={16} />}
                label="Copy"
                onClick={() => { navigator.clipboard?.writeText(fresh); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
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
        ) : rows.map((t) => (
          <div key={t.id} className="flex items-center gap-3 py-3">
            <KeyRound size={16} className="shrink-0 text-faint" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{t.name}</p>
              <p className="truncate text-xs text-faint">
                Created {relativeTime(t.created_at)}
                {t.last_used_at ? ` · last used ${relativeTime(t.last_used_at)}` : ' · never used'}
              </p>
            </div>
            <button onClick={() => revoke(t.id)} className="rounded-md px-2 py-1 text-xs text-danger hover:bg-danger/10">Revoke</button>
          </div>
        ))}
      </div>
    </div>
  );
}

const BODIES: Record<SectionId, () => JSX.Element> = {
  account: Account,
  preferences: Preferences,
  tokens: Tokens,
  members: Members,
  about: About,
};

/* ---- shell ----------------------------------------------------------- */

export function SettingsDialog() {
  const ws = useWorkspace();
  const [section, setSection] = useState<SectionId>('account');
  const Body = BODIES[section];

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
        {NAV.map((g) => (
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
                    section === it.id ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-hover',
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
