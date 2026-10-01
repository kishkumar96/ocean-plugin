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
