import { useEffect, useRef, useState } from 'react';
import { ChevronRight, ExternalLink, FileText, Folder, HardDrive, Search } from 'lucide-react';
import { docsApi, type DriveFile, type DriveStatus } from '../../lib/docsApi';
import { relativeTime } from '../../lib/time';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';

/** Rows asked for at once. A folder bigger than this is what search is for. */
const LIMIT = 200;

/**
 * The workspace's shared Google drive, browsed here.
 *
 * Reads the server's mirror (drive_files), not Google: the list is instant
 * and the same one the agents see. Opening a file goes to Drive itself, where
 * it is edited; nothing is copied into a page.
 */
export function DriveView() {
  const ws = useWorkspace();
  const { user } = useAuth();
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [error, setError] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    docsApi.driveStatus().then(setStatus).catch((e) => setError(e.message));
  }, []);

  const folder = trail.at(-1)?.id ?? status?.driveId ?? undefined;
  const q = query.trim();

  useEffect(() => {
    if (!status?.connected) return;
    const n = ++seq.current;
    // Typing searches the whole drive; a debounce keeps it to one request a word.
    const t = setTimeout(() => {
      docsApi
        .driveFiles(q ? { q, limit: LIMIT } : { folder, limit: LIMIT })
        .then((rows) => n === seq.current && setFiles(rows))
        .catch((e) => n === seq.current && setError(e.message));
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [status?.connected, folder, q]);

  const header = (
    <header className="mb-5">
      <h1 className="font-display text-2xl font-semibold leading-7 tracking-[-0.03em] text-ink md:text-3xl">
        {status?.driveName || 'Drive'}
      </h1>
      {status?.connected && (
        <p className="mt-0.5 text-sm text-muted">
          {status.fileCount} files in the shared {status.rootKind === 'folder' ? 'folder' : 'drive'}
          {status.lastSyncAt && <> · checked {relativeTime(status.lastSyncAt)}</>}
        </p>
      )}
    </header>
  );

  if (status && !status.connected) {
    return (
      <Shell>
        {header}
        <EmptyState
          icon={HardDrive}
          title="No drive connected"
          hint={
            user?.role === 'admin'
              ? 'Connect the team’s shared Google drive in Settings.'
              : 'An admin can connect the team’s shared Google drive in Settings.'
          }
          action={
            user?.role === 'admin'
              ? <Button size="sm" variant="primary" onClick={() => ws.setSettingsOpen(true)}>Open settings</Button>
              : undefined
          }
        />
      </Shell>
    );
  }

  return (
    <Shell>
      {header}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the whole drive by name…"
            aria-label="Search Drive files"
            className="h-8 w-full rounded-md bg-surface pl-8 pr-2.5 text-sm text-ink outline-none ring-1 ring-inset ring-line placeholder:text-faint focus:ring-2 focus:ring-accent"
          />
        </label>
      </div>

      {!q && (
        <nav aria-label="Folder" className="mb-3 flex flex-wrap items-center gap-1 text-sm text-muted">
          <button type="button" className="rounded px-1 hover:bg-hover hover:text-ink" onClick={() => setTrail([])}>
            {status?.driveName || 'Drive'}
          </button>
          {trail.map((f, i) => (
            <span key={f.id} className="flex items-center gap-1">
              <ChevronRight size={14} className="text-faint" />
              <button
                type="button"
                className="rounded px-1 hover:bg-hover hover:text-ink"
                aria-current={i === trail.length - 1 ? 'page' : undefined}
                onClick={() => setTrail(trail.slice(0, i + 1))}
              >
                {f.name}
              </button>
            </span>
          ))}
        </nav>
      )}

      {error ? (
        <p className="text-sm text-danger-strong">{error}</p>
      ) : files === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : files.length === 0 ? (
        <EmptyState
          icon={q ? Search : Folder}
          title={q ? 'Nothing matches' : 'This folder is empty'}
          hint={q ? 'Try part of the name.' : status?.lastError ? `Last check failed: ${status.lastError}` : undefined}
        />
      ) : (
        <>
          <div className="rounded-lg border border-line">
            {files.map((f) => (
              <FileRow key={f.id} file={f} onOpenFolder={() => { setQuery(''); setTrail([...trail, { id: f.id, name: f.name }]); }} />
            ))}
          </div>
          {files.length === LIMIT && (
            <p className="mt-3 text-xs text-muted">Showing the first {LIMIT}. Search to find the rest.</p>
          )}
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="scrollarea h-full overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-[1100px] px-6 py-8 md:px-10">{children}</div>
    </div>
  );
}

export function DriveFileIcon({ file }: { file: DriveFile }) {
  if (file.isFolder) return <Folder size={16} className="shrink-0 text-faint" />;
  // Google's own icon says Doc / Sheet / PDF at a glance; it is a 16px image.
  if (file.iconLink) return <img src={file.iconLink} alt="" width={16} height={16} className="shrink-0" />;
  return <FileText size={16} className="shrink-0 text-faint" />;
}

function FileRow({ file, onOpenFolder }: { file: DriveFile; onOpenFolder: () => void }) {
  const body = (
    <>
      <DriveFileIcon file={file} />
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{file.name}</span>
      {file.modifiedBy && <span className="hidden w-40 shrink-0 truncate text-2xs text-faint md:block">{file.modifiedBy}</span>}
      <span className="w-20 shrink-0 text-right text-2xs tabular-nums text-faint">
        {file.modifiedAt ? relativeTime(file.modifiedAt) : ''}
      </span>
      {file.isFolder ? <ChevronRight size={12} className="shrink-0 text-faint" /> : <ExternalLink size={12} className="shrink-0 text-faint" />}
    </>
  );
  const cls = 'flex w-full items-center gap-2.5 border-b border-line px-3 py-2.5 text-left transition-colors duration-120 last:border-0 hover:bg-hover';
  return file.isFolder ? (
    <button type="button" onClick={onOpenFolder} className={cls}>{body}</button>
  ) : (
    <a href={file.url ?? '#'} target="_blank" rel="noreferrer" className={cls}>{body}</a>
  );
}
