// cookIslandsRouteForecastService.js
// Request-building, response-normalizing, and fetch glue for the Cook
// Islands route forecast (/cok/suitability/route). Trimmed down from
// widget1's routeForecastService.js: no GPX/file import, no departure-time
// "suggest a better offset" sweep, no PDF advisory-brief config builder --
// this app only draws/undoes/clears a route on the map and runs one
// forecast against it, so those concerns don't apply here.

const MAX_ROUTE_POINTS = 500;
const DEFAULT_SAMPLE_SPACING_NM = 1;
// Mirrors the backend's _ROUTE_MAX_SAMPLES (main.py) -- kept a bit under it
// (not equal) so the client's own approximation (straight route-length /
// spacing, vs. the backend's actual per-segment ceil() sum, which can round
// up to slightly more samples than that approximation) still lands safely
// inside the real limit instead of occasionally tripping it by one segment's
// rounding. Cook Islands' EEZ spans ~1,500 nm corner-to-corner, so a route
// connecting several outer islands can legitimately exceed 2,000 nm at the
// default 1 nm spacing -- this was hit live (2,243 > 2,000) on a real route,
// not a hypothetical.
const BACKEND_MAX_SAMPLES = 2000;
const TARGET_MAX_SAMPLES = 1600;

export const ROUTE_HAZARD_LABELS = {
  0: 'Suitable',
  1: 'Caution',
  2: 'Warning',
};

// `Number(null) === 0` and `Number.isFinite(0) === true`, so the naive
// `Number.isFinite(Number(x)) ? Number(x) : fallback` idiom would silently
// turn the backend's explicit `null` (an unavailable/out-of-domain sample or
// segment) into a real `0` ("Suitable") -- a route leg that left the model
// domain would render as a green "safe" segment instead of the grey
// "unavailable" the map layer already has a fallback color for. null/
// undefined must short-circuit before the Number() coercion.
function toNumber(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// datetime-local <input> values (the live routeDepartureTime state) carry no
// timezone designator. This app always intends them as UTC wall-clock, same
// as the map's own timestamps -- appending Z before parsing avoids the
// runtime's local timezone silently shifting the departure time.
export function parseAsUtcWallClock(value) {
  if (!value) return null;
  const hasDesignator = /Z$|[+-]\d{2}:?\d{2}$/.test(value);
  return new Date(hasDesignator ? value : `${value}Z`);
}

function normalizePoint(point) {
  if (Array.isArray(point)) {
    const lon = toNumber(point[0]);
    const lat = toNumber(point[1]);
    return lon === null || lat === null ? null : { lon, lat };
  }
  const lon = toNumber(point?.lon ?? point?.lng ?? point?.longitude);
  const lat = toNumber(point?.lat ?? point?.latitude);
  return lon === null || lat === null ? null : { lon, lat };
}

// A plain points.slice(0, MAX_ROUTE_POINTS) could silently drop the
// destination on a very long route -- always keep the final point so
// truncation shortens the middle of the route, not where it ends.
function truncateRoutePoints(points) {
  if (points.length <= MAX_ROUTE_POINTS) return points;
  console.warn(`Route has ${points.length} points; truncated to ${MAX_ROUTE_POINTS}, keeping the destination.`);
  return [...points.slice(0, MAX_ROUTE_POINTS - 1), points[points.length - 1]];
}

export function validateRouteForecastInput({ routePoints, departureTime, speedKt }) {
  const points = Array.isArray(routePoints) ? routePoints.map(normalizePoint).filter(Boolean) : [];

  if (points.length < 2) {
    throw new Error('Add at least two route points before running a route forecast.');
  }

  const departure = parseAsUtcWallClock(departureTime);
  if (!departure || !Number.isFinite(departure.getTime())) {
    throw new Error('Choose a valid departure time before running a route forecast.');
  }

  const speed = Number(speedKt);
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error('Enter a vessel speed greater than 0 kt.');
  }

  return {
    routePoints: truncateRoutePoints(points),
    departureTime: departure.toISOString(),
    speedKt: speed,
  };
}

function totalRouteLengthNm(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineNm(points[i - 1], points[i]);
  return total;
}

// The default 1 nm spacing is fine for a short inter-island hop, but Cook
// Islands' EEZ spans ~1,500 nm corner-to-corner -- a route connecting
// several outer islands can run well past the backend's 2,000-sample cap at
// that spacing. Rather than make the user understand "sample spacing" to
// avoid an error, widen it automatically once the route is long enough that
// 1 nm would blow the cap, and never below the 1 nm default otherwise (no
// reason to make a short route coarser than it needs to be).
function autoSampleSpacingNm(routeLengthNm) {
  if (!Number.isFinite(routeLengthNm) || routeLengthNm <= 0) return DEFAULT_SAMPLE_SPACING_NM;
  return Math.max(DEFAULT_SAMPLE_SPACING_NM, routeLengthNm / TARGET_MAX_SAMPLES);
}

