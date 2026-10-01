// reportRules.js -- editorial and threshold rules shared by every Widget 5 report,
// so the domain, landing, route and scenario PDFs cannot drift apart on wording
// or on what counts as "elevated". The rules (also asserted in tests):
//   * "Warning", never Widget 1's "Avoid".
//   * Hazard conclusions are always "modelled"; no "safe", "go", "proceed" or
//     "do not depart" commands.
//   * Missing data never becomes zero; unavailable never becomes Suitable.
//   * A viewport never silently becomes the whole domain.
//   * Every recommendation needs adequate coverage.
//   * Every report prints model run, valid time, generation time, scope, source.

export const HAZARD_WORDS = { 0: 'Suitable', 1: 'Caution', 2: 'Warning' };

// Thrown by a report bundle builder when the report cannot be produced
// truthfully at all (e.g. the primary map failed with no usable fallback) --
// distinct from ReportAbortError (user cancelled) and from an ordinary fetch
// failure, so the UI can show it as-is rather than a generic "export failed".
// A report that reaches this point must never continue to the renderer: a
// polished PDF with blank map panels is worse than no PDF.
export class ReportExportBlockedError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'ReportExportBlockedError';
  }
}

// A time step is "elevated" once at least this share of assessed points is Warning.
// Same cut-off the domain advisory has always used to escalate its badge.
export const ELEVATED_WARNING_PERCENT = 20;

// Minimum available share of samples/steps for a result to support a recommendation.
export const MIN_COVERAGE = 0.8;

// How much of a route/site/time series the model actually covered:
// high (>= 95%), reduced (>= MIN_COVERAGE), insufficient (below it, or nothing assessed).
export function coverageConfidence(available, total) {
  if (!(total > 0)) return 'insufficient';
  const ratio = available / total;
  if (ratio >= 0.95) return 'high';
  return ratio >= MIN_COVERAGE ? 'reduced' : 'insufficient';
}

// Two {west,south,east,north} boxes are "the same extent" if every edge agrees to within this
// many degrees (~10 m). Shared so every report that checks an applied extent against the
// requested one uses the same tolerance.
export const BOUNDS_EPS = 1e-4;
export const boundsClose = (a, b) => !!a && !!b
  && ['west', 'south', 'east', 'north'].every((k) => Math.abs(a[k] - b[k]) <= BOUNDS_EPS);

export const SOURCE_TEXT = 'SWAN wave model forecast (Cook Islands), Pacific Community (SPC)';
export const DISCLAIMER_SHORT = 'Model guidance, not navigation advice. Confirm with official marine warnings and local seamanship.';

// Step level: 2 elevated (>= ELEVATED_WARNING_PERCENT Warning), 1 any Caution/Warning, 0 none.
export function stepLevel(warningPercent, cautionPercent) {
  const warn = Number(warningPercent) || 0;
  const caution = Number(cautionPercent) || 0;
  if (warn >= ELEVATED_WARNING_PERCENT) return 2;
  if (warn > 0 || caution > 0) return 1;
  return 0;
}

export const SCOPE_LABELS = {
  viewport: 'Current map view',
  domain: 'Whole forecast domain',
};
export const scopeLabel = (scope) => SCOPE_LABELS[scope] ?? 'Unknown scope';

export function pctText(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n > 0 && Math.round(n) === 0) return '<1';
  return String(Math.round(n));
}

// Backend run ids are YYYYMMDDHH (UTC), e.g. "2026092312".
export function parseRunId(runId) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(String(runId ?? ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n) => String(n).padStart(2, '0');
export function formatUtc(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

// "Thu 24 Sep, 14:00 CKT" -- one date/time style for every report.
export function formatLocal(dateLike, timeZone = 'Pacific/Rarotonga', label = 'CKT') {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    const s = new Intl.DateTimeFormat('en-GB', {
      timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
    return `${s.replace(',', '')} ${timeZone === 'UTC' ? 'UTC' : label}`;
  } catch {
    return formatUtc(d);
  }
}

// UTC instant of a local wall-clock time in an IANA zone (no DST assumptions:
// the offset is measured at the guessed instant, then re-measured once).
export function zonedWallTimeToUtc(year, month, day, hour, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour);
  const offsetAt = (ms) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms)).reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - ms;
  };
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first));
}

// Phrases no report may contain (instructions/assurances rather than modelled guidance).
export const FORBIDDEN_PHRASES = [
  /safe conditions/i, /safe to (depart|sail|go|proceed)/i, /\bproceed\b/i, /do not depart/i,
  /go\/no-go/i, /\ball clear\b/i, /\bavoid\b/i,
];
export const findForbiddenPhrases = (text) => FORBIDDEN_PHRASES.filter((re) => re.test(String(text ?? ''))).map(String);
