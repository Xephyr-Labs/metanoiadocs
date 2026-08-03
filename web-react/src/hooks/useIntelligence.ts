import { useEffect, useRef, useState } from 'react';
import { docsApi, type Intelligence } from '../lib/docsApi';

export function useIntelligence(pageId: string | null, refreshKey: number) {
  const [data, setData] = useState<Intelligence | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const prevPageId = useRef<string | null>(null);

  useEffect(() => {
    // Clear stale data/error only on an actual doc switch, not on every
    // background refresh (refreshKey bump), to avoid flashing the rail.
    if (pageId !== prevPageId.current) {
      setData(null);
      setError(false);
    }
    prevPageId.current = pageId;
    if (!pageId) return;
    let alive = true;
    setLoading(true);
    docsApi.intelligence(pageId)
      .then((d) => { if (alive) { setData(d); setError(false); } })
      .catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [pageId, refreshKey]);
  return { data, loading, error };
}