// sampleSpacingNm: leave unset to auto-size from the route's own length (see
// autoSampleSpacingNm above); pass a number to force a specific spacing.
export function buildRouteForecastPayload({
  routePoints,
  vessel,
  departureTime,
  speedKt,
  sampleSpacingNm,
}) {
  const validated = validateRouteForecastInput({ routePoints, departureTime, speedKt });
  const routeLengthNm = totalRouteLengthNm(validated.routePoints);
  const spacing = Number.isFinite(sampleSpacingNm) && sampleSpacingNm > 0
    ? sampleSpacingNm
    : autoSampleSpacingNm(routeLengthNm);

  // Belt-and-braces: catch the pathological case client-side (e.g. an
  // explicit sampleSpacingNm override too small for this route) with an
  // immediate, specific message instead of a round trip to the backend's
  // generic 400.
  if (routeLengthNm / spacing > BACKEND_MAX_SAMPLES) {
    throw new Error(
      `Route is too long (${routeLengthNm.toFixed(0)} nm) for a ${spacing.toFixed(2)} nm sample spacing -- `
      + 'shorten the route or use fewer waypoints.'
    );
  }

  return {
    vessel,
    departure_time: validated.departureTime,
    speed_kt: validated.speedKt,
    sample_spacing_nm: spacing,
    route: validated.routePoints.map((p) => [p.lon, p.lat]),
  };
}

export function normalizeRouteForecastResponse(payload, fallback = {}) {
  const samples = Array.isArray(payload?.samples)
    ? payload.samples.map((sample, index) => {
        const lon = toNumber(sample?.lon);
        const lat = toNumber(sample?.lat);
        const hazard = toNumber(sample?.hazard_class);
        return {
          ...sample,
          sample_index: toNumber(sample?.sample_index) ?? index,
          lon,
          lat,
          distance_nm: toNumber(sample?.distance_nm),
          hazard_class: hazard,
          hazard_label: hazard === null ? 'Unavailable' : (ROUTE_HAZARD_LABELS[hazard] ?? sample?.hazard_label ?? 'Unknown'),
          wave_height_m: toNumber(sample?.wave_height_m),
          wind_speed_kt: toNumber(sample?.wind_speed_kt),
        };
      }).filter((sample) => sample.lon !== null && sample.lat !== null)
    : [];

  const segments = Array.isArray(payload?.segments)
    ? payload.segments.map((segment) => {
        const hazardClass = toNumber(segment?.hazard_class);
        return {
          ...segment,
          from_sample_index: Number(segment?.from_sample_index),
          to_sample_index: Number(segment?.to_sample_index),
          hazard_class: hazardClass,
          available: segment?.available ?? (hazardClass !== null),
        };
      }).filter((segment) => (
        Number.isInteger(segment.from_sample_index)
        && Number.isInteger(segment.to_sample_index)
        && samples[segment.from_sample_index]
        && samples[segment.to_sample_index]
      ))
    : [];

  // Seeded with null (not 0) so "no available samples at all" stays
  // null/unknown instead of fabricating a "Suitable" reading -- mirrors the
  // backend's own worst_hazard: Optional[int] = None that only becomes a
  // real int once at least one in-domain sample is scored.
  const fallbackWorst = samples.reduce((max, sample) => {
    if (!Number.isFinite(sample.hazard_class)) return max;
    return max === null ? sample.hazard_class : Math.max(max, sample.hazard_class);
  }, null);

  const worstHazardClass = toNumber(payload?.summary?.worst_hazard_class) ?? fallbackWorst;

  return {
    route_id: payload?.route_id ?? null,
    vessel: payload?.vessel ?? fallback.vessel ?? '',
    departure_time: payload?.departure_time ?? fallback.departureTime ?? null,
    speed_kt: toNumber(payload?.speed_kt) ?? fallback.speedKt ?? null,
    summary: {
      distance_nm: toNumber(payload?.summary?.distance_nm),
      duration_hours: toNumber(payload?.summary?.duration_hours),
      worst_hazard_class: worstHazardClass,
      recommendation: worstHazardClass === null ? 'Unavailable' : (ROUTE_HAZARD_LABELS[worstHazardClass] ?? payload?.summary?.recommendation ?? 'Unknown'),
      suitable_percent: toNumber(payload?.summary?.suitable_percent),
      caution_percent: toNumber(payload?.summary?.caution_percent),
      warning_percent: toNumber(payload?.summary?.warning_percent),
    },
    samples,
    segments,
  };
}

function apiErrorMessage(status, payload) {
  if (status === 404) return 'Route forecast is not available in this deployment yet.';
  if (status === 400) return payload?.detail || payload?.message || 'Route forecast request was invalid.';
  return 'Route forecast failed. Please try again.';
}

export async function fetchCookIslandsRouteForecast(request) {
  const payload = buildRouteForecastPayload(request);
  const response = await fetch('/cok/suitability/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(apiErrorMessage(response.status, body));
  }

  return normalizeRouteForecastResponse(body, {
    vessel: payload.vessel,
    departureTime: payload.departure_time,
    speedKt: payload.speed_kt,
  });
}

// Great-circle-free (routes here are short, inter-island hops) distance
// between two {lon,lat} points, in nautical miles -- used client-side for
// the draft leg-distance labels shown while the route is still being drawn,
// before a forecast has actually been run.
export function haversineNm(a, b) {
  const R_NM = 3440.065;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}
