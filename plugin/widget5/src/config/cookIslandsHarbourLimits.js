// cookIslandsHarbourLimits.js
// Editable barge-unloading limits for the Harbour Wave Conditions panel.
//
// There are deliberately NO built-in numbers. Cook Islands Government
// (Matt Blacka) has not yet said what wave height / period / wind stops barge
// unloading, and the vessel-suitability classes (which the backend's
// vessel='all' resolves to the strictest of -- traditional craft, caution at
// 0.5 m / 10 kt) are the wrong yardstick for a barge. Until someone sets
// limits, the panel shows raw numbers and no verdict.
//
// Shape: { default: Limits, harbours: { [riskPointId]: Limits } }
// Limits: { caution: {hsM, tpS, windKt}, stop: {hsM, tpS, windKt} } -- each
// value a number or null (null = "no limit on this variable"). A harbour
// entry REPLACES the default wholesale for that harbour (simpler to reason
// about than per-field merging: what you see in its row is what applies).
// tpS is a MAXIMUM period: long-period swell is what surges harbours and
// works moored vessels even when Hs looks modest.

import { COOK_ISLANDS_HARBOUR_POINTS } from './cookIslandsHarbourPoints';

export const LIMIT_VARIABLES = [
  { key: 'hsM', label: 'Wave height', unit: 'm', step: 0.1 },
  { key: 'tpS', label: 'Peak period', unit: 's', step: 0.5 },
  { key: 'windKt', label: 'Wind', unit: 'kt', step: 1 },
];

export const LIMITS_STORAGE_KEY = 'cok-harbour-unloading-limits-v1';

export function emptyLimits() {
  return {
    caution: { hsM: null, tpS: null, windKt: null },
    stop: { hsM: null, tpS: null, windKt: null },
  };
}

export function emptyLimitsConfig() {
  return { default: emptyLimits(), harbours: {} };
}

function cleanNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cleanLimits(raw) {
  const out = emptyLimits();
  ['caution', 'stop'].forEach((level) => {
    LIMIT_VARIABLES.forEach(({ key }) => { out[level][key] = cleanNumber(raw?.[level]?.[key]); });
  });
  return out;
}

// Accepts anything (parsed localStorage, an imported file) and returns a
// well-formed config; unknown harbours' ids are kept as strings, junk is
// dropped. Never throws.
export function normalizeLimitsConfig(raw) {
  const config = emptyLimitsConfig();
  if (!raw || typeof raw !== 'object') return config;
  config.default = cleanLimits(raw.default);
  Object.entries(raw.harbours ?? {}).forEach(([id, limits]) => {
    if (limits && typeof limits === 'object') config.harbours[String(id)] = cleanLimits(limits);
  });
  return config;
}

export function hasAnyLimit(limits) {
  return ['caution', 'stop'].some((level) => LIMIT_VARIABLES.some(({ key }) => limits?.[level]?.[key] !== null && limits?.[level]?.[key] !== undefined));
}

export function limitsForHarbour(config, riskPointId) {
  return config.harbours[String(riskPointId)] ?? config.default;
}

// Result of judging one set of conditions against limits:
//   0 / 1 / 2    within limits / caution / stop
//   INCOMPLETE   at least one variable that HAS a limit has no value, and no
//                known exceedance settles it -- we can't say it's safe
//   null         no limit applies at all (nothing to judge against)
// Fail-safe rule: a missing decision variable never reads as OK. A known
// STOP still wins (a proven exceedance doesn't need the other variables);
// anything short of that with a gap is INCOMPLETE, never OK or Caution --
// the missing variable could be the one that says Stop.
export const INCOMPLETE = 'incomplete';

export function evaluateConditions({ hsM, tpS, windKt }, limits) {
  const values = { hsM, tpS, windKt };
  let limited = 0;
  let missing = 0;
  let worst = 0;
  LIMIT_VARIABLES.forEach(({ key }) => {
    const stop = limits?.stop?.[key];
    const caution = limits?.caution?.[key];
    const hasStop = stop !== null && stop !== undefined;
    const hasCaution = caution !== null && caution !== undefined;
    if (!hasStop && !hasCaution) return;
    limited += 1;
    const value = values[key];
    if (!Number.isFinite(value)) { missing += 1; return; }
    if (hasStop && value >= stop) worst = Math.max(worst, 2);
    else if (hasCaution && value >= caution) worst = Math.max(worst, 1);
  });
  if (!limited) return null;
  if (worst === 2) return 2;
  return missing ? INCOMPLETE : worst;
}

