/* Hallmark · component: linked-references section · genre: modern-minimal
 * theme: project tokens (index.css) · states: default · hover · focus · active
 * · loading · error · empty (renders nothing) · disabled (n/a — navigation only)
 */
import { Link2 } from 'lucide-react';
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
 * "Linked references" — the pages that @-reference this one. Sits below the
 * content on the document's own measure, so it reads as the end of the page
 * rather than a separate panel.
 *
 * Renders nothing at all when there are none. A backlinks block is only worth
 * the vertical space once it has something in it; an empty one on every page
 * would be permanent furniture that never pays rent.
 */
export function Backlinks({ docId, refreshKey, fullWidth, onOpen }: Props) {
  const [rows, setRows] = useState<BacklinkRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    docsApi
      .backlinks(docId)
      .then((r) => alive && setRows(r))
      .catch(() => {
        if (!alive) return;
        setRows([]);
        setFailed(true);
      });
    return () => { alive = false; };
  }, [docId, refreshKey]);

  // Loading and empty are both silent: this section appears when it has
  // something to say. A skeleton here would flash on every page open.
  if (rows === null) return null;
  if (!rows.length && !failed) return null;

  return (
    <section
      aria-label="Linked references"
      className={[
        'mx-auto w-full animate-fade-in',
        fullWidth ? 'max-w-none px-[clamp(40px,7vw,120px)]' : 'max-w-[var(--reading-w)] px-6',
      ].join(' ')}
    >
      <div className="border-t border-line pt-5">
        <h2 className="mb-1.5 flex items-center gap-1.5 px-2 text-2xs font-semibold uppercase tracking-wide text-faint">
          <Link2 size={14} />
          Linked references
          {rows.length > 0 && <span className="font-normal tabular-nums">{rows.length}</span>}
        </h2>

        {failed ? (
          // A backlinks fetch that fails costs the reader nothing — say so once,
          // quietly, and never in the danger colour.
          <p className="px-2 py-1 text-sm text-faint">Couldn&apos;t load linked references.</p>
        ) : (
          rows.map((r) => (
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
          ))
        )}
      </div>
    </section>
  );
}
