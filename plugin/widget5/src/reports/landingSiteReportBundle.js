// landingSiteReportBundle.js -- validated data for the selected-site landing
// advisory. Site rows (name, type, lon/lat, hourly steps with hazard/wind/wave,
// aggregation method and point count) come from the landing-area comparison
// hook; the model run comes from the suitability metadata. Nothing is drawn or
// fetched here.
import { findRuns, coverageOf } from './seriesAnalysis';
import { parseRunId, MIN_COVERAGE } from './reportRules';
import { VESSEL_OPERATING_ENVELOPE, deriveSuitabilityDriver } from '../lib/CookIslandsSuitabilityOverlay';
import { selectHeatmapSteps } from '../utils/heatmapSteps';
import { fetchSuitabilityMeta, fetchOperationalMap, fetchDomainBoundary } from './suitabilityReportService';

const H = 3600e3;
export const SITE_WINDOW_HOURS = 168;
export const SITE_MAP_HALF_SPAN_DEG = 0.05;
export const ASSESSMENT_RADIUS_KM = 0.5;

export const METHOD_LABELS = {
  area_500m: 'Aggregated over model points within 500 m of the site',
  nearest_point_area_fallback: 'Nearest model point (the 500 m area contained no points)',
  nearest_point_fallback: 'Nearest model point (the 500 m area service was unavailable)',
};

// Hazard-class steps expressed in the percentage form seriesAnalysis expects
// (a single reading is 100% of its own class).
const toSeriesStep = (s) => {
  // Number(null) is 0: a missing reading must stay missing, never become Suitable.
  const missing = s.hazard_class === null || s.hazard_class === undefined || s.hazard_class === '';
  const hc = missing ? NaN : Number(s.hazard_class);
  const usable = Number.isFinite(hc) && s.available !== false;
  return {
    timeIndex: s.time_index ?? null,
    validTime: new Date(s.valid_time ?? s.time).getTime(),
    available: usable,
    warning: usable ? (hc >= 2 ? 100 : 0) : null,
    caution: usable ? (hc === 1 ? 100 : 0) : null,
    suitable: usable ? (hc === 0 ? 100 : 0) : null,
    hazardClass: usable ? hc : null,
    wind: s.wind_speed_kt != null && Number.isFinite(Number(s.wind_speed_kt)) ? Number(s.wind_speed_kt) : null,
    wave: s.wave_height_m != null && Number.isFinite(Number(s.wave_height_m)) ? Number(s.wave_height_m) : null,
  };
};

const runsOfClass = (series, hc) => findRuns(series, (s) => s.hazardClass === hc)
  .map((r) => ({ from: r.start.validTime, to: r.end.validTime, steps: r.steps }));

