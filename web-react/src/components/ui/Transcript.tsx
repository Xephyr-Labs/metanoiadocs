import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import {
  POLL_MS, keepPolling, onTranscriptionEnabled, transcriptMessage, transcriptionEnabled, transcriptsApi, type Transcript as T,
} from '../../lib/transcripts';

/** Whether this workspace transcribes voice notes (Settings → Voice transcription). */
export function useTranscriptionEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    transcriptionEnabled().then((v) => { if (live) setOn(v); });
    const off = onTranscriptionEnabled((v) => { if (live) setOn(v); });
    return () => { live = false; off(); };
  }, []);
  return on;
}

/**
 * A voice note's transcript, folded away under the player until asked for.
 * Opening it fetches the text (the server made it when the note was sent, or
 * starts now for an older note) and asks again while it is still being made.
 */
export function Transcript({ fileKey }: { fileKey: string }) {
  const [open, setOpen] = useState(false);
  const [t, setT] = useState<T | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const load = (again: boolean) => {
      transcriptsApi.get(fileKey, again)
        .then((r) => {
          if (!live) return;
          setT(r);
          if (keepPolling(r, attempts++)) timer = setTimeout(() => load(false), POLL_MS);
        })
        .catch(() => { if (live) setT({ status: 'failed' }); });
    };
    load(retry > 0);
    return () => { live = false; clearTimeout(timer); };
  }, [open, fileKey, retry]);

  const message = t ? transcriptMessage(t) : 'Transcribing…';
  return (
    <div className="w-full">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 coarse:h-9 items-center gap-1 rounded px-1 text-2xs font-medium text-muted transition-colors duration-120 hover:text-ink"
      >
        <ChevronRight size={12} className={cn('transition-transform duration-120', open && 'rotate-90')} />
        Transcript
      </button>
      {open && (
        <div className="mb-1 ml-1 border-l-2 border-line pl-2.5" aria-live="polite">
          {message ? (
            <p className="py-0.5 text-2xs text-faint">
              {message}
              {t?.status === 'failed' && (
                <button type="button" onClick={() => setRetry((n) => n + 1)} className="ml-1.5 font-medium text-accent-strong hover:underline">
                  Try again
                </button>
              )}
            </p>
          ) : (
            <p className="whitespace-pre-wrap break-words py-0.5 text-sm leading-5 text-ink" lang={t?.language || undefined}>{t?.text}</p>
          )}
        </div>
      )}
    </div>
  );
}