// Combine verdicts over several time steps: Stop if any step is Stop;
// otherwise Incomplete if any step is Incomplete; otherwise the worst of the
// rest. null only when no step had anything to judge.
export function worstVerdict(verdicts) {
  const real = verdicts.filter((v) => v !== null && v !== undefined);
  if (!real.length) return null;
  if (real.includes(2)) return 2;
  if (real.includes(INCOMPLETE)) return INCOMPLETE;
  return Math.max(...real);
}

// Variables whose Stop limit is not above their Caution limit (would make the
// Caution band empty/inverted). Returned as LIMIT_VARIABLES entries.
export function limitOrderIssues(limits) {
  return LIMIT_VARIABLES.filter(({ key }) => {
    const c = limits?.caution?.[key];
    const st = limits?.stop?.[key];
    return c !== null && c !== undefined && st !== null && st !== undefined && st <= c;
  });
}

// Which variable drove a verdict, how far it went, and when. `steps` are the forecast steps of the
// window being judged ({valid_time, wave_height_m, tp_s, wind_speed_kt}); `limits` the harbour's
// {caution, stop}. Returns:
//   level    2 / 1 / 0  worst level reached (Stop / Caution / none)
//   driver   for level 2 or 1: the controlling variable -- the one furthest past ITS limit (peak /
//            limit), with its limit, peak value, first and last time at or over the limit and the
//            number of steps over it -- or null
//   missing  labels of variables that HAVE a limit but have no value in at least one step: why a
//            verdict can read Incomplete
const STEP_VALUE = { hsM: 'wave_height_m', tpS: 'tp_s', windKt: 'wind_speed_kt' };

export function explainWindow(steps, limits) {
  const list = Array.isArray(steps) ? steps : [];
  const valueOf = (step, key) => {
    const v = step?.[STEP_VALUE[key]];
    return v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
  };

  const missing = LIMIT_VARIABLES
    .filter(({ key }) => {
      const hasLimit = ['caution', 'stop'].some((lvl) => limits?.[lvl]?.[key] !== null && limits?.[lvl]?.[key] !== undefined);
      return hasLimit && list.some((step) => valueOf(step, key) === null);
    })
    .map(({ label }) => label);

  for (const [levelName, level] of [['stop', 2], ['caution', 1]]) {
    const candidates = [];
    LIMIT_VARIABLES.forEach(({ key, label, unit }) => {
      const limit = limits?.[levelName]?.[key];
      if (limit === null || limit === undefined) return;
      const over = list.filter((step) => {
        const v = valueOf(step, key);
        return v !== null && v >= limit;
      });
      if (!over.length) return;
      const peak = Math.max(...over.map((step) => valueOf(step, key)));
      candidates.push({
        key, label, unit, limit, peak, ratio: peak / limit, steps: over.length,
        firstTime: over[0].valid_time, lastTime: over[over.length - 1].valid_time,
      });
    });
    if (candidates.length) {
      const driver = candidates.reduce((a, b) => (b.ratio > a.ratio ? b : a));
      return {
        level,
        levelName,
        driver: {
          key: driver.key, label: driver.label, unit: driver.unit, limit: driver.limit, peak: driver.peak,
          steps: driver.steps, firstTime: driver.firstTime, lastTime: driver.lastTime,
        },
        missing,
      };
    }
  }
  return { level: 0, levelName: null, driver: null, missing };
}

export const UNLOADING_LABELS = { 0: 'OK', 1: 'Caution', 2: 'Stop' };

