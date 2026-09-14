/* Hallmark · component: attachment list · genre: modern-minimal
 * theme: project tokens (index.css)
 * states: default · hover · focus-visible · dragging · uploading · error · empty
 */
import { useRef, useState } from 'react';
import { Download, FileText, Paperclip, Upload, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import {
  chooseFiles,
  fileUrl,
  formatBytes,
  isAudioFile,
  isImageFile,
  isVideoFile,
  uploadFile,
  type StoredFile,
} from '../../lib/uploads';

/**
 * Files on a task or a page.
 *
 * One component for both, and for the `file` property, because they are the
 * same thing stored in three places: the bytes go to the content-addressed
 * blob store either way, so a file attached to a task and an image pasted into
 * its page are one kind of object underneath.
 *
 * An image shows itself, a video and a sound play in place, and everything else
 * is a chip you can download — a list of hashes tells you nothing about what
 * you attached. `compact` is the row that sits in a property grid, where there
 * is no width for a preview.
 */
export function Attachments({
  files,
  onChange,
  compact,
  readOnly,
  label = 'Add a file',
}: {
  files: StoredFile[];
  onChange: (next: StoredFile[]) => void;
  compact?: boolean;
  readOnly?: boolean;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  // Drag events fire on children too, so a plain boolean flickers as the
  // pointer crosses the label inside the zone. Counting enters and leaves is
  // the usual fix.
  const depth = useRef(0);

  const store = async (picked: File[]) => {
    if (!picked.length) return;
    setBusy(true);
    setError(null);
    try {
      const stored: StoredFile[] = [];
      for (const file of picked) stored.push(await uploadFile(file));
      // De-duplicated by key: the same bytes attached twice is one file.
      const merged = [...files];
      for (const f of stored) if (!merged.some((x) => x.key === f.key)) merged.push(f);
      onChange(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload that.');
    } finally {
      setBusy(false);
    }
  };

  const remove = (file: StoredFile) => onChange(files.filter((x) => x.key !== file.key));

  const addButton = !readOnly && (
    <button
      type="button"
      onClick={async () => store(await chooseFiles())}
      disabled={busy}
      className={cn(
        'flex items-center gap-1.5 rounded-md text-2xs text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-60',
        compact ? 'h-7 px-1.5' : 'h-8 px-2',
      )}
    >
      <Upload size={13} /> {busy ? 'Uploading…' : files.length ? 'Add another' : label}
    </button>
  );

  if (compact) {
    return (
      <div className="min-w-0">
        {files.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {files.map((f) => (
              <span
                key={f.key}
                className="flex max-w-full items-center gap-1.5 rounded-md border border-line bg-surface py-1 pl-1.5 pr-1 text-2xs"
              >
                {isImageFile(f)
                  ? <img src={fileUrl(f)} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
                  : <Paperclip size={12} className="shrink-0 text-faint" />}
                <a
                  href={fileUrl(f)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="min-w-0 flex-1 truncate text-ink hover:text-accent-strong hover:underline"
                  title={`${f.name}${f.size ? ` · ${formatBytes(f.size)}` : ''}`}
                >
                  {f.name}
                </a>
                {!readOnly && (
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => remove(f)}
                    className="shrink-0 text-faint hover:text-danger"
                  >
                    <X size={11} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        {addButton}
        {error && <p className="mt-1 text-2xs text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div
      onDragEnter={(e) => {
        if (readOnly || !e.dataTransfer.types.includes('Files')) return;
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => { if (!readOnly && e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
      onDrop={(e) => {
        if (readOnly) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        store([...e.dataTransfer.files]);
      }}
      className={cn(
        'rounded-lg border border-dashed transition-colors',
        over ? 'border-accent bg-accent-soft' : 'border-transparent',
      )}
    >
      {files.length > 0 && (
        <ul className="mb-1 space-y-1.5">
          {files.map((f) => (
            <li
              key={f.key}
              className="group flex items-start gap-2.5 rounded-lg border border-line bg-canvas p-2 transition-colors hover:border-line-strong"
            >
              <Preview file={f} />
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="truncate text-sm text-ink" title={f.name}>{f.name}</p>
                <p className="mt-0.5 text-2xs text-faint">
                  {[f.mime.split('/')[1]?.toUpperCase(), formatBytes(f.size)].filter(Boolean).join(' · ')}
                </p>
              </div>
              <a
                href={fileUrl(f)}
                download={f.name}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`Download ${f.name}`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink"
              >
                <Download size={14} />
              </a>
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => remove(f)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-danger"
                >
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {files.length === 0 && !readOnly && (
        <p className="px-1 pb-1 text-2xs text-faint">Drop a file here, or</p>
      )}
      {addButton}
      {error && <p className="mt-1 px-1 text-2xs text-danger">{error}</p>}
    </div>
  );
}

/** What the file looks like, at the one size a list row has room for. */
function Preview({ file }: { file: StoredFile }) {
  if (isImageFile(file)) {
    return (
      <a href={fileUrl(file)} target="_blank" rel="noreferrer noopener" className="shrink-0">
        <img
          src={fileUrl(file)}
          alt={file.name}
          loading="lazy"
          className="h-14 w-14 rounded-md border border-line object-cover"
        />
      </a>
    );
  }
  if (isVideoFile(file)) {
    // preload="metadata" so a row of videos costs a few kilobytes rather than
    // every file in the list at once.
    return <video src={fileUrl(file)} controls preload="metadata" className="h-14 w-24 shrink-0 rounded-md bg-surface" />;
  }
  if (isAudioFile(file)) {
    return <audio src={fileUrl(file)} controls preload="metadata" className="h-8 w-48 shrink-0" />;
  }
  return (
    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-faint">
      <FileText size={20} />
    </span>
  );
}
