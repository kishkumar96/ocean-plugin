import { useEffect, useState } from 'react';
import { fetchCookIslandsSuitabilityPointTimeseries } from '../lib/CookIslandsSuitabilityOverlay';
import { COOK_ISLANDS_HARBOUR_POINTS } from '../config/cookIslandsHarbourPoints';
import { fetchWaveTimeseries } from '../services/cookIslandsWaveTimeseriesService';
import { mapWithConcurrency } from '../utils/concurrency';

// Same concurrency-cap + delay discipline as the landing-area comparison
// fetch (see useCookIslandsLandingAreaComparison.js) -- 16 requests fired at
// once tripped the same volume-based edge block that motivated it there.
const FETCH_CONCURRENCY = 3;
const FETCH_DELAY_MS = 120;

const HOURLY_STEP_HOURS = 1; // /cok/suitability/point/timeseries steps are hourly
const OUTLOOK_HOURS = 24;
const EXTENDED_OUTLOOK_HOURS = 72; // the harbour advisory PDF's per-harbour trend

// vessel='all' rather than a specific vessel class: this product is for
// planning barge cargo unloading, not one vessel's safe-passage envelope
// (that's what Plan Route is for) -- raw sea state at the harbour, not a
// suitability verdict. The endpoint still returns an overall hazard_class
// for 'all', which is kept alongside the raw numbers as a secondary,
// at-a-glance signal.
const VESSEL = 'all';

// The suitability feed (Hs + wind) and the raw wave feed (peak period) are
// published separately and can be on different model cycles (seen live: 00Z
// vs 06Z). Joining them by valid time would put numbers from two different
// forecasts in one verdict, so period is only attached when both feeds are
// provably the same cycle; otherwise it is withheld (periodWithheld) and any
// period limit evaluates to "incomplete" rather than a confident verdict.
const SAME_CYCLE_TOLERANCE_MS = 60 * 60 * 1000;

export function sameCycle(suitabilityRunStart, waveRunStart) {
  const a = suitabilityRunStart ? new Date(suitabilityRunStart).getTime() : NaN;
  const b = waveRunStart ? new Date(waveRunStart).getTime() : NaN;
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= SAME_CYCLE_TOLERANCE_MS;
}

async function fetchSuitabilityRunStart() {
  try {
    const res = await fetch('/cok/suitability/summary');
    if (!res.ok) return null;
    const data = await res.json();
    return data?.model_run_time ?? null;
  } catch (err) {
    return null;
  }
}

// Peak period isn't in the suitability timeseries (Hs + wind only); it comes
// from the wave model and is joined on by valid time -- only when same-cycle.
function attachPeriod(steps, waveRows, cyclesMatch) {
  if (!waveRows?.length || !cyclesMatch) return steps;
  const byTime = new Map(waveRows.map((row) => [new Date(row.time).getTime(), row]));
  return steps.map((step) => {
    const wave = byTime.get(new Date(step.valid_time).getTime());
    // dir_deg: direction waves come FROM (dirp, nautical degrees true).
    return { ...step, tp_s: wave?.tpeak ?? null, dir_deg: wave?.dirp ?? null };
  });
}

const HOUR_MS = 3_600_000;

// The steps falling in [start, start + hours) hourly slots from steps[startIndex], plus how
// many of those hourly slots have NO step. Slicing by index (what this used to do) treats
// whatever arrived as the whole window: a forecast that ends early, or has holes, then looked
// like a complete 24 h / 72 h outlook. Counting missing slots lets every consumer say so.
export function windowFrom(steps, startIndex, hours) {
  const first = steps[startIndex];
  const t0 = first ? new Date(first.valid_time).getTime() : NaN;
  if (!Number.isFinite(t0)) return { steps: [], missingHours: hours };
  const inWindow = steps.filter((st) => {
    const t = new Date(st.valid_time).getTime();
    return Number.isFinite(t) && t >= t0 && t < t0 + hours * HOUR_MS;
  });
  const present = new Set(inWindow.map((st) => Math.round(new Date(st.valid_time).getTime() / 60000)));
  let missingHours = 0;
  for (let k = 0; k < hours; k += 1) {
    const slot = Math.round((t0 + k * HOUR_MS) / 60000);
    if (![slot - 1, slot, slot + 1].some((m) => present.has(m))) missingHours += 1;
  }
  return { steps: inWindow, missingHours };
}

