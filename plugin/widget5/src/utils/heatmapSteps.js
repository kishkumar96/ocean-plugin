// heatmapSteps.js
// Pure time-series-sampling helpers shared by any "row per site/vessel,
// column per timestep" heatmap this app builds -- currently
// CookIslandsLandingAreaComparisonHeatmap.jsx, and (per the wider vessel-
// suitability plan) a future whole-domain advisory PDF exporter, so they
// live in their own module rather than inside one particular component.
//
// Ported verbatim from widget1's SuitabilityPDFExporter.js (selectHeatmapSteps
// at line 280, findMatchingStep at line 732) -- these are pure functions with
// no PDF/jsPDF dependency, so they carry over with no adaptation needed.

// Picks a representative subset of timesteps to show as heatmap columns,
// rather than one column per raw timestep (which would make a 7-day, hourly
// series unreadably wide). windowHours=168 (7 days) picks columns every 12h;
// windowHours<=72 picks columns every 6h. Always includes the first and last
// step in range.
export function selectHeatmapSteps(timeSeriesData = [], windowHours = 168) {
  if (!Array.isArray(timeSeriesData) || timeSeriesData.length === 0) return [];
  if (windowHours === 0 || timeSeriesData.length === 1) {
    const step = timeSeriesData[0];
    return [{ time_index: step.time_index ?? 0, time: step.time ?? step.valid_time, sourceIndex: 0 }];
  }

  const targetHours = windowHours <= 72 ? 6 : 12;
  const selected = new Map();
  const firstMs = new Date(timeSeriesData[0]?.time ?? timeSeriesData[0]?.valid_time).getTime();
  const lastIndex = timeSeriesData.length - 1;
  const add = (index) => {
    const safeIndex = Math.max(0, Math.min(lastIndex, index));
    const step = timeSeriesData[safeIndex];
    if (!step) return;
    selected.set(safeIndex, {
      time_index: step.time_index ?? safeIndex,
      time: step.time ?? step.valid_time,
      sourceIndex: safeIndex,
    });
  };

  add(0);
  if (Number.isFinite(firstMs)) {
    const lastMs = new Date(timeSeriesData[lastIndex]?.time ?? timeSeriesData[lastIndex]?.valid_time).getTime();
    const endMs = Number.isFinite(lastMs)
      ? Math.min(lastMs, firstMs + windowHours * 3_600_000)
      : firstMs + windowHours * 3_600_000;
    for (let targetMs = firstMs + targetHours * 3_600_000; targetMs < endMs; targetMs += targetHours * 3_600_000) {
      let best = 0;
      let bestDelta = Infinity;
      timeSeriesData.forEach((step, index) => {
        const ms = new Date(step.time ?? step.valid_time).getTime();
        if (!Number.isFinite(ms) || ms > endMs) return;
        const delta = Math.abs(ms - targetMs);
        if (delta < bestDelta) {
          best = index;
          bestDelta = delta;
        }
      });
      add(best);
    }
    // "Always includes the first and last step *in range*" (see header
    // comment) -- this must be the last step at or before endMs, not
    // timeSeriesData's own final element. When the caller passes a longer
    // series than windowHours (exactly what happens in production: this
    // app's landing-area comparison fetches each site's full ~9-10 day
    // forecast, then asks this function for a 168h/7-day heatmap), the raw
    // last index can sit days past the window -- confirmed against a real
    // capture where this produced a heatmap whose last column jumped from
    // 25 Sept straight to 28 Sept, a 3-day gap none of the other ~12h-spaced
    // columns had. Walking backward from the end (steps are chronological)
    // rather than forward from the start keeps this cheap for the common
    // case where the series doesn't exceed the window at all.
    let lastInRangeIndex = 0;
    for (let index = lastIndex; index >= 0; index -= 1) {
      const ms = new Date(timeSeriesData[index]?.time ?? timeSeriesData[index]?.valid_time).getTime();
      if (Number.isFinite(ms) && ms <= endMs) {
        lastInRangeIndex = index;
        break;
      }
    }
    add(lastInRangeIndex);
  } else {
    const approxStepHours = windowHours / Math.max(1, timeSeriesData.length - 1);
    const stride = Math.max(1, Math.round(targetHours / approxStepHours));
    for (let i = stride; i < timeSeriesData.length - 1; i += stride) add(i);
    // No usable timestamps to compare against endMs here, so there's no way
    // to tell whether the raw last index is "in range" -- fall back to it
    // as the best available approximation, same as this function always did
    // before the in-range fix above.
    add(lastIndex);
  }

  return Array.from(selected.values()).sort((a, b) => a.sourceIndex - b.sourceIndex);
}

// Finds the step in a site's own steps[] that corresponds to a heatmap
// column (matches by time_index first, falls back to nearest valid_time --
// a site's own series may not share exact indices/timestamps with the
// heatmap's reference column set).
export function findMatchingStep(steps, heatmapStep) {
  if (!steps?.length || !heatmapStep) return null;
  const byIndex = steps.find((s) => s.time_index === heatmapStep.time_index);
  if (byIndex) return byIndex;
  const targetMs = new Date(heatmapStep.time).getTime();
  if (!Number.isFinite(targetMs)) return null;
  let best = null;
  let bestDelta = Infinity;
  for (const s of steps) {
    const ms = new Date(s.valid_time ?? s.time).getTime();
    if (!Number.isFinite(ms)) continue;
    const delta = Math.abs(ms - targetMs);
    if (delta < bestDelta) { bestDelta = delta; best = s; }
  }
  return best;
}
