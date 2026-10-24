// Voice-note transcripts and the workspace's transcription settings.
// Same-origin and cookie-authed, matching docsApi.

export type TranscriptStatus = 'off' | 'none' | 'toolong' | 'pending' | 'done' | 'empty' | 'failed';
export interface Transcript {
  status: TranscriptStatus;
  text?: string;
  /** 'en', 'bn', or whatever Deepgram detected. */
  language?: string | null;
}

export interface TranscriptionSettings {
  provider: 'deepgram';
  enabled: boolean;
  language: 'auto' | 'bn' | 'en';
  keySet: boolean;
}

async function req(path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const transcriptsApi = {
  get: (key: string, retry = false): Promise<Transcript> =>
    req(`/blob/${encodeURIComponent(key)}/transcript${retry ? '?retry=1' : ''}`),
  settings: (): Promise<TranscriptionSettings> => req('/settings/transcription'),
  saveSettings: (body: { enabled?: boolean; apiKey?: string; language?: string }): Promise<TranscriptionSettings> =>
    req('/settings/transcription', { method: 'PUT', body: JSON.stringify(body) }),
};

/** The line shown in place of a transcript; null once there is text. */
export function transcriptMessage(t: Transcript): string | null {
  switch (t.status) {
    case 'pending': return 'Transcribing…';
    case 'empty': return 'No speech found in this recording.';
    case 'failed': return 'Could not transcribe this recording.';
    case 'off': return 'Transcription is off. An admin can turn it on in Settings → Voice transcription.';
    case 'none': return 'This file has no transcript.';
    case 'toolong': return 'This recording is too long to transcribe.';
    default: return t.text ? null : 'No speech found in this recording.';
  }
}

/** Shown when polling gives up on a transcript still being made. */
export const STALLED = 'Still transcribing. Check back in a minute.';

/** Ask again every 2s while it is being made, for about two minutes. */
export const POLL_MS = 2000;
export function keepPolling(t: Transcript, attempts: number): boolean {
  return t.status === 'pending' && attempts < 60;
}

// Whether transcription is on, read once per page load and refreshed when the
// settings are saved — every voice note asks, and the answer rarely changes.
let enabled: Promise<boolean> | null = null;
const listeners = new Set<(on: boolean) => void>();
export function transcriptionEnabled(): Promise<boolean> {
  // A failed read is not remembered: the next asker tries again.
  enabled ??= transcriptsApi.settings().then((s) => s.enabled && s.keySet).catch(() => { enabled = null; return false; });
  return enabled;
}
export function setTranscriptionEnabled(on: boolean) {
  enabled = Promise.resolve(on);
  listeners.forEach((l) => l(on));
}
export function onTranscriptionEnabled(l: (on: boolean) => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
