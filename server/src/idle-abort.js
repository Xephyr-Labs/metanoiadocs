/**
 * Watchdog for a stream that may simply stop arriving.
 *
 * A provider that is thinking, a provider that is not serving the model we
 * asked for, and a provider that died halfway through all look the same from
 * here: an open socket with nothing on it. The only thing worth measuring is
 * how long it has been quiet, so callers signal `alive()` on every chunk and
 * the signal aborts once the gap gets too long.
 */
export function idleAbort(ms) {
  const ac = new AbortController();
  let timer = setTimeout(() => ac.abort(), ms);
  return {
    signal: ac.signal,
    /** A chunk arrived — start the clock over. */
    alive() {
      clearTimeout(timer);
      timer = setTimeout(() => ac.abort(), ms);
    },
    /** The stream finished (or threw); stop holding the event loop open. */
    done() {
      clearTimeout(timer);
    },
  };
}
