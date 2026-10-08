// Custom wind/wave thresholds are scoped to a vessel class. A single shared
// object is unsafe: switching from a larger vessel to a traditional craft can
// otherwise carry the larger vessel's much more permissive limits with it.
import { CUSTOM_ENVELOPE_FIELDS, VESSEL_OPERATING_ENVELOPE } from '../../lib/CookIslandsSuitabilityOverlay';

export const CUSTOM_ENVELOPE_STORAGE_KEY = 'cok_suitability_custom_envelopes_v1';

// One row per hazard metric. `step` is the slider's step and the precision a
// threshold is rounded to (a typed 12.5 kt or 1.2345 m is not a value the UI
// can represent or display consistently); `sliderMax` scales the track to the
// vessel's own preset so a small craft's whole useful range isn't squeezed
// into a fraction of the larger-vessel track.
const ENVELOPE_METRICS = [
  {
    cautionKey: 'cautionWindKt', maxKey: 'maxWindKt', step: 1, decimals: 0,
    sliderMax: (preset) => Math.max(preset.maxWindKt * 2, 20),
  },
  {
    cautionKey: 'cautionWaveHeightM', maxKey: 'maxWaveHeightM', step: 0.1, decimals: 1,
    sliderMax: (preset) => Math.max(preset.maxWaveHeightM * 2, 2),
  },
];

const roundTo = (value, decimals) => Number(value.toFixed(decimals));
const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

export function envelopeSliderMax(vesselCode) {
  const preset = VESSEL_OPERATING_ENVELOPE[vesselCode];
  if (!preset) return { windMax: 40, waveMax: 5 };
  const [wind, wave] = ENVELOPE_METRICS;
  return { windMax: wind.sliderMax(preset), waveMax: wave.sliderMax(preset) };
}

// True when any of the four adjustable fields differs from the vessel preset.
export function envelopeDiffersFromPreset(vesselCode, envelope) {
  const preset = VESSEL_OPERATING_ENVELOPE[vesselCode];
  if (!preset || !envelope) return false;
  return CUSTOM_ENVELOPE_FIELDS.some((f) => envelope[f] !== undefined && envelope[f] !== preset[f]);
}

// The single validator for envelopes that arrive from outside the slider
// (localStorage, share links). Returns a complete four-field envelope, or
// null when the input is unusable -- callers then fall back to the preset,
// so the sliders and the map can never disagree about what is in force.
//
// Missing fields inherit the preset (same as resolveOperatingEnvelope);
// out-of-range values are clamped to the vessel's slider range; a
// non-numeric field or an inverted caution/avoid pair rejects the whole
// envelope rather than guessing what was meant.
export function sanitizeEnvelope(vesselCode, envelope) {
  const preset = VESSEL_OPERATING_ENVELOPE[vesselCode];
  if (!preset || !envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null;

  const result = {};
  for (const metric of ENVELOPE_METRICS) {
    const sliderMax = metric.sliderMax(preset);
    for (const key of [metric.cautionKey, metric.maxKey]) {
      const raw = envelope[key];
      if (raw === undefined) {
        result[key] = preset[key];
      } else if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return null;
      } else {
        result[key] = roundTo(clamp(raw, 0, sliderMax), metric.decimals);
      }
    }
    if (result[metric.cautionKey] >= result[metric.maxKey]) return null;
  }
  return result;
}

// One slider/number-field edit. Keeps caution below avoid by pushing the
// other threshold along (never accepting an inverted pair), clamps to the
// vessel's slider range, and rounds to the metric's step so repeated
// push-along arithmetic can't accumulate float noise like 0.30000000000000004.
// Returns `prev` untouched for a non-finite value (e.g. a half-typed field).
export function applyEnvelopeEdit(vesselCode, prev, field, value) {
  const preset = VESSEL_OPERATING_ENVELOPE[vesselCode];
  const metric = ENVELOPE_METRICS.find((m) => m.cautionKey === field || m.maxKey === field);
  if (!preset || !metric || !Number.isFinite(value)) return prev ?? null;

  const resolved = { ...preset, ...(prev ?? {}) };
  const next = Object.fromEntries(CUSTOM_ENVELOPE_FIELDS.map((key) => [key, resolved[key]]));
  const { cautionKey, maxKey, step, decimals } = metric;
  const sliderMax = metric.sliderMax(preset);

  if (field === cautionKey) {
    next[cautionKey] = clamp(value, 0, sliderMax - step);
    next[maxKey] = Math.max(next[maxKey], next[cautionKey] + step);
  } else {
    next[maxKey] = clamp(value, step, sliderMax);
    next[cautionKey] = Math.min(next[cautionKey], next[maxKey] - step);
  }
  next[cautionKey] = roundTo(next[cautionKey], decimals);
  next[maxKey] = roundTo(next[maxKey], decimals);
  return next;
}

export function getCustomEnvelopeForVessel(profiles, vesselCode) {
  return profiles?.[vesselCode] ?? null;
}

export function updateCustomEnvelopeForVessel(profiles, vesselCode, update) {
  if (!vesselCode) return profiles ?? {};

  const currentProfiles = profiles ?? {};
  const currentEnvelope = getCustomEnvelopeForVessel(currentProfiles, vesselCode);
  const nextEnvelope = typeof update === 'function' ? update(currentEnvelope) : update;

  if (nextEnvelope === null || nextEnvelope === undefined) {
    if (!Object.prototype.hasOwnProperty.call(currentProfiles, vesselCode)) return currentProfiles;
    const nextProfiles = { ...currentProfiles };
    delete nextProfiles[vesselCode];
    return nextProfiles;
  }

  if (nextEnvelope === currentEnvelope) return currentProfiles;
  return {
    ...currentProfiles,
    [vesselCode]: { ...nextEnvelope },
  };
}

export function loadCustomEnvelopeProfiles(storage = window.localStorage) {
  try {
    const raw = storage.getItem(CUSTOM_ENVELOPE_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    const profiles = parsed?.profiles ?? parsed;
    if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) return {};

    // Each profile goes through the same validator as share links, so a
    // corrupt or hand-edited entry is dropped (that vessel falls back to its
    // preset) instead of reaching the sliders as numbers the map would reject.
    const clean = {};
    for (const [vesselCode, envelope] of Object.entries(profiles)) {
      const sanitized = sanitizeEnvelope(vesselCode, envelope);
      if (sanitized) clean[vesselCode] = sanitized;
    }
    return clean;
  } catch {
    return {};
  }
}

export function saveCustomEnvelopeProfiles(profiles, storage = window.localStorage) {
  try {
    storage.setItem(CUSTOM_ENVELOPE_STORAGE_KEY, JSON.stringify({
      version: 1,
      profiles: profiles ?? {},
    }));
    return true;
  } catch {
    return false;
  }
}

export function customEnvelopesEqual(left, right) {
  if (left === right) return true;
  if (!left || !right) return left == null && right == null;

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}
