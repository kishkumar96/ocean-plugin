// Builds public/pacific-eez.json: simplified 200 NM EEZ polygons for the
// Pacific Island countries and territories, one feature per country, used to
// shade EEZs by drought status (see public/drought.json).
//
//   node scripts/build-eez.mjs
//
// Source: Pacific Data Hub GeoNode WFS (one layer per country). EEZ limits
// rarely change; rerun this only when they do.
//
// Each feature: { properties: { code: "FJ", name: "Fiji" } }. Longitudes are
// shifted to 0–360 so EEZs that cross the 180° line (Fiji, Kiribati, Tuvalu,
// …) stay in one piece.

import { writeFile } from "node:fs/promises";

const WFS =
  "https://geonode.pacificdata.org/geoserver/ows?service=WFS&version=2.0.0" +
  "&request=GetFeature&outputFormat=application/json&srsName=EPSG:4326&typeNames=geonode:";

// code (used in drought.json) -> [GeoNode layer, name]
const COUNTRIES = {
  AS: ["as_eez_pol", "American Samoa"],
  CK: ["ck_eez_pol", "Cook Islands"],
  FJ: ["fj_eez_pol", "Fiji"],
  FM: ["fm_eez_pol", "Federated States of Micronesia"],
  GU: ["gu_eez_pol", "Guam"],
  KI: ["ki_eez_pol", "Kiribati"],
  MH: ["mh_eez_pol", "Marshall Islands"],
  MP: ["mp_eez_pol", "Northern Mariana Islands"],
  NC: ["nc_eez_pol", "New Caledonia"],
  NR: ["nr_eez_pol", "Nauru"],
  NU: ["nu_eez_pol", "Niue"],
  PF: ["pf_eez_pol", "French Polynesia"],
  PG: ["pg_eez_pol", "Papua New Guinea"],
  PN: ["pn_eez_pol", "Pitcairn Islands"],
  PW: ["pw_eez_pol", "Palau"],
  SB: ["sb_eez_pol", "Solomon Islands"],
  TK: ["tk_eez_pol", "Tokelau"],
  TO: ["to_eez_pol", "Tonga"],
  TV: ["tv_eez_pol", "Tuvalu"],
  VU: ["vu_eez_pol", "Vanuatu"],
  WF: ["wf_eez_pol", "Wallis and Futuna"],
  WS: ["ws_eez_pol", "Samoa"],
};

// Simplification tolerance in degrees (~2 km): plenty for regional zooms.
const TOLERANCE = 0.02;

/** Douglas–Peucker on one ring of [lon, lat] points. */
function simplify(points, tol) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let worst = -1;
    let index = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > worst) [worst, index] = [d, i];
    }
    if (worst > tol) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Simplify a closed ring (first point = last). Douglas–Peucker needs two
 * distinct ends, so split at the point farthest from the start.
 */
function simplifyRing(ring, tol) {
  const [x0, y0] = ring[0];
  let far = 0;
  let best = -1;
  ring.forEach(([x, y], i) => {
    const d = Math.hypot(x - x0, y - y0);
    if (d > best) [best, far] = [d, i];
  });
  if (far === 0) return ring;
  const first = simplify(ring.slice(0, far + 1), tol);
  const second = simplify(ring.slice(far), tol);
  return [...first, ...second.slice(1)];
}

const toPacific = ([lon, lat]) => [
  Math.round((lon < 0 ? lon + 360 : lon) * 1000) / 1000,
  Math.round(lat * 1000) / 1000,
];

/** All polygons (as rings) of a Polygon / MultiPolygon geometry. */
const polygonsOf = (g) =>
  g.type === "Polygon"
    ? [g.coordinates]
    : g.type === "MultiPolygon"
      ? g.coordinates
      : [];

const features = [];
for (const [code, [layer, name]] of Object.entries(COUNTRIES)) {
  const res = await fetch(WFS + layer);
  if (!res.ok) throw new Error(`${layer}: ${res.status}`);
  const json = await res.json();
  const polygons = json.features
    .flatMap((f) => polygonsOf(f.geometry))
    .map((rings) =>
      rings
        .map((ring) => simplifyRing(ring.map(toPacific), TOLERANCE))
        .filter((ring) => ring.length >= 4),
    )
    .filter((rings) => rings.length > 0);
  if (!polygons.length) throw new Error(`${layer}: no polygons`);
  features.push({
    type: "Feature",
    properties: { code, name },
    geometry: { type: "MultiPolygon", coordinates: polygons },
  });
  console.log(`${code} ${name}: ${polygons.length} polygon(s)`);
}

const out = new URL("../public/pacific-eez.json", import.meta.url);
await writeFile(out, JSON.stringify({ type: "FeatureCollection", features }));
console.log(`Wrote ${out.pathname}`);
