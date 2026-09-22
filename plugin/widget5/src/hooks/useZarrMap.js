// useZarrMap.js — MapLibre GL map + ZarrOverlay/UgridOverlay management.
// Replaces: useMapRendering, useWMSCapabilities, useTimeAnimation, useMapInteraction.
import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { ZarrOverlay } from '../lib/ZarrOverlay';
import { UgridOverlay } from '../lib/UgridOverlay';
import { SfincsRasterOverlay } from '../lib/SfincsRasterOverlay';
import { SfincsColumnOverlay } from '../lib/SfincsColumnOverlay';
import { COK_SUITABILITY_CIRCLES_LAYER, COK_ADVISORY_LOCATIONS_LAYER, HAZARD_COLORS } from '../lib/CookIslandsSuitabilityOverlay';
import { CookIslandsSuitabilityController } from '../lib/CookIslandsSuitabilityController';
import { haversineNm } from '../services/cookIslandsRouteForecastService';
import { IMPACT_SECTOR_COLORS, IMPACT_SECTOR_LABELS } from '../services/cookIslandsImpactService';
import { fmtUsd } from '../components/impact/impactFormat';
import { findLayerById } from '../lib/mapLayersConfig';
import { BASEMAP_LAYER_ID, BASEMAP_OPTIONS } from '../config/basemapConfig';
import { ISLAND_ZOOM_TARGETS } from '../config/islandConfig';
import {
  fetchRiskDetails,
  fetchRiskPoints as fetchRiskPointsData,
  getEffectiveRiskLevel,
  ensureRiskThresholdOverridesLoaded,
  RISK_COLORS,
  RISK_LABELS,
} from '../services/riskDataService';
import { disableTerrain, enableTerrain, hasTerrainDem } from '../lib/terrainMapLibre';

// Satellite/hybrid tiles from ESRI — no key needed
const ESRI_SAT_STYLE = {
  version: 8,
  sources: {
    sat: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Tiles © Esri',
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'sat', type: 'raster', source: 'sat' },
  ],
};

const RISK_SOURCE = 'risk-points-src';
const RISK_CIRCLES_LAYER = 'risk-circles';
// Gold highlight ring for whichever point is currently selected (its details
// are showing in the bottom panel) -- distinct from any risk-level color so
// selection is legible at every risk level, including moderate/red.
const RISK_SELECTED_STROKE = '#facc15';

const ISLAND_LABELS_SOURCE = 'island-labels-src';
const ISLAND_LABELS_LAYER = 'island-labels';

const COK_ROUTE_DRAFT_SOURCE = 'cok-route-draft-src';
const COK_ROUTE_SEGMENTS_SOURCE = 'cok-route-segments-src';
const COK_ROUTE_DRAFT_LAYER = 'cok-route-draft-line';
const COK_ROUTE_SEGMENTS_LAYER = 'cok-route-segments';
const COK_ROUTE_WAYPOINT_COLORS = { origin: '#22c55e', destination: '#ef4444', waypoint: '#38bdf8' };

// RiskScape per-building/per-road impact assets (/cok/impact/latest/assets)
// -- one shared GeoJSON source (mixed Polygon/LineString/Point geometry, one
// Feature per asset) split across three layers by MapLibre's own
// ['geometry-type'] expression, since a single layer type can't paint every
// geometry kind. Always present (like the route layers above), not tied to
// selectedLayerId -- Home.jsx toggles visibility/data via impactAssetsVisible/
// impactAssetsGeojson rather than this hook owning any fetch lifecycle.
const COK_IMPACT_ASSETS_SOURCE = 'cok-impact-assets-src';
const COK_IMPACT_ASSETS_FILL_LAYER = 'cok-impact-assets-fill';
const COK_IMPACT_ASSETS_LINE_HALO_LAYER = 'cok-impact-assets-line-halo';
const COK_IMPACT_ASSETS_LINE_LAYER = 'cok-impact-assets-line';
const COK_IMPACT_ASSETS_CIRCLE_LAYER = 'cok-impact-assets-circle';
const COK_IMPACT_ASSETS_LAYERS = [COK_IMPACT_ASSETS_FILL_LAYER, COK_IMPACT_ASSETS_LINE_HALO_LAYER, COK_IMPACT_ASSETS_LINE_LAYER, COK_IMPACT_ASSETS_CIRCLE_LAYER];

// Built once from the single IMPACT_SECTOR_COLORS source of truth (also used
// by the Impacts tab's own sector donut chart/legend) rather than a second,
// hand-kept color list -- a building on the map and its slice of that donut
// always match. MapLibre 'match' expression: [input, label, output, ...,
// fallback] -- flattening the color map's entries gives exactly that shape.
function buildImpactSectorColorExpression() {
  const stops = Object.entries(IMPACT_SECTOR_COLORS).flatMap(([sector, color]) => [sector, color]);
  return ['match', ['get', 'sector'], ...stops, IMPACT_SECTOR_COLORS.unknown];
}

// Severity (economic damage ÷ original value, 0-1, computed server-side) drives opacity
// rather than a second color ramp -- IMPACT_SECTOR_COLORS above already
// carries the categorical "what kind of asset" signal; layering a
// continuous "how badly damaged" ramp on the same channel would fight it.
// A damaged building still reads as its own sector color, just more solid.
//
// Floor is 0.45, not near-zero: verified visually against a real cycle's
// data (most exposed assets carry a real but modest loss_ratio, well under
// 1.0 -- the worst building in the 2026091406 cycle was ~0.17) -- a lower
// floor left every asset that isn't near-total damage looking almost
// invisible against satellite imagery, defeating the point of an "exposed
// assets" layer (being exposed at all should always read clearly; severity
// should refine that, not gate whether you can see it).
const COK_IMPACT_LOSS_RATIO_OPACITY = ['interpolate', ['linear'], ['get', 'lossRatio'], 0, 0.45, 1, 0.85];

const ISLAND_LABEL_FEATURES = {
  type: 'FeatureCollection',
  features: ISLAND_ZOOM_TARGETS.map(island => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [
        (island.bounds.southWest[1] + island.bounds.northEast[1]) / 2,
        (island.bounds.southWest[0] + island.bounds.northEast[0]) / 2,
      ],
    },
    properties: { name: island.label },
  })),
};

// Convert island bounds stored as {southWest:[lat,lng], northEast:[lat,lng]}
// to MapLibre LngLatBoundsLike [[sw_lng,sw_lat],[ne_lng,ne_lat]]
function islandBoundsToML(bounds) {
  if (!bounds) return null;
  const { southWest: sw, northEast: ne } = bounds;
  return [[sw[1], sw[0]], [ne[1], ne[0]]];
}

function parseTimeLabel(label) {
  if (!label) return null;
  try {
    const d = new Date(label.replace(' UTC', 'Z').replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

function emptyFeatureCollection() {
  return { type: 'FeatureCollection', features: [] };
}

function routePointsToLineFeature(points = []) {
  const coords = points
    .filter((point) => Number.isFinite(point?.lon) && Number.isFinite(point?.lat))
    .map((point) => [point.lon, point.lat]);

  if (coords.length < 2) return emptyFeatureCollection();
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }],
  };
}

// One LineString feature per scored leg (not the whole route as a single
// feature) so 'line-color' can key off each leg's own hazardClass property
// -- a route that gets worse partway through renders as a green-to-red
// gradient of segments instead of one flat color for the whole line.
function routeSamplesToSegmentFeatures(result) {
  const samples = result?.samples;
  const segments = result?.segments;
  if (!Array.isArray(samples) || !Array.isArray(segments)) return [];
  return segments
    .filter((segment) => segment.available && Number.isFinite(segment.hazard_class))
    .map((segment) => {
      const a = samples[segment.from_sample_index];
      const b = samples[segment.to_sample_index];
      if (!a || !b || !Number.isFinite(a.lon) || !Number.isFinite(a.lat) || !Number.isFinite(b.lon) || !Number.isFinite(b.lat)) {
        return null;
      }
      return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] },
        properties: { hazardClass: segment.hazard_class },
      };
    })
    .filter(Boolean);
}

