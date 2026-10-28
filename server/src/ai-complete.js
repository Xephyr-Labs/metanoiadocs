/**
 * One non-streamed answer from the configured Ask AI model, as text.
 *
 * Errors carry an HTTP `status`: 503 when Ask AI is not set up, 504 when the
 * provider does not answer in time, 502 for anything else it does.
 */
import OpenAI from 'openai';

const fail = (status, message) => Object.assign(new Error(message), { status });

export function aiCompleter(
  getSetting,
  makeClient = (cfg) => new OpenAI({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey, maxRetries: 0 }),
  timeoutMs = 60_000,
) {
  return async function aiComplete({ messages, maxTokens = 2048 }) {
    const cfg = (await getSetting('ai')) || {};
    if (!cfg.enabled || !cfg.baseUrl || !cfg.apiKey || !cfg.model) {
      throw fail(503, 'Ask AI is not configured — set it up in Settings');
    }
    // Not AbortSignal.timeout: its timer is unref'd, which Node 22's test runner
    // treats as a promise that can never settle.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const { signal } = ctrl;
    try {
      const r = await makeClient(cfg).chat.completions.create(
        { model: cfg.model, max_tokens: maxTokens, messages }, { signal });
      // A reasoning model may think first; only the answer counts.
      return String(r?.choices?.[0]?.message?.content ?? '');
    } catch (err) {
      if (signal.aborted) throw fail(504, 'Ask AI took too long to answer — try again');
      console.error('[ai-complete]', err.message);
      throw fail(502, 'Ask AI could not answer — try again');
    } finally {
      clearTimeout(timer);
    }
  };
}
