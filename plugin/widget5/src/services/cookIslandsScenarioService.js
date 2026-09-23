// cookIslandsScenarioService.js
// Pure logic for the vessel-suitability "Scenario Comparison" workflow:
// building/duplicating scenario objects, deriving an explainable decision
// from a route-forecast result, ranking scenarios, detecting stale/superseded
// results, running scenarios against the backend (rate-limited), and
// building the advisoryConfig shapes a future PDF exporter needs for route
// and scenario-comparison briefs.
//
// Ported from widget1's scenarioService.js (494 lines) with two real
// differences, not just a rename:
//   - fetchCookIslandsRouteForecast(request) has no apiBase parameter (the
//     endpoint is hardcoded relative -- POST /cok/suitability/route), unlike
//     widget1's fetchRouteForecast(apiBase, request), so every function here
//     drops that parameter rather than threading an unused one through.
//   - Hazard label/color source is this app's own ROUTE_HAZARD_LABELS
//     (cookIslandsRouteForecastService.js -- note 'Warning', not widget1's
//     'Avoid', for hazard class 2) and HAZARD_COLORS
//     (CookIslandsSuitabilityOverlay.js), not widget1's
//     SUITABILITY_HAZARD_LABELS/COLORS. Neither is imported by this file
//     directly -- they're a rendering concern for CookIslandsScenarioComparisonPanel.jsx.
//
// Backend hazard_class stays authoritative throughout -- nothing here ever
// overrides it; deriveRouteDecision only *explains* it using the client-side
// vessel operating envelope, and only where the backend doesn't already
// supply an equivalent field (see main_driver fallback below).
//
// V1 scope: scenarios vary by vessel/speed/departure/route only, always
// classified against that vessel's PRESET envelope -- matching how the
// single-route panel already discloses "classified against vessel preset."
// Scenarios varying by custom envelope are deferred; they'd need client-side
// re-classification of samples that has no equivalent in widget1 to port.

import { VESSEL_CLASS_OPTIONS, classifySuitability, deriveSuitabilityDriver } from '../lib/CookIslandsSuitabilityOverlay';
import { fetchCookIslandsRouteForecast, parseAsUtcWallClock } from './cookIslandsRouteForecastService';
import { mapWithConcurrency, sleep } from '../utils/concurrency';

export const MAX_SCENARIOS = 4;

// Mirrors widget1's SCENARIO_RUN_CONCURRENCY/DELAY_MS -- same documented
// rate-limit rationale (a volume-based edge block, not a simultaneous-
// connection cap, see utils/concurrency.js) applies to "run all scenarios"
// firing several /cok/suitability/route calls in a short window.
const SCENARIO_RUN_CONCURRENCY = 2;
const SCENARIO_RUN_DELAY_MS = 200;

const DRIVER_LABELS = {
  none: 'None',
  wind: 'Wind',
  waves: 'Waves',
  wind_and_waves: 'Wind + Waves',
};

export function driverLabel(driver) {
  return DRIVER_LABELS[driver] ?? 'Unknown';
}

let scenarioCounter = 0;
function generateScenarioId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  scenarioCounter += 1;
  return `scenario-${Date.now()}-${scenarioCounter}`;
}

const SCENARIO_NAME_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Default scenario names are "Scenario A", "Scenario B", ... -- first unused
// letter, so removing "Scenario B" and adding a new one doesn't collide with
// the still-existing "Scenario C".
export function nextScenarioName(existingScenarios = []) {
  const used = new Set(existingScenarios.map((s) => s.name));
  for (const letter of SCENARIO_NAME_LETTERS) {
    const candidate = `Scenario ${letter}`;
    if (!used.has(candidate)) return candidate;
  }
  return `Scenario ${existingScenarios.length + 1}`;
}

export function createScenario({
  name,
  vessel,
  routePoints,
  departureTime,
  speedKt,
  existingScenarios = [],
}) {
  const now = new Date().toISOString();
  return {
    id: generateScenarioId(),
    name: name || nextScenarioName(existingScenarios),
    vessel,
    routePoints: Array.isArray(routePoints) ? routePoints.map((p) => ({ ...p })) : [],
    departureTime,
    speedKt,
    createdAt: now,
    updatedAt: now,
    forecastResult: null,
    status: 'draft',
    error: null,
    // Snapshotted only once the scenario is actually run -- see runScenario.
    modelRunStartAtRun: null,
    generatedAt: null,
  };
}

