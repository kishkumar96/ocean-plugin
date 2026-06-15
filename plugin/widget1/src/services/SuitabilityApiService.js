// SuitabilityApiService.js
// Reusable suitability data fetching and normalization for Widget 1.
//
// Both the PDF exporter and the app-side outlook panel consume the same
// normalized shape produced here. The PDF exporter has its own internal
// fetching for now; this service is the canonical path going forward.
//
// Default base URL mirrors SuitabilityPDFExporter.js so both resolve the
// same endpoints in dev (proxied via setupProxy → localhost:8001) and prod
// (REACT_APP_SUITABILITY_BASE_URL or empty string for relative paths).

const DEFAULT_BASE_URL = process.env.REACT_APP_SUITABILITY_BASE_URL || '/suitability';

// ── Constants ─────────────────────────────────────────────────────────────────

export const STATUS = Object.freeze({
  SUITABLE:    'suitable',
  CAUTION:     'caution',
  AVOID:       'avoid',
  UNAVAILABLE: 'unavailable',
});

// Matches VESSEL_CLASSES in SuitabilityPDFExporter.js — labels are identical
// so future deduplication into a shared config is a clean find-and-replace.
export const VESSEL_CLASSES = Object.freeze([
  { code: 'traditional_craft',          label: 'Traditional',     shortLabel: 'Trad.',  initials: 'TRAD' },
  { code: 'very_small_motorised_craft', label: 'Very Small Motor', shortLabel: 'VSM',   initials: 'VSM'  },
  { code: 'small_craft',                label: 'Small Craft',      shortLabel: 'SC',    initials: 'SC'   },
  { code: 'larger_vessels',             label: 'Larger Vessels',   shortLabel: 'LV',    initials: 'LV'   },
]);

// ── URL helpers ───────────────────────────────────────────────────────────────

