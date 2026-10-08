// domainBriefing.js -- the decision layer of the domain advisory: a plain-language summary, the page-1
// briefing (status, driver, lowest exposure, worst case, data confidence, freshness), threshold margins,
// a reproducible report id, and the pre-export checks that block a report whose numbers do not add up.
// Pure: bundle facts in, plain data out. Wording obeys reportRules (modelled, never "safe").
import { coverageConfidence, stepLevel, ELEVATED_WARNING_PERCENT, pctText } from './reportRules';
import { estimateDriver } from './dailyEvolution';
import { updateFreshness } from '../utils/modelRunTiming';

// null / undefined / '' are missing, not zero (Number(null) is 0).
const finite = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// Meaning first: one sentence a reader can act on, before the percentages. Never "safe".
export function operationalSummary(label, step) {
  if (!step || step.available === false || !Number.isFinite(step.warning)) {
    return `${label}: no model data for this area and time.`;
  }
  const w = Number(step.warning) || 0;
  const c = Number(step.caution) || 0;
  if (w >= ELEVATED_WARNING_PERCENT) return `${label}: Warning conditions over much of the assessed area.`;
  if (w > 0) return `${label}: mostly below the Warning threshold, with localised Warning conditions.`;
  if (c >= 50) return `${label}: Caution conditions over most of the assessed area; no Warning.`;
  if (c > 0) return `${label}: mostly within the preset thresholds, with localised Caution and no Warning.`;
  return `${label}: within the preset thresholds across the assessed area.`;
}

// How far a peak value is from the threshold that matters for it: above Warning, else below Warning
// (when over Caution), else below Caution. e.g. "0.7 m above Warning".
export function thresholdMargin(value, caution, warning, { unit = '', digits = 1 } = {}) {
  const v = finite(value);
  if (v === null || !Number.isFinite(warning)) return null;
  const fmt = (x) => `${Math.abs(x).toFixed(digits)}${unit ? ` ${unit}` : ''}`;
  // Equal at the printed precision reads "at", never "0 kt above".
  const at = (x) => Math.abs(x) < 0.5 * 10 ** -digits;
  if (v >= warning) return at(v - warning)
    ? { side: 'at', level: 'warning', amount: 0, text: 'at the Warning threshold' }
    : { side: 'above', level: 'warning', amount: v - warning, text: `${fmt(v - warning)} above Warning` };
  if (Number.isFinite(caution) && v >= caution && at(v - caution)) return { side: 'at', level: 'caution', amount: 0, text: 'at the Caution threshold' };
  if (Number.isFinite(caution) && v >= caution) return { side: 'below', level: 'warning', amount: warning - v, text: `${fmt(warning - v)} below Warning` };
  if (Number.isFinite(caution)) return { side: 'below', level: 'caution', amount: caution - v, text: `${fmt(caution - v)} below Caution` };
  return { side: 'below', level: 'warning', amount: warning - v, text: `${fmt(warning - v)} below Warning` };
}

// Small stable hash (djb2) so the same inputs always give the same id.
function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36).toUpperCase().padStart(6, '0').slice(-6);
}

const VESSEL_CODE = { traditional_craft: 'TC', very_small_motorised_craft: 'VS', small_craft: 'SC', larger_vessels: 'LV' };

// e.g. COK-SUIT-2026100406-V2026100417-SC-VIEW-3K9QZ1. The readable part names run, valid hour, vessel and
// scope; the hash pins everything else that shaped the figures (bounds, method, rule and threshold set).
export function reportId({ runId, validTime, vessel, scope, bounds, methodologyVersion, ruleId, thresholdSetId }) {
  const valid = Number.isFinite(validTime) ? new Date(validTime).toISOString().replace(/[-:T]/g, '').slice(0, 10) : 'NOVALID';
  const scopeCode = scope === 'viewport' ? 'VIEW' : scope === 'domain' ? 'DOM' : 'UNK';
  const fingerprint = JSON.stringify({ bounds: bounds ?? null, methodologyVersion: methodologyVersion ?? null, ruleId, thresholdSetId });
  return `COK-SUIT-${runId ?? 'NORUN'}-V${valid}-${VESSEL_CODE[vessel] ?? 'XX'}-${scopeCode}-${hash(fingerprint)}`;
}

