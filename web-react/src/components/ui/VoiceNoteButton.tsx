/* Hallmark · component: voice note button · genre: modern-minimal
 * theme: project tokens (index.css)
 * states: idle · starting · recording · uploading · error (reported by caller)
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square, X } from 'lucide-react';
import { formatElapsed, micErrorMessage, startRecording, type Recording } from '../../lib/recorder';
import { fileUrl, isAudioFile, uploadFile, type StoredFile } from '../../lib/uploads';
import { IconButton } from './IconButton';

/**
 * The files on a comment, as players. Not <Attachments>: its compact row has
 * no player and its full list is an upload zone, and a comment needs neither.
 * Anything that is not a sound is a link, so a file posted some other way
 * still opens.
 */
export function CommentFiles({ files, onRemove }: { files?: StoredFile[]; onRemove?: (f: StoredFile) => void }) {
  if (!files?.length) return null;
  return (
    <div className="mt-1.5 w-full space-y-1">
      {files.map((f) => (
        <div key={f.key} className="flex w-full items-center gap-1">
          {isAudioFile(f)
            ? <audio src={fileUrl(f)} controls preload="metadata" className="h-8 w-full min-w-0 flex-1" aria-label={f.name} />
            : <a href={fileUrl(f)} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate text-2xs text-accent-strong hover:underline">{f.name}</a>}
          {onRemove && <IconButton size="sm" tone="danger" icon={<X size={12} />} label="Remove voice note" onClick={() => onRemove(f)} />}
        </div>
      ))}
    </div>
  );
}

/**
 * The mic beside a comment box's Send button.
 *
 * Press it and it becomes the recording: a red dot, how long it has run, and
 * Stop or throw away. Stop uploads the note and hands it to the composer,
 * which holds it until the comment is sent — so a note can be listened to,
 * removed, or sent with words beside it. Unmounting mid-recording (the panel
 * closed, the page changed) throws the recording away and frees the mic.
 *
 * Errors go to `onError` so they appear where the panel already shows its own.
 */
export function VoiceNoteButton({
  onRecorded,
  onError,
  disabled,
}: {
  onRecorded: (file: StoredFile) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'uploading'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<Recording | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      rec.current?.cancel();
      rec.current = null;
    };
  }, []);

  const store = async (file: File) => {
    rec.current = null;
    if (!alive.current) return;
    setState('uploading');
    try {
      const stored = await uploadFile(file);
      if (alive.current) onRecorded(stored);
    } catch (e) {
      if (alive.current) onError(e instanceof Error ? e.message : 'Could not upload the voice note.');
    } finally {
      if (alive.current) setState('idle');
    }
  };

  const start = async () => {
    setState('starting');
    setElapsed(0);
    try {
      const r = await startRecording({ onTick: setElapsed, onAutoStop: (f) => void store(f) });
      if (!alive.current) { r.cancel(); return; }
      rec.current = r;
      setState('recording');
    } catch (e) {
      setState('idle');
      onError(micErrorMessage(e));
    }
  };

  const stop = async () => {
    const r = rec.current;
    if (!r) return;
    await store(await r.stop());
  };

  const cancel = () => {
    rec.current?.cancel();
    rec.current = null;
    setState('idle');
  };

  if (state === 'recording') {
    return (
      <div className="mb-0.5 flex shrink-0 items-center gap-1" role="status" aria-label="Recording a voice note">
        <span className="h-2 w-2 animate-pulse rounded-full bg-danger" aria-hidden />
        <span className="w-9 text-2xs tabular-nums text-muted">{formatElapsed(elapsed)}</span>
        <IconButton size="sm" icon={<Square size={12} />} label="Stop and attach" onClick={() => void stop()} />
        <IconButton size="sm" tone="danger" icon={<X size={13} />} label="Discard recording" onClick={cancel} />
      </div>
    );
  }
  const busy = state !== 'idle';
  return (
    <IconButton
      icon={busy ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
      label="Record a voice note"
      onClick={() => void start()}
      disabled={disabled || busy}
      className="mb-0.5"
    />
  );
}