export function duplicateScenario(scenario, overrides = {}, existingScenarios = []) {
  const now = new Date().toISOString();
  return {
    ...scenario,
    ...overrides,
    routePoints: Array.isArray(overrides.routePoints ?? scenario.routePoints)
      ? (overrides.routePoints ?? scenario.routePoints).map((p) => ({ ...p }))
      : [],
    id: generateScenarioId(),
    name: overrides.name || nextScenarioName(existingScenarios),
    createdAt: now,
    updatedAt: now,
    forecastResult: null,
    status: 'draft',
    error: null,
    modelRunStartAtRun: null,
    generatedAt: null,
  };
}

// Explains a route-forecast result for one vessel: which sample was worst,
// what likely drove it, how confident we are given unavailable samples, and
// the numbers needed to rank this result against other scenarios. Returns
// null if there's no result to explain yet.
export function deriveRouteDecision(routeForecastResult, vesselCode) {
  if (!routeForecastResult) return null;
  const summary = routeForecastResult.summary ?? {};
  const samples = Array.isArray(routeForecastResult.samples) ? routeForecastResult.samples : [];

  const unavailableSamples = samples.filter((s) => (
    s.available === false || s.hazard_class === null || s.hazard_class === undefined
  )).length;
  const totalSamples = samples.length;
  const availableSamples = totalSamples - unavailableSamples;

  // Worst-hazard sample -- ties broken by earliest ETA (first point along the
  // route where conditions reach that severity).
  let worstSample = null;
  for (const sample of samples) {
    if (sample.hazard_class === null || sample.hazard_class === undefined) continue;
    if (!worstSample
      || sample.hazard_class > worstSample.hazard_class
      || (sample.hazard_class === worstSample.hazard_class && new Date(sample.eta) < new Date(worstSample.eta))
    ) {
      worstSample = sample;
    }
  }

  // Prefer a backend-provided driver field if one ever appears; derive from
  // the vessel operating envelope otherwise (see module header).
  const primaryDriver = worstSample
    ? (worstSample.main_driver ?? deriveSuitabilityDriver(
        vesselCode,
        worstSample.wind_speed_kt ?? 0,
        worstSample.wave_height_m ?? 0,
      ))
    : null;

  const confidenceLabel = totalSamples === 0
    ? 'unknown'
    : unavailableSamples === 0
      ? 'high'
      : availableSamples === 0
        ? 'low'
        : 'reduced';

  const worstHazardClass = Number.isFinite(summary.worst_hazard_class) ? summary.worst_hazard_class : null;

  return {
    worstHazardClass,
    recommendation: summary.recommendation ?? null,
    primaryDriver,
    worstTime: worstSample?.eta ?? null,
    confidenceLabel,
    unavailableSamples,
    totalSamples,
    suitablePercent: Number.isFinite(summary.suitable_percent) ? summary.suitable_percent : null,
    cautionPercent: Number.isFinite(summary.caution_percent) ? summary.caution_percent : null,
    warningPercent: Number.isFinite(summary.warning_percent) ? summary.warning_percent : null,
    durationHours: Number.isFinite(summary.duration_hours) ? summary.duration_hours : null,
    distanceNm: Number.isFinite(summary.distance_nm) ? summary.distance_nm : null,
  };
}

// Checks whether a more-capable vessel class would clear this same route to
// a better hazard, using ONLY the wind/wave data this result already has --
// no network call. Purely a client-side estimate against
// VESSEL_OPERATING_ENVELOPE (wind/wave thresholds only -- it doesn't know
// about daylightOnly/offshoreCautionNm/exposedLandingCaution), so it must
// never be presented as route-checked; the "Confirm & compare" flow fires
// one real fetchCookIslandsRouteForecast to verify a suggestion before it's
// trusted for planning.
//
// Walks vessel classes from the current one forward (nearest more-capable
// first, not straight to the most-capable) so the suggestion is the minimal
// upgrade that actually helps, not an overcorrection.
export function suggestBetterVessel(routeForecastResult, currentVesselCode) {
  const summary = routeForecastResult?.summary;
  const samples = Array.isArray(routeForecastResult?.samples) ? routeForecastResult.samples : [];
  const currentWorst = summary?.worst_hazard_class;
  if (currentWorst === null || currentWorst === undefined || currentWorst === 0) return null;

  const currentIndex = VESSEL_CLASS_OPTIONS.findIndex((v) => v.value === currentVesselCode);
  if (currentIndex === -1) return null;

  for (let i = currentIndex + 1; i < VESSEL_CLASS_OPTIONS.length; i++) {
    const candidate = VESSEL_CLASS_OPTIONS[i];
    let worst = null;
    let considered = 0;
    for (const sample of samples) {
      if (sample.wind_speed_kt == null || sample.wave_height_m == null) continue; // can't estimate this sample
      const cls = classifySuitability(candidate.value, sample.wind_speed_kt, sample.wave_height_m);
      if (cls === null) continue;
      considered += 1;
      worst = worst === null ? cls : Math.max(worst, cls);
    }
    if (worst !== null && worst < currentWorst) {
      return {
        vessel: candidate.value,
        vesselLabel: candidate.label,
        fromVessel: currentVesselCode,
        currentWorstHazardClass: currentWorst,
        estimatedWorstHazardClass: worst,
        samplesConsidered: considered,
        samplesSkipped: samples.length - considered,
        isEstimate: true,
      };
    }
  }
  return null;
}

