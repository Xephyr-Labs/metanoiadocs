import { getSetting, pool } from './db.js';

/**
 * Voice-note transcripts, by Deepgram.
 *
 * Every audio blob is transcribed once, in the background, as soon as it is
 * uploaded (`PUT /api/blob`), and the text is kept per blob key — so one
 * transcript serves a comment's voice note and a page's voice-note block alike,
 * and a note recorded before this existed is transcribed the first time
 * somebody opens its transcript.
 *
 * Configured per workspace in Settings (app_settings key `transcription`):
 * `{ enabled, apiKey, language: 'auto' | 'bn' | 'en' }`. DEEPGRAM_URL exists
 * only so the e2e stack can point at a stub.
 */

export const SETTING_KEY = 'transcription';
const LANGUAGES = new Set(['auto', 'bn', 'en']);
/** A voice note is at most ~2.4 MB (10 minutes at 32 kbit/s); 10 MB leaves room
 *  for an uploaded clip without sending a whole album to Deepgram. */
const MAX_AUTO_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 120_000;

export function deepgramBase() {
  return process.env.DEEPGRAM_URL || 'https://api.deepgram.com';
}

/** `mode` is 'detect' or a language code. */
export function listenUrl(base, mode) {
  const lang = mode === 'detect' ? 'detect_language=true' : `language=${mode}`;
  return `${base.replace(/\/+$/, '')}/v1/listen?model=nova-3&smart_format=true&${lang}`;
}

export function readListen(body) {
  const ch = body?.results?.channels?.[0];
  return { text: String(ch?.alternatives?.[0]?.transcript ?? '').trim(), language: ch?.detected_language };
}

