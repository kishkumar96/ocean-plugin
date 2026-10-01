// domainReportBundle.js -- builds the single, validated data bundle the domain
// advisory PDF renders. Drawing code never fetches or interprets endpoint
// responses; it draws this. Everything a page prints (model run, valid time,
// scope, coverage, warnings) comes from one place, so pages cannot disagree.
//
// Validation rules applied here (not in the renderer):
//  * scope: the API reports statistics_basis and applied_bounds; if they do not
//    match what was requested, the bundle says so (scope.mismatch + a warning)
//    and the effective scope is what the API actually used -- never the request.
//  * a step with zero assessed points is a gap, never "Suitable".
//  * a map whose applied bounds differ from the requested extent is dropped.
import {
  fetchSuitabilityMeta, fetchVesselStep, fetchBestContrast, fetchOperationalMap, fetchSummarySeries, fetchDomainBoundary, mapWithLimit, ReportAbortError,
} from './suitabilityReportService';
import { parseRunId, zonedWallTimeToUtc, ReportExportBlockedError, boundsClose, coverageConfidence } from './reportRules';
import {
  bestWindow, highestRiskStep, elevatedRuns, recoveryWindows, unavailableRuns, coverageOf,
} from './seriesAnalysis';
import { VESSEL_CLASS_OPTIONS } from '../lib/CookIslandsSuitabilityOverlay';

const VESSEL_CODES = VESSEL_CLASS_OPTIONS.map((v) => v.value);
const SERIES_STRIDE_HOURS = 6;
const DAILY_MATCH_TOLERANCE_MS = 3 * 3600e3;
const FETCH_LIMIT = 8;

export const HORIZON_OPTIONS = [
  { value: 0, label: 'Current time only' },
  { value: 72, label: '72-hour outlook' },
  { value: 168, label: 'Seven-day outlook' },
];

// exec + methodology for a single time; all six pages when an outlook is requested.
export const expectedDomainPageCount = (horizonHours) => (horizonHours > 0 ? 6 : 2);

export const LIMITATIONS = [
  'Statistics describe modelled wind and wave conditions at forecast grid points, not observations.',
  'Percentages are shares of assessed model points; they are not shares of sea area or of vessel routes.',
  'Nearshore, reef and lagoon conditions are not resolved by the wave model grid.',
  'Currents, tides, visibility and local hazards are not included in the suitability classification.',
  'Missing or unassessed times are shown as Unavailable and are never treated as Suitable.',
];

// Decides whether the statistics returned really describe the requested scope.
export function validateScope({ requested, requestedBounds }, steps) {
  const reasons = [];
  const usable = steps.filter(Boolean);
  const basisReported = usable.find((s) => s.statisticsBasis)?.statisticsBasis ?? null;
  const appliedBounds = usable.find((s) => s.appliedBounds)?.appliedBounds ?? null;
  if (requested === 'viewport') {
    if (basisReported !== 'points_in_bounds') reasons.push(`Requested the current map view but the service reported "${basisReported ?? 'no basis'}".`);
    else if (!boundsClose(requestedBounds, appliedBounds)) reasons.push('The bounds the service applied differ from the map view requested.');
  } else if (basisReported && basisReported !== 'full_domain') {
    reasons.push(`Requested the whole domain but the service reported "${basisReported}".`);
  }
  const mismatch = reasons.length > 0;
  let effective = requested;
  if (mismatch) effective = basisReported === 'full_domain' ? 'domain' : (basisReported === 'points_in_bounds' ? 'viewport' : 'unknown');
  return { requested, effective, requestedBounds: requestedBounds ?? null, appliedBounds, basisReported, mismatch, reasons };
}

