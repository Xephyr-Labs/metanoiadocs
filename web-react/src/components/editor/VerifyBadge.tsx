import { BadgeCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { canEditRole, docsApi, type UserRow } from '../../lib/docsApi';
import { calendarDate, fullTime } from '../../lib/time';
import { toast } from '../../lib/toast';
import type { Page } from '../../lib/types';
import { useWorkspace } from '../../store/workspace';
import { Menu, type MenuItem } from '../ui/Menu';

const EVERY: [number, string][] = [[30, '30 days'], [90, '90 days'], [180, '180 days'], [0, 'Never']];

/** Why a page asks for another look, in the words the header shows. */
const reasonOf = (reason?: 'expired' | 'edited') => (reason === 'edited' ? 'edited since' : 'review due');

/**
 * The page header's verification badge (server/src/verify.js).
 *
 * Everyone sees Verified (green) or Needs review (amber); an unverified page
 * shows nothing to a reader and one quiet "Verify" to someone who can edit it.
 * Anyone who can edit can verify, re-verify, change the interval or owner, or
 * take the verification off — the same rule the server enforces.
 */
export function VerifyBadge({ page }: { page: Page }) {
  const ws = useWorkspace();
  const v = page.verify;
  const canEdit = canEditRole(page.role);
  const [people, setPeople] = useState<UserRow[]>([]);
  useEffect(() => {
    if (!canEdit) return;
    let live = true;
    docsApi.users().then((u) => { if (live) setPeople(u.filter((p) => p.kind !== 'agent')); }).catch(() => {});
    return () => { live = false; };
  }, [canEdit]);

  if (v.state === 'unverified' && !canEdit) return null;

  const run = async (act: () => Promise<Page['verify']>) => {
    try {
      ws.setVerification(page.id, await act());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change the verification.');
    }
  };
  const current = v.state === 'unverified' ? undefined : v;
  const verify = (body: { every?: number; ownerId?: string }) => run(() => docsApi.verify(page.id, body));

  const items: MenuItem[] = [
    { label: v.state === 'unverified' ? 'Verify this page' : 'Verify again', icon: BadgeCheck, onSelect: () => verify({ every: current?.every, ownerId: current?.owner.id }) },
    {
      label: 'Review every',
      items: EVERY.map(([days, label]) => ({
        label,
        checked: (current?.every ?? 90) === days,
        onSelect: () => verify({ every: days, ownerId: current?.owner.id }),
      })),
    },
    ...(people.length ? [{
      label: `Owner: ${current?.owner.name ?? 'you'}`,
      items: people.map((p) => ({
        label: p.name || p.email,
        checked: p.id === current?.owner.id,
        onSelect: () => verify({ every: current?.every, ownerId: p.id }),
      })),
    }] : []),
    ...(current ? [{ label: 'Remove verification', danger: true, separatorBefore: true, onSelect: () => run(() => docsApi.unverify(page.id)) }] : []),
  ];

  const body = (() => {
    if (v.state === 'unverified') {
      return <span className="flex items-center gap-1 text-faint hover:text-ink"><BadgeCheck size={12} /> Verify</span>;
    }
    const when = calendarDate(v.verifiedAt);
    if (v.state === 'verified') {
      return (
        <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
          <BadgeCheck size={12} /> Verified by {v.verifiedBy.name ?? 'someone'} · {when}
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
        <TriangleAlert size={12} /> Needs review · {reasonOf(v.reason)} · verified by {v.verifiedBy.name ?? 'someone'}, {when}
      </span>
    );
  })();

  const title = current
    ? `Verified ${fullTime(current.verifiedAt)} by ${current.verifiedBy.name ?? 'someone'}. Owner: ${current.owner.name ?? 'the verifier'}. ${current.every ? `Reviewed every ${current.every} days.` : 'Never expires.'}`
    : 'Vouch that this page is accurate';

  // A reader gets the badge as plain text; only editors get the menu.
  if (!canEdit) return <span title={title} className="rounded-full px-1.5 py-0.5">{body}</span>;
  return (
    <Menu
      trigger={<button type="button" title={title} className={cn('rounded-full px-1.5 py-0.5 transition-colors hover:bg-hover')}>{body}</button>}
      items={items}
      align="start"
    />
  );
}
