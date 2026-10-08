import { useEffect, useRef, useState } from 'react';
import { fetchPublishedAt } from '../utils/modelRunTiming';
import { WAVE_PUBLISHED_AT_URL } from '../lib/mapLayersConfig';

// When a forecast product last reached the server (Date, or null until known / unavailable).
// Several panels read the same store, so lookups are shared per URL for REFRESH_MS, and each
// mounted user re-checks on that interval so a page left open notices a new run.
const REFRESH_MS = 10 * 60 * 1000;
const cache = new Map(); // url -> { at, promise, value }

function lookup(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < REFRESH_MS) return hit.promise;
  const entry = { at: Date.now(), value: null };
  entry.promise = fetchPublishedAt(url).then((d) => { entry.value = d; return d; });
  cache.set(url, entry);
  return entry.promise;
}

const sameTime = (a, b) => (a?.getTime?.() ?? null) === (b?.getTime?.() ?? null);

// Defaults to the wave store; pass null to disable (no request while a panel is switched off).
export function useForecastUpdatedAt(url = WAVE_PUBLISHED_AT_URL) {
  // Start from what another panel already learned, so a re-mount does not flash "unknown".
  const [updatedAt, setUpdatedAt] = useState(() => (url ? cache.get(url)?.value ?? null : null));
  const current = useRef(updatedAt);
  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    const load = () => lookup(url).then((d) => {
      // Only a real change re-renders (and repeat lookups from the cache cost nothing).
      if (cancelled || sameTime(current.current, d)) return;
      current.current = d;
      setUpdatedAt(d);
    });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [url]);
  return updatedAt;
}
