/**
 * Voice notes: record from the microphone into a File the blob store takes.
 *
 * One recorder for every place a note can be made — a comment, a reply, a
 * page — so they agree on format, length and what a refused microphone says.
 *
 * webm first because Chrome, Firefox and Android record it; Safari records
 * only mp4. The type is kept bare ("audio/webm", not "audio/webm;codecs=opus"):
 * the blob endpoint plays a fixed list of exact types and downloads the rest.
 * 32 kbps is plenty for speech — about 240 KB a minute — and ten minutes is
 * the cap, so one note stays a couple of megabytes in a Postgres row.
 */

export const MAX_VOICE_MS = 10 * 60 * 1000;
const BITRATE = 32000;

export function pickMime(isSupported: (type: string) => boolean): 'audio/webm' | 'audio/mp4' | '' {
  if (isSupported('audio/webm')) return 'audio/webm';
  if (isSupported('audio/mp4')) return 'audio/mp4';
  return '';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "Voice note 2026-10-22 14.03.webm" — local time, so it reads as when you said it. */
export function voiceNoteName(at: Date, mime: string): string {
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `Voice note ${day} ${pad(at.getHours())}.${pad(at.getMinutes())}.${mime === 'audio/mp4' ? 'm4a' : 'webm'}`;
}

/** What to tell a person whose recording never started. */
export function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return "Microphone is blocked — allow it in the browser's site settings.";
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone found.';
  if (name === 'NotSupportedError') return "Recording isn't supported in this browser.";
  return 'Could not start recording.';
}

/** "1:07" */
export const formatElapsed = (ms: number) => `${Math.floor(ms / 60000)}:${pad(Math.floor(ms / 1000) % 60)}`;

export interface Recording {
  /** Finish and hand back the note. */
  stop(): Promise<File>;
  /** Throw it away. */
  cancel(): void;
}

/**
 * Ask for the microphone and start recording. Rejects with the browser's own
 * error when there is no microphone or it was refused — pass it to
 * micErrorMessage. Stopping or cancelling releases the microphone, which is
 * what turns the browser's recording indicator off.
 */
export async function startRecording(opts: { onTick?: (ms: number) => void; onAutoStop?: (file: File) => void } = {}): Promise<Recording> {
  const mime = typeof MediaRecorder === 'undefined' ? '' : pickMime((t) => MediaRecorder.isTypeSupported(t));
  if (!mime || !navigator.mediaDevices?.getUserMedia) throw new DOMException('no recorder', 'NotSupportedError');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: BITRATE });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const started = Date.now();
  const ticker = setInterval(() => opts.onTick?.(Date.now() - started), 250);
  const limit = setTimeout(() => { void stop().then((f) => opts.onAutoStop?.(f)); }, MAX_VOICE_MS);
  let done: Promise<File> | null = null;

  const release = () => {
    clearInterval(ticker);
    clearTimeout(limit);
    stream.getTracks().forEach((t) => t.stop());
  };

  function stop(): Promise<File> {
    done ??= new Promise<File>((resolve) => {
      recorder.onstop = () => {
        release();
        resolve(new File(chunks, voiceNoteName(new Date(started), mime), { type: mime }));
      };
      if (recorder.state === 'inactive') recorder.onstop?.(new Event('stop'));
      else recorder.stop();
    });
    return done;
  }

  recorder.start(1000);
  return {
    stop,
    cancel: () => {
      if (done) return;
      done = Promise.reject(new Error('cancelled'));
      done.catch(() => {});
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
      release();
    },
  };
}

/**
 * A recorded webm has no duration in its header, so Chrome reports Infinity
 * and the scrubber cannot seek until the clip has played through once. Asking
 * for a point past the end makes the browser read to the end and work the
 * duration out; then it goes back to the start. Listening on the document in
 * the capture phase covers every player — the comment list's and the editor's.
 */
export function installAudioDurationFix(): void {
  // ponytail: Chrome's MediaRecorder webm has no duration header; seek-to-end makes it compute one. Replace if we ever post-process recordings.
  document.addEventListener('loadedmetadata', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLAudioElement) || el.duration !== Infinity) return;
    el.addEventListener('durationchange', () => { el.currentTime = 0; }, { once: true });
    el.currentTime = 1e101;
  }, true);
}