export function useZarrMap({
  selectedLayerId,
  sliderIndex,
  setSliderIndex,
  isPlaying,
  setIsPlaying,
  opacity = 0.75,
  thresholds = null,
  riskEnabled = true,
  setBottomCanvasData,
  setShowBottomCanvas,
  inundationCategories = null,
  minVisibleDepth = null,
  inundationRenderMode = 'continuous',
  rangeWindow = null,
  playSpeedMs = 700,
  terrainEnabled = false,
  terrainConfig = null,
  flood3dEnabled = false,
  flood3dConfig = null,
  flood3dElevScale = null,
  vesselClass = 'traditional_craft',
  suitabilityMode = 'preset',
  customEnvelope = null,
  routePickMode = false,
  onRoutePointPick,
  routePoints = [],
  routeForecastResult = null,
  impactAssetsGeojson = null,
  impactAssetsVisible = false,
  impactAssetsScenario = null,
  initialMapView = null,
  initialBasemapId = 'satellite',
}) {
  // mapRef  = DOM container div ref  (used as <div ref={mapRef}>)
  // mapInstance = actual MapLibre map ref (used for fitBounds, getZoom, etc.)
  const mapRef = useRef(null);
  const mapInstance = useRef(null);

  const overlayRef = useRef(null);
  // Shared across every UgridOverlay instance this hook ever creates (unlike
  // the overlay's own `didAutoFit`, which is a per-instance flag that starts
  // false again on every layer switch, so the camera snapped to the mesh
  // bounds on *every* switch between wave layers, not just the first load).
  const autoFitStateRef = useRef({ done: Boolean(initialMapView) });
  const columnOverlayRef = useRef(null);
  const playIntervalRef = useRef(null);
  const pinMarkerRef = useRef(null);
  const riskLatestReqRef = useRef(0);
  const riskDetailsReqRef = useRef(0);
  const riskPointsRef = useRef([]);
  const selectedRiskIdRef = useRef(null);
  const selectedImpactAssetIdRef = useRef(null);
  const riskHoverPopupRef = useRef(null);
  const advisoryHoverPopupRef = useRef(null);
  const impactAssetPopupRef = useRef(null);
  const routeWaypointMarkersRef = useRef([]);
  const routeLegLabelMarkersRef = useRef([]);

  const [timeCount, setTimeCount] = useState(1);
  const [timeLabels, setTimeLabels] = useState([]);
  // Which selectedLayerId timeLabels actually belongs to. timeLabels is
  // deliberately NOT cleared on a layer switch (see the overlay-construction
  // effect's own comment) so currentSliderDate never flickers null -- but that
  // means a consumer who only checks "timeLabels is non-empty" right after a
  // switch can silently read the OLD layer's array for a brief window (new
  // overlay constructed, but its own onTimeChange/getTimeLabels hasn't landed
  // yet). Set only alongside the real setTimeLabels() call below, so callers
  // needing "this data is really for my just-selected layer" can compare it
  // against selectedLayerId instead of trusting non-emptiness alone.
  const [timeLabelsLayerId, setTimeLabelsLayerId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [overlayStats, setOverlayStats] = useState(null);

  // Keep latest callback params in refs to avoid stale closures in map event listeners
  const cbRef = useRef({});
  cbRef.current = { setBottomCanvasData, setShowBottomCanvas, inundationCategories, minVisibleDepth, inundationRenderMode, rangeWindow, selectedLayerId, opacity, flood3dElevScale, sliderIndex, vesselClass, suitabilityMode, customEnvelope, loading, routePickMode, onRoutePointPick };

  const overlayRefR = useRef(overlayRef);
  overlayRefR.current = overlayRef;

  // ── map init (once) ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const initialBasemap = BASEMAP_OPTIONS.find((option) => option.id === initialBasemapId)
      ?? BASEMAP_OPTIONS[0];
    const initialBounds = initialMapView?.bounds;
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: initialBasemapId === 'satellite' ? ESRI_SAT_STYLE : {
        version: 8,
        sources: { [BASEMAP_LAYER_ID]: initialBasemap.source },
        layers: [{ id: BASEMAP_LAYER_ID, type: 'raster', source: BASEMAP_LAYER_ID }],
      },
      center: initialMapView?.center ?? [-159.78, -21.24],
      zoom: initialMapView?.zoom ?? 8,
      bearing: initialMapView?.bearing ?? 0,
      pitch: initialMapView?.pitch ?? 0,
      ...(Array.isArray(initialBounds) && initialBounds.length === 4
        ? {
            bounds: [
              [initialBounds[0], initialBounds[1]],
              [initialBounds[2], initialBounds[3]],
            ],
            fitBoundsOptions: { padding: 0, animate: false },
          }
        : {}),
      maxPitch: 60,
      attributionControl: true,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-left');
    mapInstance.current = map;

    const onLoad = () => {
      // Risk points layer
      map.addSource(RISK_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      // Shared condition expressions for the risk-circles paint spec below.
      const RISK_IS_SELECTED = ['boolean', ['feature-state', 'selected'], false];
      const RISK_IS_REPRESENTATIVE = ['==', ['get', 'type'], 'representative'];
      map.addLayer({
        id: RISK_CIRCLES_LAYER,
        type: 'circle',
        source: RISK_SOURCE,
        paint: {
          // Selected point renders larger than either the representative or
          // detailed base size, so the highlight is legible at any zoom.
          //
          // The MapLibre style spec allows at most one zoom-based
          // step/interpolate subexpression per property, and only as a
          // *top-level* expression (or nested one level inside a top-level
          // step/interpolate's own stop values) -- a 'case' picking between
          // three separate ['interpolate', ..., ['zoom'], ...] branches, or
          // multiplying an interpolate's result by a 'case'-selected factor,
          // both fail addLayer() validation and throw, silently aborting the
          // rest of this onLoad() closure (so risk points AND everything
          // registered after this addLayer call -- island labels, route
          // layers, click handlers, doRefreshRisk() -- never ran). Verified
          // against the real validator (@maplibre/maplibre-gl-style-spec's
          // validateStyleMin) before landing this, not just by inspection.
          // The single valid shape: one top-level interpolate-by-zoom whose
          // *stop values* are themselves data-driven 'case' expressions.
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            8, ['case', RISK_IS_SELECTED, 9, RISK_IS_REPRESENTATIVE, 6, 5],
            12, ['case', RISK_IS_SELECTED, 11, RISK_IS_REPRESENTATIVE, 8, 7],
            14, ['case', RISK_IS_SELECTED, 14, RISK_IS_REPRESENTATIVE, 10, 9],
          ],
          'circle-color': [
            'match', ['get', 'riskLevel'],
            0, RISK_COLORS[0], 1, RISK_COLORS[1], 2, RISK_COLORS[2], RISK_COLORS[0],
          ],
          // Representative points (one marker standing in for a whole island at
          // low zoom -- see selectRepresentativePoints in riskDataService.js)
          // get a thicker stroke than individually-clickable detailed points,
          // so the two strategies read as visually distinct rather than only
          // differing in how many markers happen to be on screen. No zoom
          // dependence here, so a plain 'case' (unlike circle-radius above) is fine.
          'circle-stroke-width': [
            'case',
            RISK_IS_SELECTED, 3,
            RISK_IS_REPRESENTATIVE, 2.5,
            1.5,
          ],
          'circle-stroke-color': [
            'case',
            RISK_IS_SELECTED, RISK_SELECTED_STROKE,
            '#ffffff',
          ],
          'circle-opacity': 0.75,
        },
      });

      // Island name labels — rendered on top of the wave overlay (interleaved deck.gl)
      map.addSource(ISLAND_LABELS_SOURCE, { type: 'geojson', data: ISLAND_LABEL_FEATURES });
      map.addLayer({
        id: ISLAND_LABELS_LAYER,
        type: 'symbol',
        source: ISLAND_LABELS_SOURCE,
        minzoom: 5,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 9, 8, 12, 12, 15],
          'text-anchor': 'bottom',
          'text-offset': [0, -0.3],
          'text-allow-overlap': false,
          'text-ignore-placement': false,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0, 15, 35, 0.85)',
          'text-halo-width': 2,
          'text-opacity': 0.92,
        },
      });

      // Route draft/forecast layers -- always present (not tied to the
      // selected wave layer, unlike the suitability overlay's own sources),
      // since a route can be drawn regardless of which forecast layer is
      // currently displayed underneath it.
      map.addSource(COK_ROUTE_DRAFT_SOURCE, { type: 'geojson', data: emptyFeatureCollection() });
      map.addSource(COK_ROUTE_SEGMENTS_SOURCE, { type: 'geojson', data: emptyFeatureCollection() });
      map.addLayer({
        id: COK_ROUTE_SEGMENTS_LAYER,
        type: 'line',
        source: COK_ROUTE_SEGMENTS_SOURCE,
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 12, 6, 14, 8],
          'line-color': [
            'match', ['get', 'hazardClass'],
            0, HAZARD_COLORS[0], 1, HAZARD_COLORS[1], 2, HAZARD_COLORS[2], '#94a3b8',
          ],
          'line-opacity': 0.92,
        },
      });
      map.addLayer({
        id: COK_ROUTE_DRAFT_LAYER,
        type: 'line',
        source: COK_ROUTE_DRAFT_SOURCE,
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 12, 4, 14, 5],
          'line-color': '#e0f2fe',
          'line-dasharray': [2, 1.2],
          'line-opacity': 0.9,
        },
      });

      // RiskScape impact assets (buildings/roads/points) -- inserted below
      // risk-circles (which already exists at this point in onLoad) so the
      // coastal-risk markers stay on top and clickable rather than getting
      // buried under building fills.
      const impactAssetsBeforeId = map.getLayer(RISK_CIRCLES_LAYER) ? RISK_CIRCLES_LAYER : undefined;
      const impactSectorColorExpr = buildImpactSectorColorExpression();
      const IMPACT_ASSET_SELECTED = ['boolean', ['feature-state', 'selected'], false];
      // generateId: true so setFeatureState()-based selection (see
      // flyToImpactAsset below) has a stable id per feature to key off of --
      // the GeoJSON itself has none, and feature-state is keyed by
      // source+id, not tied to a particular setData() snapshot.
      map.addSource(COK_IMPACT_ASSETS_SOURCE, { type: 'geojson', data: emptyFeatureCollection(), generateId: true });
      // 'Polygon' OR 'MultiPolygon' -- ['geometry-type'] returns the literal
      // GeoJSON type string, it does NOT fold Multi* into its singular form.
      // A plain ['==', ..., 'Polygon'] silently dropped every MultiPolygon
      // feature from all three impact-asset layers (fill here, and the
      // scenario-filter effect below repeats this same filter) -- checked
      // live against a real cycle's block01: 29 of 265 features (mostly
      // larger building footprints RiskScape represents as multi-part
      // polygons) never rendered anywhere, not hidden by opacity/color like
      // the line/circle contrast issue above, just never selected at all.
      const IMPACT_POLYGON_FILTER = ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']];
      map.addLayer({
        id: COK_IMPACT_ASSETS_FILL_LAYER,
        type: 'fill',
        source: COK_IMPACT_ASSETS_SOURCE,
        filter: IMPACT_POLYGON_FILTER,
        layout: { visibility: 'none' },
        paint: {
          'fill-color': impactSectorColorExpr,
          'fill-opacity': COK_IMPACT_LOSS_RATIO_OPACITY,
          'fill-outline-color': ['case', IMPACT_ASSET_SELECTED, '#38bdf8', 'rgba(15, 23, 42, 0.55)'],
        },
      }, impactAssetsBeforeId);
      const IMPACT_LINE_WIDTH = [
        'interpolate', ['linear'], ['zoom'],
        10, ['case', IMPACT_ASSET_SELECTED, 5, 2],
        14, ['case', IMPACT_ASSET_SELECTED, 9, 5],
      ];
      // Dark casing under the colored road line -- see
      // COK_IMPACT_ASSETS_LINE_HALO_LAYER's own comment above for why this
      // exists (roads crossing the inundation raster were losing all
      // contrast against it). Wider than the line it sits under and at a
      // flat, high opacity regardless of severity/selection -- its only job
      // is to guarantee an edge exists, not to carry any of its own signal.
      map.addLayer({
        id: COK_IMPACT_ASSETS_LINE_HALO_LAYER,
        type: 'line',
        source: COK_IMPACT_ASSETS_SOURCE,
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#0f172a',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 9],
          'line-opacity': 0.85,
        },
      }, impactAssetsBeforeId);
      map.addLayer({
        id: COK_IMPACT_ASSETS_LINE_LAYER,
        type: 'line',
        source: COK_IMPACT_ASSETS_SOURCE,
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { visibility: 'none' },
        paint: {
          // Roads colored by flood severity (lossRatio), not sector, unlike
          // the fill/circle layers below -- a road's economic "sector" isn't
          // the useful signal for evacuation-route planning, how badly it's
          // flooded is. Reuses the same 3-tier teal/amber/red scale as
          // HAZARD_COLORS/vessel suitability elsewhere in the app rather
          // than inventing a new palette for the same concept.
          'line-color': [
            'interpolate', ['linear'], ['get', 'lossRatio'],
            0, HAZARD_COLORS[0], 0.35, HAZARD_COLORS[1], 0.65, HAZARD_COLORS[2],
          ],
          // One top-level interpolate-by-zoom whose *stop values* are
          // data-driven 'case' expressions -- not a 'case' wrapping two
          // separate top-level interpolates (that shape fails addLayer()'s
          // validator with "Only one zoom-based step/interpolate
          // subexpression may be used", which silently aborted the rest of
          // this onLoad() closure -- confirmed live. Same fix, same root
          // cause the RISK_CIRCLES_LAYER 'circle-radius' comment above
          // already documents; missed applying it here the first time.
          'line-width': IMPACT_LINE_WIDTH,
          // Flat, not lossRatio-driven -- color already carries severity (see
          // above); tying opacity to the same value too made a "Low" road's
          // already-similar-hued teal fade toward transparent, which is what
          // made it disappear against the raster even with the halo. Fill/
          // circle already only vary color by category, not severity, so
          // this brings the line layer's opacity policy in line with them.
          'line-opacity': 0.95,
        },
      }, impactAssetsBeforeId);
      map.addLayer({
        id: COK_IMPACT_ASSETS_CIRCLE_LAYER,
        type: 'circle',
        source: COK_IMPACT_ASSETS_SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            10, ['case', IMPACT_ASSET_SELECTED, 7, 4],
            14, ['case', IMPACT_ASSET_SELECTED, 12, 8],
          ],
          'circle-color': impactSectorColorExpr,
          // Flat, not lossRatio-driven -- same reasoning as the line layer's
          // own opacity above; a small marker faded toward 0.45 opacity was
          // easy to lose entirely against busy satellite imagery.
          'circle-opacity': 0.9,
          'circle-stroke-width': ['case', IMPACT_ASSET_SELECTED, 3, 1.5],
          'circle-stroke-color': ['case', IMPACT_ASSET_SELECTED, '#38bdf8', '#ffffff'],
        },
      }, impactAssetsBeforeId);

      map.on('click', RISK_CIRCLES_LAYER, onRiskClick);
      map.on('mouseenter', RISK_CIRCLES_LAYER, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mousemove', RISK_CIRCLES_LAYER, onRiskHover);
      map.on('mouseleave', RISK_CIRCLES_LAYER, () => {
        map.getCanvas().style.cursor = '';
        riskHoverPopupRef.current?.remove();
      });
      for (const layerId of COK_IMPACT_ASSETS_LAYERS) {
        map.on('click', layerId, onImpactAssetClick);
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
      }
      map.on('click', COK_SUITABILITY_CIRCLES_LAYER, onSuitabilityClick);
      map.on('mouseenter', COK_SUITABILITY_CIRCLES_LAYER, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', COK_SUITABILITY_CIRCLES_LAYER, () => { map.getCanvas().style.cursor = ''; });
      map.on('click', COK_ADVISORY_LOCATIONS_LAYER, onAdvisoryLocationClick);
      map.on('mouseenter', COK_ADVISORY_LOCATIONS_LAYER, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mousemove', COK_ADVISORY_LOCATIONS_LAYER, onAdvisoryLocationHover);
      map.on('mouseleave', COK_ADVISORY_LOCATIONS_LAYER, () => {
        map.getCanvas().style.cursor = '';
        advisoryHoverPopupRef.current?.remove();
      });
      map.on('moveend', doRefreshRisk);
      map.on('zoomend', doRefreshRisk);
      doRefreshRisk();
    };

    // 'load' waits for the initial viewport's tiles across ALL sources to finish
    // fetching (now 4 raster sources instead of 1, so measurably slower) — but
    // adding a layer only needs the style itself to be parsed, which is ready
    // much earlier. Waiting on 'load' let UgridOverlay's first render (which
    // targets beforeId: 'risk-circles') fire before this layer existed, sending
    // deck.gl's MapboxOverlay into a permanently-stuck add/move failure loop.
    if (map.isStyleLoaded()) onLoad(); else map.once('style.load', onLoad);

    map.on('click', onMapClick);

    return () => {
      map.off('click', onMapClick);
      advisoryHoverPopupRef.current?.remove();
      map.remove();
      mapInstance.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── overlay lifecycle ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    const layerCfg = findLayerById(selectedLayerId);
    if (!layerCfg) return;

    const prev = overlayRef.current;
    if (prev) {
      // Null callbacks BEFORE destroy so any in-flight async work on the old
      // overlay cannot race against the new overlay's loading state.
      prev.onLoadingChange = null;
      prev.onTimeChange = null;
      prev.onErrorChange = null;
      prev.onStatsChange = null;
      prev.destroy();
      overlayRef.current = null;
    }

    // Reset loading so a stale true from the previous layer doesn't bleed through.
    setLoading(false);
    setSliderIndex(0);
    // Don't reset timeCount to 1 here (same reasoning as leaving timeLabels alone
    // below): the playback interval's stop condition is `nextIndex >= timeCount`,
    // and metadata loads are routinely slower than playSpeedMs. A transient
    // timeCount of 1 made that check fire on the interval's very first tick
    // after almost every layer switch made mid-playback, silently stopping
    // animation before the new overlay's real timeCount ever arrived. Keep the
    // previous layer's timeCount as a harmless upper bound until the new
    // overlay's onTimeChange replaces it with the real value.
    //
    // Don't clear timeLabels here — keep previous layer's labels so currentSliderDate
    // is never null during the metadata load window. They'll be replaced as soon as
    // the new overlay fires onTimeChange and the [timeCount] effect runs.
    setOverlayStats(null);
    setError(null);

    // Construction is deferred one frame past prev.destroy(). UgridOverlay (and
    // SfincsColumnOverlay, constructed by a sibling effect below) both use deck.gl's
    // *interleaved* MapboxOverlay, which shares ONE Deck instance per map, cached on
    // map.__deck (see @deck.gl/mapbox/deck-utils.js getDeckInstance/removeDeckInstance).
    // Removing an interleaved overlay unconditionally finalizes and nulls that shared
    // instance, even if a sibling interleaved overlay is still relying on it — and
    // MapboxOverlay's own layer sync (resolveLayers) runs synchronously off whatever
    // that reference currently is. Giving the previous overlay's teardown a full
    // render frame before the next one starts inserting layers (with beforeId:
    // 'risk-circles') avoids that hazard; this is the source of the intermittent
    // "cannot add/move layer" MapLibre console errors seen when switching wave
    // variable/island. (Traced from source, not live-verified — see conversation notes.)
    let cancelled = false;
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      const ov = layerCfg.type === 'ugrid'
        ? new UgridOverlay(map, { ...layerCfg, opacity, autoFitState: autoFitStateRef.current })
        : layerCfg.sourceType === 'sfincs-raster'
        ? new SfincsRasterOverlay(map, {
            ...layerCfg,
            opacity,
            inundationCategories: cbRef.current.inundationCategories,
            minVisibleDepth: cbRef.current.minVisibleDepth,
            inundationRenderMode: cbRef.current.inundationRenderMode,
          })
        : layerCfg.sourceType === 'cok-suitability'
        ? new CookIslandsSuitabilityController(map, {
            ...layerCfg,
            opacity,
            vesselClass: cbRef.current.vesselClass,
            suitabilityMode: cbRef.current.suitabilityMode,
            customEnvelope: cbRef.current.customEnvelope,
          })
        : new ZarrOverlay(map, {
            ...layerCfg,
            opacity,
            thresholds,
            skipAutoFit: Boolean(initialMapView),
          });

      ov.onTimeChange = (_label, _idx, maxIdx) => setTimeCount(maxIdx + 1);
      ov.onLoadingChange = setLoading;
      ov.onErrorChange = setError;
      ov.onStatsChange = (min, max, units, extra = {}) => {
        setOverlayStats({
          min,
          max,
          units,
          colorMin: extra.colorMin ?? min,
          colorMax: extra.colorMax ?? max,
          variable: extra.variable ?? layerCfg.variable,
          layerId: layerCfg.value,
        });
      };
      overlayRef.current = ov;
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      const current = overlayRef.current;
      if (current) {
        current.onLoadingChange = null;
        current.onTimeChange = null;
        current.onErrorChange = null;
        current.onStatsChange = null;
        current.destroy();
        overlayRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayerId]);

  // Auto-dismiss transient layer errors (e.g. S3 503 throttle) after 8 s.
  // The user can switch layers to clear immediately; this handles the case
  // where they stay on the same layer after a transient blip.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(t);
  }, [error]);

  // Grab time labels from either overlay type once they're loaded (after timeCount updates)
  useEffect(() => {
    const ov = overlayRef.current;
    if (ov && typeof ov.getTimeLabels === 'function') {
      const labels = ov.getTimeLabels();
      if (labels.length > 0) {
        setTimeLabels(labels);
        // cbRef.current.selectedLayerId (not the selectedLayerId this effect
        // would otherwise close over) so a layer switch that lands between
        // renders still tags these labels with whichever layer was actually
        // selected at the moment getTimeLabels() ran.
        setTimeLabelsLayerId(cbRef.current.selectedLayerId);
      }
    }
  }, [timeCount]);

  // ── slider → overlay ──────────────────────────────────────────────────────
  useEffect(() => {
    overlayRef.current?.setTimeIndex(sliderIndex);
    columnOverlayRef.current?.setTimeIndex(sliderIndex);
  }, [sliderIndex]);

  // ── opacity ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const ov = overlayRef.current;
    if (ov && typeof ov.setOpacity === 'function') ov.setOpacity(opacity);
    columnOverlayRef.current?.setOpacity(opacity);
  }, [opacity]);

  // ── thresholds (ZarrOverlay / UgridOverlay) ───────────────────────────────
  useEffect(() => {
    const ov = overlayRef.current;
    if (ov && typeof ov.setThresholds === 'function') ov.setThresholds(thresholds);
  }, [thresholds]);

  // ── vessel class (CookIslandsSuitabilityController) ───────────────────────
  useEffect(() => {
    const ov = overlayRef.current;
    if (ov && typeof ov.setVesselClass === 'function') ov.setVesselClass(vesselClass);
  }, [vesselClass]);

  // ── suitability Preset/Custom mode + custom envelope ──────────────────────
  // customEnvelope is the effective envelope object (vessel preset merged
  // with any user overrides) once Custom mode has been enabled at least
  // once -- null/undefined before that, in which case setEnvelope just gets
  // {} and CookIslandsSuitabilityDynamicOverlay falls back to the vessel's
  // own preset, so Custom mode always starts identical to Preset until the
  // user actually moves a slider.
  useEffect(() => {
    const ov = overlayRef.current;
    if (!ov || typeof ov.setMode !== 'function') return;
    ov.setMode(suitabilityMode);
    ov.setEnvelope(vesselClass, suitabilityMode === 'custom' ? (customEnvelope || {}) : {});
  }, [vesselClass, suitabilityMode, customEnvelope]);

  // ── route pick-mode cursor ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (map) map.getCanvas().style.cursor = routePickMode ? 'crosshair' : '';
  }, [routePickMode]);

  // ── route draft / forecast rendering ──────────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    const draftSource = map.getSource(COK_ROUTE_DRAFT_SOURCE);
    const segmentSource = map.getSource(COK_ROUTE_SEGMENTS_SOURCE);
    if (!draftSource || !segmentSource) return; // route layers not added yet (style still loading)

    draftSource.setData(routePointsToLineFeature(routePoints));
    segmentSource.setData({ type: 'FeatureCollection', features: routeSamplesToSegmentFeatures(routeForecastResult) });

    routeWaypointMarkersRef.current.forEach((marker) => marker.remove());
    routeWaypointMarkersRef.current = [];
    routeLegLabelMarkersRef.current.forEach((marker) => marker.remove());
    routeLegLabelMarkersRef.current = [];

    const validPoints = routePoints.filter((p) => Number.isFinite(p?.lon) && Number.isFinite(p?.lat));

    validPoints.forEach((point, index) => {
      const kind = index === 0 ? 'origin' : index === validPoints.length - 1 ? 'destination' : 'waypoint';
      const el = document.createElement('div');
      el.textContent = String(index + 1);
      el.style.cssText = `
        width: 22px; height: 22px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font: 700 11px system-ui, sans-serif; color: #fff;
        background: ${COK_ROUTE_WAYPOINT_COLORS[kind]};
        border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.45);
      `;
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([point.lon, point.lat])
        .addTo(map);
      routeWaypointMarkersRef.current.push(marker);
    });

    // Per-leg distance labels at each segment's midpoint, computed
    // client-side from the raw waypoints so labels appear immediately while
    // drawing, before a forecast has actually been run.
    for (let i = 0; i < validPoints.length - 1; i += 1) {
      const a = validPoints[i];
      const b = validPoints[i + 1];
      const nm = haversineNm(a, b);
      const midLon = (a.lon + b.lon) / 2;
      const midLat = (a.lat + b.lat) / 2;
      const el = document.createElement('div');
      el.textContent = `${nm.toFixed(1)} nm`;
      el.style.cssText = `
        padding: 2px 6px; border-radius: 4px;
        font: 700 10px system-ui, sans-serif; color: #f8fafc;
        background: rgba(15, 23, 42, 0.78); border: 1px solid rgba(255,255,255,0.25);
        white-space: nowrap; pointer-events: none;
      `;
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([midLon, midLat])
        .addTo(map);
      routeLegLabelMarkersRef.current.push(marker);
    }
  }, [routePoints, routeForecastResult]);

  // ── RiskScape impact assets (data / visibility / scenario filter) ────────
  // Three independent effects rather than one, matching how opacity/
  // thresholds/vesselClass above are each their own effect -- Home.jsx
  // updates these three props on different triggers (data once per tab
  // visit, visibility on every tab switch, scenario on every window chip
  // click), and there's no reason a scenario-only change should redo the
  // (larger) setData call or vice versa.
  useEffect(() => {
    const map = mapInstance.current;
    const src = map?.getSource(COK_IMPACT_ASSETS_SOURCE);
    if (!src) return; // layers not added yet (style still loading)
    src.setData(impactAssetsGeojson && Array.isArray(impactAssetsGeojson.features)
      ? impactAssetsGeojson
      : emptyFeatureCollection());
  }, [impactAssetsGeojson]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    const visibility = impactAssetsVisible ? 'visible' : 'none';
    for (const layerId of COK_IMPACT_ASSETS_LAYERS) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visibility);
    }
  }, [impactAssetsVisible]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    // null/undefined scenario (data still loading, or fetched with no
    // ?scenario= filter) shows every window's assets overlaid rather than
    // hiding the layer outright -- a reasonable default, and avoids a
    // flash-to-empty between "assets fetched" and "which window is selected"
    // landing on the same render.
    const scenarioFilter = impactAssetsScenario ? ['==', ['get', 'scenario'], impactAssetsScenario] : true;
    // Values are arrays, not single strings -- ['geometry-type'] returns the
    // literal GeoJSON type, never folding e.g. MultiPolygon into 'Polygon',
    // so the fill layer needs both listed or every multi-part building
    // footprint gets excluded here on every window change even after the
    // initial addLayer filter above was fixed to include it.
    const geomFilters = {
      [COK_IMPACT_ASSETS_FILL_LAYER]: ['Polygon', 'MultiPolygon'],
      [COK_IMPACT_ASSETS_LINE_HALO_LAYER]: ['LineString'],
      [COK_IMPACT_ASSETS_LINE_LAYER]: ['LineString'],
      [COK_IMPACT_ASSETS_CIRCLE_LAYER]: ['Point'],
    };
    for (const [layerId, geomTypes] of Object.entries(geomFilters)) {
      if (map.getLayer(layerId)) {
        const geomFilter = geomTypes.length === 1
          ? ['==', ['geometry-type'], geomTypes[0]]
          : ['any', ...geomTypes.map((t) => ['==', ['geometry-type'], t])];
        map.setFilter(layerId, ['all', geomFilter, scenarioFilter]);
      }
    }
  }, [impactAssetsScenario]);

  // ── sfincs config (rangeWindow / inundationCategories / minVisibleDepth) ──
  useEffect(() => {
    const ov = overlayRef.current;
    if (ov instanceof SfincsRasterOverlay) {
      ov.updateConfig({ rangeWindow, inundationCategories, minVisibleDepth, inundationRenderMode });
    }
  }, [rangeWindow, inundationCategories, minVisibleDepth, inundationRenderMode]);

  // ── optional MapLibre terrain ────────────────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    // Wave/SWAN layers render as a flat, sea-level deck.gl UGRID mesh (see
    // UgridOverlay.js) — even interleaved with MapLibre's WebGL context, the
    // mesh geometry itself has no elevation, so wherever the wave domain
    // overlaps the coastline it visually disagrees with 3D land terrain
    // (jagged cutouts, broken-looking colors at the shoreline). Terrain was
    // built for the inundation raster path; force it off for UGRID layers
    // regardless of the user's terrain toggle, and let the toggle resume
    // control as soon as they switch back to a non-UGRID layer.
    const isUgridLayer = findLayerById(selectedLayerId)?.type === 'ugrid';

    if (isUgridLayer || !terrainEnabled || !hasTerrainDem(terrainConfig)) {
      disableTerrain(map, terrainConfig || {});
      if (map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 350 });
      // Drop flood columns back to sea-level positioning now that terrain is off.
      columnOverlayRef.current?.refreshTerrainAlignment();
      return;
    }

    const applyTerrain = () => {
      // Insert hillshade before risk-circles so it sits below overlay layers
      const enabled = enableTerrain(map, terrainConfig, 'risk-circles');
      if (enabled) {
        map.easeTo({ pitch: 58, bearing: -15, duration: 800 });
        // DEM tiles for the current view may still be loading; re-anchor columns
        // immediately with whatever's cached, then again once tiles settle.
        columnOverlayRef.current?.refreshTerrainAlignment();
        map.once('idle', () => columnOverlayRef.current?.refreshTerrainAlignment());
      }
    };

    if (map.loaded()) applyTerrain();
    else map.once('load', applyTerrain);

    // Remove the once() listener if this effect re-runs before the map loads
    return () => map.off('load', applyTerrain);
  }, [terrainEnabled, terrainConfig, selectedLayerId]);

  // ── 3D flood column overlay ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    const layerCfg = findLayerById(selectedLayerId);
    const isSfincs = layerCfg?.sourceType === 'sfincs-raster';

    // Destroy any existing column overlay first
    if (columnOverlayRef.current) {
      columnOverlayRef.current.destroy();
      columnOverlayRef.current = null;
    }

    if (!flood3dEnabled || !isSfincs || !map) return;

    // Deferred one frame past the destroy above for the same reason as the main
    // overlay-lifecycle effect: this is also an interleaved deck.gl MapboxOverlay
    // sharing the map's single cached Deck instance (map.__deck) with UgridOverlay.
    let cancelled = false;
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      // Read latest values from cbRef to avoid stale closure when 3D is toggled off/on
      const { opacity: latestOpacity, flood3dElevScale: latestElevScale, inundationCategories: latestCats } = cbRef.current;
      const col = new SfincsColumnOverlay(map, {
        apiBase: layerCfg.apiBase,
        colorRange: layerCfg.colorRange,
        opacity: latestOpacity,
        inundationCategories: latestCats,
        flood3dConfig: {
          ...(flood3dConfig ?? {}),
          elevationScale: latestElevScale ?? flood3dConfig?.elevationScale ?? 6,
        },
        // Insert columns below labels so map text remains readable
        beforeLayerId: map.getLayer(ISLAND_LABELS_LAYER) ? ISLAND_LABELS_LAYER : null,
      });
      col.onLoadingChange = setLoading;
      col.onErrorChange = setError;
      columnOverlayRef.current = col;
      col.setTimeIndex(sliderIndex);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (columnOverlayRef.current) {
        columnOverlayRef.current.destroy();
        columnOverlayRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flood3dEnabled, selectedLayerId]);

  // ── column overlay: sync categories ──────────────────────────────────────
  useEffect(() => {
    columnOverlayRef.current?.updateConfig({ inundationCategories });
  }, [inundationCategories]);

  // ── column overlay: sync elevation scale ─────────────────────────────────
  useEffect(() => {
    if (flood3dElevScale != null) {
      columnOverlayRef.current?.setElevationScale(flood3dElevScale);
    }
  }, [flood3dElevScale]);

  // ── playback ──────────────────────────────────────────────────────────────
  // Load-aware instead of a fixed setInterval: a frame stays on screen for at
  // least playSpeedMs (so fast-loading layers don't flash by faster than
  // intended), but won't advance to the next one until the current overlay's
  // load actually finishes -- checked via cbRef.current.loading, which is
  // written synchronously every render (see cbRef.current assignment above)
  // so this reads the live value instead of the stale one a plain setInterval
  // closure would have captured. Layers whose per-frame fetch (e.g. Cook
  // Islands vessel suitability's wider-domain raster tiles) routinely takes
  // longer than a single playSpeedMs interval used to fall behind silently,
  // with frames rendering late while the slider had already moved on --
  // visible stutter with no actual cause visible in any one component.
  // MAX_FRAME_WAIT_MS bounds this: a load that's hung or erroring shouldn't
  // freeze playback indefinitely, so a frame gives up waiting and advances
  // anyway past that ceiling.
  useEffect(() => {
    if (playIntervalRef.current) { clearTimeout(playIntervalRef.current); playIntervalRef.current = null; }
    if (!isPlaying) return;

    let cancelled = false;
    const MIN_FRAME_MS = playSpeedMs;
    const MAX_FRAME_WAIT_MS = Math.max(playSpeedMs * 4, 4000);
    const POLL_MS = 50;

    const advance = () => {
      setSliderIndex((prev) => {
        const next = prev + 1;
        if (next >= timeCount) { setIsPlaying(false); return prev; }
        return next;
      });
    };

    const scheduleFrame = () => {
      if (cancelled) return;
      const frameStart = Date.now();
      const tick = () => {
        if (cancelled) return;
        const elapsed = Date.now() - frameStart;
        const readyToAdvance = elapsed >= MIN_FRAME_MS
          && (!cbRef.current.loading || elapsed >= MAX_FRAME_WAIT_MS);
        if (readyToAdvance) {
          advance();
          playIntervalRef.current = setTimeout(scheduleFrame, 0);
          return;
        }
        playIntervalRef.current = setTimeout(tick, POLL_MS);
      };
      playIntervalRef.current = setTimeout(tick, MIN_FRAME_MS);
    };

    scheduleFrame();
    return () => { cancelled = true; if (playIntervalRef.current) clearTimeout(playIntervalRef.current); };
  }, [isPlaying, timeCount, setSliderIndex, setIsPlaying, playSpeedMs]);

  // ── risk points ───────────────────────────────────────────────────────────
  function riskPointsToFeatureCollection(pts) {
    return {
      type: 'FeatureCollection',
      features: pts
        .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon))
        .map((p) => ({
          type: 'Feature',
          // Top-level feature id (not just a `properties.id`) is required for
          // map.setFeatureState()/['feature-state', ...] paint expressions --
          // that's how the selected-marker highlight below survives a setData()
          // refresh (feature-state is keyed by source+id, not tied to one
          // particular data snapshot, as long as ids stay stable across refetches).
          id: p.id,
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          properties: { id: p.id, riskLevel: getEffectiveRiskLevel(p), maxTWL: p.maxTWL ?? null, type: p.type ?? '', island: p.island ?? '' },
        })),
    };
  }

  // Moves the gold selection ring from whichever point had it to `id` (or just
  // clears it if `id` is null). Feature-state, not a property in the GeoJSON
  // itself, so re-fetching/re-coloring markers elsewhere never has to know
  // about selection.
  function setSelectedRiskPoint(id) {
    const map = mapInstance.current;
    if (!map) return;
    const prevId = selectedRiskIdRef.current;
    if (prevId != null && prevId !== id) {
      map.setFeatureState({ source: RISK_SOURCE, id: prevId }, { selected: false });
    }
    if (id != null) {
      map.setFeatureState({ source: RISK_SOURCE, id }, { selected: true });
    }
    selectedRiskIdRef.current = id;
  }

  // Cheap centroid, not a true geometric one -- fine for flyTo/highlight
  // purposes on the small building/road/point footprints these features
  // actually have (a real polygon centroid library would be overkill here).
  function impactAssetCenter(geometry) {
    if (!geometry) return null;
    const { type, coordinates } = geometry;
    if (type === 'Point') return coordinates;
    const ring = type === 'LineString' ? coordinates
      : type === 'Polygon' ? coordinates[0]
      : type === 'MultiPolygon' ? coordinates[0]?.[0]
      : null;
    if (!Array.isArray(ring) || ring.length === 0) return null;
    const [sumLon, sumLat] = ring.reduce(([lon, lat], [x, y]) => [lon + x, lat + y], [0, 0]);
    return [sumLon / ring.length, sumLat / ring.length];
  }

  // Selecting a building/road/point from the impact-assets category list
  // (CookIslandsImpactPanel's accordion) flies the map to it and gives it
  // the same feature-state selection ring risk-circles use, via
  // IMPACT_ASSET_SELECTED in the layer paint above -- mirrors
  // setSelectedRiskPoint below, just for the impact-assets source instead
  // of risk points.
  function flyToImpactAsset(feature) {
    const map = mapInstance.current;
    if (!map || !feature) return;
    const prevId = selectedImpactAssetIdRef.current;
    if (prevId != null && prevId !== feature.id) {
      map.setFeatureState({ source: COK_IMPACT_ASSETS_SOURCE, id: prevId }, { selected: false });
    }
    if (feature.id != null) {
      map.setFeatureState({ source: COK_IMPACT_ASSETS_SOURCE, id: feature.id }, { selected: true });
    }
    selectedImpactAssetIdRef.current = feature.id ?? null;
    const center = impactAssetCenter(feature.geometry);
    if (center) map.flyTo({ center, zoom: Math.max(map.getZoom(), 17) });
  }

  function doRefreshRisk() {
    const map = mapInstance.current;
    if (!map) return;
    const reqId = ++riskLatestReqRef.current;
    const bnds = map.getBounds();
    const bbox = [bnds.getWest(), bnds.getSouth(), bnds.getEast(), bnds.getNorth()].join(',');
    const zoom = map.getZoom();
    fetchRiskPointsData({ zoom, bbox })
      .then((payload) => {
        if (riskLatestReqRef.current !== reqId) return;
        const pts = Array.isArray(payload?.points) ? payload.points : [];
        riskPointsRef.current = pts;
        const src = map.getSource?.(RISK_SOURCE);
        if (!src) return;
        src.setData(riskPointsToFeatureCollection(pts));
      })
      .catch((err) => console.error('Risk points fetch failed:', err));
  }

  // Re-colors markers from the already-fetched point list — no network round trip.
  // Used after a per-point threshold edit is saved (locally) in RiskDetailsPanel,
  // so the marker's color picks up the new override immediately instead of waiting
  // for the next moveend/zoomend refetch.
  function refreshRiskMarkerColors() {
    const map = mapInstance.current;
    if (!map) return;
    const src = map.getSource?.(RISK_SOURCE);
    if (!src) return;
    src.setData(riskPointsToFeatureCollection(riskPointsRef.current));
  }

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    if (!riskEnabled) {
      const src = map.getSource?.(RISK_SOURCE);
      if (src) src.setData({ type: 'FeatureCollection', features: [] });
      riskHoverPopupRef.current?.remove();
      selectedRiskIdRef.current = null;
      return;
    }
    if (map.loaded()) doRefreshRisk(); else map.once('load', doRefreshRisk);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskEnabled]);

  // Server-saved threshold overrides load asynchronously (separate request from the
  // points fetch above) — once they land, re-color markers already on the map so a
  // returning user sees their previously-saved thresholds without needing a pan/zoom.
  useEffect(() => {
    let cancelled = false;
    ensureRiskThresholdOverridesLoaded().then(() => {
      if (!cancelled) refreshRiskMarkerColors();
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── event handlers (stable refs, read latest values via cbRef) ────────────
  function onRiskClick(e) {
    const feature = e.features?.[0];
    if (!feature) return;
    const { id, riskLevel, maxTWL, type: pType, island } = feature.properties;
    const point = { id, riskLevel, maxTWL, type: pType, island, lat: e.lngLat.lat, lon: e.lngLat.lng };
    removePinMarker();
    setSelectedRiskPoint(id);

    // Two clicks in quick succession fire two independent fetches; without a
    // request-id guard, whichever one happens to resolve *last* wins the
    // panel, not whichever was clicked last — a slow first request can land
    // after a fast second one and silently replace the panel the user is now
    // looking at with the previous point's (stale) details. Re-used by the
    // panel's own retry action below, so a manual retry participates in the
    // same guard as a real re-click.
    const loadDetails = () => {
      const reqId = ++riskDetailsReqRef.current;
      cbRef.current.setBottomCanvasData({ mode: 'risk', point, status: 'loading' });
      cbRef.current.setShowBottomCanvas(true);
      fetchRiskDetails(id)
        .then((details) => {
          if (riskDetailsReqRef.current !== reqId) return;
          cbRef.current.setBottomCanvasData({ mode: 'risk', point, details, status: 'success' });
          cbRef.current.setShowBottomCanvas(true);
        })
        .catch((err) => {
          if (riskDetailsReqRef.current !== reqId) return;
          console.error('[useZarrMap] Risk point details fetch failed:', err);
          cbRef.current.setBottomCanvasData({ mode: 'risk', point, status: 'error', error: err.message, onRetry: loadDetails });
          cbRef.current.setShowBottomCanvas(true);
        });
    };

    loadDetails();
  }

  // Lightweight hover tooltip -- separate from onRiskClick's full detail fetch
  // (no network round trip; everything shown is already on the point's GeoJSON
  // properties) so a user can scan risk levels across many points before
  // committing to a click.
  function onRiskHover(e) {
    const map = mapInstance.current;
    const feature = e.features?.[0];
    if (!map || !feature) return;
    const { riskLevel, maxTWL, island, type: pType } = feature.properties;
    if (!riskHoverPopupRef.current) {
      riskHoverPopupRef.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 12,
        className: 'risk-hover-popup',
      });
    }
    const label = RISK_LABELS[riskLevel] ?? RISK_LABELS[0];
    const color = RISK_COLORS[riskLevel] ?? RISK_COLORS[0];
    const twlText = Number.isFinite(Number(maxTWL)) ? `${Number(maxTWL).toFixed(2)} m` : 'N/A';
    const html = `
      <div style="font:600 12px/1.4 system-ui, sans-serif; color:#0f172a;">
        ${island ? `<div style="font-weight:700;">${island}</div>` : ''}
        <div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:5px;"></span>${label}</div>
        <div style="font-weight:400;opacity:0.75;">Forecast max TWL: ${twlText}</div>
        ${pType === 'representative' ? '<div style="font-weight:400;opacity:0.65;font-style:italic;">Representative point &mdash; zoom in for detail</div>' : ''}
      </div>`;
    riskHoverPopupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
  }

  // Every field this needs is already on the clicked feature's own GeoJSON
  // properties (step11_marine_suitability.py bakes hazard_class/action_label/
  // etc. in at pipeline time) -- unlike onRiskClick above, no backend
  // round-trip is needed to populate the detail panel.
  function onSuitabilityClick(e) {
    const feature = e.features?.[0];
    if (!feature) return;
    const point = { ...feature.properties, lat: e.lngLat.lat, lon: e.lngLat.lng };
    removePinMarker();
    cbRef.current.setBottomCanvasData({ mode: 'suitability', point });
    cbRef.current.setShowBottomCanvas(true);
  }

  // Named advisory locations carry the same per-feature properties as the
  // plain forereef points, plus name/island/type -- but since the advice
  // endpoint returns all 4 vessel classes per location per timestep (unlike
  // the plain points layer, which this map only ever renders one vessel
  // class of at a time), getAdvisoryGroup() pulls the other 3 readings from
  // the overlay's already-fetched cache so the panel can show a full
  // vessel comparison instead of just the one that happens to be selected.
  function onAdvisoryLocationHover(e) {
    const map = mapInstance.current;
    const feature = e.features?.[0];
    if (!map || !feature) return;
    const { name, type } = feature.properties;
    if (!advisoryHoverPopupRef.current) {
      advisoryHoverPopupRef.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 14,
      });
    }
    const kind = type === 'fishing_ground' ? 'Fishing ground' : 'Landing site / harbour';
    // Explicit dark text: the popup's default white background sits under the
    // dark theme's inherited white text, which made setText() render blank.
    const content = document.createElement('div');
    content.style.cssText = 'font:600 12px/1.4 system-ui, sans-serif; color:#0f172a;';
    content.textContent = `${name || 'Named location'} · ${kind}`;
    advisoryHoverPopupRef.current
      .setLngLat(e.lngLat)
      .setDOMContent(content)
      .addTo(map);
  }

  function onAdvisoryLocationClick(e) {
    const feature = e.features?.[0];
    if (!feature) return;
    const point = { ...feature.properties, lat: e.lngLat.lat, lon: e.lngLat.lng };
    const locationGroup = overlayRef.current?.getAdvisoryGroup?.(point.name) ?? null;
    removePinMarker();
    cbRef.current.setBottomCanvasData({ mode: 'suitability', point, locationGroup });
    cbRef.current.setShowBottomCanvas(true);
  }

  // Click-to-inspect popup (not routed through setBottomCanvasData like
  // onSuitabilityClick/onAdvisoryLocationClick above) -- every field needed
  // is already on the clicked feature's own properties (no backend
  // round-trip), and a single asset's detail is a small enough surface that
  // a dismissible popup at the click point reads better than displacing the
  // whole map with a bottom sheet for what's ultimately a "what is this one
  // building" lookup.
  function onImpactAssetClick(e) {
    const map = mapInstance.current;
    const feature = e.features?.[0];
    if (!map || !feature) return;
    const p = feature.properties || {};
    const sector = p.sector || 'unknown';
    const sectorColor = IMPACT_SECTOR_COLORS[sector] ?? IMPACT_SECTOR_COLORS.unknown;
    const sectorLabel = IMPACT_SECTOR_LABELS[sector] ?? IMPACT_SECTOR_LABELS.unknown;
    const totalLoss = Number(p.totalLoss);
    const originalValue = Number(p.originalValue);
    const lossRatio = Number(p.lossRatio);
    const sizeM2 = Number(p.sizeM2);

    if (!impactAssetPopupRef.current) {
      impactAssetPopupRef.current = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
        offset: 10,
        maxWidth: '260px',
        className: 'impact-asset-popup',
      });
    }
    const html = `
      <div style="font:600 12px/1.5 system-ui, sans-serif; color:#0f172a; min-width:170px;">
        <div style="font-weight:700; margin-bottom:3px;">${p.useType || 'Impact asset'}</div>
        <div style="display:flex; align-items:center; gap:5px; margin-bottom:5px; font-weight:400; opacity:0.8;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${sectorColor}; flex-shrink:0;"></span>
          ${sectorLabel}
        </div>
        <div>Est. economic damage: <b>${fmtUsd(totalLoss)}</b></div>
        <div style="font-weight:400; opacity:0.75;">
          Value: ${fmtUsd(originalValue)}${Number.isFinite(lossRatio) ? ` &middot; ${(lossRatio * 100).toFixed(0)}% economic damage` : ''}
        </div>
        ${Number.isFinite(sizeM2) ? `<div style="font-weight:400; opacity:0.6;">${sizeM2.toFixed(0)} m&sup2;</div>` : ''}
      </div>`;
    impactAssetPopupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
  }

  function onMapClick(e) {
    const map = mapInstance.current;
    if (!map) return;

    // Route pick-mode short-circuits all normal click behavior below --
    // risk points, suitability points, the transient timeseries pin, etc.
    // Defaults to false/undefined everywhere it isn't explicitly enabled,
    // so this is a no-op for every existing flow when the feature is unused.
    const { routePickMode: routeMode, onRoutePointPick: pickRoute } = cbRef.current;
    if (routeMode) {
      pickRoute?.(e.lngLat.lng, e.lngLat.lat);
      return;
    }

    // Skip if clicking a risk point or a vessel-suitability point -- both
    // have their own dedicated click handlers registered above. Unlike
    // RISK_CIRCLES_LAYER (added once at map init, never removed),
    // COK_SUITABILITY_CIRCLES_LAYER only exists while that overlay is the
    // active layer -- queryRenderedFeatures throws if asked about a layer
    // that isn't currently on the map's style, so it's only included here
    // when actually present.
    // COK_IMPACT_ASSETS_LAYERS are always present (like RISK_CIRCLES_LAYER),
    // just usually hidden -- included unconditionally rather than behind a
    // getLayer() guard for that reason, unlike the two below.
    const clickableLayers = [RISK_CIRCLES_LAYER, ...COK_IMPACT_ASSETS_LAYERS];
    if (map.getLayer(COK_SUITABILITY_CIRCLES_LAYER)) clickableLayers.push(COK_SUITABILITY_CIRCLES_LAYER);
    if (map.getLayer(COK_ADVISORY_LOCATIONS_LAYER)) clickableLayers.push(COK_ADVISORY_LOCATIONS_LAYER);
    const feats = map.queryRenderedFeatures(e.point, { layers: clickableLayers });
    if (feats.length > 0) return;

    const ov = overlayRef.current;
    if (!ov?.getTimeseriesAtPoint) return;
    const { setBottomCanvasData: setCB, setShowBottomCanvas: setSC, inundationCategories: cats, rangeWindow: rw, selectedLayerId: currentLayerId } = cbRef.current;
    const layerCfg = findLayerById(currentLayerId);
    if (!layerCfg) return;

    // Vessel suitability has no point timeseries: its overlays resolve
    // getTimeseriesAtPoint() to null, which the generic path below reports as
    // "No data at this location" in the bottom canvas. Preset mode's clickable
    // markers are handled above. Custom mode has no markers, so a click on its
    // canvas opens the same suitability panel for the grid cell under the
    // cursor (null on land/outside the grid, and always null in Preset mode,
    // where a click on bare tiles is not an inspect action).
    if (layerCfg.sourceType === 'cok-suitability') {
      const customPoint = ov.getCustomPointAt?.(e.lngLat.lng, e.lngLat.lat);
      if (customPoint) {
        addPinMarker(e.lngLat.lng, e.lngLat.lat, map);
        setCB({ mode: 'suitability', point: customPoint });
        setSC(true);
      }
      return;
    }

    const { lng, lat } = e.lngLat;
    addPinMarker(lng, lat, map);
    const isInundationLayer = layerCfg.sourceType === 'sfincs-raster' || layerCfg.heightVariable === 'h' || layerCfg.variable === 'h';
    setCB(isInundationLayer
      ? { mode: 'inundation', loading: true, lat, lng, rangeWindow: rw }
      : { loading: true, lat, lng, selectedLayer: layerCfg }
    );
    setSC(true);

    ov.getTimeseriesAtPoint(lng, lat)
      .then((result) => {
        if (!result) {
          setCB(isInundationLayer
            ? { mode: 'inundation', lat, lng, timeseries: null, rangeWindow: rw,
                noData: true }
            : { lat, lng, selectedLayer: layerCfg, error: 'No data at this location' }
          );
          return;
        }
        if (!isInundationLayer) {
          const perVariableData = toCoverageByVariable(result);
          setCB({
            lat: result.lat ?? result.node_lat ?? lat,
            lng: result.lon ?? result.node_lon ?? lng,
            selectedLayer: layerCfg,
            perVariableData,
          });
          return;
        }
        // InundationTimeseries expects [{time: string, depth_m: number}] objects.
        // Reconstruct from the generic {timeLabels, variables[0].values} format.
        const depthVals = result.variables?.[0]?.values ?? [];
        const timeLabels = result.timeLabels ?? [];
        const timeseries = timeLabels.length > 0
          ? timeLabels.map((t, i) => ({
              time: t,
              depth_m: Number.isFinite(depthVals[i]) ? depthVals[i] : 0,
            }))
          : null;
        setCB({
          mode: 'inundation',
          lat: result.lat ?? lat,
          lng: result.lon ?? lng,
          timeseries,
          categories: cats,
          rangeWindow: rw,
        });
      })
      .catch((err) => {
        setCB(isInundationLayer
          ? { mode: 'inundation', lat, lng, timeseries: null, rangeWindow: rw, error: err.message }
          : { lat, lng, selectedLayer: layerCfg, error: err.message }
        );
      });
  }

  function addPinMarker(lng, lat, map) {
    removePinMarker();
    const el = document.createElement('div');
    el.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#ff6b35;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)';
    pinMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
  }

  function removePinMarker() {
    if (pinMarkerRef.current) { pinMarkerRef.current.remove(); pinMarkerRef.current = null; }
  }

  // ── exposed fitBounds (island bounds are [lat,lng], convert for MapLibre) ──
  const fitBounds = useCallback((islandBounds, options = {}) => {
    const map = mapInstance.current;
    if (!map) return;
    const mlBounds = islandBoundsToML(islandBounds);
    if (!mlBounds) return;
    map.fitBounds(mlBounds, { padding: 30, animate: true, ...options });
  }, []);

  // Swaps only the 'sat' source/layer in place (never map.setStyle()) so the
  // Rarotonga ortho overlay and SFINCS/inundation raster overlays — all added
  // outside this style JSON, or layered above 'sat' within it — survive the
  // switch untouched.
  const setBasemap = useCallback((basemapId) => {
    const map = mapInstance.current;
    if (!map) return;
    const option = BASEMAP_OPTIONS.find((b) => b.id === basemapId);
    if (!option) return;

    // addSource/addLayer/removeLayer are safe any time after the map exists —
    // no need to gate on isStyleLoaded(), which also reflects whether raster
    // tile sources have finished loading and can be false during ordinary
    // panning/zooming. Gating on it made this silently no-op: it fell back to
    // map.once('load', ...), but 'load' only ever fires once in a map's
    // lifetime (at initial style load), so that listener would never fire
    // again and the basemap switch would just be dropped.
    if (map.getLayer(BASEMAP_LAYER_ID)) map.removeLayer(BASEMAP_LAYER_ID);
    if (map.getSource(BASEMAP_LAYER_ID)) map.removeSource(BASEMAP_LAYER_ID);
    map.addSource(BASEMAP_LAYER_ID, option.source);
    const firstLayerId = map.getStyle()?.layers?.[0]?.id;
    // raster-fade-duration: 0 — otherwise MapLibre cross-fades the new tiles
    // against the just-destroyed previous source's tiles, and the next render
    // tick throws (parentTile.texture is gone): "Cannot read properties of
    // undefined (reading 'bind')" in draw_raster.
    map.addLayer({ id: BASEMAP_LAYER_ID, type: 'raster', source: BASEMAP_LAYER_ID, paint: { 'raster-fade-duration': 0 } }, firstLayerId);
  }, []);

  // ── capTime compatibility shim for ForecastApp/InundationWindowControl ─────
  // NOTE (performance): zarr chunks fetched from Wasabi hit S3 on every request
  // because the bucket doesn't serve Cache-Control headers. Fix: add
  // "Cache-Control: public, max-age=3600" to the Wasabi bucket policy for the
  // spc-zarr-file bucket — chunks are immutable per model run.
  //
  // Cook Islands suitability's own timeLabels[0] (forecast_start) is not the
  // pipeline cycle's init time -- every cycle's summary carries a fixed
  // 48h hindcast/spin-up window before its own init (verified across 9
  // consecutive cycles' cok_suitability_summary.json: forecast_start is
  // always exactly cycle_init - 48h; see also
  // step11_marine_suitability.py's _load_mesh_fields docstring, which notes
  // wind_and_waves.nc's own time axis already carries this same ~48h of
  // hindcast/spin-up hours that SWAN_UGRID.nc's mesh drops). Treating
  // timeLabels[0] as "now" the way every other layer's modelRunStart does
  // would make this layer's modelRunAgeHours >= 48h and therefore isStale
  // permanently true, even seconds after a fresh cycle publishes.
  const COK_SUITABILITY_HINDCAST_HOURS = 48;
  const availableTimestamps = timeLabels.map(parseTimeLabel).filter(Boolean);
  const modelRunStart = availableTimestamps[0] ?? null;
  const modelRunHindcastHours = timeLabelsLayerId === 'cok-suitability' ? COK_SUITABILITY_HINDCAST_HOURS : 0;
  const modelRunAgeHours = modelRunStart
    ? (Date.now() - modelRunStart.getTime()) / 3_600_000 - modelRunHindcastHours
    : null;
  const capTime = {
    loading,
    availableTimestamps,
    // The selectedLayerId that availableTimestamps actually belongs to — see
    // timeLabelsLayerId's own comment. A consumer that needs "this data is
    // really for the layer I just selected" (not a stale leftover from the
    // previous one) should compare this against selectedLayerId rather than
    // trusting availableTimestamps.length alone.
    layerId: timeLabelsLayerId,
    stepHours: 1,
    warmupSkipped: false,
    warmupDays: 0,
    modelRunStart,
    modelRunAgeHours,
    // True when data is older than 30 h — indicates a missed pipeline run
    isStale: modelRunAgeHours !== null && modelRunAgeHours > 30,
  };

  const currentSliderDate = timeLabels[sliderIndex] ? parseTimeLabel(timeLabels[sliderIndex]) : null;

  return {
    mapRef,         // DOM div ref  → <div ref={mapRef} />
    mapInstance,    // MapLibre map ref → map.fitBounds, etc.
    timeCount,
    timeLabels,
    currentSliderDate,
    capTime,
    loading,
    error,
    overlayStats,
    fitBounds,      // (islandBounds, options) → map.fitBounds with coord conversion
    setBasemap,     // (basemapId) → swap 'sat' raster source/layer in place
    removePinMarker,
    setShowContours: (enabled) => { overlayRef.current?.setShowContours?.(enabled); },
    refreshRiskMarkerColors,
    flyToImpactAsset,
    setVesselClass: (vc) => { overlayRef.current?.setVesselClass?.(vc); },
  };
}

