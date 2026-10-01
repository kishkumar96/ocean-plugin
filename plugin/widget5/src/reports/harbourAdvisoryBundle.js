// harbourAdvisoryBundle.js -- everything the Harbour Conditions Advisory PDF
// states, decided once and kept out of the renderer (same bundle -> renderer
// split as domainReportBundle.js). Pure: rows in, plain data out.
//
// Inputs are the rows from useCookIslandsHarbourWaveConditions plus the
// limits authority from useHarbourUnloadingLimits. Nothing here fetches.
import {
  evaluateConditions, worstVerdict, limitsForHarbour, hasAnyLimit, INCOMPLETE,
} from '../config/cookIslandsHarbourLimits';
import { waveRunAgeHours, WAVE_STALE_HOURS, compassPoint } from '../services/cookIslandsWaveTimeseriesService';

// Report wording for a verdict. Deliberately the vocabulary of "limits"
// (conditions against criteria), never instructions to act -- see
// FORBIDDEN_PHRASES in reportRules.js.
export function verdictText(verdict) {
  if (verdict === 0) return 'Within limits';
  if (verdict === 1) return 'Exceeds caution limit';
  if (verdict === 2) return 'Exceeds stop limit';
  if (verdict === INCOMPLETE) return 'Incomplete data';
  return '—';
}

const max = (values) => {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : null;
};

// What the limits rest on, as one statement the PDF prints verbatim.
export function limitsBasisStatement(basis, meta) {
  if (basis === 'approved') {
    return `Unloading limits: version ${meta.version}, approved by ${meta.approvedBy} on ${String(meta.approvedOn).slice(0, 10)}, effective ${String(meta.effectiveFrom).slice(0, 10)}.`;
  }
  if (basis === 'provisional') {
    return 'Unloading limits: PROVISIONAL placeholder values, NOT confirmed by Cook Islands Government or any harbour authority. Verdicts in this report are indicative only and are not approved guidance.';
  }
  if (basis === 'draft') {
    return 'Unloading limits: DRAFT, entered locally and NOT approved. Verdicts in this report are for discussion only and are not approved guidance.';
  }
  if (basis === 'pending') {
    return `Approved unloading limits (version ${meta.version}) take effect ${String(meta.effectiveFrom).slice(0, 10)}. No limits are applied in this report.`;
  }
  if (basis === 'unavailable') {
    return 'Approved unloading limits could not be loaded, so no verdict is shown in this report.';
  }
  return 'No approved unloading limits have been set. This report shows forecast values only, with no verdict.';
}

export function buildHarbourAdvisoryBundle({
  rows = [], suitabilityRunStart = null, limits = { basis: 'none', config: null, meta: null },
  limitsUnavailable = false, timeDisplayZone = 'Pacific/Rarotonga', generatedAt = new Date(),
}) {
  const basis = limitsUnavailable ? 'unavailable' : limits.basis;
  // Verdicts exist only when a real authority backs them.
  const judged = (basis === 'approved' || basis === 'provisional' || basis === 'draft') && limits.config && (
    hasAnyLimit(limits.config.default) || Object.values(limits.config.harbours).some(hasAnyLimit)
  );

  const harbours = rows.map((row) => {
    const harbourLimits = judged ? limitsForHarbour(limits.config, row.riskPointId) : null;
    const judge = (step) => (harbourLimits
      ? evaluateConditions({ hsM: step.wave_height_m, tpS: step.tp_s, windKt: step.wind_speed_kt }, harbourLimits)
      : null);
    const outlook = row.outlookSteps ?? [];
    const verdictNow = row.available && harbourLimits
      ? evaluateConditions({ hsM: row.waveHeightM, tpS: row.peakPeriodS, windKt: row.windSpeedKt }, harbourLimits)
      : null;
    return {
      riskPointId: row.riskPointId,
      name: row.name,
      island: row.island,
      lat: row.lat,
      lon: row.lon,
      available: Boolean(row.available),
      validTime: row.validTime ?? null,
      hsM: row.available ? (row.waveHeightM ?? null) : null,
      tpS: row.available ? (row.peakPeriodS ?? null) : null,
      dirDeg: row.available ? (row.peakDirectionDeg ?? null) : null,
      dirPoint: compassPoint(row.peakDirectionDeg),
      windKt: row.available ? (row.windSpeedKt ?? null) : null,
      max24HsM: row.available ? max(outlook.map((s) => s.wave_height_m)) : null,
      max24WindKt: row.available ? max(outlook.map((s) => s.wind_speed_kt)) : null,
      verdictNow,
      // A short or holey 24 h window can still prove a Stop, but can never prove "within limits":
      // the hours with no forecast could be the bad ones. Hence an INCOMPLETE entry whenever any
      // hour is missing (worstVerdict: Stop beats Incomplete beats everything else).
      verdict24h: row.available && harbourLimits
        ? worstVerdict([...outlook.map(judge), row.outlookMissingHours > 0 ? INCOMPLETE : null])
        : null,
      missing24Hours: row.available ? (row.outlookMissingHours ?? 0) : null,
      missing72Hours: row.available ? (row.outlook72MissingHours ?? 0) : null,
      // 72 h trend of Hs for the page-2 small multiples.
      series: (row.outlook72Steps ?? []).map((s) => ({ t: new Date(s.valid_time).getTime(), hsM: Number.isFinite(s.wave_height_m) ? s.wave_height_m : null })),
      hsCaution: harbourLimits?.caution?.hsM ?? null,
      hsStop: harbourLimits?.stop?.hsM ?? null,
    };
  });

  const runAgeHours = waveRunAgeHours(suitabilityRunStart, generatedAt.getTime());
  const stale = runAgeHours !== null && runAgeHours > WAVE_STALE_HOURS;
  const periodWithheld = rows.some((r) => r.periodWithheld);
  const waveRunStart = rows.find((r) => r.waveRunStart)?.waveRunStart ?? null;
  const availableCount = harbours.filter((h) => h.available).length;

  const warnings = [];
  if (stale) {
    warnings.push(`Forecast may be outdated: the model run is ${Math.round(runAgeHours)} h old. A newer run may not have published yet.`);
  }
  if (periodWithheld) {
    warnings.push('Peak period and wave direction are withheld: the wave feed is not from the same model run as wave height and wind. Any period limit reads Incomplete data.');
  }
  const partial24 = harbours.filter((h) => h.available && h.missing24Hours > 0);
  if (partial24.length) {
    warnings.push(`${partial24.length} of ${harbours.length} locations have less than a full 24 h of forecast (${partial24.slice(0, 3).map((h) => `${h.name}: ${24 - h.missing24Hours} h`).join(', ')}${partial24.length > 3 ? ', …' : ''}). Their 24 h figures cover only the hours available, marked *, and their 24 h verdict reads Incomplete data unless a limit is already exceeded.`);
  }
  if (availableCount < harbours.length) {
    warnings.push(`${harbours.length - availableCount} of ${harbours.length} locations have no model data and are shown as unavailable.`);
  }

  return {
    generatedAt,
    timezone: timeDisplayZone,
    runStart: suitabilityRunStart,
    waveRunStart,
    runAgeHours,
    stale,
    periodWithheld,
    basis,
    judged: Boolean(judged),
    basisStatement: limitsBasisStatement(basis, limits.meta),
    harbours,
    warnings,
  };
}
