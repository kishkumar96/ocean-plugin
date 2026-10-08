// modelRunTiming.js
// What "model run start" means per layer, in one place.
//
// For most layers the first timeline timestamp IS the model run's start. The Cook
// Islands suitability layer is the exception: every cycle's summary carries a fixed
// 48 h hindcast/spin-up window BEFORE its own init (forecast_start is always exactly
// cycle init - 48 h; the summary's own model_run_time and hindcast_hours_before_run
// fields say the same). Its first timestamp is therefore 48 h older than the run.
//
// Treating that first timestamp as the run start was wrong in two ways that only
// surfaced once the value reached printed reports: route/advisory PDFs stated a model
// run 48 h too early and a forecast age 48 h too old (a live 29 h-old run printed as
// "Forecast age: 77 h"), while only the on-screen stale banner corrected for it.
// Deriving both the start and the age from this one function keeps them consistent.
export const COK_SUITABILITY_HINDCAST_HOURS = 48;
export const STALE_AFTER_HOURS = 30;

export function hindcastHoursForLayer(layerId) {
  return layerId === 'cok-suitability' ? COK_SUITABILITY_HINDCAST_HOURS : 0;
}

// `firstTimestamp`: the layer's first timeline timestamp (Date). Returns the model
// run's start as a Date, or null.
export function resolveModelRunStart(firstTimestamp, layerId) {
  if (!(firstTimestamp instanceof Date) || !Number.isFinite(firstTimestamp.getTime())) return null;
  return new Date(firstTimestamp.getTime() + hindcastHoursForLayer(layerId) * 3_600_000);
}

export function modelRunAgeHours(modelRunStart, now = Date.now()) {
  if (!(modelRunStart instanceof Date) || !Number.isFinite(modelRunStart.getTime())) return null;
  return (now - modelRunStart.getTime()) / 3_600_000;
}

export const isModelRunStale = (ageHours) => ageHours !== null && ageHours > STALE_AFTER_HOURS;

// A normal run reaches the dashboard ~16-22 h after its init time and the next cycle is 6 h behind it,
// so a healthy feed is routinely a day old. "Current" therefore runs to 24 h, "aging" to the stale limit,
// "stale" beyond it. Distinct from the stale banner's own bound only in having the middle state.
export const AGING_AFTER_HOURS = 24;

export function forecastFreshness(ageHours) {
  if (ageHours === null || ageHours === undefined || !Number.isFinite(ageHours)) return 'unknown';
  if (ageHours > STALE_AFTER_HOURS) return 'stale';
  if (ageHours > AGING_AFTER_HOURS) return 'aging';
  return 'current';
}

// "19 h" under two days, "2.3 days" beyond.
export function formatAge(ageHours) {
  if (!Number.isFinite(ageHours)) return '';
  const h = Math.max(0, ageHours);
  return h >= 48 ? `${(h / 24).toFixed(1)} days` : `${Math.round(h)} h`;
}

// Hours from the model run start to a valid time ("+19 h"); null when either is unusable.
export function leadHours(validTime, modelRunStart) {
  // new Date(null) is the 1970 epoch, so a missing time must be rejected before it is parsed.
  if (validTime === null || validTime === undefined || modelRunStart === null || modelRunStart === undefined) return null;
  const v = validTime instanceof Date ? validTime.getTime() : new Date(validTime).getTime();
  const r = modelRunStart instanceof Date ? modelRunStart.getTime() : new Date(modelRunStart).getTime();
  return Number.isFinite(v) && Number.isFinite(r) ? (v - r) / 3_600_000 : null;
}

export function formatLead(hours) {
  if (!Number.isFinite(hours)) return '';
  const rounded = Math.round(hours);
  return `${rounded >= 0 ? '+' : '-'}${Math.abs(rounded)} h`;
}

// ── When the forecast actually reached the dashboard ─────────────────────────────────────────
// Ages above are measured from the model's init time, which forecasters read as "time since the
// system last ran": a healthy forecast is already ~16 h old when it publishes, so "model run is
// 33 h old" sounded like a day and a half of downtime when one run had been missed. The pipeline
// publishes every 6 h, so time since the last *update* is what says whether the system is running.
// An update is the Last-Modified of the layer's zarr .zmetadata (rewritten by every upload).
export const UPDATE_AGING_AFTER_HOURS = 7;  // one run late or lost
export const UPDATE_STALE_AFTER_HOURS = 13; // two runs lost

export async function fetchPublishedAt(url, fetchImpl = fetch) {
  if (!url) return null;
  try {
    // GET, not HEAD: zarr-api's static route omits Last-Modified on HEAD.
    const res = await fetchImpl(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const lastModified = res.headers.get('last-modified');
    const date = lastModified ? new Date(lastModified) : null;
    return date && Number.isFinite(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

// Combined freshness. The update age is the primary signal; the model-run age still matters
// because a run that re-processes the same GFS cycle (NOMADS feed not advancing) re-uploads
// it, so the update looks recent while the forecast data does not move on.
// Returns { state, reason } with reason 'not-updated' | 'old-model-data' | null.
export function updateFreshness(updateAgeHours, runAgeHours) {
  const hasUpdate = Number.isFinite(updateAgeHours);
  if (!hasUpdate) {
    const state = forecastFreshness(runAgeHours);
    return { state, reason: state === 'stale' ? 'old-model-data' : null };
  }
  if (updateAgeHours > UPDATE_STALE_AFTER_HOURS) return { state: 'stale', reason: 'not-updated' };
  if (isModelRunStale(runAgeHours)) return { state: 'stale', reason: 'old-model-data' };
  if (updateAgeHours > UPDATE_AGING_AFTER_HOURS) return { state: 'aging', reason: 'not-updated' };
  return { state: 'current', reason: null };
}
