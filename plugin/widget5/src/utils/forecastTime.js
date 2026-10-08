// forecastTime.js
// Where the forecast slider should start.

// The slider used to open on index 0 -- the first timeline step. For the Cook suitability layer that
// is the start of a 48 h hindcast window in which the pipeline deliberately HOLDS the model's earliest
// frame (step11_marine_suitability.py: "timestamps before its own start are held at its earliest
// available frame"), so the map opened on a frozen copy of the run-start state, labelled two days
// before the run. For every layer, index 0 is also simply the past.
//
// Default: the step for the hour we are in (the last timestamp at or before `now`), kept inside the
// REAL part of the timeline: not before `modelRunStart` (skips the frozen hindcast frames) and not
// after the last step. `timestamps`: Date[]; `modelRunStart`: Date | null. Returns an index, 0 for an
// empty or unusable timeline.
export function defaultSliderIndex(timestamps, { now = new Date(), modelRunStart = null } = {}) {
  if (!Array.isArray(timestamps) || timestamps.length === 0) return 0;
  const times = timestamps.map((t) => new Date(t).getTime());
  if (times.some((t) => !Number.isFinite(t))) return 0;
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return 0;

  const last = times.length - 1;
  let current = 0;
  for (let i = 0; i < times.length; i += 1) {
    if (times[i] <= nowMs) current = i; else break;
  }

  const runMs = modelRunStart ? new Date(modelRunStart).getTime() : NaN;
  let firstReal = 0;
  if (Number.isFinite(runMs)) {
    const idx = times.findIndex((t) => t >= runMs);
    firstReal = idx === -1 ? last : idx;
  }
  return Math.min(last, Math.max(firstReal, current));
}
