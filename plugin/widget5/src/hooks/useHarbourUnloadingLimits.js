import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  normalizePublishedLimits, resolveActiveLimits, loadDraftLimits, saveDraftLimits, emptyLimitsConfig, normalizeLimitsConfig,
} from '../config/cookIslandsHarbourLimits';

const PUBLISHED_URL = `${(process.env.PUBLIC_URL || '').replace(/\/+$/, '')}/harbour-limits.json`;

// Loads the published (approved) limits file and layers the user's local draft
// on top. See HARBOUR_LIMITS.md. `published.state`:
//   'loading' | 'ok' | 'unavailable' (couldn't fetch) | 'invalid' (failed validation)
// Unavailable/invalid are surfaced, never collapsed into "no limits set": if
// approved limits exist but can't be read, the user must be told verdicts are
// unavailable, not shown a calm table that looks like nothing is configured.
export function useHarbourUnloadingLimits(enabled = true) {
  const [published, setPublished] = useState({ state: 'loading', data: null, problems: [] });
  const [draft, setDraftState] = useState(loadDraftLimits);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(PUBLISHED_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = normalizePublishedLimits(await res.json());
        if (cancelled) return;
        setPublished(result.ok
          ? { state: 'ok', data: result.published, problems: [] }
          : { state: 'invalid', data: null, problems: result.problems });
      } catch (err) {
        if (!cancelled) setPublished({ state: 'unavailable', data: null, problems: [err.message] });
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  const setDraft = useCallback((config) => {
    const next = config === null ? null : normalizeLimitsConfig(config);
    setDraftState(next);
    saveDraftLimits(next);
  }, []);

  const active = useMemo(
    () => resolveActiveLimits({ published: published.data, draft }),
    [published.data, draft],
  );

  // What the editor shows and edits: the draft if there is one, otherwise a
  // copy of the approved limits (so editing starts from what is in force).
  const editable = draft ?? (published.data?.config ? normalizeLimitsConfig(published.data.config) : emptyLimitsConfig());

  return { published, draft, active, editable, setDraft, discardDraft: () => setDraft(null) };
}
