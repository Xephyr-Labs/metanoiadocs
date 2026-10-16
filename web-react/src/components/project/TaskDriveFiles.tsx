import { useEffect, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { docsApi, type DriveFile } from '../../lib/docsApi';
import { toast } from '../../lib/toast';
import { DriveFileIcon } from '../drive/DriveView';
import { IconButton } from '../ui/IconButton';
import { SearchSelect } from '../ui/SearchSelect';

/** Files offered in the picker. ponytail: the newest N, filtered in the
 *  browser; a server-side search box when a drive outgrows it. */
const PICK_LIMIT = 500;

/**
 * Files from the workspace's shared drive linked to one task. Hidden entirely
 * while no drive is connected and nothing was ever linked.
 */
export function TaskDriveFiles({ taskId }: { taskId: string }) {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [connected, setConnected] = useState(false);
  const [choices, setChoices] = useState<DriveFile[] | null>(null);

  useEffect(() => {
    let live = true;
    docsApi.taskDriveFiles(taskId).then((r) => live && setFiles(r)).catch(() => {});
    docsApi.driveStatus().then((s) => live && setConnected(s.connected)).catch(() => {});
    return () => { live = false; };
  }, [taskId]);

  if (!connected && !files.length) return null;

  const openPicker = () =>
    docsApi.driveFiles({ limit: PICK_LIMIT })
      .then((r) => setChoices(r.filter((f) => !f.isFolder)))
      .catch((e) => toast(e.message));

  const attach = async (fileId: string) => {
    try {
      const f = await docsApi.attachDriveFile(taskId, fileId);
      setFiles((cur) => (cur.some((x) => x.id === f.id) ? cur : [...cur, f]));
      setChoices(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not attach that file.');
    }
  };

  const detach = async (fileId: string) => {
    setFiles((cur) => cur.filter((f) => f.id !== fileId));
    await docsApi.detachDriveFile(taskId, fileId).catch(() => toast('Could not remove that link.'));
  };

  const linked = new Set(files.map((f) => f.id));

  return (
    <section className="px-4 py-3" aria-label="Drive files">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-2xs font-semibold uppercase text-muted">Drive files</h3>
        {connected && choices === null && (
          <IconButton size="sm" icon={<Paperclip size={14} />} label="Attach a Drive file" onClick={openPicker} />
        )}
      </div>
      {choices !== null && (
        <div className="mb-2 flex items-center gap-2">
          <SearchSelect
            value={null}
            label="Drive file"
            placeholder="Choose a file…"
            empty="No files in the drive."
            searchable
            options={choices.filter((f) => !linked.has(f.id)).map((f) => ({ value: f.id, label: f.name, lead: <DriveFileIcon file={f} /> }))}
            onChange={attach}
            className="flex-1"
          />
          <IconButton size="sm" icon={<X size={14} />} label="Cancel" onClick={() => setChoices(null)} />
        </div>
      )}
      {files.length === 0 ? (
        <p className="text-xs text-faint">None yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {files.map((f) => (
            <li key={f.id} className="group/file flex items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-hover">
              {f.missing ? (
                <span className="min-w-0 flex-1 truncate italic text-faint">A file no longer in the drive</span>
              ) : (
                <a href={f.url ?? '#'} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-2 text-ink">
                  <DriveFileIcon file={f} />
                  <span className="truncate">{f.name}</span>
                </a>
              )}
              <IconButton size="sm" icon={<X size={12} />} label={`Remove ${f.name ?? 'link'}`} onClick={() => detach(f.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