async function listen({ apiKey, mime, data, base, mode, fetch: f }) {
  const res = await f(listenUrl(base, mode), {
    method: 'POST',
    headers: { Authorization: `Token ${apiKey}`, 'Content-Type': mime || 'application/octet-stream' },
    body: data,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Deepgram ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return readListen(await res.json());
}

/**
 * The text of one recording. 'auto' is the method Andy's channels use: detect,
 * keep it when Deepgram says English, else run again as Bangla — Deepgram hears
 * Bangla as Hindi, Bangla is not in its `multi` mode, and restricting detection
 * to en+bn is refused by the API.
 */
export async function transcribeAudio({ apiKey, language, mime, data, base = deepgramBase(), fetch: f = fetch }) {
  if (language === 'bn' || language === 'en') {
    const r = await listen({ apiKey, mime, data, base, mode: language, fetch: f });
    return { text: r.text, language };
  }
  const first = await listen({ apiKey, mime, data, base, mode: 'detect', fetch: f });
  if (first.language?.startsWith('en')) return first;
  const bangla = await listen({ apiKey, mime, data, base, mode: 'bn', fetch: f });
  return bangla.text ? { text: bangla.text, language: 'bn' } : first;
}

/** A PUT body merged over what is stored. A blank key keeps the stored one, so
 *  saving the language does not wipe it. */
export function cleanTranscriptionSettings(body, stored) {
  const prev = stored || {};
  const key = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
  return {
    enabled: body?.enabled === undefined ? !!prev.enabled : !!body.enabled,
    apiKey: key || prev.apiKey || '',
    language: LANGUAGES.has(body?.language) ? body.language : (body?.language === undefined && LANGUAGES.has(prev.language) ? prev.language : 'auto'),
  };
}

/** Only a voice note (the recorder marks its upload) is transcribed unasked;
 *  any other audio waits until someone opens its transcript. */
export function shouldAutoTranscribe(cfg, mime, size, voiceNote) {
  return !!voiceNote && !!(cfg?.enabled && cfg.apiKey) && transcribable(mime, size);
}

/** Audio small enough to send: a voice note is ~2.4 MB at most, and nothing
 *  past 10 MB goes to Deepgram on anyone's click. */
export function transcribable(mime, size) {
  return /^audio\//i.test(mime || '') && size <= MAX_AUTO_BYTES;
}

export async function transcriptionSettings() {
  return cleanTranscriptionSettings({}, await getSetting(SETTING_KEY));
}

/** Whether Deepgram accepts this key. Throws when Deepgram cannot be reached,
 *  so an outage is not reported as a bad key. */
export async function checkDeepgramKey(apiKey, { base = deepgramBase(), fetch: f = fetch } = {}) {
  const res = await f(`${base.replace(/\/+$/, '')}/v1/projects`, {
    headers: { Authorization: `Token ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status >= 500) throw new Error(`Deepgram ${res.status}`);
  return res.ok;
}

// One run per blob at a time in this process; the row's status guards the rest.
const running = new Map();

/**
 * Transcribe a stored blob and keep the result. Resolves when done; never
 * rejects (a Deepgram failure is recorded on the row, where the reader sees it).
 */
export function transcribeBlob(key, { force = false } = {}) {
  if (running.has(key)) return running.get(key);
  const job = (async () => {
    try {
      const cfg = await transcriptionSettings();
      if (!cfg.enabled || !cfg.apiKey) return;
      const size = await pool.query('SELECT mime, octet_length(data) AS n FROM blobs WHERE key = $1', [key]);
      if (!size.rows[0] || !transcribable(size.rows[0].mime, Number(size.rows[0].n))) return;
      const claim = await pool.query(
        `INSERT INTO transcripts (blob_key, status) VALUES ($1, 'pending')
         ON CONFLICT (blob_key) DO UPDATE SET status = 'pending', error = NULL, updated_at = now()
           -- A retried failure, or a run a restart cut off (pending for 10 minutes).
           WHERE (transcripts.status = 'failed' AND $2::boolean)
              OR (transcripts.status = 'pending' AND transcripts.updated_at < now() - interval '10 minutes')
         RETURNING blob_key`,
        [key, force],
      );
      if (!claim.rowCount) return; // already done, empty, or another run has it
      try {
        const { rows } = await pool.query('SELECT mime, data FROM blobs WHERE key = $1', [key]);
        if (!rows[0]) throw new Error('the recording is gone');
        const r = await transcribeAudio({ apiKey: cfg.apiKey, language: cfg.language, mime: rows[0].mime, data: rows[0].data });
        await pool.query(
          `UPDATE transcripts SET status = $2, text = $3, language = $4, updated_at = now() WHERE blob_key = $1`,
          [key, r.text ? 'done' : 'empty', r.text, r.language ?? null],
        );
      } catch (e) {
        console.error('[transcribe]', key, e?.message || e);
        await pool.query(
          `UPDATE transcripts SET status = 'failed', error = $2, updated_at = now() WHERE blob_key = $1`,
          [key, String(e?.message || e).slice(0, 300)],
        ).catch(() => {});
      }
    } catch (e) {
      // The settings read or the claim failed (the blob went, the database
      // blinked): nothing was recorded, so the next ask starts again.
      console.error('[transcribe]', key, e?.message || e);
    }
  })().finally(() => running.delete(key));
  running.set(key, job);
  return job;
}

/**
 * What a reader sees for one recording: off (not set up), pending, done,
 * empty (no speech) or failed. Asking for one that was never transcribed
 * starts it (notes recorded before this existed); `retry` restarts a failure.
 */
export async function transcriptFor(key, { retry = false } = {}) {
  const cfg = await transcriptionSettings();
  const { rows } = await pool.query('SELECT status, text, language FROM transcripts WHERE blob_key = $1', [key]);
  const row = rows[0];
  if (row?.status === 'pending' && cfg.enabled && cfg.apiKey) void transcribeBlob(key); // resumes only a stale one
  if (row && row.status !== 'failed') return { status: row.status, text: row.text || '', language: row.language };
  if (!cfg.enabled || !cfg.apiKey) return row ? { status: 'failed' } : { status: 'off' };
  if (row && !retry) return { status: 'failed' };
  const blob = await pool.query('SELECT mime, octet_length(data) AS n FROM blobs WHERE key = $1', [key]);
  if (!blob.rows[0] || !/^audio\//i.test(blob.rows[0].mime)) return { status: 'none' };
  if (!transcribable(blob.rows[0].mime, Number(blob.rows[0].n))) return { status: 'toolong' };
  void transcribeBlob(key, { force: retry });
  return { status: 'pending' };
}
