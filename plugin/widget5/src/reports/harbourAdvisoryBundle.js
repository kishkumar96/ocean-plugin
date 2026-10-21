// harbourAdvisoryBundle.js -- everything the Harbour Conditions Advisory PDF
// states, decided once and kept out of the renderer (same bundle -> renderer
// split as domainReportBundle.js). Pure: rows in, plain data out.
//
// Inputs are the rows from useCookIslandsHarbourWaveConditions plus the
// limits authority from useHarbourUnloadingLimits. Nothing here fetches.
import {
  evaluateConditions, worstVerdict, limitsForHarbour, hasAnyLimit, explainWindow, findOperationalWindow, MIN_WINDOW_HOURS, unloadingLabel, INCOMPLETE,
} from '../config/cookIslandsHarbourLimits';
import { waveRunAgeHours, compassPoint } from '../services/cookIslandsWaveTimeseriesService';
import { formatAge, updateFreshness } from '../utils/modelRunTiming';

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

// A wave-model node further than this from the location is flagged. 2 km is the same cut-off the
// on-screen harbour chart already uses for its "nearest wave-model point is N km away" note; it is a
// provisional value, not an agreed tolerance -- reefs, lagoons and passages are not resolved by the
// model grid at any distance, so a flag means "look harder", not "unreliable".
export const NODE_FAR_KM = 2;

const UNIT_DIGITS = { m: 1, s: 1, kt: 0 };
const num = (v, unit) => `${Number(v).toFixed(UNIT_DIGITS[unit] ?? 1)} ${unit}`;

// "Thu 14:00" in the report's time zone.
export function shortTime(value, timeZone) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
      .format(d).replace(',', '');
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

// Table cells are narrow: Hs / Tp are the terms the report's own column headers already define.
const COMPACT_LABEL = { hsM: 'Hs', tpS: 'Tp' };

// One line saying WHY a verdict is what it is: the controlling variable, its peak against the limit,
// and when it was over. e.g. "Wave height peaks 1.9 m (stop 1.5 m), over Thu 03:00 to Thu 09:00 (7 h)".
export function describeDriver(explanation, timeZone, { compact = false, withTime = true } = {}) {
  const d = explanation?.driver;
  if (!d) return '';
  const level = explanation.levelName; // 'stop' | 'caution'
  const sameTime = d.firstTime === d.lastTime;
  if (compact) {
    // One short line for a table cell: "Wave height 1.9 m, over stop 1.5 m · Wed 02:00-04:00 (3 h)".
    const first = shortTime(d.firstTime, timeZone);
    const last = shortTime(d.lastTime, timeZone);
    const sameDay = first.split(' ')[0] === last.split(' ')[0];
    const when = sameTime ? `at ${first}` : `${first}-${sameDay ? last.split(' ')[1] : last} (${d.steps} h)`;
    return `${COMPACT_LABEL[d.key] ?? d.label} ${num(d.peak, d.unit)}, over ${level} ${num(d.limit, d.unit)}${withTime ? ` · ${when}` : ''}`;
  }
  const when = sameTime
    ? `over at ${shortTime(d.firstTime, timeZone)}`
    : `over ${shortTime(d.firstTime, timeZone)} to ${shortTime(d.lastTime, timeZone)} (${d.steps} h)`;
  return `${d.label} peaks ${num(d.peak, d.unit)} (${level} ${num(d.limit, d.unit)}), ${when}`;
}

// One line for a harbour's operational window (see findOperationalWindow), e.g.
// "Next window Thu 16:00-Fri 11:00 (19 h)" or "No window of 3 h or more in the next 72 h".
export function describeWindow(win, timeZone) {
  if (!win) return '';
  if (win.state === 'within') {
    return win.throughEnd
      ? `Within limits for the whole forecast (${win.horizonHours} h)`
      : `Within limits until ${shortTime(win.until, timeZone)}`;
  }
  if (win.state === 'next') {
    return `Next window ${shortTime(win.start, timeZone)}-${shortTime(win.end, timeZone)} (${win.hours} h${win.throughEnd ? ' or more' : ''})`;
  }
  if (win.state === 'none') return `No window of ${MIN_WINDOW_HOURS} h or more in the next ${win.horizonHours} h`;
  return 'Window not assessable (data incomplete)';
}

