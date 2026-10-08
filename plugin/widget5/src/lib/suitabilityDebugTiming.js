// suitabilityDebugTiming.js
// Diagnostic-only per-frame timing for Cook Islands vessel suitability
// playback -- Preset mode's raster tile load (CookIslandsSuitabilityOverlay.js)
// and Custom mode's grid fetch/decode/repaint (CookIslandsSuitabilityDynamicOverlay.js).
// Purely observational: no behavior changes, and silent by default.
//
// Enable from the browser console:
//   localStorage.setItem('cokSuitDebugTiming', '1')
// then reload. Disable by removing that key (or setting any other value)
// and reloading again.
//
// This exists to answer one question: once a frame is warm/prefetched, how
// many milliseconds does it actually take? That number decides whether the
// next optimisation belongs in the browser (React/MapLibre) or in the
// backend/Zarr layout -- see the two overlays' own timing call sites for
// what each column means.
export const SUITABILITY_DEBUG_TIMING = (() => {
  try {
    return typeof window !== 'undefined' && window.localStorage?.getItem('cokSuitDebugTiming') === '1';
  } catch (_) {
    return false;
  }
})();

export function logSuitabilityFrameTiming(row) {
  if (!SUITABILITY_DEBUG_TIMING) return;
  const rounded = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v) : v])
  );
  // One JSON object per line rather than console.table: a rendered table
  // copy-pasted out of DevTools as plain text loses its cell delimiters
  // (multi-digit values from adjacent columns run together with no
  // separator), making a saved log ambiguous or impossible to re-parse
  // after the fact. A JSON line survives copy/paste and log-file capture
  // losslessly.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(rounded));
}