function summarizePoint(point, timeseries, waveRows, suitabilityRunStart) {
  const waveRunStart = waveRows?.[0]?.time ?? null;
  const cyclesMatch = sameCycle(suitabilityRunStart, waveRunStart);
  const steps = attachPeriod(Array.isArray(timeseries?.steps) ? timeseries.steps : [], waveRows, cyclesMatch);
  // "Now" is the forecast step closest to the wall clock, NOT steps[0]: the
  // forecast starts at the model run's start time, which can be a day old by
  // the time someone opens the panel (seen live: a 22 h-old first step showed
  // 0.9 m against the chart's current 0.8 m).
  const nowMs = Date.now();
  let nowIndex = 0;
  let bestDiff = Infinity;
  steps.forEach((step, i) => {
    const diff = Math.abs(new Date(step.valid_time).getTime() - nowMs);
    if (diff < bestDiff) { bestDiff = diff; nowIndex = i; }
  });
  const now = steps[nowIndex] ?? null;
  const outlook = windowFrom(steps, nowIndex, Math.round(OUTLOOK_HOURS / HOURLY_STEP_HOURS));
  const outlook72 = windowFrom(steps, nowIndex, Math.round(EXTENDED_OUTLOOK_HOURS / HOURLY_STEP_HOURS));
  const outlookSteps = outlook.steps;
  const maxWaveM = outlookSteps.reduce((max, step) => (
    Number.isFinite(step.wave_height_m) && step.wave_height_m > max ? step.wave_height_m : max
  ), -Infinity);

  return {
    ...point,
    available: Boolean(timeseries?.available) && steps.length > 0,
    unavailableReason: timeseries?.unavailable_reason ?? null,
    validTime: now?.valid_time ?? null,
    waveHeightM: now?.wave_height_m ?? null,
    windSpeedKt: now?.wind_speed_kt ?? null,
    peakPeriodS: now?.tp_s ?? null,
    peakDirectionDeg: now?.dir_deg ?? null,
    hazardClass: now?.hazard_class ?? null,
    hazardLabel: now?.hazard_label ?? null,
    outlookMaxWaveHeightM: Number.isFinite(maxWaveM) ? maxWaveM : null,
    steps,
    outlookSteps,
    outlook72Steps: outlook72.steps,
    // Hourly slots with no forecast step in each window (0 = complete). A non-zero value means
    // the "24 h" / "72 h" figures are over a shorter or holey window.
    outlookMissingHours: outlook.missingHours,
    outlook72MissingHours: outlook72.missingHours,
    // First timestamp of the wave model forecast (its run start), for the
    // panel's model-run-age notice; null if the wave fetch failed.
    waveRunStart,
    // Wave data exists but was deliberately not joined (different cycle, or
    // the suitability run couldn't be confirmed).
    periodWithheld: Boolean(waveRows?.length) && !cyclesMatch,
  };
}

// Fetches current + short-term-outlook wave conditions at every named Cook
// Islands harbour/anchorage/passage point at once. `enabled` gates the fetch
// (16 requests) so it only fires once a user actually opens the panel, same
// as the landing-area comparison hook this one otherwise mirrors.
export function useCookIslandsHarbourWaveConditions(enabled) {
  const [state, setState] = useState({ loading: false, error: null, rows: [], suitabilityRunStart: null });

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      const suitabilityRunStart = await fetchSuitabilityRunStart();
      if (cancelled) return;
      const rows = await mapWithConcurrency(COOK_ISLANDS_HARBOUR_POINTS, FETCH_CONCURRENCY, async (point) => {
        try {
          const [timeseries, waveRows] = await Promise.all([
            fetchCookIslandsSuitabilityPointTimeseries(point.lon, point.lat, VESSEL),
            fetchWaveTimeseries(point.lon, point.lat).then((ts) => ts.rows).catch(() => null),
          ]);
          return summarizePoint(point, timeseries, waveRows, suitabilityRunStart);
        } catch (err) {
          // One harbour's failure (e.g. out of model domain, or a transient
          // network error) shouldn't blank the whole table -- report it as
          // an unavailable row, not a thrown error that aborts every other
          // harbour's fetch.
          console.warn(`Harbour wave conditions: timeseries unavailable for ${point.name}:`, err.message);
          return { ...point, available: false, unavailableReason: err.message, steps: [] };
        }
      }, FETCH_DELAY_MS);

      if (cancelled) return;
      const availableCount = rows.filter((row) => row.available).length;
      setState({
        loading: false,
        error: availableCount ? null : 'No wave conditions returned for any harbour.',
        rows,
        suitabilityRunStart,
      });
    })();

    return () => { cancelled = true; };
  }, [enabled]);

  return state;
}