// The same window as two short lines for a narrow table column: the times, then what they are.
export function describeWindowCell(win, timeZone) {
  if (!win) return null;
  if (win.state === 'within') {
    return win.throughEnd
      ? { head: 'Whole forecast', sub: `Within limits (${win.horizonHours} h)` }
      : { head: `Until ${shortTime(win.until, timeZone)}`, sub: 'Within limits' };
  }
  if (win.state === 'next') {
    return { head: `${shortTime(win.start, timeZone)}-${shortTime(win.end, timeZone)}`, sub: `Next window, ${win.hours} h${win.throughEnd ? '+' : ''}` };
  }
  if (win.state === 'none') return { head: `None in ${win.horizonHours} h`, sub: `no window of ${MIN_WINDOW_HOURS} h+` };
  return { head: 'Not assessable', sub: 'data incomplete' };
}

// Short cause for a table row: the controlling variable and its peak against the limit it crossed.
export function describeCause(explanation) {
  const d = explanation?.driver;
  if (!d) return '';
  return `${d.label} ${num(d.peak, d.unit)} vs ${explanation.levelName} ${num(d.limit, d.unit)}`;
}

// Counts of locations by verdict, for the headline banner. `now` and `next24h` are each tallied separately.
export function summarizeVerdicts(harbours) {
  const tally = (key) => {
    const t = { stop: 0, caution: 0, within: 0, incomplete: 0, unavailable: 0 };
    harbours.forEach((h) => {
      if (!h.available) t.unavailable += 1;
      else if (h[key] === 2) t.stop += 1;
      else if (h[key] === 1) t.caution += 1;
      else if (h[key] === 0) t.within += 1;
      else t.incomplete += 1;
    });
    return t;
  };
  return { total: harbours.length, now: tally('verdictNow'), next24h: tally('verdict24h') };
}

// The headline counts as two sentences, worded by who stands behind the limits (see unloadingLabel).
export function describeSummary(summary, basis) {
  const sentence = (t) => [
    t.stop && `${t.stop} ${unloadingLabel(2, basis).toLowerCase()}`,
    t.caution && `${t.caution} ${unloadingLabel(1, basis).toLowerCase()}`,
    t.within && `${t.within} ${unloadingLabel(0, basis).toLowerCase()}`,
    t.incomplete && `${t.incomplete} incomplete data`,
    t.unavailable && `${t.unavailable} unavailable`,
  ].filter(Boolean).join(', ');
  return { now: sentence(summary.now), next24h: sentence(summary.next24h) };
}