function cleanBase(baseUrl) {
  return String(baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function buildUrl(baseUrl, path) {
  return `${cleanBase(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`;
}

// ── Low-level fetch ───────────────────────────────────────────────────────────

async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new Error(`Suitability API network error for ${url}: ${err.message}`);
  }

  if (!res.ok) {
    throw new Error(`Suitability API ${res.status} ${res.statusText} — ${url}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const body = await res.text();
    const hint = body.trimStart().startsWith('<') ? 'HTML (check proxy routing)' : contentType || 'non-JSON';
    throw new Error(`Suitability API returned ${hint} for ${url}`);
  }

  try {
    return await res.json();
  } catch {
    throw new Error(`Suitability API returned invalid JSON for ${url}`);
  }
}

// ── Normalisation helpers ─────────────────────────────────────────────────────

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, asNumber(value, 0)));
}

export function getVesselLabel(vesselCode) {
  return VESSEL_CLASSES.find(v => v.code === vesselCode)?.label ?? vesselCode;
}

/**
 * Conservative operational status.
 * Any Avoid area → AVOID, regardless of dominant class.
 * This intentionally differs from the PDF's "dominant class ≥ 20%" rule —
 * the advisory PDF uses a softer threshold; the app UI uses the strict rule.
 */
export function getVesselStatus(vesselData) {
  if (!vesselData || vesselData.isAvailable === false) return STATUS.UNAVAILABLE;
  if (asNumber(vesselData.avoidPercent)   > 0) return STATUS.AVOID;
  if (asNumber(vesselData.cautionPercent) > 0) return STATUS.CAUTION;
  return STATUS.SUITABLE;
}

/** Which class covers the largest fraction of modelled sea area. */
export function getDominantStatus(vesselData) {
  if (!vesselData || vesselData.isAvailable === false) return STATUS.UNAVAILABLE;
  const s = asNumber(vesselData.suitablePercent);
  const c = asNumber(vesselData.cautionPercent);
  const a = asNumber(vesselData.avoidPercent);
  if (a >= c && a >= s) return STATUS.AVOID;
  if (c >= s && c >= a) return STATUS.CAUTION;
  return STATUS.SUITABLE;
}

/** How much of the modelled area is Avoid — useful for colour-coding severity. */
export function getAvoidSeverity(avoidPercent) {
  const v = asNumber(avoidPercent);
  if (v <= 0)  return 'none';
  if (v <  5)  return 'isolated';
  if (v < 50)  return 'significant';
  return 'widespread';
}

export function normalizeVesselStats(rawVessel, vesselCode) {
  if (!rawVessel || typeof rawVessel !== 'object') {
    return {
      vesselCode,
      label:           getVesselLabel(vesselCode),
      suitablePercent: 0,
      cautionPercent:  0,
      avoidPercent:    0,
      status:          STATUS.UNAVAILABLE,
      dominantStatus:  STATUS.UNAVAILABLE,
      avoidSeverity:   'none',
      isAvailable:     false,
    };
  }

  const suitablePercent = clampPercent(
    rawVessel.suitable_percent ?? rawVessel.suitablePercent ?? rawVessel.suitable
  );
  const cautionPercent = clampPercent(
    rawVessel.caution_percent ?? rawVessel.cautionPercent ?? rawVessel.caution
  );
  // Backend uses warning_percent for avoid — keep both aliases.
  const avoidPercent = clampPercent(
    rawVessel.warning_percent ?? rawVessel.avoid_percent ?? rawVessel.avoidPercent ??
    rawVessel.warning          ?? rawVessel.avoid
  );

  const normalized = {
    vesselCode,
    label:           getVesselLabel(vesselCode),
    suitablePercent,
    cautionPercent,
    avoidPercent,
    status:          STATUS.UNAVAILABLE,
    dominantStatus:  STATUS.UNAVAILABLE,
    avoidSeverity:   'none',
    isAvailable:     true,
    raw:             rawVessel,
  };

  normalized.status        = getVesselStatus(normalized);
  normalized.dominantStatus = getDominantStatus(normalized);
  normalized.avoidSeverity  = getAvoidSeverity(normalized.avoidPercent);
  return normalized;
}

export function getWorstFleetStatus(summary) {
  const vessels  = summary?.vessels ?? {};
  const statuses = Object.values(vessels).map(v => v.status);
  if (statuses.includes(STATUS.AVOID))     return STATUS.AVOID;
  if (statuses.includes(STATUS.CAUTION))   return STATUS.CAUTION;
  if (statuses.includes(STATUS.SUITABLE))  return STATUS.SUITABLE;
  return STATUS.UNAVAILABLE;
}

export function normalizeSuitabilitySummary(raw, fallbackTimeIndex = null) {
  // Backend may return vessels at top level or nested under .summary.vessels.
  const rawVessels = raw?.vessels ?? raw?.summary?.vessels ?? {};

  const vessels = VESSEL_CLASSES.reduce((acc, vc) => {
    acc[vc.code] = normalizeVesselStats(rawVessels[vc.code], vc.code);
    return acc;
  }, {});

  const normalized = {
    timeIndex: raw?.time_index ?? raw?.timeIndex ?? fallbackTimeIndex ?? null,
    timeUtc:   raw?.time ?? raw?.time_utc ?? raw?.timeUtc ?? raw?.valid_time ?? raw?.validTime ?? null,
    vessels,
    fleetStatus: STATUS.UNAVAILABLE,
    raw,
  };

  normalized.fleetStatus = getWorstFleetStatus(normalized);
  return normalized;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the raw timesteps array from the API.
 * Shape is flexible — backend may return an array directly or wrap it.
 */
export async function fetchSuitabilityTimesteps(baseUrl = DEFAULT_BASE_URL) {
  const url = buildUrl(baseUrl, '/niue/suitability/timesteps');
  const raw = await fetchJson(url);

  if (Array.isArray(raw))             return raw;
  if (Array.isArray(raw?.timesteps))  return raw.timesteps;
  if (Array.isArray(raw?.times))      return raw.times;

  throw new Error(
    `Suitability timesteps response from ${url} did not contain a recognisable array`
  );
}

/**
 * Fetches and normalizes the summary for a single time index.
 */
export async function fetchSuitabilitySummary(timeIndex, baseUrl = DEFAULT_BASE_URL) {
  const idx = Number(timeIndex);
  if (!Number.isFinite(idx)) {
    throw new Error(`Invalid suitability timeIndex: ${timeIndex}`);
  }
  const url = buildUrl(baseUrl, `/niue/suitability/summary/${idx}`);
  const raw = await fetchJson(url);
  return normalizeSuitabilitySummary(raw, idx);
}

/**
 * Fetches a contiguous run of normalized summaries as an array.
 *
 * Strategy:
 *   1. Fetch timesteps to know the total count (fast single request).
 *   2. Clamp the requested range to what the API actually has.
 *   3. Fetch all summaries in parallel for minimum wall-clock time.
 *
 * Falls back to sequential-with-break if the timesteps endpoint is
 * unavailable, so the function degrades gracefully.
 */
export async function fetchSuitabilityTimeseries({
  startIndex = 0,
  maxSteps   = 28,
  baseUrl    = DEFAULT_BASE_URL,
} = {}) {
  const safeStart = Math.max(0, Math.trunc(Number(startIndex) || 0));
  const safeMax   = Math.max(1, Math.trunc(Number(maxSteps)   || 28));

  // Try to determine the valid range from the timesteps list first.
  let totalSteps = null;
  try {
    const timesteps = await fetchSuitabilityTimesteps(baseUrl);
    totalSteps = timesteps.length;
  } catch {
    // Non-fatal — fall back to sequential probing below.
  }

  if (totalSteps !== null) {
    // Parallel path — known range, fire all requests simultaneously.
    const count   = Math.min(safeMax, Math.max(0, totalSteps - safeStart));
    const indices = Array.from({ length: count }, (_, i) => safeStart + i);
    const results = await Promise.all(
      indices.map(i => fetchSuitabilitySummary(i, baseUrl))
    );
    return results;
  }

  // Sequential fallback — stop on first missing future step.
  const results = [];
  for (let offset = 0; offset < safeMax; offset++) {
    const idx = safeStart + offset;
    try {
      results.push(await fetchSuitabilitySummary(idx, baseUrl));
    } catch (err) {
      if (offset === 0) throw err;   // first step missing → surface to caller
      break;
    }
  }
  return results;
}
