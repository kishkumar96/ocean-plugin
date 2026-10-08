import { useEffect, useMemo, useState } from 'react';
import {
  fetchCookIslandsMhwsSummary,
  mhwsBlockIndexFromScenario,
  MHWS_DEFAULT_MIN_DEPTH_M,
} from '../../services/cookIslandsImpactService';

// Area above every MHWS water mark, for each forecast window in `blocks`, keyed
// by block index. One small no-geometry request per window; the backend only
// serves the latest cycle, so results are not shared with the other impact
// fetches. A failure is reported once for the whole set (the columns just show
// "—"), never blocking the RiskScape tables.
export default function useMhwsSummaries(blocks, minDepthM = MHWS_DEFAULT_MIN_DEPTH_M) {
  const blockIndexes = useMemo(
    () => [...new Set((blocks ?? []).map((b) => mhwsBlockIndexFromScenario(b?.scenario)).filter(Boolean))],
    [blocks],
  );
  const key = blockIndexes.join(',');
  const [state, setState] = useState({ loading: false, error: null, byBlock: {}, key: '', depthM: null });

  useEffect(() => {
    if (!key) {
      setState({ loading: false, error: null, byBlock: {}, key: '', depthM: null });
      return undefined;
    }
    let cancelled = false;
    // Drop the previous window/depth's values straight away rather than showing
    // them under the new selection while this request is in flight.
    setState({ loading: true, error: null, byBlock: {}, key, depthM: minDepthM });
    Promise.all(
      key.split(',').map((b) => fetchCookIslandsMhwsSummary({ block: Number(b), minDepthM }).then((r) => [Number(b), r])),
    )
      .then((pairs) => {
        if (!cancelled) setState({ loading: false, error: null, byBlock: Object.fromEntries(pairs), key, depthM: minDepthM });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err?.message || 'Area above MHWS failed to load.', byBlock: {}, key, depthM: minDepthM });
      });
    return () => { cancelled = true; };
  }, [key, minDepthM]);

  // Only ever hand back values that answer the current request (window set + depth).
  const fresh = state.key === key && state.depthM === minDepthM;
  return fresh ? state : { loading: Boolean(key), error: null, byBlock: {} };
}
