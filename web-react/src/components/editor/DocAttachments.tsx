/* Hallmark · component: page attachments section · genre: modern-minimal
 * theme: project tokens (index.css)
 * states: default · hover · focus-visible · dragging · uploading · error
 * · loading (silent) · empty (collapsed to one button)
 */
import { useEffect, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { docsApi } from '../../lib/docsApi';
import type { StoredFile } from '../../lib/uploads';
import { Attachments } from '../ui/Attachments';

/**
 * Files that belong to the page but are not in it.
 *
 * An image pasted into the body is part of the writing; the signed contract,
 * the recording of the call, the spreadsheet the numbers came from are not —
 * they are things the page needs to carry. They sit at the end of the document
 * on its own measure, under the content and above its linked references, which
 * is where every document tool that has both puts them.
 *
 * Unlike Backlinks this stays visible when empty: attaching a file has to be
 * discoverable, and nobody goes looking for a section that isn't drawn.
 */
export function DocAttachments({ docId, fullWidth }: { docId: string; fullWidth: boolean }) {
  const [files, setFiles] = useState<StoredFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setFiles(null);
    setError(null);
    docsApi
      .attachments(docId)
      .then((r) => alive && setFiles(r))
      .catch(() => alive && setFiles([]));
    return () => { alive = false; };
  }, [docId]);

  // Silent while loading: a skeleton here would flash on every page open.
  if (files === null) return null;

  const save = async (next: StoredFile[]) => {
    const before = files;
    setFiles(next); // optimistic — the upload already happened, this is the pointer
    setError(null);
    try {
      await docsApi.setAttachments(docId, next);
    } catch {
      setFiles(before);
      setError('Could not save that. The file is uploaded — try again.');
    }
  };

  return (
    <section
      aria-label="Attachments"
      className={[
        'mx-auto w-full animate-fade-in',
        fullWidth ? 'max-w-none px-[clamp(40px,7vw,120px)]' : 'max-w-[var(--reading-w)] px-6',
      ].join(' ')}
    >
      <div className="border-t border-line pt-5">
        <h2 className="mb-1.5 flex items-center gap-1.5 px-2 text-2xs font-semibold uppercase tracking-wide text-faint">
          <Paperclip size={12} />
          Attachments
          {files.length > 0 && <span className="font-normal normal-case tracking-normal">{files.length}</span>}
        </h2>
        <Attachments files={files} onChange={save} label="Attach a file" />
        {error && <p className="mt-1 px-1 text-2xs text-danger">{error}</p>}
      </div>
    </section>
  );
}