// Single composite number so ranking is a plain ascending sort -- lower is
// better. Order of significance (most to least): worst hazard class, then
// caution+warning exposure, then unavailable sample count, then duration. A
// scenario with no decision yet (draft/running/error) always ranks last.
function computeRankScore(decision) {
  if (!decision || decision.worstHazardClass === null) return Infinity;
  const exposurePct = (decision.cautionPercent ?? 0) + (decision.warningPercent ?? 0);
  const unavailable = decision.unavailableSamples ?? 0;
  const duration = decision.durationHours ?? 0;
  return decision.worstHazardClass * 1e9 + exposurePct * 1e6 + unavailable * 1e3 + duration;
}

// Decorates every scenario with its derived decision + rank score, and picks
// the single best-ranked scenario (if any has a ready result) as recommended.
export function rankScenarios(scenarios) {
  const decorated = scenarios.map((scenario) => {
    const decision = scenario.status === 'ready'
      ? deriveRouteDecision(scenario.forecastResult, scenario.vessel)
      : null;
    return { scenario, decision, rankScore: computeRankScore(decision) };
  });

  const best = decorated.reduce((champion, entry) => (
    Number.isFinite(entry.rankScore) && (!champion || entry.rankScore < champion.rankScore) ? entry : champion
  ), null);

  return {
    entries: decorated,
    recommendedId: best ? best.scenario.id : null,
  };
}

// datetime-local <input> values (e.g. live routeDepartureTime state) have no
// timezone designator, but this app always intends them as UTC wall-clock --
// see parseAsUtcWallClock in cookIslandsRouteForecastService.js for the
// shared parsing logic this delegates to, so the exact same departureTime
// string can't resolve to two different real-world moments depending on
// which function reads it.
function toComparableMs(value) {
  if (!value) return NaN;
  return parseAsUtcWallClock(value)?.getTime() ?? NaN;
}

// A scenario's departureTime is often the backend's normalized ISO string
// (e.g. from routeForecastResult.departure_time), while currentInputs.departureTime
// comes straight from the <input type="datetime-local"> field. Both can
// represent the exact same UTC moment while being different strings --
// comparing them as raw strings would flag a just-created scenario as
// "stale" immediately, before the user touched anything.
function sameDepartureTime(a, b) {
  if (a === b) return true;
  const aMs = toComparableMs(a);
  const bMs = toComparableMs(b);
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return false;
  return aMs === bMs;
}

// True when a scenario's saved inputs no longer match the live route/vessel/
// speed/departure being edited -- i.e. its result no longer describes what
// the user currently has drawn. Only meaningful for scenarios that actually
// have a result; a draft has nothing to go stale.
//
// This checks EVERY field, which is only correct where "the current live
// form" and "this result" are meant to be the same thing -- i.e. the single
// displayed route-forecast result (built by wrapping it in a
// {status, vessel, speedKt, ...} pseudo-scenario). Do NOT use this for
// scenarios saved into the comparison list -- see isScenarioRouteStale below
// for why vessel/speed/departure differing from the live form is normal
// there, not staleness.
export function isScenarioStale(scenario, currentInputs) {
  if (!scenario || scenario.status !== 'ready' || !currentInputs) return false;
  if (scenario.vessel !== currentInputs.vessel) return true;
  if (Number(scenario.speedKt) !== Number(currentInputs.speedKt)) return true;
  if (!sameDepartureTime(scenario.departureTime, currentInputs.departureTime)) return true;
  if (JSON.stringify(scenario.routePoints ?? []) !== JSON.stringify(currentInputs.routePoints ?? [])) return true;
  return false;
}

