// cookIslandsWaveTimeseriesService.js
// Point wave timeseries (Hs, peak period, direction, swell partition) from the
// SWAN UGRID model, via GET /wave/ugrid/timeseries on the zarr-api. This is
// the raw sea state -- distinct from /cok/suitability/point/timeseries, which
// only returns Hs + wind scored against a vessel-class envelope. Harbour
// unloading and boat-crossing decisions need period and direction too: a
// 1.5 m swell at 18 s beam-on is a very different day from 1.5 m wind chop.

import { haversineNm } from './cookIslandsRouteForecastService';

const SFINCS_API_BASE = (process.env.REACT_APP_SFINCS_API_BASE || 'https://ocean-zarr.spc.int').replace(/\/+$/, '');

// hs/tpeak/dirp = total sea state. Partitions (Hanson & Phillips 2001, per the
// SWAN_UGRID zarr attrs): *_p1 is the WIND SEA; *_p2, *_p3 are swells in
// decreasing height. So p1 = local wind chop, p2 = primary swell -- NOT
// "swell 1". dirm = mean direction. All directions (including the partition
// ones, whose long_name says "propagation" but whose standard_name is
// *_from_direction_*) are "coming from", degrees clockwise from north (same
// convention as the wave layer's directionConvention in mapLayersConfig.js).
export const WAVE_TIMESERIES_VARIABLES = [
  'hs', 'tpeak', 'dirp', 'dirm', 'hs_p1', 'tp_p1', 'dirp_p1', 'hs_p2', 'tp_p2', 'dirp_p2',
];

function finiteOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeWaveTimeseries(payload) {
  const times = Array.isArray(payload?.times) ? payload.times : [];
  const vars = payload?.variables ?? {};
  const rows = times.map((time, i) => {
    const row = { time };
    WAVE_TIMESERIES_VARIABLES.forEach((name) => { row[name] = finiteOrNull(vars[name]?.[i]); });
    return row;
  });
  return {
    rows,
    nodeLon: finiteOrNull(payload?.node_lon),
    nodeLat: finiteOrNull(payload?.node_lat),
    // ~111 km per degree; how far the model node used is from the request.
    nodeDistanceKm: finiteOrNull(payload?.distance_degrees) === null ? null : payload.distance_degrees * 111,
  };
}

export async function fetchWaveTimeseries(lon, lat, { signal } = {}) {
  const params = new URLSearchParams({
    lon: String(lon), lat: String(lat), variables: WAVE_TIMESERIES_VARIABLES.join(','),
  });
  const resp = await fetch(`${SFINCS_API_BASE}/wave/ugrid/timeseries?${params}`, { signal });
  if (!resp.ok) throw new Error(`/wave/ugrid/timeseries ${resp.status}`);
  return normalizeWaveTimeseries(await resp.json());
}

// --- geometry -------------------------------------------------------------

export function bearingDeg(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat))
    - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

// Point half-way along a route (by distance travelled, not by vertex count --
// the crossing tracks have a ~90 km leg between two closely spaced vertices),
// plus the heading of the leg it falls on. `points` is [{lon,lat}, ...].
export function routeMidpoint(points) {
  const pts = (points || []).filter((p) => Number.isFinite(p?.lon) && Number.isFinite(p?.lat));
  if (pts.length < 2) return null;
  const legs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = haversineNm(pts[i - 1], pts[i]);
    legs.push(d);
    total += d;
  }
  if (!(total > 0)) return null;
  let remaining = total / 2;
  for (let i = 0; i < legs.length; i++) {
    if (remaining <= legs[i] || i === legs.length - 1) {
      const t = legs[i] > 0 ? Math.min(1, remaining / legs[i]) : 0;
      const a = pts[i];
      const b = pts[i + 1];
      return {
        lon: a.lon + (b.lon - a.lon) * t,
        lat: a.lat + (b.lat - a.lat) * t,
        headingDeg: bearingDeg(a, b),
        routeLengthNm: total,
      };
    }
    remaining -= legs[i];
  }
  return null;
}

