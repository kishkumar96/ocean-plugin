// cookIslandsSuitabilitySummaryService.js
// Cook Islands' flat /cok/suitability/summary is time metadata only
// (n_timesteps, forecast_start/end -- confirmed by reading
// CookIslandsSuitabilityOverlay.js's own _fetchSummary()). Two ways to get
// real per-vessel warning_percent/caution_percent statistics, tried in
// order:
//
//   1. /cok/suitability/summary/{time_index}?vessel=...&west=...&south=...
//      &east=...&north=... -- a per-timestep, bounds-scoped backend
//      endpoint mirroring Niue's own /niue/suitability/summary/{time_index}.
//      Didn't exist when this file was first written; may or may not be
//      deployed yet depending on whether the Phase 2 backend patch (see
//      .claude/plans/elegant-snuggling-dahl.md) has landed on the
//      production host this session has no way to check from here.
//   2. If that 404s/errors for any reason (not deployed yet, or any other
//      failure), falls back to computing the same shape client-side from
//      /cok/suitability/points/{time_index} -- the raw per-point feed
//      CookIslandsSuitabilityOverlay.js already fetches for the map layer.
//      This is the original, fully self-contained implementation; kept as
//      a real fallback (not just a stub) so the domain-advisory PDF keeps
//      working today regardless of backend deploy timing, and silently
//      upgrades to the server-computed version the moment it's live.
import { VESSEL_CLASS_OPTIONS } from '../lib/CookIslandsSuitabilityOverlay';

function boundsQueryParams(bounds) {
  if (!bounds) return '';
  const { west, south, east, north } = bounds;
  if (![west, south, east, north].every(Number.isFinite)) return '';
  return `&west=${west}&south=${south}&east=${east}&north=${north}`;
}

async function fetchCookIslandsSuitabilitySummaryFromBackend(timeIndex, bounds) {
  const boundsParams = boundsQueryParams(bounds);
  // One request per vessel -- the backend endpoint deliberately has no
  // "all"/overall option (see the Phase 2 patch's own comment: Cook
  // Islands has no pre-computed cross-vessel hazard array to report), so
  // building the same all-vessels shape the PDF needs takes four small
  // requests instead of Niue's one.
  const entries = await Promise.all(VESSEL_CLASS_OPTIONS.map(async ({ value: vessel }) => {
    const res = await fetch(`/cok/suitability/summary/${timeIndex}?vessel=${encodeURIComponent(vessel)}${boundsParams}`);
    if (!res.ok) throw new Error(`Suitability summary t${timeIndex} (${vessel}): HTTP ${res.status}`);
    const body = await res.json();
    return [vessel, {
      warning_percent: body?.percentages?.warning ?? 0,
      caution_percent: body?.percentages?.caution ?? 0,
      point_count: body?.total_points ?? 0,
    }];
  }));
  return { vessels: Object.fromEntries(entries) };
}

async function fetchCookIslandsSuitabilitySummaryFromPoints(timeIndex) {
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

// bounds ({ west, south, east, north }, optional): scopes both the
// backend-endpoint attempt and (once real bounds-scoped map-image data
// exists) matches what the captured/rendered map actually shows. The
// points-based fallback ignores bounds -- it always summarizes the whole
// domain, since scoping it correctly would mean duplicating the same
// point-in-bounds filtering the backend patch already does server-side.
export async function fetchCookIslandsSuitabilitySummary(timeIndex, bounds = null) {
  try {
    return await fetchCookIslandsSuitabilitySummaryFromBackend(timeIndex, bounds);
  } catch {
    return fetchCookIslandsSuitabilitySummaryFromPoints(timeIndex);
  }
}

// Server-rendered map image (/cok/suitability/map-image/{vessel}/{time_index}
// -- the Phase 2 backend patch), converted to a data URL for jsPDF's
// addImage(). bounds is required by that endpoint (no domain-wide auto-fit
// makes sense across Cook Islands' multi-island spread -- see the patch's
// own comment), so this throws (caller falls back to a live canvas
// capture) whenever real bounds aren't available, same as any other
// failure.
export async function fetchCookIslandsSuitabilityMapImage(vessel, timeIndex, bounds) {
  const boundsParams = boundsQueryParams(bounds);
  if (!boundsParams) throw new Error('Map image requires real bounds.');
  const res = await fetch(`/cok/suitability/map-image/${encodeURIComponent(vessel)}/${timeIndex}?${boundsParams.slice(1)}`);
  if (!res.ok) throw new Error(`Suitability map image t${timeIndex} (${vessel}): HTTP ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read map image blob.'));
    reader.readAsDataURL(blob);
  });
}