// Why a verdict reads Incomplete: the variables that have a limit but no value, and/or a forecast
// window with hours missing. '' when there is nothing to explain.
export function describeIncomplete(explanation, missingHours = 0, windowHours = 24) {
  const parts = [];
  if (explanation?.missing?.length) parts.push(`${explanation.missing.join(' and ')} not available`);
  if (missingHours > 0) parts.push(`forecast covers ${windowHours - missingHours} of ${windowHours} h`);
  return parts.join('; ');
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
  rows = [], suitabilityRunStart = null, updatedAt = null, limits = { basis: 'none', config: null, meta: null },
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
    // The explanation behind each verdict: controlling variable, peak and timing (or why Incomplete).
    const nowStep = { valid_time: row.validTime, wave_height_m: row.waveHeightM, tp_s: row.peakPeriodS, wind_speed_kt: row.windSpeedKt };
    const explainNow = row.available && harbourLimits ? explainWindow([nowStep], harbourLimits) : null;
    const explain24 = row.available && harbourLimits ? explainWindow(outlook, harbourLimits) : null;
    // A short or holey 24 h window can still prove a Stop, but can never prove "within limits":
    // the hours with no forecast could be the bad ones. Hence an INCOMPLETE entry whenever any
    // hour is missing (worstVerdict: Stop beats Incomplete beats everything else).
    const verdict24h = row.available && harbourLimits
      ? worstVerdict([...outlook.map(judge), row.outlookMissingHours > 0 ? INCOMPLETE : null])
      : null;
    const detailFor = (verdict, explanation, missingHours, windowHours, compact = false, withTime = true) => {
      if (!explanation || verdict === null) return '';
      if (verdict === INCOMPLETE) return describeIncomplete(explanation, missingHours, windowHours);
      // Stop/Caution: the driver. (A Stop proven in a short window still gets its driver.)
      return verdict === 0 ? '' : describeDriver(explanation, timeDisplayZone, { compact, withTime });
    };
    // Operational window over the 72 h outlook from "now" (step 0 is the "now" step).
    const win = row.available && harbourLimits ? findOperationalWindow(row.outlook72Steps ?? [], harbourLimits) : null;
    // The headline cause: what the next 24 h peaks at when that is over a limit, else what now is.
    const causeSource = verdict24h === 1 || verdict24h === 2 ? explain24 : explainNow;
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
      detailNow: detailFor(verdictNow, explainNow, 0, 1),
      detailNowShort: detailFor(verdictNow, explainNow, 0, 1, true, false),
      driverNow: explainNow?.driver ?? null,
      verdict24h,
      detail24h: detailFor(verdict24h, explain24, row.outlookMissingHours ?? 0, 24),
      detail24hShort: detailFor(verdict24h, explain24, row.outlookMissingHours ?? 0, 24, true),
      driver24h: explain24?.driver ?? null,
      cause: describeCause(causeSource),
      window: win,
      windowText: describeWindow(win, timeDisplayZone),
      windowCell: describeWindowCell(win, timeDisplayZone),
      missing24Hours: row.available ? (row.outlookMissingHours ?? 0) : null,
      missing72Hours: row.available ? (row.outlook72MissingHours ?? 0) : null,
      // 72 h trend of Hs for the page-2 small multiples.
      series: (row.outlook72Steps ?? []).map((s) => ({ t: new Date(s.valid_time).getTime(), hsM: Number.isFinite(s.wave_height_m) ? s.wave_height_m : null })),
      hsCaution: harbourLimits?.caution?.hsM ?? null,
      hsStop: harbourLimits?.stop?.hsM ?? null,
      // Why this row is unavailable, when it is (e.g. the forecast has no step near the clock).
      unavailableReason: row.available ? null : (row.unavailableReason ?? null),
      // The wave-model node actually sampled, and whether it is far from the location.
      nodeDistanceKm: row.waveNode?.distanceKm ?? null,
      nodeFar: Number.isFinite(row.waveNode?.distanceKm) && row.waveNode.distanceKm > NODE_FAR_KM,
    };
  });

  const runAgeHours = waveRunAgeHours(suitabilityRunStart, generatedAt.getTime());
  // Freshness by when the forecast last updated, as on screen (see utils/modelRunTiming.js).
  const updateAgeHours = waveRunAgeHours(updatedAt, generatedAt.getTime());
  const freshness = runAgeHours === null ? { state: 'unknown', reason: null } : updateFreshness(updateAgeHours, runAgeHours);
  const stale = freshness.state === 'stale';
  const periodWithheld = rows.some((r) => r.periodWithheld);
  const waveRunStart = rows.find((r) => r.waveRunStart)?.waveRunStart ?? null;
  const availableCount = harbours.filter((h) => h.available).length;

  // Every row picks its own "now" step; normally they are the same hour. When they are not, the
  // report must not print one shared time as if it applied to all of them.
  const validTimes = harbours.filter((h) => h.available && h.validTime).map((h) => new Date(h.validTime).getTime()).filter(Number.isFinite);
  const validTimeMin = validTimes.length ? Math.min(...validTimes) : null;
  const validTimeMax = validTimes.length ? Math.max(...validTimes) : null;
  const validTimeCommon = validTimes.length && validTimeMin === validTimeMax ? validTimeMin : null;

  const farNodes = harbours.filter((h) => h.available && h.nodeFar);

  const warnings = [];
  if (farNodes.length) {
    warnings.push(`${farNodes.length} of ${harbours.length} locations use a wave-model point more than ${NODE_FAR_KM} km away (marked †). The model does not resolve reefs, lagoons or passages, so conditions at the harbour itself can differ.`);
  }
  if (stale) {
    warnings.push(freshness.reason === 'not-updated'
      ? `Forecast may be outdated: it has not updated for ${formatAge(updateAgeHours)} (the system normally updates every 6 h).`
      : 'Forecast may be outdated: the latest update has no newer model data. A newer run may not have published yet.');
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
    updatedAt,
    updateAgeHours,
    stale,
    periodWithheld,
    basis,
    judged: Boolean(judged),
    basisStatement: limitsBasisStatement(basis, limits.meta),
    harbours,
    summary: summarizeVerdicts(harbours),
    summaryText: describeSummary(summarizeVerdicts(harbours), basis),
    validTimeCommon,
    validTimeMin,
    validTimeMax,
    nodeFarKm: NODE_FAR_KM,
    warnings,
  };
}