// Page-1 decision briefing for the selected vessel.
export function buildBriefing({ step, envelope, analysis = null, pointCoverage = null, stepCoverage = null, runAgeHours = null, updateAgeHours = null }) {
  const ok = Boolean(step) && step.available !== false && Number.isFinite(step.warning);
  const pointConfidence = pointCoverage && Number.isFinite(pointCoverage.eligible)
    ? coverageConfidence(pointCoverage.classified, pointCoverage.eligible) : null;
  const stepConfidence = stepCoverage ? coverageConfidence(stepCoverage.available, stepCoverage.total) : null;
  // The weaker of the two coverages is the report's data confidence.
  const order = { high: 2, reduced: 1, insufficient: 0 };
  const confidence = [pointConfidence, stepConfidence].filter(Boolean).reduce((a, b) => (order[b] < order[a] ? b : a), 'high');
  return {
    level: ok ? stepLevel(step.warning, step.caution) : null,
    driver: ok ? estimateDriver(step, envelope) : null,
    peakHsM: ok ? finite(step.wave?.max) : null,
    peakWindKt: ok ? finite(step.wind?.max) : null,
    lowest: analysis ? (analysis.best ? { kind: 'all-suitable', start: analysis.best.start, end: analysis.best.end } : (analysis.lowest ?? null)) : null,
    worst: analysis?.highest ?? null,
    confidence: pointConfidence || stepConfidence ? confidence : null,
    pointConfidence,
    stepConfidence,
    // By when the forecast last updated, as on screen; the model-run age alone is the fallback.
    freshness: updateFreshness(updateAgeHours, runAgeHours).state,
  };
}

// ── pre-export checks ───────────────────────────────────────────────────────
// Errors mean the numbers cannot be right (shares that do not sum, more classified points than exist,
// a valid time outside the data, time running backwards): the report is blocked rather than printed.
export function validateDomainBundle(bundle) {
  const errors = [];
  const checkStep = (step, where) => {
    if (!step || step.available === false) return;
    const parts = [step.suitable, step.caution, step.warning].map(finite);
    if (parts.every((p) => p !== null)) {
      const sum = parts.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 100) > 1.5) errors.push(`${where}: class shares sum to ${sum.toFixed(1)}%, not 100%.`);
      if (parts.some((p) => p < 0 || p > 100)) errors.push(`${where}: a class share is outside 0-100%.`);
    }
    const { classifiedPoints: cl, eligiblePoints: el, totalPoints: tot } = step;
    if (Number.isFinite(cl) && Number.isFinite(el) && cl > el) errors.push(`${where}: ${cl} classified points exceed ${el} eligible.`);
    if (Number.isFinite(el) && Number.isFinite(tot) && el > tot) errors.push(`${where}: ${el} eligible points exceed ${tot} total.`);
  };
  Object.entries(bundle?.vessels ?? {}).forEach(([v, step]) => checkStep(step, `Current ${v}`));
  const ts = bundle?.timeSeries;
  if (ts) {
    Object.entries(ts.byVessel ?? {}).forEach(([v, series]) => {
      let prev = -Infinity;
      series.forEach((step, k) => {
        checkStep(step, `Outlook ${v} step ${k}`);
        if (Number.isFinite(step?.validTime)) {
          if (step.validTime <= prev) errors.push(`Outlook ${v}: time steps are not in order at step ${k}.`);
          prev = step.validTime;
        }
      });
    });
  }
  const fw = bundle?.forecastWindow;
  if (fw && Number.isFinite(bundle?.validTime) && Number.isFinite(fw.forecastStart) && Number.isFinite(fw.forecastEnd)
    && (bundle.validTime < fw.forecastStart || bundle.validTime > fw.forecastEnd)) {
    errors.push('The valid time lies outside the model data window.');
  }
  return { ok: errors.length === 0, errors };
}

// "40% Warning at Wed 7 Oct 14:00" style fragment for the briefing.
export const shareText = (step) => (step ? `${pctText(step.warning)}% Warning, ${pctText(step.caution)}% Caution` : '—');