// The wording of a verdict depends on who stands behind the limits. "Stop" in red reads as an order, so
// until limits are approved the label says what was actually found: a value over a PROVISIONAL / DRAFT
// limit. Approved limits keep the plain operational words.
export function unloadingLabel(verdict, basis) {
  if (verdict === INCOMPLETE) return 'Incomplete';
  const qualifier = basis === 'provisional' ? 'provisional ' : basis === 'draft' ? 'draft ' : null;
  if (qualifier === null) return UNLOADING_LABELS[verdict] ?? '—';
  if (verdict === 0) return `Within ${qualifier}limits`;
  if (verdict === 1) return `Over ${qualifier}caution limit`;
  if (verdict === 2) return `Over ${qualifier}stop limit`;
  return '—';
}

// A usable unloading window needs more than a single lucky hour. Provisional, like the limits.
export const MIN_WINDOW_HOURS = 3;
const WINDOW_GAP_MS = 90 * 60 * 1000;

// When conditions are (or next will be) within every limit, over the forecast steps from "now" on.
// Steps are hourly; a missing hour or a value that can't be judged ends a run, so a window is never
// claimed across a hole in the data. State:
//   within  -- now is within limits; `until` = first step that is not (null when it lasts to the end)
//   next    -- now is not; the first run of >= minHours within-limit steps (start, end, hours)
//   none    -- judged, but no such run in the available forecast (horizonHours long)
//   unknown -- nothing could be judged (no limits, or every step Incomplete)
export function findOperationalWindow(steps, limits, { minHours = MIN_WINDOW_HOURS } = {}) {
  const list = Array.isArray(steps) ? steps : [];
  const times = list.map((st) => new Date(st.valid_time).getTime());
  const verdicts = list.map((st) => evaluateConditions({ hsM: st.wave_height_m, tpS: st.tp_s, windKt: st.wind_speed_kt }, limits));
  const horizonHours = list.length;
  if (!list.length || verdicts.every((v) => v === null || v === INCOMPLETE)) {
    return { state: 'unknown', horizonHours };
  }
  const contiguous = (i) => i > 0 && times[i] - times[i - 1] <= WINDOW_GAP_MS;
  const runFrom = (start) => {
    let end = start;
    while (end + 1 < list.length && verdicts[end + 1] === 0 && contiguous(end + 1)) end += 1;
    return end;
  };
  if (verdicts[0] === 0) {
    const end = runFrom(0);
    const throughEnd = end === list.length - 1;
    return {
      state: 'within', hours: end + 1, throughEnd, horizonHours,
      until: throughEnd ? null : list[end + 1].valid_time,
    };
  }
  for (let i = 1; i < list.length; i += 1) {
    if (verdicts[i] !== 0 || (verdicts[i - 1] === 0 && contiguous(i))) continue;
    const end = runFrom(i);
    const hours = end - i + 1;
    if (hours >= minHours || end === list.length - 1) {
      // A run still going at the end of the forecast may be shorter than minHours only because the
      // forecast stops; it is reported as open-ended rather than dropped.
      return {
        state: 'next', start: list[i].valid_time, end: list[end].valid_time, hours,
        throughEnd: end === list.length - 1, horizonHours,
      };
    }
    i = end;
  }
  return { state: 'none', horizonHours };
}

// The LOCAL DRAFT (this browser only). null = no draft has been started.
// Approved limits are never stored here -- they come from the published file
// (see resolveActiveLimits).
export function loadDraftLimits() {
  try {
    const raw = window.localStorage.getItem(LIMITS_STORAGE_KEY);
    return raw ? normalizeLimitsConfig(JSON.parse(raw)) : null;
  } catch (err) {
    return null;
  }
}

