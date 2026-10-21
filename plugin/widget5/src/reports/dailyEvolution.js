// dailyEvolution.js -- the per-day facts behind the daily evolution page: peak wave height and wind in the
// report area, the variable most likely behind the classification, and how the Warning share moved
// since the day before. Pure: daily panels (from the domain report bundle) in, table rows out.
//
// "Likely driver" is an ESTIMATE. The suitability service counts points per class but does not say which
// variable put each point there, so the driver is inferred from the area's PEAK Hs and wind against the
// vessel's own thresholds. It is labelled as such wherever it is printed.

// null / undefined / '' are missing, not zero (Number(null) is 0).
const finite = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

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
      // Quantified change since the previous day with data: Warning and Caution share (points) and peaks.
      delta: ok && previous ? {
        warning: step.warning - previous.warning,
        caution: step.caution - previous.caution,
        hsM: peak(step.wave) !== null && previous.peakHsM !== null ? peak(step.wave) - previous.peakHsM : null,
        windKt: peak(step.wind) !== null && previous.peakWindKt !== null ? peak(step.wind) - previous.peakWindKt : null,
      } : null,
      map: p?.map ?? null,
    };
    if (ok) previous = row;
    return row;
  });
}

// "W +2 · C +24 pts · Hs +0.2 m · wind +2 kt" -- every change since the previous day, signed.
export function deltaText(delta) {
  if (!delta) return '';
  const sign = (v, digits) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(digits)}`;
  const parts = [`W ${sign(Math.round(delta.warning), 0)}`, `C ${sign(Math.round(delta.caution), 0)} pts`];
  if (Number.isFinite(delta.hsM)) parts.push(`Hs ${sign(delta.hsM, 1)} m`);
  if (Number.isFinite(delta.windKt)) parts.push(`wind ${sign(delta.windKt, 0)} kt`);
  return parts.join(' · ');
}