// ETA at the route's mid-distance: the forecast sample whose distance along
// the route is closest to half the total. `samples` are normalized route
// samples ({distance_nm, eta}); returns an ISO string or null. This is the
// time the vessel is actually at the midpoint, which is when the midpoint's
// wave conditions matter -- not "now", not the departure time.
export function etaAtMidpoint(samples) {
  const usable = (samples || []).filter((s) => Number.isFinite(s?.distance_nm) && s?.eta);
  if (usable.length < 2) return null;
  const half = Math.max(...usable.map((s) => s.distance_nm)) / 2;
  const best = usable.reduce((a, b) => (Math.abs(b.distance_nm - half) < Math.abs(a.distance_nm - half) ? b : a));
  return Number.isFinite(new Date(best.eta).getTime()) ? best.eta : null;
}

// Where the vessel is along the route at time `tMs`, interpolated between the route
// forecast's own samples (each has an ETA and a position). null outside the voyage -- before
// departure or after arrival the boat is not on the route, so nothing is drawn rather than
// pinning it to an end. `samples`: normalized route samples ({eta, lon, lat, distance_nm}).
export function vesselPositionAt(samples, tMs) {
  const pts = (samples || [])
    .map((s) => ({ t: new Date(s?.eta).getTime(), lon: s?.lon, lat: s?.lat, nm: s?.distance_nm }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.lon) && Number.isFinite(p.lat))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2 || !Number.isFinite(tMs)) return null;
  if (tMs < pts[0].t || tMs > pts[pts.length - 1].t) return null;
  let i = 1;
  while (i < pts.length - 1 && pts[i].t < tMs) i += 1;
  const a = pts[i - 1];
  const b = pts[i];
  const f = b.t > a.t ? (tMs - a.t) / (b.t - a.t) : 0;
  return {
    lon: a.lon + (b.lon - a.lon) * f,
    lat: a.lat + (b.lat - a.lat) * f,
    distanceNm: Number.isFinite(a.nm) && Number.isFinite(b.nm) ? a.nm + (b.nm - a.nm) * f : null,
    voyageStartMs: pts[0].t,
    voyageEndMs: pts[pts.length - 1].t,
  };
}

