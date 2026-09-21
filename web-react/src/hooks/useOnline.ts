import { useEffect, useState } from 'react';

/**
 * Whether the browser thinks it has a network.
 *
 * `navigator.onLine` is a weak signal — it means "there is an interface up",
 * not "the server answers" — so this is used only to *say* something, never to
 * decide whether a request is worth making. A captive-portal wifi reports
 * online and fails every fetch; the honest thing is to let the request fail and
 * report that, which the app already does.
 *
 * What it is good for is the opposite direction: when the browser says the
 * network is gone, it is gone, and that is worth a line on screen before
 * somebody types a paragraph into a page they think is saving.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' || navigator.onLine !== false);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}
