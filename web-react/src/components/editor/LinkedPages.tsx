/* Hallmark · component: linked-pages section · genre: modern-minimal
 * theme: project tokens (index.css) · states: default · hover · focus · active
 * · loading · error · empty (renders nothing) · one direction only
 */
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { docsApi, type BacklinkRow } from '../../lib/docsApi';
import { relativeTime } from '../../lib/time';
import { PageIcon } from '../ui/PageIcon';

interface Props {
  docId: string;
  /** Bumped after a save so a link typed a moment ago appears without a reload. */
  refreshKey: number;
  fullWidth: boolean;
  onOpen: (id: string) => void;
}

/**
 * Both ends of every link this page is part of.
 *
 * It used to show one: the pages that reference this one. So linking A to B
 * put a section at the foot of B and nothing at the foot of A — the page you
 * were standing on when you made the link had no record of it anywhere except
 * as a chip buried in its own prose. Referencing a page mid-sentence, which is
 * the ordinary way to do it, left the same gap.
 *
 * Two lists, then, and the direction is said out loud rather than implied:
 * what this page points at, and what points at it. Both come from the same
 * `doc_links` table the sidebar hangs children off, so a link drawn by a drag
 * and a link typed with "@" land in exactly the same place.
 *
 * Renders nothing at all when there is nothing in either. A linked-pages block
 * is only worth the vertical space once it has something in it; an empty one
 * on every page would be permanent furniture that never pays rent.
 */
export function LinkedPages({ docId, refreshKey, fullWidth, onOpen }: Props) {
  const [out, setOut] = useState<BacklinkRow[] | null>(null);
  const [incoming, setIncoming] = useState<BacklinkRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    // One `catch` for the pair: either endpoint failing means the section
    // cannot claim to be complete, and two half-answers is worse than one
    // honest line saying it could not load.
    Promise.all([docsApi.links(docId), docsApi.backlinks(docId)])
      .then(([o, i]) => {
        if (!alive) return;
        setOut(o);
        setIncoming(i);
      })
      .catch(() => {
        if (!alive) return;
        setOut([]);
        setIncoming([]);
        setFailed(true);
      });
    return () => { alive = false; };
  }, [docId, refreshKey]);

  // Loading and empty are both silent: this section appears when it has
  // something to say. A skeleton here would flash on every page open.
  if (out === null || incoming === null) return null;
  if (!out.length && !incoming.length && !failed) return null;

  return (
    <section
      aria-label="Linked pages"
      className={[
        'mx-auto w-full animate-fade-in',
        fullWidth ? 'max-w-none px-[clamp(40px,7vw,120px)]' : 'max-w-[var(--reading-w)] px-6',
      ].join(' ')}
    >
      <div className="space-y-4 border-t border-line pt-5">
        {failed ? (
          // A links fetch that fails costs the reader nothing — say so once,
          // quietly, and never in the danger colour.
          <p className="px-2 py-1 text-sm text-faint">Couldn&apos;t load linked pages.</p>
        ) : (
          <>
            <Group
              icon={<ArrowUpRight size={14} />}
              title="Links from this page"
              rows={out}
              onOpen={onOpen}
            />
            <Group
              icon={<ArrowDownLeft size={14} />}
              title="Links to this page"
              rows={incoming}
              onOpen={onOpen}
            />
          </>
        )}
      </div>
    </section>
  );
}

/** One direction. Draws nothing when it has nothing, so a page that only ever
 *  links outward doesn't carry an empty "Links to this page" heading. */
function Group({ icon, title, rows, onOpen }: {
  icon: React.ReactNode;
  title: string;
  rows: BacklinkRow[];
  onOpen: (id: string) => void;
}) {
  if (!rows.length) return null;
  return (
    <div>
      <h2 className="mb-1.5 flex items-center gap-1.5 px-2 text-2xs font-semibold uppercase tracking-wide text-faint">
        {icon}
        {title}
        <span className="font-normal tabular-nums">{rows.length}</span>
      </h2>
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onOpen(r.id)}
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors duration-120 hover:bg-hover active:bg-selected"
        >
          <PageIcon icon={r.icon} size={16} />
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.title || 'Untitled'}</span>
          <span className="shrink-0 text-2xs tabular-nums text-faint">{relativeTime(r.updated_at)}</span>
        </button>
      ))}
    </div>
  );
}