export function saveDraftLimits(config) {
  try {
    if (config === null) window.localStorage.removeItem(LIMITS_STORAGE_KEY);
    else window.localStorage.setItem(LIMITS_STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    // Private window / blocked storage: the draft still applies this session.
  }
}

export function serializeLimitsConfig(config) {
  return JSON.stringify({ version: 1, ...config }, null, 2);
}

// ---- published (approved) limits: validation + resolution ------------------

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

// Validates the published file. Returns { ok, problems, published } where
// `published` is null unless ok. An unapproved ("not_set") but well-formed
// file is ok with status 'not_set' and simply applies no limits. A file that
// claims approval but is malformed is REJECTED (ok:false) so the UI says so
// instead of silently applying something half-governed.
export function normalizePublishedLimits(raw) {
  const problems = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, problems: ['not a JSON object'], published: null };
  }
  if (raw.schema !== 1) problems.push('unsupported schema');
  if (!['not_set', 'provisional', 'approved'].includes(raw.status)) problems.push('status must be "not_set", "provisional" or "approved"');
  const config = normalizeLimitsConfig(raw);
  const knownIds = new Set(COOK_ISLANDS_HARBOUR_POINTS.map((p) => String(p.riskPointId)));
  Object.keys(raw.harbours ?? {}).forEach((id) => { if (!knownIds.has(String(id))) problems.push(`unknown harbour id ${id}`); });
  [['default', config.default], ...Object.entries(config.harbours)].forEach(([name, limits]) => {
    limitOrderIssues(limits).forEach((v) => problems.push(`${name}: stop must be above caution for ${v.label.toLowerCase()}`));
  });
  if (raw.status === 'approved') {
    if (!raw.approvedBy || typeof raw.approvedBy !== 'string') problems.push('approvedBy is required');
    if (!validDate(raw.approvedOn)) problems.push('approvedOn must be a date');
    if (!validDate(raw.effectiveFrom)) problems.push('effectiveFrom must be a date');
    if (!Number.isInteger(raw.version) || raw.version < 1) problems.push('version must be an integer >= 1');
    if (!hasAnyLimit(config.default) && !Object.values(config.harbours).some(hasAnyLimit)) problems.push('approved but no limits set');
  }
  if (raw.status === 'provisional' && !hasAnyLimit(config.default) && !Object.values(config.harbours).some(hasAnyLimit)) {
    problems.push('provisional but no limits set');
  }
  if (problems.length) return { ok: false, problems, published: null };
  return {
    ok: true,
    problems: [],
    published: {
      status: raw.status,
      version: raw.version ?? 0,
      approvedBy: raw.approvedBy ?? null,
      approvedOn: raw.approvedOn ?? null,
      effectiveFrom: raw.effectiveFrom ?? null,
      notes: typeof raw.notes === 'string' ? raw.notes : '',
      config,
      history: Array.isArray(raw.history) ? raw.history : [],
    },
  };
}

// Which limits apply right now, and on what authority:
//   'draft'       local, unapproved -- verdicts must be labelled as such
//   'provisional' published PLACEHOLDER values, not confirmed by the
//                 authority -- usable so the product works out of the box,
//                 but labelled provisional everywhere (screen and PDF)
//   'approved'    published, approved and already effective
//   'pending'  approved but not yet effective (applies nothing)
//   'none'     nothing applies (not set, unavailable or invalid)
// A local draft takes precedence over approved limits so a forecaster can
// trial changes, but basis 'draft' follows it everywhere it is shown.
export function resolveActiveLimits({ published, draft, now = new Date() }) {
  if (draft && (hasAnyLimit(draft.default) || Object.values(draft.harbours).some(hasAnyLimit))) {
    return { basis: 'draft', config: draft, meta: null };
  }
  if (published?.status === 'provisional') {
    return { basis: 'provisional', config: published.config, meta: published };
  }
  if (published?.status === 'approved') {
    const effective = new Date(published.effectiveFrom).getTime() <= new Date(now).getTime();
    return effective
      ? { basis: 'approved', config: published.config, meta: published }
      : { basis: 'pending', config: emptyLimitsConfig(), meta: published };
  }
  return { basis: 'none', config: emptyLimitsConfig(), meta: published ?? null };
}

// A proposal for approval: the current limits plus enough context for the
// approving authority to act on it. Importable back into the editor.
export function buildLimitsProposal(config, { basedOnVersion = 0, now = new Date() } = {}) {
  return JSON.stringify({
    schema: 1,
    status: 'draft',
    basedOnVersion,
    proposedOn: new Date(now).toISOString(),
    notes: 'Proposal only -- not approved. To publish, see HARBOUR_LIMITS.md.',
    ...config,
  }, null, 2);
}
