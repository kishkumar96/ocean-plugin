// cookIslandsPresetRoutes.js
// The two inter-island small-boat crossings Cook Islands Government asked
// SPC to auto-generate a wave-conditions product for (Matt Blacka's email to
// Herve Damlamian, 2026-09-29): Pukapuka<->Nassau and Manihiki<->Rakahanga,
// used to inform safe passage for the small boats that operate these
// routes. Point sequences are the actual survey tracks Cook Islands
// Government supplied (Pukapuka_Nassau.kmz / Manihiki_Rakahanga.kmz,
// exported from Google Earth Pro), not a straight-line approximation
// between the two harbours -- both tracks path around each island's own
// reef before heading for open water.
//
// "Plan route" (CookIslandsRouteControls.jsx) already runs an arbitrary,
// manually-drawn route through /cok/suitability/route and reports
// wave_height_m/wind_speed_kt/hazard_class along it -- these presets just
// pre-fill that same tool with a known route and its vessel, instead of the
// user drawing point-by-point each time.
//
// Each crossing is listed as two separate, explicitly directional entries
// (A->B and B->A) rather than one A<->B entry with a "reverse" toggle: a
// route's ETA/hazard-per-sample depends on which end is the departure point
// (later samples get a later, and possibly quite different, forecast
// timestep), so "reversed" is a real, consequential choice, not a display
// nicety -- making it two explicit buttons means there is never a hidden
// direction state to get out of sync with what was actually run. Each
// direction's points are derived from the SAME source track (forward or
// reversed), so there is only ever one place either track's coordinates are
// written down.
//
// vessel: the closest match in VESSEL_CLASS_OPTIONS (CookIslandsSuitabilityOverlay.js)
// to the vessel size Matt's email gave for each crossing ("~10 m vessel for
// Nassau, ~6 m vessel for Rakahanga"). Both crossings resolve to
// 'small_craft' (6-10 m): Nassau's ~10 m vessel sits at that band's own
// upper edge, and -- importantly -- Rakahanga's ~6 m vessel does NOT fit
// 'very_small_motorised_craft', whose own definition is "<6 m" (strictly
// less than 6, so 6 m itself is out of range); 6-10 m's inclusive lower
// bound is the one band that actually contains 6 m. This is a starting
// assumption, not a confirmed value -- surfaced as such in
// CookIslandsRouteControls.jsx, and editable there like any other route's
// vessel/speed choice. defaultSpeedKt is similarly assumed (neither KMZ
// carries speed/timing data) -- differs between the two crossings only to
// reflect Matt's stated size difference between the two boats, since the
// vessel classification itself can't distinguish a 6 m from a 10 m craft.
const PUKAPUKA_NASSAU_TRACK = [
  { lon: -165.854467, lat: -10.855803 },
  { lon: -165.85728, lat: -10.853224 },
  { lon: -165.859751, lat: -10.846755 },
  { lon: -165.856809, lat: -10.84249 },
  { lon: -165.849565, lat: -10.840639 },
  { lon: -165.83716, lat: -10.840249 },
  { lon: -165.826741, lat: -10.840541 },
  { lon: -165.822375, lat: -10.843465 },
  { lon: -165.420784, lat: -11.552485 },
  { lon: -165.420244, lat: -11.554133 },
];

const MANIHIKI_RAKAHANGA_TRACK = [
  { lon: -161.014436, lat: -10.373621 },
  { lon: -161.015672, lat: -10.372336 },
  { lon: -161.107614, lat: -10.043033 },
  { lon: -161.108588, lat: -10.037285 },
  { lon: -161.107692, lat: -10.031182 },
  { lon: -161.106089, lat: -10.029909 },
];

export const COOK_ISLANDS_PRESET_ROUTES = [
  {
    id: 'pukapuka_to_nassau',
    label: 'Pukapuka → Nassau',
    start: 'Pukapuka',
    destination: 'Nassau',
    vessel: 'small_craft',
    defaultSpeedKt: 8,
    points: PUKAPUKA_NASSAU_TRACK,
  },
  {
    id: 'nassau_to_pukapuka',
    label: 'Nassau → Pukapuka',
    start: 'Nassau',
    destination: 'Pukapuka',
    vessel: 'small_craft',
    defaultSpeedKt: 8,
    points: [...PUKAPUKA_NASSAU_TRACK].reverse(),
  },
  {
    id: 'manihiki_to_rakahanga',
    label: 'Manihiki → Rakahanga',
    start: 'Manihiki',
    destination: 'Rakahanga',
    vessel: 'small_craft',
    defaultSpeedKt: 6,
    points: MANIHIKI_RAKAHANGA_TRACK,
  },
  {
    id: 'rakahanga_to_manihiki',
    label: 'Rakahanga → Manihiki',
    start: 'Rakahanga',
    destination: 'Manihiki',
    vessel: 'small_craft',
    defaultSpeedKt: 6,
    points: [...MANIHIKI_RAKAHANGA_TRACK].reverse(),
  },
];

// {southWest: [lat, lon], northEast: [lat, lon]} -- the shape useZarrMap's
// fitBounds (via islandBoundsToML) expects, not GeoJSON/Leaflet's own
// [[lon,lat],[lon,lat]] convention.
export function presetRouteBounds(preset) {
  const lons = preset.points.map((p) => p.lon);
  const lats = preset.points.map((p) => p.lat);
  return {
    southWest: [Math.min(...lats), Math.min(...lons)],
    northEast: [Math.max(...lats), Math.max(...lons)],
  };
}

// Whether loading a preset should ask before it overwrites the route
// currently on screen. Only true for a route the user actually drew by hand
// (no activePresetRouteId) -- switching between presets, or reloading the
// same one, is never destructive of manual work and should stay one click.
export function shouldConfirmRouteReplacement({ existingPointCount, activePresetRouteId }) {
  return existingPointCount > 0 && !activePresetRouteId;
}
