// dailyEvolution.js -- the per-day facts behind the daily evolution page: peak wave height and wind in the
// report area, the variable most likely behind the classification, and how the Warning share moved
// since the day before. Pure: daily panels (from the domain report bundle) in, table rows out.
//
// "Likely driver" is an ESTIMATE. The suitability service counts points per class but does not say which
// variable put each point there, so the driver is inferred from the area's PEAK Hs and wind against the
// vessel's own thresholds. It is labelled as such wherever it is printed.

const finite = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// stats: { min, mean, max } from the per-step response (wave_height_m / wind_speed_kt).
const peak = (stats) => finite(stats?.max);

// Which of wave height / wind exceeds the vessel's thresholds, by how far (peak / limit). The level
// checked is Warning first, then Caution; null when neither is over either limit (or data is missing).
export function estimateDriver(step, envelope) {
  const hs = peak(step?.wave);
  const wind = peak(step?.wind);
  if (!envelope || (hs === null && wind === null)) return null;
  for (const [level, hsLimit, windLimit] of [
    ['warning', envelope.maxWaveHeightM, envelope.maxWindKt],
    ['caution', envelope.cautionWaveHeightM, envelope.cautionWindKt],
  ]) {
    const hsOver = hs !== null && Number.isFinite(hsLimit) && hs >= hsLimit;
    const windOver = wind !== null && Number.isFinite(windLimit) && wind >= windLimit;
    if (hsOver && windOver) return { level, driver: 'both', label: 'Waves and wind' };
    if (hsOver) return { level, driver: 'waves', label: 'Waves' };
    if (windOver) return { level, driver: 'wind', label: 'Wind' };
  }
  return { level: null, driver: 'none', label: 'Below thresholds' };
}

// Warning share change from the previous day with data, in percentage points; |change| < 2 is steady.
export function describeChange(warning, previousWarning) {
  if (!Number.isFinite(warning) || !Number.isFinite(previousWarning)) return null;
  const delta = warning - previousWarning;
  if (Math.abs(delta) < 2) return { delta, direction: 'steady', text: 'Steady' };
  const pts = `${delta > 0 ? '+' : '-'}${Math.round(Math.abs(delta))} pts`;
  return delta > 0
    ? { delta, direction: 'higher', text: `Higher (${pts} Warning)` }
    : { delta, direction: 'lower', text: `Lower (${pts} Warning)` };
}

// One row per daily panel. Beyond-horizon and no-data days keep their place, flagged, never filled in.
export function dailyEvolutionRows(daily, envelope) {
  let previous = null;
  return (Array.isArray(daily) ? daily : []).map((p) => {
    const step = p?.step;
    const ok = Boolean(step) && step.available !== false && Number.isFinite(step.warning);
    const row = {
      targetTime: p?.targetTime ?? null,
      matchedTime: p?.matchedTime ?? null,
      beyondHorizon: Boolean(p?.beyondHorizon),
      available: ok,
      suitable: ok ? step.suitable : null,
      caution: ok ? step.caution : null,
      warning: ok ? step.warning : null,
      peakHsM: ok ? peak(step.wave) : null,
      peakWindKt: ok ? peak(step.wind) : null,
      driver: ok ? estimateDriver(step, envelope) : null,
      change: ok && previous ? describeChange(step.warning, previous.warning) : null,
      map: p?.map ?? null,
    };
    if (ok) previous = row;
    return row;
  });
}