// True when the ROUTE GEOMETRY a saved comparison scenario was run against
// no longer matches what's drawn on the map. Deliberately does NOT compare
// vessel/speedKt/departureTime -- those are the exact dimensions scenarios
// are meant to vary across for comparison (that's the point of "duplicate
// with a different vessel", "suggest a better departure", etc.), so a
// scenario differing from the live form along those alone isn't stale, it's
// just a different alternative. Only a redrawn route invalidates a saved
// scenario's relevance to what's currently being planned.
export function isScenarioRouteStale(scenario, currentRoutePoints) {
  if (!scenario || scenario.status !== 'ready') return false;
  return JSON.stringify(scenario.routePoints ?? []) !== JSON.stringify(currentRoutePoints ?? []);
}

// True when a newer forecast model run has become available since this
// scenario was run. currentModelRunStart is the earliest timestep currently
// loaded (a proxy for "which forecast window is active"), not a certified
// backend-issued run id.
export function isScenarioSuperseded(scenario, currentModelRunStart) {
  if (!scenario || scenario.status !== 'ready') return false;
  if (!scenario.modelRunStartAtRun || !currentModelRunStart) return false;
  const ranAtMs = new Date(scenario.modelRunStartAtRun).getTime();
  const currentMs = new Date(currentModelRunStart).getTime();
  if (!Number.isFinite(ranAtMs) || !Number.isFinite(currentMs)) return false;
  return currentMs > ranAtMs;
}

// Runs one scenario against the backend and returns a new scenario object
// with status/result/error updated -- never mutates the input.
export async function runScenario(scenario, { modelRunStart = null } = {}) {
  const now = new Date().toISOString();
  try {
    const result = await fetchCookIslandsRouteForecast({
      routePoints: scenario.routePoints,
      vessel: scenario.vessel,
      departureTime: scenario.departureTime,
      speedKt: scenario.speedKt,
    });
    return {
      ...scenario,
      status: 'ready',
      forecastResult: result,
      error: null,
      updatedAt: now,
      generatedAt: now,
      modelRunStartAtRun: modelRunStart,
    };
  } catch (err) {
    return {
      ...scenario,
      status: 'error',
      error: err?.message || 'Route forecast failed.',
      updatedAt: now,
    };
  }
}

// Runs several scenarios with the same concurrency/delay discipline as
// utils/concurrency.js documents -- never Promise.all these directly.
// onScenarioSettled fires once per scenario as its result comes back, so
// callers can update state incrementally instead of waiting for the whole
// batch.
export async function runAllScenarios(scenarios, { modelRunStart = null, onScenarioSettled } = {}) {
  return mapWithConcurrency(scenarios, SCENARIO_RUN_CONCURRENCY, async (scenario) => {
    const updated = await runScenario(scenario, { modelRunStart });
    onScenarioSettled?.(updated);
    return updated;
  }, SCENARIO_RUN_DELAY_MS);
}

// Candidate departure offsets to probe, in hours from the current departure.
export const DEPARTURE_PROBE_OFFSETS_HOURS = [3, 6, 12, 24];

