import { CUSTOM_ENVELOPE_FIELDS, VESSEL_OPERATING_ENVELOPE } from '../../lib/NiueSuitabilityOverlay';

// One row per hazard metric. `step` is the slider's step and the precision a
// threshold is rounded to; `sliderMax` scales the track to the vessel's own
// preset so a small craft's whole useful range isn't squeezed into a
// fraction of the larger-vessel track.
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

// One slider edit. Keeps caution below avoid by pushing the other threshold
// along (never accepting an inverted pair, which NiueSuitabilityOverlay's
// resolveOperatingEnvelope would throw on), clamps to the vessel's slider
// range, and rounds to the metric's step so repeated push-along arithmetic
// can't accumulate float noise like 0.30000000000000004. Returns `prev`
// untouched for a non-finite value.
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

// Custom wind/wave thresholds are scoped to a vessel class. A single shared
// object is unsafe: switching from a larger vessel to a traditional craft can
// otherwise carry the larger vessel's much more permissive limits with it.
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