// Local-noon targets (in the display zone) for the daily evolution page, matched to
// forecast time steps; a target past the forecast end is "beyond horizon", not guessed.
export function planDailyPanels({ validTimeMs, forecastStartMs, forecastEndMs, stepMs, days, timeZone }) {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(validTimeMs)).reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  let y = +local.year; let m = +local.month; let d = +local.day;
  const panels = [];
  let guard = 0;
  while (panels.length < days && guard < days + 3) {
    const target = zonedWallTimeToUtc(y, m, d, 12, timeZone).getTime();
    guard += 1;
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    y = next.getUTCFullYear(); m = next.getUTCMonth() + 1; d = next.getUTCDate();
    if (target < validTimeMs - DAILY_MATCH_TOLERANCE_MS) continue; // noon already passed today
    if (target > forecastEndMs + DAILY_MATCH_TOLERANCE_MS) { panels.push({ targetTime: target, beyondHorizon: true, timeIndex: null, matchedTime: null }); continue; }
    const idx = Math.round((target - forecastStartMs) / stepMs);
    const matched = forecastStartMs + idx * stepMs;
    const ok = idx >= 0 && Math.abs(matched - target) <= DAILY_MATCH_TOLERANCE_MS;
    panels.push({ targetTime: target, beyondHorizon: !ok, timeIndex: ok ? idx : null, matchedTime: ok ? matched : null });
  }
  return panels;
}

const swallow = async (fn, onError) => { try { return await fn(); } catch (e) { if (e instanceof ReportAbortError || e?.name === 'AbortError') throw new ReportAbortError(); onError?.(e); return null; } };

