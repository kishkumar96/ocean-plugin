// routeSeverity.js
// Which sample along a route is the WORST one, for the route advisory PDF,
// the scenario comparison and anything else that needs "the critical point".
//
// hazard_class alone can't decide it: a whole stretch of a crossing can share
// the same class (Warning), and "the earliest sample in the worst class"
// (what this used to do) then picks the departure point, where conditions
// only just crossed the line, over the offshore sample that is far beyond it.
// Seen on a live Pukapuka to Nassau forecast: the departure sample (20.9 kt,
// 0.24 m, +0.9 kt past the Warning line) was reported as the critical point
// while 3.19 m waves against a 2.0 m line sat further along the route.
//
// Within a hazard class the worst sample is the one furthest past its own
// thresholds, measured as a ratio to each threshold so wind (kt) and waves
// (m) can be compared at all -- they are different units, never directly
// comparable as raw differences.
import { VESSEL_OPERATING_ENVELOPE } from '../../lib/CookIslandsSuitabilityOverlay';

const finite = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));

// The thresholds a sample of this hazard class is judged against: Warning
// samples against the Warning (max) lines, everything else against Caution.
export function thresholdsForHazard(envelope, hazardClass) {
  return hazardClass >= 2
    ? { windKt: envelope.maxWindKt, waveM: envelope.maxWaveHeightM }
    : { windKt: envelope.cautionWindKt, waveM: envelope.cautionWaveHeightM };
}

// How far past (ratio > 1) or short of (< 1) its own thresholds a sample is:
// the larger of windKt / windThreshold and waveM / waveThreshold, over
// whichever readings are present. null when nothing can be measured (unknown
// vessel, or no finite reading) -- callers then fall back to earliest-first.
export function sampleSeverity(vesselCode, sample, envelope = VESSEL_OPERATING_ENVELOPE[vesselCode]) {
  if (!envelope || !sample) return null;
  const t = thresholdsForHazard(envelope, Number(sample.hazard_class));
  const ratios = [];
  if (finite(sample.wind_speed_kt) && t.windKt > 0) ratios.push(Number(sample.wind_speed_kt) / t.windKt);
  if (finite(sample.wave_height_m) && t.waveM > 0) ratios.push(Number(sample.wave_height_m) / t.waveM);
  return ratios.length ? Math.max(...ratios) : null;
}

// Worst sample: highest hazard class, then greatest threshold ratio, then
// earliest ETA (deterministic when everything else ties). `samples` may
// contain unavailable ones; they are ignored.
export function pickWorstSample(samples, vesselCode, envelope) {
  let worst = null;
  let worstScore = null;
  for (const sample of samples ?? []) {
    if (!sample || sample.available === false || !finite(sample.hazard_class)) continue;
    const score = sampleSeverity(vesselCode, sample, envelope);
    if (!worst) { worst = sample; worstScore = score; continue; }
    const dh = Number(sample.hazard_class) - Number(worst.hazard_class);
    let better = dh > 0;
    if (dh === 0) {
      const a = score ?? -Infinity;
      const b = worstScore ?? -Infinity;
      if (a > b) better = true;
      else if (a === b && new Date(sample.eta) < new Date(worst.eta)) better = true;
    }
    if (better) { worst = sample; worstScore = score; }
  }
  return worst;
}
