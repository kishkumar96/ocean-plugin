// viewBounds.js -- turns MapLibre's view bounds into ones a server can use.
//
// Zoomed far out, or after panning across world copies, map.getBounds() returns longitudes beyond
// +/-180 (seen live: W -328.85, E 5.35) and latitudes near the poles. Sent as-is, the suitability
// service matched no model points and the report failed with "statistics are unavailable". The view
// is shifted back by whole turns so its centre lies in [-180, 180], then clamped to the valid range.
const MAX_LAT = 85.0511; // Web Mercator limit

export function normalizeViewBounds(bounds) {
  if (!bounds) return null;
  let { west, south, east, north } = bounds;
  if (![west, south, east, north].every(Number.isFinite)) return null;
  const shift = Math.round(((west + east) / 2) / 360) * 360;
  west -= shift;
  east -= shift;
  west = Math.max(-180, west);
  east = Math.min(180, east);
  south = Math.max(-MAX_LAT, south);
  north = Math.min(MAX_LAT, north);
  if (!(east > west) || !(north > south)) return null;
  return { west, south, east, north };
}
