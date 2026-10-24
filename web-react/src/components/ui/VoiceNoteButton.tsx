/* Hallmark · component: voice note button · genre: modern-minimal
 * theme: project tokens (index.css)
 * states: idle · starting · recording · uploading · error (reported by caller)
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square, X } from 'lucide-react';
import { formatElapsed, micErrorMessage, startRecording, type Recording } from '../../lib/recorder';
import { discardUpload, fileUrl, isAudioFile, uploadFile, type StoredFile } from '../../lib/uploads';
import { IconButton } from './IconButton';
import { Transcript, useTranscriptionEnabled } from './Transcript';

/**
 * The files on a comment, as players. Not <Attachments>: its compact row has
 * no player and its full list is an upload zone, and a comment needs neither.
 * Anything that is not a sound is a link, so a file posted some other way
 * still opens.
 */
export function CommentFiles({ files, onRemove, share }: {
  files?: StoredFile[];
  onRemove?: (f: StoredFile) => void;
  /** A public link's token: how a guest, who has no session, may fetch the file. */
  share?: string;
}) {
  // A sent note (not the composer's pending one, not a guest's view) can show
  // its transcript, when the workspace transcribes.
  const transcribes = useTranscriptionEnabled() && !onRemove && !share;
  if (!files?.length) return null;
  const url = (f: StoredFile) => (share ? `${fileUrl(f)}&share=${encodeURIComponent(share)}` : fileUrl(f));
  return (
    <div className="mt-1.5 w-full space-y-1">
      {files.map((f) => (
        <div key={f.key} className="w-full">
          <div className="flex w-full items-center gap-1">
            {isAudioFile(f)
              ? <audio src={url(f)} controls preload="metadata" className="h-8 w-full min-w-0 flex-1" aria-label={f.name} />
              : <a href={url(f)} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate text-2xs text-accent-strong hover:underline">{f.name}</a>}
            {onRemove && <IconButton size="sm" tone="danger" icon={<X size={12} />} label="Remove voice note" onClick={() => onRemove(f)} />}
          </div>
          {transcribes && isAudioFile(f) && <Transcript fileKey={f.key} />}
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
/**
 * The note a composer is holding until Send, and whether one is still being
 * recorded or uploaded. A note that is replaced, removed, or left behind when
 * the composer goes away was never sent, so its file is taken back.
 */
export function usePendingNote() {
  const [note, setNote] = useState<StoredFile | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef<StoredFile | null>(null);
  useEffect(() => () => { if (latest.current) discardUpload(latest.current); }, []);
  const hold = (next: StoredFile | null) => { latest.current = next; setNote(next); };
  return {
    note,
    busy,
    setBusy,
    /** A new recording; the one it replaces is thrown away. */
    set: (f: StoredFile) => { if (latest.current && latest.current.key !== f.key) discardUpload(latest.current); hold(f); },
    /** Removed before sending: its file goes too. */
    discard: () => { if (latest.current) discardUpload(latest.current); hold(null); },
    /** Sent: the comment owns it now. */
    sent: () => hold(null),
  };
}

/** What Send says while a note is still on its way. */
export const VOICE_BUSY = 'Finish the voice note first.';

export function VoiceNoteButton({
  onRecorded,
  onError,
  onBusyChange,
  disabled,
}: {
  onRecorded: (file: StoredFile) => void;
  onError: (message: string) => void;
  /** True while recording or uploading — Send waits for the note. */
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'uploading'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<Recording | null>(null);
  const alive = useRef(true);
  const micRef = useRef<HTMLButtonElement>(null);
  const stopRef = useRef<HTMLButtonElement>(null);
  /** Set once Record is pressed, so mounting never pulls focus to the mic. */
  const engaged = useRef(false);

  // The mic and the recording controls replace each other, so whichever is
  // showing takes the focus — otherwise a keyboard user pressing Record lands
  // on <body> with Stop a long tab away. Only when focus was lost, though:
  // someone typing in the comment box meanwhile keeps their caret.
  useEffect(() => { onBusyChange?.(state !== 'idle'); }, [state, onBusyChange]);

  useEffect(() => {
    if (!engaged.current) return;
    if (state === 'idle') engaged.current = false;
    const lost = !document.activeElement || document.activeElement === document.body;
    if (!lost) return;
    if (state === 'recording') stopRef.current?.focus();
    else if (state === 'idle') micRef.current?.focus();
  }, [state]);

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
      const stored = await uploadFile(file, { voiceNote: true });
      if (alive.current) onRecorded(stored);
    } catch (e) {
      if (alive.current) onError(e instanceof Error ? e.message : 'Could not upload the voice note.');
    } finally {
      if (alive.current) setState('idle');
    }
  };

  const start = async () => {
    engaged.current = true;
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
    rec.current = null; // a second click finds nothing to stop
    await store(await r.stop());
  };

  const cancel = () => {
    rec.current?.cancel();
    rec.current = null;
    setState('idle');
  };

  if (state === 'recording') {
    return (
      // A group, not a status region: a live region would read the timer out
      // every second over the person speaking.
      <div className="mb-0.5 flex shrink-0 items-center gap-1" role="group" aria-label="Recording a voice note">
        <span className="h-2 w-2 animate-pulse rounded-full bg-danger" aria-hidden />
        <span className="w-9 text-2xs tabular-nums text-muted" aria-hidden>{formatElapsed(elapsed)}</span>
        <IconButton ref={stopRef} size="sm" icon={<Square size={12} />} label="Stop and attach" onClick={() => void stop()} />
        <IconButton size="sm" tone="danger" icon={<X size={13} />} label="Discard recording" onClick={cancel} />
      </div>
    );
  }
  const busy = state !== 'idle';
  return (
    <IconButton
      ref={micRef}
      icon={busy ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
      label="Record a voice note"
      onClick={() => void start()}
      disabled={disabled || busy}
      className="mb-0.5"
    />
  );
}
