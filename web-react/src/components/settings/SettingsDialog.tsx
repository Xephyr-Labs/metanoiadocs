import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Info,
  Moon,
  MoreHorizontal,
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
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
import { LogoMark } from '../brand/Logo';
import { Menu } from '../ui/Menu';
import { SegmentedControl } from '../ui/SegmentedControl';

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const a = avatarFor(name);
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: a.color, fontSize: size * 0.4 }}>
      {a.initials}
    </span>
  );
}

type SectionId = 'account' | 'preferences' | 'members' | 'about';

const NAV: { group: string; items: { id: SectionId; label: string; icon: typeof Settings2 }[] }[] = [
  {
    group: 'Account',
    items: [
      { id: 'account', label: 'My account', icon: Users },
      { id: 'preferences', label: 'Preferences', icon: Settings2 },
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
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink">{title}</p>
        {desc && <p className="mt-0.5 text-[12px] leading-snug text-muted">{desc}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-1 text-[17px] font-semibold text-ink">{children}</h2>;
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
      <p className="mb-5 text-[13px] text-muted">Your profile and how others see you.</p>
      <div className="mb-6 flex items-center gap-4">
        <Avatar name={name || user?.name || 'You'} size={64} />
        <div>
          <p className="text-[15px] font-semibold text-ink">{name || user?.name}</p>
          <p className="text-[13px] text-muted">@{user?.username}</p>
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
                className="h-8 w-40 rounded-md bg-surface px-2.5 text-[13px] text-ink outline-none ring-1 ring-inset ring-line focus:ring-2 focus:ring-accent"
              />
              {dirty ? (
                <Button size="sm" variant="primary" onClick={save} disabled={busy}
                  leftIcon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}>Save</Button>
              ) : saved ? (
                <span className="flex items-center gap-1 text-[12px] text-accent"><Check size={13} /> Saved</span>
              ) : null}
            </div>
          }
        />
        <Row title="Username" control={<span className="text-[13px] text-muted">@{user?.username}</span>} />
        <Row title="Email" desc="Used to sign in and for notifications." control={<span className="text-[13px] text-muted">{user?.email}</span>} />
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
      <p className="mb-5 text-[13px] text-muted">Customize how Metanoia looks and behaves for you.</p>
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
                { value: 'light', label: 'Light', icon: <Sun size={13} /> },
                { value: 'dark', label: 'Dark', icon: <Moon size={13} /> },
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
  const changeRole = async (m: UserRow, role: 'admin' | 'collaborator') => {
    await docsApi.setUserRole(m.id, role).catch(() => {});
    reload();
  };
  const remove = async (m: UserRow) => {
    if (!window.confirm(`Remove ${m.name || m.email} from the workspace? Their pages transfer to you.`)) return;
    await docsApi.removeUser(m.id).catch(() => {});
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
        <p className="text-[13px] text-muted">{rows ? `${rows.length} people in this workspace.` : 'Loading…'}</p>
      </div>
      <div className="border-b border-line pb-3">
        <div className="flex gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && invite()}
            type="email"
            placeholder="Invite a teammate by email…"
            className="h-8 flex-1 rounded-md bg-surface px-3 text-[13px] outline-none ring-1 ring-inset ring-line placeholder:text-faint focus:ring-2 focus:ring-accent"
          />
          <Button variant="primary" size="sm" onClick={invite} disabled={busy} leftIcon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}>
            Invite
          </Button>
        </div>
        {msg && (
          <p className={cn('mt-2 flex items-center gap-1.5 text-[12px]', msg.ok ? 'text-accent' : 'text-danger')}>
            {msg.ok ? <Check size={13} /> : <AlertCircle size={13} />}
            {msg.text}
          </p>
        )}
      </div>
      <div className="divide-y divide-line">
        {(rows ?? []).map((m) => (
          <div key={m.id} className="flex items-center gap-3 py-3">
            <Avatar name={m.name || m.email} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink">{m.name} {m.id === user?.id && <span className="text-faint">(you)</span>}</p>
              <p className="truncate text-[12px] text-faint">{m.email}</p>
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
                    <MoreHorizontal size={15} className="text-faint" />
                  </button>
                }
              />
            ) : m.role === 'admin' ? (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent">Admin</span>
            ) : (
              <span className="text-[13px] text-muted">Collaborator</span>
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
      <p className="mb-5 text-[13px] text-muted">Version and workspace information.</p>
      <dl className="divide-y divide-line border-t border-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between py-3 text-[13px]">
            <dt className="text-muted">{k}</dt>
            <dd className="font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const BODIES: Record<SectionId, () => JSX.Element> = {
  account: Account,
  preferences: Preferences,
  members: Members,
  about: About,
};

/* ---- shell ----------------------------------------------------------- */

export function SettingsDialog() {
  const ws = useWorkspace();
  const [section, setSection] = useState<SectionId>('account');
  const Body = BODIES[section];

  return (
    <Dialog.Root open={ws.settingsOpen} onOpenChange={ws.setSettingsOpen}>
      <AnimatePresence>
        {ws.settingsOpen && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild aria-describedby={undefined}>
              <div onClick={(e) => e.target === e.currentTarget && ws.setSettingsOpen(false)} className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.98, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: 8 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="pointer-events-auto flex h-[92vh] w-[94vw] flex-col overflow-hidden rounded-xl border border-line bg-canvas shadow-modal md:h-[min(640px,88vh)] md:w-[min(94vw,900px)] md:flex-row"
              >
                <Dialog.Title className="sr-only">Settings</Dialog.Title>

                {/* section rail — vertical on desktop, a horizontal scroll strip on mobile */}
                <nav className="flex shrink-0 gap-2 overflow-x-auto border-b border-line bg-surface-2 p-2 md:w-[212px] md:flex-col md:gap-4 md:overflow-x-visible md:overflow-y-auto md:border-b-0 md:border-r md:p-3">
                  <div className="hidden items-center gap-2 px-2 pt-1 md:flex">
                    <LogoMark size={20} />
                    <span className="text-[13px] font-semibold text-ink">{workspaces[0].name}</span>
                  </div>
                  {NAV.map((g) => (
                    <div key={g.group} className="flex shrink-0 items-center gap-1 md:block">
                      <p className="hidden px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint md:block">{g.group}</p>
                      <div className="flex gap-1 md:block md:space-y-0.5">
                        {g.items.map((it) => (
                          <button
                            key={it.id}
                            type="button"
                            onClick={() => setSection(it.id)}
                            className={cn(
                              'flex h-8 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 text-[13px] transition-colors duration-120 md:w-full md:px-2',
                              section === it.id ? 'bg-selected font-medium text-ink' : 'text-muted hover:bg-hover',
                            )}
                          >
                            <it.icon size={15} className="shrink-0 opacity-80" />
                            {it.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </nav>

                {/* content */}
                <div className="relative min-w-0 flex-1">
                  <Dialog.Close asChild>
                    <button
                      aria-label="Close settings"
                      className="absolute right-4 top-4 z-10 flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink"
                    >
                      <X size={17} />
                    </button>
                  </Dialog.Close>
                  <div className="scrollarea h-full overflow-y-auto px-5 py-6 md:px-8 md:py-7">
                    <div className="mx-auto max-w-[520px]">
                      <Body />
                    </div>
                  </div>
                </div>
              </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