export async function buildDomainReportBundle({
  vessel, timeIndex = 0, bounds = null, scope = 'viewport', horizonHours = 0,
  timeDisplayZone = 'Pacific/Rarotonga', customEnvelope = null, fallbackMapDataUrl = null, signal, onProgress, now = () => new Date(),
} = {}, deps = {}) {
  const d = {
    fetchMeta: fetchSuitabilityMeta, fetchStep: fetchVesselStep, fetchContrast: fetchBestContrast, fetchMap: fetchOperationalMap, fetchSeries: fetchSummarySeries, fetchBoundary: fetchDomainBoundary, ...deps,
  };
  const warnings = [];
  const limitations = [...LIMITATIONS];
  let done = 0;
  const wantOutlook = horizonHours > 0;
  const estTotal = 6 + (wantOutlook ? 4 * (Math.ceil(horizonHours / SERIES_STRIDE_HOURS) + 1) + 1 + 4 + 4 + 1 + Math.min(6, Math.ceil(horizonHours / 24)) * 2 : 0);
  const tick = (label) => { done += 1; onProgress?.({ done: Math.min(done, estTotal), total: estTotal, label }); };

  const meta = await d.fetchMeta({ signal });
  tick('Model run');
  const forecastStartMs = meta.forecastStart?.getTime() ?? null;
  const forecastEndMs = meta.forecastEnd?.getTime() ?? null;
  const stepMs = meta.timestepCount > 1 && forecastStartMs !== null && forecastEndMs !== null
    ? (forecastEndMs - forecastStartMs) / (meta.timestepCount - 1) : 3600e3;
  const lastIndex = Math.max((meta.timestepCount ?? 1) - 1, 0);

  // Requested scope: a viewport needs real bounds.
  let requested = scope;
  if (requested === 'viewport' && !bounds) {
    requested = 'domain';
    warnings.push('No map view was available, so the whole forecast domain was used.');
  }
  const reqBounds = requested === 'viewport' ? bounds : null;

  const stepOpts = { signal };
  const current = await Promise.all(VESSEL_CODES.map((v) => swallow(() => d.fetchStep(timeIndex, v, reqBounds, stepOpts))));
  tick('Current conditions');
  if (current.every((s) => !s)) throw new Error('Suitability statistics are unavailable for this time.');

  const scopeInfo = validateScope({ requested, requestedBounds: reqBounds }, current);
  if (scopeInfo.mismatch) {
    warnings.push(`Statistics scope differs from the request: ${scopeInfo.reasons.join(' ')} Figures describe: ${scopeInfo.effective === 'domain' ? 'the whole forecast domain' : scopeInfo.effective}.`);
  }
  const domainBounds = current.find((s) => s?.domainBounds)?.domainBounds ?? null;
  const mapBounds = scopeInfo.effective === 'viewport' ? reqBounds : domainBounds;

  const vessels = {};
  VESSEL_CODES.forEach((code, i) => { vessels[code] = current[i] ?? null; });
  const validTimeMs = current.find((s) => s?.validTime)?.validTime ?? (forecastStartMs !== null ? forecastStartMs + timeIndex * stepMs : null);

  // ── outlook series ────────────────────────────────────────────────────
  let timeSeries = null;
  if (wantOutlook) {
    const strideSteps = Math.max(1, Math.round((SERIES_STRIDE_HOURS * 3600e3) / stepMs));
    const endIdx = Math.min(lastIndex, timeIndex + Math.round((horizonHours * 3600e3) / stepMs));
    const idxs = [];
    for (let i = timeIndex; i <= endIdx; i += strideSteps) idxs.push(i);
    if (idxs[idxs.length - 1] !== endIdx) idxs.push(endIdx);
    const gap = (i) => ({ timeIndex: i, validTime: forecastStartMs !== null ? forecastStartMs + i * stepMs : null, available: false, suitable: null, caution: null, warning: null });
    const byVessel = {};
    VESSEL_CODES.forEach((v) => { byVessel[v] = []; });
    // One bulk request when the service offers it; otherwise vessels x steps single requests.
    let bulk = null;
    try {
      bulk = await d.fetchSeries(reqBounds, { startIndex: timeIndex, endIndex: endIdx, stride: strideSteps, signal });
      if (!VESSEL_CODES.every((v) => bulk?.vessels?.[v]?.length)) bulk = null;
    } catch (e) {
      if (e instanceof ReportAbortError || e?.name === 'AbortError') throw new ReportAbortError();
      bulk = null;
    }
    if (bulk) {
      // Align onto the REQUESTED time grid. Taking the response's own steps as-is would let
      // omitted timestamps vanish from the coverage denominator and let "best window" bridge
      // them; every requested index without a returned step is an explicit gap instead.
      VESSEL_CODES.forEach((v) => {
        const byIndex = new Map(bulk.vessels[v].map((step) => [step.timeIndex, step]));
        byVessel[v] = idxs.map((i) => byIndex.get(i) ?? gap(i));
      });
      tick('Outlook');
    } else {
      const jobs = idxs.flatMap((i) => VESSEL_CODES.map((v) => ({ i, v })));
      const results = await mapWithLimit(jobs, FETCH_LIMIT, ({ i, v }) => swallow(() => d.fetchStep(i, v, reqBounds, stepOpts)), { signal, onEach: () => tick('Outlook') });
      jobs.forEach(({ i, v }, k) => { byVessel[v].push(results[k] || gap(i)); });
    }
    // The outlook must describe the same area as the headline figures. Scope was only ever
    // validated on the current-time steps, so an endpoint that ignored the viewport bounds
    // for the series could have the trend describe a different area than the report states.
    const outlookReturned = VESSEL_CODES.flatMap((v) => byVessel[v]).filter((st) => st && st.available !== false);
    if (outlookReturned.length) {
      const outlookScope = validateScope({ requested, requestedBounds: reqBounds }, outlookReturned);
      if (outlookScope.effective !== scopeInfo.effective) {
        warnings.push(`The outlook was omitted: its statistics describe a different area (${outlookScope.effective === 'domain' ? 'the whole forecast domain' : outlookScope.effective}) from the headline figures (${scopeInfo.effective === 'domain' ? 'the whole forecast domain' : scopeInfo.effective}). Outlook time steps are shown as Unavailable.`);
        VESSEL_CODES.forEach((v) => { byVessel[v] = idxs.map((i) => gap(i)); });
      }
    }
    const analysis = {};
    VESSEL_CODES.forEach((v) => {
      const s = byVessel[v];
      const coverage = coverageOf(s);
      // Same 80% bar the route advisory applies before it recommends anything: a "best
      // window" drawn from a mostly-missing series is not a finding, and "no window" would
      // be a false claim about the sea. Withheld, and said so.
      const bestWithheld = coverageConfidence(coverage.available, coverage.total) === 'insufficient';
      analysis[v] = {
        best: bestWithheld ? null : bestWindow(s), bestWithheld,
        highest: highestRiskStep(s), elevated: elevatedRuns(s), recovery: recoveryWindows(s), unavailable: unavailableRuns(s), coverage,
      };
    });
    timeSeries = { strideHours: (strideSteps * stepMs) / 3600e3, byVessel, analysis, startIndex: timeIndex, endIndex: endIdx };
    const gaps = analysis[vessel]?.unavailable ?? [];
    if (gaps.length) warnings.push(`${gaps.reduce((n, g) => n + g.steps, 0)} outlook time step(s) for the selected vessel could not be assessed and are shown as Unavailable.`);
  }

  // ── maps ──────────────────────────────────────────────────────────────
  const maps = { selected: null, contrast: null, daily: [], bounds: mapBounds };
  // Optional overlay: where the wave model has values. Skipped silently if the service lacks it.
  const domainBoundary = mapBounds ? await swallow(() => d.fetchBoundary({ signal })) : null;
  let mapFailure = null;
  const fetchCheckedMap = async (v, i) => {
    if (!mapBounds) return null;
    // A failed map request must be visible in the report, not look like a rendering race.
    const m = await swallow(() => d.fetchMap(v, i, mapBounds, { signal }), (e) => { mapFailure = e?.message || String(e); });
    if (!m) return null;
    if (m.appliedBounds && !boundsClose(m.appliedBounds, mapBounds)) {
      limitations.push('A map was omitted because the service drew a different extent from the one requested.');
      return null;
    }
    // x-classified-cells === 0: the service rendered a PNG but nothing on-mesh
    // fell inside it (e.g. bounds landing entirely on masked/off-mesh cells) --
    // a real but visually blank map. null means an unpatched deployment that
    // doesn't send the header yet; treated as unknown, not blank, so this is
    // additive and never regresses a deployment without it.
    if (m.classifiedCells === 0) {
      mapFailure = 'the service rendered an empty map for these bounds';
      limitations.push('A map was omitted because the service reported no classified data for it.');
      return null;
    }
    return m;
  };
  maps.selected = await fetchCheckedMap(vessel, timeIndex);
  tick('Map');
  if (!maps.selected && fallbackMapDataUrl) {
    maps.selected = { dataUrl: fallbackMapDataUrl, appliedBounds: null, fallback: true };
    limitations.push('The page 1 map is a screenshot of the on-screen map, not a service-rendered map; it may show layers or an extent that differ slightly from the statistics.');
  } else if (!maps.selected) {
    // No service-rendered map AND no on-screen fallback: page 1 would ship as a
    // polished PDF with a blank map frame next to statistics it can't visually
    // corroborate. That reads as a broken report, not an honest limitation --
    // stop here instead of letting the renderer paper over it.
    throw new ReportExportBlockedError(
      `Report not generated: the primary map could not be produced${mapFailure ? ` (${mapFailure})` : ''}, and no on-screen map was available as a fallback.`,
    );
  }

  if (wantOutlook) {
    const contrast = await swallow(() => d.fetchContrast(reqBounds ?? null, { startIndex: timeIndex, endIndex: timeSeries.endIndex, signal }));
    tick('Vessel contrast');
    if (contrast && Number.isFinite(contrast.timeIndex)) {
      let panelSteps = await Promise.all(VESSEL_CODES.map((v) => swallow(() => d.fetchStep(contrast.timeIndex, v, reqBounds, stepOpts))));
      // Same scope guard as the headline and outlook: a comparison panel describing a
      // different area is dropped, not shown next to figures for another one.
      if (panelSteps.some(Boolean) && validateScope({ requested, requestedBounds: reqBounds }, panelSteps).effective !== scopeInfo.effective) {
        limitations.push('The vessel comparison statistics were omitted because they describe a different area from the headline figures.');
        panelSteps = VESSEL_CODES.map(() => null);
      }
      const panelMaps = await Promise.all(VESSEL_CODES.map((v) => fetchCheckedMap(v, contrast.timeIndex)));
      tick('Vessel maps');
      maps.contrast = { ...contrast, panels: VESSEL_CODES.map((v, i) => ({ vessel: v, step: panelSteps[i], map: panelMaps[i] })) };
    } else {
      warnings.push('The time of greatest vessel contrast could not be determined; the vessel comparison page is omitted.');
    }

    const days = Math.min(6, Math.ceil(horizonHours / 24));
    const plan = validTimeMs !== null && forecastStartMs !== null
      ? planDailyPanels({ validTimeMs, forecastStartMs, forecastEndMs, stepMs, days, timeZone: timeDisplayZone }) : [];
    maps.daily = await Promise.all(plan.map(async (p) => {
      if (p.beyondHorizon) return { ...p, step: null, map: null };
      const [step, map] = await Promise.all([swallow(() => d.fetchStep(p.timeIndex, vessel, reqBounds, stepOpts)), fetchCheckedMap(vessel, p.timeIndex)]);
      tick('Daily maps');
      return { ...p, step, map };
    }));
  }

  // ── coverage / provenance ─────────────────────────────────────────────
  const sel = vessels[vessel];
  // Prefer the run the statistics themselves report; flag a disagreement with the run-level metadata.
  const stepRunId = current.find((s) => s?.runId)?.runId ?? null;
  if (stepRunId && meta.runId && stepRunId !== meta.runId) warnings.push(`The statistics report model run ${stepRunId} but the run metadata reports ${meta.runId}; the forecast may have updated while this report was built.`);
  const runTime = parseRunId(stepRunId ?? meta.runId) ?? meta.modelRunTime ?? null;
  const generatedAt = now();
  const pointCoverage = sel ? { classified: sel.classifiedPoints, eligible: sel.eligiblePoints, total: sel.totalPoints } : null;
  if (sel && sel.eligiblePoints !== null && sel.classifiedPoints < sel.eligiblePoints) {
    warnings.push(`Only ${sel.classifiedPoints} of ${sel.eligiblePoints} eligible points were classified for the selected vessel.`);
  }
  if (!runTime) warnings.push('The model run time was not reported by the service.');
  if (customEnvelope) limitations.push('Custom thresholds are applied on the on-screen map; this report uses the preset thresholds for every vessel class.');

  return {
    reportType: 'domain-advisory',
    generatedAt,
    modelRun: { runId: stepRunId ?? meta.runId, time: runTime, ageHours: runTime ? (generatedAt.getTime() - runTime.getTime()) / 3600e3 : null },
    validTime: validTimeMs,
    forecastWindow: {
      start: validTimeMs, end: timeSeries ? (timeSeries.byVessel[vessel].filter((s) => s.validTime).slice(-1)[0]?.validTime ?? null) : validTimeMs,
      forecastStart: forecastStartMs, forecastEnd: forecastEndMs, horizonHours, hindcastHoursBeforeRun: meta.hindcastHoursBeforeRun ?? null,
    },
    scope: scopeInfo,
    methodology: {
      apiSchemaVersion: meta.schemaVersion, methodologyVersion: current.find((s) => s?.methodologyVersion)?.methodologyVersion ?? meta.methodologyVersion ?? null,
      thresholdSource: customEnvelope ? 'preset (custom on-screen envelope not applied)' : 'preset',
      thresholds: meta.vessels,
    },
    selectedVessel: vessel,
    timezone: timeDisplayZone,
    vessels,
    timeSeries,
    maps,
    domainBoundary,
    coverage: { points: pointCoverage, steps: timeSeries ? timeSeries.analysis[vessel]?.coverage ?? null : null },
    locations: meta.locations,
    limitations,
    warnings,
  };
}
