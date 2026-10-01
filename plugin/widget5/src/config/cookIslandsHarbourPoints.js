// cookIslandsHarbourPoints.js
// The 16 named harbour/anchorage/passage locations Cook Islands Government
// (Matt Blacka, Climate Change Cook Islands) asked SPC to auto-generate a
// wave-conditions product for, to plan safe cargo unloading from the
// inter-island barge (email to Herve Damlamian, forwarded 2026-09-29).
//
// riskPointId cross-references the SAME point in the Coastal Risk catalog
// (/thredds/.../COK/risk/points.json, see riskDataService.js) -- verified
// live against production that these ids/coordinates are identical to the
// ones in Matt's table (e.g. id 29 = Avatiu Harbour at -21.1978, -159.7856).
// That catalog only carries total-water-level/inundation data for each
// point, not wave height, which is what this product actually needs -- see
// useCookIslandsHarbourWaveConditions.js, which samples wave height at
// these same coordinates from the live wave/wind model instead
// (/cok/suitability/point/timeseries, already deployed for the landing-area
// comparison feature).
//
// Listed in the same order as Matt's table: southern group first, then
// northern group.
export const COOK_ISLANDS_HARBOUR_POINTS = [
  { riskPointId: 29, name: 'Avatiu Harbour', island: 'Rarotonga', lon: -159.7856, lat: -21.1978 },
  { riskPointId: 347, name: 'Mangaia Harbour', island: 'Mangaia', lon: -157.9594, lat: -21.9071 },
  { riskPointId: 344, name: 'Mauke Harbour', island: 'Mauke', lon: -157.3639, lat: -20.1439 },
  { riskPointId: 323, name: 'Mitiaro Harbour', island: 'Mitiaro', lon: -157.7274, lat: -19.8628 },
  { riskPointId: 282, name: 'Atiu Harbour', island: 'Atiu', lon: -158.1451, lat: -19.9767 },
  { riskPointId: 214, name: 'Arutanga Harbour', island: 'Aitutaki', lon: -159.8201, lat: -18.8608 },
  { riskPointId: 175, name: 'Home Island Anchorage', island: 'Palmerston', lon: -163.1977, lat: -18.0476 },
  { riskPointId: 426, name: 'Anchorage Island Passage', island: 'Suwarrow', lon: -163.1023, lat: -13.2392 },
  { riskPointId: 401, name: 'Nassau Harbour', island: 'Nassau', lon: -165.4233, lat: -11.5506 },
  { riskPointId: 378, name: 'Yato Passage', island: 'Pukapuka', lon: -165.8594, lat: -10.858 },
  { riskPointId: 385, name: 'Ngake Wharf', island: 'Pukapuka', lon: -165.8347, lat: -10.8631 },
  { riskPointId: 144, name: 'Tauhunu Harbour', island: 'Manihiki', lon: -161.0414, lat: -10.425 },
  { riskPointId: 150, name: 'Tukao Harbour', island: 'Manihiki', lon: -161.0176, lat: -10.3714 },
  { riskPointId: 128, name: 'Rakahanga Harbour', island: 'Rakahanga', lon: -161.11, lat: -10.0304 },
  { riskPointId: 69, name: 'Taruia Passage', island: 'Penrhyn', lon: -158.0549, lat: -8.9589 },
  { riskPointId: 88, name: 'Takuua Passage', island: 'Penrhyn', lon: -157.9224, lat: -8.9366 },
].map((point) => ({ ...point, id: point.riskPointId }));
