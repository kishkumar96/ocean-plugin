// cookIslandsSuitabilitySummaryService.js
// Cook Islands' /cok/suitability/summary is time metadata only
// (n_timesteps, forecast_start/end -- confirmed by reading
// CookIslandsSuitabilityOverlay.js's own _fetchSummary()), unlike Niue's
// /niue/suitability/summary/{time_index}, which returns per-vessel
// warning_percent/caution_percent statistics. No Cook Islands equivalent
// exists server-side.
//
// This computes the same shape client-side from
// /cok/suitability/points/{time_index} -- the raw per-point suitability
// feed CookIslandsSuitabilityOverlay.js already fetches for the map layer.
// That response is one Feature per (point, vessel_class) combination, each
// carrying a hazard_class of 0 (suitable) / 1 (caution) / 2 (warning) --
// same convention read elsewhere in this app (see e.g. hazard_class usage
// in useZarrMap.js and CookIslandsSuitabilityOverlay.js's own MapLibre
// paint expression). Aggregating this ourselves means the domain-advisory
// PDF doesn't need a new backend endpoint to exist yet -- it just costs one
// extra fetch of data already being requested elsewhere for the same
// timestep.
export async function fetchCookIslandsSuitabilitySummary(timeIndex) {
  const res = await fetch(`/cok/suitability/points/${timeIndex}`);
  if (!res.ok) throw new Error(`Suitability points t${timeIndex}: HTTP ${res.status}`);
  const geojson = await res.json();
  const features = Array.isArray(geojson?.features) ? geojson.features : [];

  const byVessel = new Map();
  for (const feature of features) {
    const vessel = feature.properties?.vessel_class;
    const hazard = Number(feature.properties?.hazard_class);
    if (!vessel || !Number.isFinite(hazard)) continue;
    let bucket = byVessel.get(vessel);
    if (!bucket) {
      bucket = { total: 0, caution: 0, warning: 0 };
      byVessel.set(vessel, bucket);
    }
    bucket.total += 1;
    // >= 2 (not === 2) so a backend that ever emits a hazard_class beyond
    // the current 0/1/2 range still counts as "warning" rather than
    // silently falling out of every bucket.
    if (hazard >= 2) bucket.warning += 1;
    else if (hazard === 1) bucket.caution += 1;
  }

  const vessels = {};
  for (const [vessel, bucket] of byVessel) {
    vessels[vessel] = {
      warning_percent: bucket.total > 0 ? (bucket.warning / bucket.total) * 100 : 0,
      caution_percent: bucket.total > 0 ? (bucket.caution / bucket.total) * 100 : 0,
      point_count: bucket.total,
    };
  }
  return { vessels, point_count: features.length };
}
