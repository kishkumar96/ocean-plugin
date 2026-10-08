// routeProbeLayout.js
// Layout decisions for the route probe markers (the midpoint ring and boat dot drawn while the
// midpoint wave chart is open), kept pure so they can be tested without a map.
import { haversineNm } from '../services/cookIslandsRouteForecastService';

// How close, as a fraction of the whole route's length, a leg-distance label has to be to a
// probe marker before the two overlap on screen. The route is fitted to roughly the map's
// width, so a tenth of the route is on the order of a label's width.
export const LABEL_COLLISION_FRACTION = 0.1;

// Indexes of the route's legs whose distance label (drawn at the leg's midpoint) would collide with
// a marker at `point`. `points` are the route's waypoints [{lon,lat}, ...]. On a two-leg crossing
// the long leg's midpoint is almost exactly the route midpoint, which is the case this exists for.
export function legLabelsNearPoint(points, point, fraction = LABEL_COLLISION_FRACTION) {
  const pts = (points || []).filter((p) => Number.isFinite(p?.lon) && Number.isFinite(p?.lat));
  if (pts.length < 2 || !Number.isFinite(point?.lon) || !Number.isFinite(point?.lat)) return [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i += 1) total += haversineNm(pts[i], pts[i + 1]);
  if (!(total > 0)) return [];
  const near = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const mid = { lon: (pts[i].lon + pts[i + 1].lon) / 2, lat: (pts[i].lat + pts[i + 1].lat) / 2 };
    if (haversineNm(mid, point) <= fraction * total) near.push(i);
  }
  return near;
}