// Angle of the incoming sea relative to the vessel's bow, 0..180 (sign
// dropped -- port/starboard doesn't change the advice). `seaFromDeg` is where
// the waves come FROM; `headingDeg` is where the vessel is going TO.
// 0 = waves dead ahead (head seas), 180 = waves dead astern (following).
export function seaAngleOffBow(seaFromDeg, headingDeg) {
  if (!Number.isFinite(seaFromDeg) || !Number.isFinite(headingDeg)) return null;
  const d = (((seaFromDeg - headingDeg) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

export function describeSeaAngle(angle) {
  if (!Number.isFinite(angle)) return null;
  if (angle <= 30) return 'Head seas';
  if (angle <= 60) return 'Bow quarter';
  if (angle <= 120) return 'Beam-on';
  if (angle <= 150) return 'Stern quarter';
  return 'Following seas';
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compassPoint(deg) {
  if (!Number.isFinite(deg)) return null;
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

// Same threshold as ForecastTimeline's "Forecast data may be outdated" banner
// (isStale in useZarrMap.js): older than this means a missed pipeline cycle.
export const WAVE_STALE_HOURS = 30;

// Age in hours of the wave forecast, from its first timestamp (the model
// run's start). null if the start is missing/unparseable. Never negative.
export function waveRunAgeHours(runStart, now = Date.now()) {
  const t = runStart ? new Date(runStart).getTime() : NaN;
  return Number.isFinite(t) ? Math.max(0, (now - t) / 3_600_000) : null;
}

// Rows at/after `now`, so "current" is never a step that's already past.
export function currentRow(rows, now = new Date()) {
  if (!rows?.length) return null;
  const t = now.getTime();
  return rows.reduce((best, row) => (
    Math.abs(new Date(row.time).getTime() - t) < Math.abs(new Date(best.time).getTime() - t) ? row : best
  ));
}

// Everything the route advisory PDF states about the route's midpoint, decided
// once: the sea state at the time the vessel is actually there (not now, not the
// departure), how it meets the bow, and its components. `midpoint` is
// routeMidpoint()'s result, `rows` the normalized wave rows, `etaIso` the
// vessel's ETA at the midpoint. Returns null when there is nothing usable.
export function buildMidpointConditions({ midpoint, rows, etaIso }) {
  if (!midpoint || !rows?.length || !etaIso) return null;
  const row = currentRow(rows, new Date(etaIso));
  if (!row) return null;
  // The nearest forecast hour must be genuinely near the ETA; otherwise the ETA
  // is outside the wave forecast and quoting its nearest edge would be misleading.
  const gapHours = Math.abs(new Date(row.time).getTime() - new Date(etaIso).getTime()) / 3_600_000;
  if (!(gapHours <= 1.5)) return null;
  const angle = seaAngleOffBow(row.dirp, midpoint.headingDeg);
  return {
    lat: midpoint.lat,
    lon: midpoint.lon,
    headingDeg: midpoint.headingDeg,
    etaIso,
    validTime: row.time,
    waveRunStart: rows[0]?.time ?? null,
    hsM: row.hs, tpS: row.tpeak, dirDeg: row.dirp, dirPoint: compassPoint(row.dirp),
    angleOffBowDeg: angle,
    angleText: describeSeaAngle(angle),
    windSea: { hsM: row.hs_p1, tpS: row.tp_p1, dirDeg: row.dirp_p1, dirPoint: compassPoint(row.dirp_p1) },
    primarySwell: { hsM: row.hs_p2, tpS: row.tp_p2, dirDeg: row.dirp_p2, dirPoint: compassPoint(row.dirp_p2) },
  };
}

// Local wall-clock 'YYYY-MM-DD HH:mm:ss' in `timeZone`, with no offset
// designator. Plotly formats Date objects in the browser's own timezone, so
// feeding it zone-shifted strings is the only way the axis reads in the
// app's display zone (Pacific/Rarotonga) regardless of the viewer's machine.
export function zonedPlotlyTime(value, timeZone) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

// --- CSV ------------------------------------------------------------------

const CSV_COLUMNS = [
  ['time_utc', (r) => r.time],
  ['hs_m', (r) => r.hs],
  ['tpeak_s', (r) => r.tpeak],
  ['dir_peak_from_deg', (r) => r.dirp],
  ['dir_mean_from_deg', (r) => r.dirm],
  ['windsea_hs_m', (r) => r.hs_p1],
  ['windsea_tp_s', (r) => r.tp_p1],
  ['windsea_dir_from_deg', (r) => r.dirp_p1],
  ['primary_swell_hs_m', (r) => r.hs_p2],
  ['primary_swell_tp_s', (r) => r.tp_p2],
  ['primary_swell_dir_from_deg', (r) => r.dirp_p2],
];

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'number' ? String(Math.round(value * 1000) / 1000) : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// `site`: {name, lon, lat, headingDeg?}. When headingDeg is given, a
// sea_angle_off_bow_deg column (peak direction vs the vessel's heading) is
// added. Metadata goes in leading '#' comment lines so the file stays a
// plain header+rows CSV for spreadsheet/pandas users (skip with comment='#').
export function buildWaveTimeseriesCsv(rows, site = {}) {
  const hasHeading = Number.isFinite(site.headingDeg);
  const columns = hasHeading
    ? [...CSV_COLUMNS, ['sea_angle_off_bow_deg', (r) => seaAngleOffBow(r.dirp, site.headingDeg)]]
    : CSV_COLUMNS;
  const meta = [
    `# Cook Islands SWAN wave forecast${site.name ? ` - ${site.name}` : ''}`,
    `# Requested location (lat, lon): ${site.lat}, ${site.lon}`,
    hasHeading ? `# Route heading at this point: ${Math.round(site.headingDeg)} deg true` : null,
    '# Directions are where waves come FROM, degrees true. Model guidance, not navigation advice.',
  ].filter(Boolean);
  const lines = [
    ...meta,
    columns.map(([name]) => name).join(','),
    ...(rows || []).map((row) => columns.map(([, get]) => csvCell(get(row))).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

function downloadBlob(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Deferred: revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(filename, csv) {
  downloadBlob(filename, csv, 'text/csv;charset=utf-8');
}

export function downloadJson(filename, json) {
  downloadBlob(filename, json, 'application/json');
}