export function buildLandingSiteReportBundle({
  site, rows = [], omittedSites = [], vesselCode, vesselLabel, validTime, timeDisplayZone = 'Pacific/Rarotonga',
  meta = null, mapDataUrl = null, mapError = null, mapBounds = null, domainBoundary = null, now = () => new Date(),
}) {
  if (!site || !Array.isArray(site.steps) || site.steps.length === 0) throw new Error('No landing-site data to export.');
  const warnings = [];
  const validMs = new Date(validTime ?? Date.now()).getTime();

  const all = site.steps.map(toSeriesStep).filter((s) => Number.isFinite(s.validTime));
  // The report starts at the selected time, not at the start of the stored series.
  const windowEnd = validMs + SITE_WINDOW_HOURS * H;
  const series = all.filter((s) => s.validTime >= validMs - 30 * 60e3 && s.validTime <= windowEnd);
  if (series.length === 0) throw new Error('The selected site has no forecast steps in the report period.');

  const current = series.reduce((best, s) => (Math.abs(s.validTime - validMs) < Math.abs(best.validTime - validMs) ? s : best), series[0]);
  const rule = VESSEL_OPERATING_ENVELOPE[vesselCode] ?? null;
  const cov = coverageOf(series);
  if (cov.ratio < MIN_COVERAGE) warnings.push(`Only ${cov.available} of ${cov.total} forecast steps at this site could be assessed (${Math.round(cov.ratio * 100)}%); treat gaps as Unavailable, not as Suitable.`);
  if (!site.point_count && site.statistics_basis === 'area_500m') warnings.push('The service did not report how many model points were aggregated at this site.');
  if (site.statistics_basis && site.statistics_basis !== 'area_500m') warnings.push(METHOD_LABELS[site.statistics_basis] ?? 'A fallback aggregation method was used for this site.');
  if (!meta?.runId) warnings.push('The model run time was not reported by the service.');
  if (mapError) warnings.push(`The site map could not be produced (${mapError}); the report shows statistics only.`);

  const driver = current.hazardClass > 0 && current.wind !== null && current.wave !== null
    ? deriveSuitabilityDriver(vesselCode, current.wind, current.wave) : (current.hazardClass === 0 ? 'none' : null);

  const longest = (runs) => [...runs].sort((a, b) => b.steps - a.steps).slice(0, 3);
  const suitableWindows = longest(runsOfClass(series, 0));
  const heatmapSteps = selectHeatmapSteps(
    (rows.find((r) => r.steps?.length)?.steps ?? site.steps).filter((s) => new Date(s.valid_time ?? s.time).getTime() >= validMs - 30 * 60e3),
    SITE_WINDOW_HOURS,
  );
  const heatmapRows = rows.filter((r) => r?.steps?.length).map((r) => ({
    id: r.id, name: r.name ?? r.label, type: r.type ?? null, basis: r.statistics_basis ?? 'area_500m',
    pointCount: Number.isFinite(r.point_count) ? r.point_count : null, steps: r.steps, isSelected: r.id === site.id,
  }));
  const runTime = parseRunId(meta?.runId);
  const bases = new Set(heatmapRows.map((r) => r.basis));

  return {
    reportType: 'landing-site-advisory',
    generatedAt: now(),
    modelRun: { runId: meta?.runId ?? null, time: runTime, ageHours: runTime ? (now().getTime() - runTime.getTime()) / H : null },
    validTime: validMs,
    forecastWindow: { start: series[0].validTime, end: series[series.length - 1].validTime, hours: SITE_WINDOW_HOURS },
    timezone: timeDisplayZone,
    site: { id: site.id, name: site.name ?? site.label, type: site.type ?? null, lon: site.lon, lat: site.lat, radiusKm: site.radiusKm ?? ASSESSMENT_RADIUS_KM },
    vessel: { code: vesselCode, label: vesselLabel ?? vesselCode, thresholds: rule },
    aggregation: { basis: site.statistics_basis ?? 'area_500m', label: METHOD_LABELS[site.statistics_basis ?? 'area_500m'] ?? site.statistics_basis, pointCount: Number.isFinite(site.point_count) ? site.point_count : null },
    current: { ...current, driver, label: current.hazardClass === null ? 'Unavailable' : ['Suitable', 'Caution', 'Warning'][Math.min(current.hazardClass, 2)] },
    timeline: { series, stepHours: series.length > 1 ? (series[1].validTime - series[0].validTime) / H : 1, coverage: cov },
    windows: {
      suitable: suitableWindows,
      caution: longest(runsOfClass(series, 1)),
      warning: longest(runsOfClass(series, 2)),
    },
    map: mapDataUrl ? { dataUrl: mapDataUrl, bounds: mapBounds } : null,
    domainBoundary,
    heatmap: { steps: heatmapSteps, rows: heatmapRows, omittedSites: [...new Set([...omittedSites, ...rows.filter((r) => !r?.steps?.length).map((r) => r.name ?? r.label)].filter(Boolean))], mixedMethods: bases.size > 1 },
    methodology: { apiSchemaVersion: meta?.schemaVersion ?? null, thresholdSource: 'preset' },
    limitations: [
      'Values describe modelled wind and wave conditions at forecast grid points near the site, not observations at the landing itself.',
      'Reef, lagoon and passage conditions at the landing are not resolved by the wave model grid.',
      'Tide and sea-level effects are not included in this report.',
      'Unavailable times are shown as Unavailable and are never treated as Suitable.',
    ],
    warnings,
  };
}

// Fetches what the pure builder needs (model run + a map around the site), then builds.
export async function buildLandingSiteReport(params, { signal } = {}, deps = {}) {
  const fetchMeta = deps.fetchMeta ?? fetchSuitabilityMeta;
  const fetchMap = deps.fetchMap ?? fetchOperationalMap;
  const fetchBoundary = deps.fetchBoundary ?? fetchDomainBoundary;
  const { site, vesselCode, timeIndex } = params;
  const meta = await fetchMeta({ signal }).catch(() => null);
  const dLat = SITE_MAP_HALF_SPAN_DEG;
  const dLon = dLat / Math.max(0.2, Math.cos((site.lat * Math.PI) / 180));
  const mapBounds = { west: site.lon - dLon, east: site.lon + dLon, south: site.lat - dLat, north: site.lat + dLat };
  let mapDataUrl = null;
  let mapError = null;
  if (Number.isFinite(timeIndex)) {
    try { mapDataUrl = (await fetchMap(vesselCode, timeIndex, mapBounds, { signal }))?.dataUrl ?? null; } catch (e) { if (e?.name === 'AbortError' || e?.name === 'ReportAbortError') throw e; mapDataUrl = null; mapError = e?.message || String(e); }
    if (!mapDataUrl && !mapError) mapError = 'the service returned no image';
  }
  let domainBoundary = null;
  if (mapDataUrl) { try { domainBoundary = await fetchBoundary({ signal }); } catch { domainBoundary = null; } }
  return buildLandingSiteReportBundle({ ...params, meta, mapDataUrl, mapError, mapBounds, domainBoundary });
}
