import { useEffect, useState } from 'react';
import { docsApi, type Intelligence } from '../lib/docsApi';

export function useIntelligence(pageId: string | null, refreshKey: number) {
  const [data, setData] = useState<Intelligence | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!pageId) { setData(null); return; }
    let alive = true;
    setLoading(true);
    docsApi.intelligence(pageId)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [pageId, refreshKey]);
  return { data, loading };
}
