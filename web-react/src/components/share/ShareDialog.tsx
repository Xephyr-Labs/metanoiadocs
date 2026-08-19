import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Check, Copy, Globe, Link2, Loader2, Lock, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { docsApi, type AccessRow } from '../../lib/docsApi';
import { copyText } from '../../lib/clipboard';
import { sendInvite } from '../../lib/api';
import { avatarFor } from '../../lib/avatar';
import { useWorkspace } from '../../store/workspace';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
import { field } from '../ui/styles';
import { Modal } from '../ui/Modal';

export function ShareDialog() {
  const ws = useWorkspace();
  const docId = ws.currentId;
  const [access, setAccess] = useState<AccessRow[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyLink, setBusyLink] = useState(false);

  useEffect(() => {
    if (!ws.shareOpen || !docId) return;
    setMsg(null);
    docsApi.access(docId).then(setAccess).catch(() => setAccess([]));
    docsApi.publicGet(docId).then((r) => setToken(r.token)).catch(() => setToken(null));
  }, [ws.shareOpen, docId]);

  const invite = async () => {
    if (!docId || inviting) return;
    setMsg(null);
    setInviting(true);
    // Try to grant access to an existing user; if they haven't signed up yet,
    // fall back to a workspace invite email.
    try {
      await docsApi.shareWith(docId, inviteEmail.trim());
      setMsg({ ok: true, text: `${inviteEmail.trim()} now has access.` });
      setInviteEmail('');
      docsApi.access(docId).then(setAccess).catch(() => {});
    } catch (e) {
      const err = e instanceof Error ? e.message : '';
      if (/signed in|not found/i.test(err)) {
        const r = await sendInvite(inviteEmail);
        setMsg(r.ok ? { ok: true, text: `Invitation emailed to ${inviteEmail.trim()}.` } : { ok: false, text: r.error ?? 'Invite failed.' });
        if (r.ok) setInviteEmail('');
      } else {
        setMsg({ ok: false, text: err || 'Could not share.' });
      }
    } finally {
      setInviting(false);
    }
  };

  const togglePublic = async () => {
    if (!docId || busyLink) return;
    setBusyLink(true);
    try {
      if (token) { await docsApi.publicDisable(docId); setToken(null); }
      else { const r = await docsApi.publicEnable(docId); setToken(r.token); }
      ws.refresh();
    } finally {
      setBusyLink(false);
    }
  };

  const link = token ? `${location.origin}/share/${token}` : '';
  const copy = async () => {
    if (!link) return;
    if (!(await copyText(link))) {
      setMsg({ ok: false, text: 'Could not copy — your browser blocked clipboard access.' });
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Modal
      open={ws.shareOpen}
      onOpenChange={ws.setShareOpen}
      title={<><Users size={16} className="text-muted" /> Share this page</>}
    >
      <div className="p-4">
        <div className="flex gap-2">
          <input
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && invite()}
            type="email"
            placeholder="Invite by email…"
            className={cn(field, "flex-1")}
          />
          <Button variant="primary" onClick={invite} disabled={inviting} leftIcon={inviting ? <Loader2 size={14} className="animate-spin" /> : undefined}>Invite</Button>
        </div>
        {msg && (
          <p className={cn('mt-2 flex items-center gap-1.5 text-xs', msg.ok ? 'text-accent' : 'text-danger')}>
            {msg.ok ? <Check size={14} /> : <AlertCircle size={14} />}{msg.text}
          </p>
        )}

        <div className="mt-4 space-y-0.5">
          <p className="px-1 pb-1 text-2xs font-semibold uppercase tracking-wide text-faint">People with access</p>
          {access.map((r) => {
            const a = avatarFor(r.name || r.email);
            return (
              <div key={r.id} className="flex items-center gap-2.5 rounded-md px-1 py-1.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full text-2xs font-semibold text-white" style={{ background: a.color }}>{a.initials}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{r.name || r.email}</p>
                  <p className="truncate text-2xs text-faint">{r.email}</p>
                </div>
                <span className="text-sm capitalize text-muted">{r.role}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-line bg-surface/60 p-4">
        <div className="flex items-center gap-2.5">
          <span className={cn('flex h-8 w-8 items-center justify-center rounded-md', token ? 'bg-accent-soft text-accent' : 'bg-hover text-muted')}>
            {token ? <Globe size={16} /> : <Lock size={16} />}
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium text-ink">{token ? 'Anyone with the link' : 'Only invited people'}</p>
            <p className="text-2xs text-faint">{token ? 'Can view this page' : 'Link sharing is off'}</p>
          </div>
          <button type="button" role="switch" aria-checked={!!token} onClick={togglePublic} disabled={busyLink} className={cn('relative h-[22px] w-[38px] rounded-full transition-colors duration-180', token ? 'bg-accent' : 'bg-line-strong')}>
            <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 34 }} className={cn('absolute top-[3px] h-4 w-4 rounded-full bg-white shadow', token ? 'left-[19px]' : 'left-[3px]')} />
          </button>
        </div>

        <AnimatePresence>
          {token && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="mt-3 flex items-center gap-2 rounded-md bg-canvas px-2.5 py-1.5 ring-1 ring-inset ring-line">
                <Link2 size={14} className="shrink-0 text-faint" />
                <span className="flex-1 truncate text-sm text-muted">{link}</span>
                <Button size="sm" variant="ghost" leftIcon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
}