function toCoverageByVariable(result) {
  // Two API response shapes are supported:
  // Old (zarr fallback):  { timeLabels: string[], variables: [{name, values, units, label}] }
  // New (ocean-zarr.spc.int): { times: string[], variables: {name: values[]}, units: {}, long_names: {} }
  const times = result?.timeLabels || result?.times || [];
  const out = {};

  if (Array.isArray(result?.variables)) {
    // Old list-of-objects format
    for (const variable of result.variables) {
      if (!variable?.name) continue;
      out[variable.name] = {
        type: 'Coverage',
        domain: { axes: { t: { values: times } } },
        ranges: { [variable.name]: { values: variable.values || [] } },
        parameters: {
          [variable.name]: {
            observedProperty: { label: { en: variable.label || variable.name } },
            unit: { symbol: variable.units || '' },
          },
        },
      };
    }
  } else if (result?.variables && typeof result.variables === 'object') {
    // New dict format: variables[name] = values[]
    const units = result.units ?? {};
    const longNames = result.long_names ?? {};
    for (const [name, values] of Object.entries(result.variables)) {
      out[name] = {
        type: 'Coverage',
        domain: { axes: { t: { values: times } } },
        ranges: { [name]: { values: Array.isArray(values) ? values : [] } },
        parameters: {
          [name]: {
            observedProperty: { label: { en: longNames[name] || name } },
            unit: { symbol: units[name] || '' },
          },
        },
      };
    }
  }

  return out;
}

export default useZarrMap;