// Explicit, user-triggered: tries each candidate departure time in turn
// against the real backend, stopping as soon as one clears to hazard 0
// (Suitable) rather than firing every candidate -- mapWithConcurrency can't
// do this (fixed worker pool, no early exit), so this is its own sequential
// loop, paced with the same SCENARIO_RUN_DELAY_MS rate-limit discipline. One
// candidate failing doesn't abort the rest of the probe.
//
// maxDepartureTime (optional Date) is the forecast's last available
// timestamp. Offsets that would land past it are dropped *before* probing --
// firing them would just fail (or, worse, silently succeed against
// stale/extrapolated backend data) instead of telling the user anything
// useful. Always returns an object (never bare null) so callers can build an
// honest message even when nothing was found: `found` says whether a
// candidate is being recommended; checkedOffsets/failedOffsets/skippedOffsets
// together account for every offset in DEPARTURE_PROBE_OFFSETS_HOURS.
export async function findBetterDeparture({ routePoints, vessel, departureTime, speedKt, maxDepartureTime } = {}, { onProgress } = {}) {
  // Same bare-datetime-local issue as validateRouteForecastInput/
  // toComparableMs -- departureTime here is the live routeDepartureTime
  // state, undesignated but UTC-intended. Every probed offset would
  // otherwise be silently computed from the wrong base moment for any
  // non-UTC runtime.
  const baseMs = parseAsUtcWallClock(departureTime)?.getTime();
  if (!Number.isFinite(baseMs)) {
    throw new Error('Choose a valid departure time before checking alternatives.');
  }

  const maxMs = maxDepartureTime instanceof Date && !Number.isNaN(maxDepartureTime.getTime())
    ? maxDepartureTime.getTime()
    : null;
  const probeOffsets = DEPARTURE_PROBE_OFFSETS_HOURS.filter(
    (h) => maxMs === null || baseMs + h * 3_600_000 <= maxMs
  );
  const skippedOffsets = DEPARTURE_PROBE_OFFSETS_HOURS.filter((h) => !probeOffsets.includes(h));

  let best = null;
  // Callers describe the result as "best of the offsets checked" -- that
  // would not actually be true if a probe failed outright (network error,
  // etc.) rather than just scoring worse; failedOffsets lets the UI say so
  // instead of silently implying every offset was evaluated.
  const failedOffsets = [];
  for (let i = 0; i < probeOffsets.length; i++) {
    const offsetHours = probeOffsets[i];
    const candidateTime = new Date(baseMs + offsetHours * 3_600_000).toISOString();
    onProgress?.({ offsetHours, index: i, total: probeOffsets.length });

    let result = null;
    try {
      result = await fetchCookIslandsRouteForecast({ routePoints, vessel, departureTime: candidateTime, speedKt });
    } catch {
      // Skip this candidate; a single failed probe shouldn't sink the rest.
      failedOffsets.push(offsetHours);
    }

    if (result) {
      const worst = result.summary?.worst_hazard_class;
      if (worst === 0) {
        return {
          found: true, offsetHours, departureTime: candidateTime, worstHazardClass: 0, allClear: true, result, isEstimate: false,
          checkedOffsets: probeOffsets, failedOffsets, skippedOffsets,
        };
      }
      if (worst !== null && worst !== undefined && (best === null || worst < best.worstHazardClass)) {
        best = { offsetHours, departureTime: candidateTime, worstHazardClass: worst, allClear: false, result, isEstimate: false };
      }
    }

    if (i < probeOffsets.length - 1) await sleep(SCENARIO_RUN_DELAY_MS);
  }
  return best
    ? { found: true, ...best, checkedOffsets: probeOffsets, failedOffsets, skippedOffsets }
    : { found: false, checkedOffsets: probeOffsets, failedOffsets, skippedOffsets };
}

// PDF brief configs -- not consumed anywhere yet (no exporter exists in this
// app), but exported now so CookIslandsScenarioComparisonPanel.jsx's
// "Generate Scenario Comparison Brief" button can be wired to a real
// exporter later (see the vessel-suitability advisory PDF work) without
// revisiting this file. buildRouteAdvisoryBriefConfig is unused for now
// (kept for the same future PDF work, matching widget1's route brief).
export function buildRouteAdvisoryBriefConfig({
  vesselType,
  vesselLabel,
  routePoints,
  speedKt,
  departureTime,
  result,
  decision,
  provenance,
  vesselSuggestion = null,
  departureSuggestion = null,
  mapTimeIndex = null,
}) {
  return {
    area: { type: 'route_forecast', label: 'Route Advisory Brief' },
    vesselType,
    vesselLabel,
    routeForecast: {
      routePoints, speedKt, departureTime, result, decision, provenance,
      vesselSuggestion, departureSuggestion, mapTimeIndex,
    },
  };
}

export function buildScenarioComparisonBriefConfig({ scenarios, recommendedId, vesselLabelFor }) {
  return {
    area: { type: 'scenario_comparison', label: 'Scenario Comparison Advisory Brief' },
    scenarioComparison: {
      scenarios: scenarios.map((scenario) => ({
        ...scenario,
        vesselLabel: vesselLabelFor ? vesselLabelFor(scenario.vessel) : scenario.vessel,
        decision: scenario.status === 'ready'
          ? deriveRouteDecision(scenario.forecastResult, scenario.vessel)
          : null,
      })),
      recommendedId,
      generatedAt: new Date().toISOString(),
    },
  };
}
