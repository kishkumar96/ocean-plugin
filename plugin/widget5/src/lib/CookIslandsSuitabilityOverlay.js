// CookIslandsSuitabilityOverlay.js
// Renders Cook Islands forereef suitability as a continuous raster (server-
// interpolated from the 460 forereef points, see zarr-api's
// cok_suitability_tile route) with the discrete per-point circles on top for
// exact readouts. Data comes from the forecast pipeline's /cok/suitability/
// API endpoints.

import { SUITABILITY_DEBUG_TIMING, logSuitabilityFrameTiming } from './suitabilityDebugTiming';
import { advisoryMarkerId, registerAdvisoryMarkerIcons } from './advisoryMarkerIcons';
import VESSEL_THRESHOLDS from './vesselThresholds.generated.json';

const SOURCE_ID        = 'cok-suitability-src';
export const COK_SUITABILITY_CIRCLES_LAYER = 'cok-suitability-circles';
const LAYER_ID         = COK_SUITABILITY_CIRCLES_LAYER;
const RASTER_SOURCE_ID = 'cok-suitability-raster-src';
const RASTER_LAYER_ID  = 'cok-suitability-raster-layer';
const ADVISORY_SOURCE_ID = 'cok-suitability-advisory-src';
export const COK_ADVISORY_LOCATIONS_LAYER = 'cok-suitability-advisory-layer';
const ADVISORY_LAYER_ID = COK_ADVISORY_LOCATIONS_LAYER;

// Exported so the details panel and the custom-envelope slider can share
// this one definition instead of keeping their own copies in sync by hand.
export const HAZARD_COLORS = {
  0: '#2A9D8F',  // Suitable  — teal-green
  1: '#F4A261',  // Caution   — amber
  2: '#E63946',  // Warning   — red
};

export const VESSEL_CLASS_OPTIONS = [
  { value: 'traditional_craft',          label: 'Traditional craft',     examples: 'Canoes, vaka' },
  { value: 'very_small_motorised_craft', label: 'Very small (<6 m)',      examples: 'Dinghies, open skiffs' },
  { value: 'small_craft',                label: 'Small craft (6–10 m)',   examples: 'Fibreglass, skiffs' },
  { value: 'larger_vessels',             label: 'Larger vessels (10+ m)', examples: 'Decked vessels' },
];

// Wind/wave thresholds come from vesselThresholds.generated.json, which
// ocean-plugin/scripts/sync_vessel_thresholds.py regenerates from the
// pipeline's vessel_suitability_rules.yaml (the single source of truth for
// what "preset" means). Only labels and examples are written here; never edit
// the numbers by hand -- change the yaml and re-run the script.
const VESSEL_META = {
  traditional_craft:          { label: 'Traditional craft',    examples: 'Canoes, vaka, outrigger canoes' },
  very_small_motorised_craft: { label: 'Very small (<6 m)',    examples: 'Dinghies, open skiffs under 6 m' },
  small_craft:                { label: 'Small craft (6–10 m)', examples: 'Fibreglass boats 6-10 m, inter-island skiffs' },
  larger_vessels:             { label: 'Larger vessels (10+ m)', examples: 'Decked vessels over 10-12 m' },
};

export const VESSEL_OPERATING_ENVELOPE = Object.fromEntries(
  Object.entries(VESSEL_META).map(([code, meta]) => [code, { ...meta, ...VESSEL_THRESHOLDS[code] }])
);

// Only these four numeric fields are user-adjustable -- keeps a custom
// envelope object from ever picking up a label/examples field by accident.
export const CUSTOM_ENVELOPE_FIELDS = ['cautionWindKt', 'maxWindKt', 'cautionWaveHeightM', 'maxWaveHeightM'];

// Bounds the per-timestep GeoJSON cache so scrubbing through a full
// forecast (229 timesteps) doesn't retain every frame in memory -- 460
// points x 4 vessel classes per timestep is ~209 MiB of point GeoJSON plus
// ~9 MiB of advisory JSON before JS object overhead, all of it in the cache
// at once with no eviction. Only the most recently viewed
// MAX_CACHE_ENTRIES timesteps are kept.
const MAX_CACHE_ENTRIES = 10;

export function resolveOperatingEnvelope(vesselCode, overrides = {}) {
  const base = VESSEL_OPERATING_ENVELOPE[vesselCode];
  if (!base) throw new Error(`Unknown vessel class: ${vesselCode}`);

  const envelope = { ...base };
  for (const field of CUSTOM_ENVELOPE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(overrides ?? {}, field)) {
      envelope[field] = overrides[field];
    }
  }
  for (const field of CUSTOM_ENVELOPE_FIELDS) {
    if (!Number.isFinite(envelope[field]) || envelope[field] < 0) {
      throw new Error(`${field} must be a finite, non-negative number.`);
    }
  }
  if (envelope.cautionWindKt >= envelope.maxWindKt) {
    throw new Error('Caution wind threshold must be lower than the avoid wind threshold.');
  }
  if (envelope.cautionWaveHeightM >= envelope.maxWaveHeightM) {
    throw new Error('Caution wave threshold must be lower than the avoid wave threshold.');
  }
  return envelope;
}

// Pure classifier shared by the custom canvas overlay and any future
// point-reading code -- one boundary rule, not two copies that could drift.
export function classifyAgainstOperatingEnvelope(envelope, windKt, waveM) {
  if (!envelope || !Number.isFinite(windKt) || !Number.isFinite(waveM)) return null;
  const windHazard = windKt >= envelope.maxWindKt ? 2 : windKt >= envelope.cautionWindKt ? 1 : 0;
  const waveHazard = waveM >= envelope.maxWaveHeightM ? 2 : waveM >= envelope.cautionWaveHeightM ? 1 : 0;
  return Math.max(windHazard, waveHazard);
}

export class CookIslandsSuitabilityOverlay {
  constructor(map, opts = {}) {
    this._map         = map;
    this._vesselClass = opts.vesselClass || 'traditional_craft';
    this._opacity     = opts.opacity ?? 0.85;
    this._timeIndex   = 0;
    this._timeLabels  = [];
    this._timeCount   = 0;
    this._cache       = new Map(); // timeIndex -> { features, adviceFeatures }, LRU-ordered
    this._inflight    = null; // active fetch AbortController
    this._destroyed   = false;
    // onLoadingChange must reflect the raster tiles (the actual colored
    // suitability layer, dominant on screen) as well as the small
    // points/advice JSON fetch below -- previously only the JSON fetch
    // toggled loading, so useZarrMap's load-aware Play loop advanced the
    // slider/circles to the next timestep as soon as that tiny payload
    // landed, consistently before the raster PNG tiles for the new
    // timestep had finished loading and painting. See _bindRasterLoadTracking.
    this._jsonLoading   = false;
    this._rasterLoading = false;

    // Standard overlay callbacks (assigned by useZarrMap)
    this.onLoadingChange = null;
    this.onTimeChange    = null;
    this.onErrorChange   = null;
    this.onStatsChange   = null;

    this._addLayers();
    this._fetchSummary();
  }

  // ── MapLibre layer setup ─────────────────────────────────────────────────

  _addLayers() {
    const map = this._map;
    if (!map) return;

    // Insert both below the risk-circles layer so risk markers remain on top
    const beforeId = map.getLayer('risk-circles') ? 'risk-circles' : undefined;

    // Raster first, so it sits underneath the per-point circles added next.
    if (!map.getSource(RASTER_SOURCE_ID)) {
      map.addSource(RASTER_SOURCE_ID, {
        type: 'raster',
        tiles: [this._buildTileUrl()],
        tileSize: 256,
      });
    }
    if (!map.getLayer(RASTER_LAYER_ID)) {
      map.addLayer({
        id:     RASTER_LAYER_ID,
        type:   'raster',
        source: RASTER_SOURCE_ID,
        paint:  { 'raster-opacity': this._opacity },
      }, beforeId);
    }

    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }

    if (!map.getLayer(LAYER_ID)) {
      map.addLayer(
        {
          id:     LAYER_ID,
          type:   'circle',
          source: SOURCE_ID,
          paint: {
            'circle-radius': [
              'interpolate', ['linear'], ['zoom'],
              5, 3.5,
              8, 5.5,
              11, 8,
            ],
            'circle-color': [
              'match', ['get', 'hazard_class'],
              0, HAZARD_COLORS[0],
              1, HAZARD_COLORS[1],
              2, HAZARD_COLORS[2],
              '#888',
            ],
            'circle-opacity':        this._opacity,
            'circle-stroke-width':   1,
            'circle-stroke-color':   'rgba(255,255,255,0.45)',
            'circle-stroke-opacity': this._opacity,
          },
        },
        beforeId,
      );
    }

    // Named landing sites and fishing grounds use pictograms; color still
    // communicates the vessel suitability class at the chosen forecast hour.
    if (!map.getSource(ADVISORY_SOURCE_ID)) {
      map.addSource(ADVISORY_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!map.getLayer(ADVISORY_LAYER_ID)) {
      registerAdvisoryMarkerIcons(map, HAZARD_COLORS);
      map.addLayer({
        id: ADVISORY_LAYER_ID,
        type: 'symbol',
        source: ADVISORY_SOURCE_ID,
        layout: {
          'icon-image': ['get', 'marker_icon'],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.65, 8, 0.75, 11, 0.9],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: { 'icon-opacity': this._opacity },
      }, beforeId);
    }

    this._bindRasterLoadTracking();
  }

  // Wires the raster source's own loading state into the same loading flag
  // the points/advice JSON fetch uses, via MapLibre's documented
  // isSourceLoaded()-after-'sourcedata' pattern. Without this, the raster
  // (the layer the user actually watches) could still be mid-fetch/paint
  // for the new timestep while onLoadingChange had already reported "done".
  _bindRasterLoadTracking() {
    const map = this._map;
    if (!map) return;
    this._onSourceData = (e) => {
      if (e.sourceId !== RASTER_SOURCE_ID) return;
      const nowLoading = !map.isSourceLoaded(RASTER_SOURCE_ID);
      if (nowLoading === this._rasterLoading) return;
      this._rasterLoading = nowLoading;
      if (SUITABILITY_DEBUG_TIMING && !nowLoading && this._rasterLoadStart != null) {
        const now = performance.now();
        logSuitabilityFrameTiming({
          timeIndex: this._rasterLoadIndex,
          rasterLoadMs: now - this._rasterLoadStart,
          totalMs: now - (this._frameStart ?? this._rasterLoadStart),
        });
        this._rasterLoadStart = null;
      }
      this._emitLoading();
    };
    map.on('sourcedata', this._onSourceData);
  }

  _buildTileUrl() {
    return `/cok/suitability/tiles/${this._vesselClass}/${this._timeIndex}/{z}/{x}/{y}.png`;
  }

  _updateRasterTiles() {
    const src = this._map?.getSource(RASTER_SOURCE_ID);
    // setTiles() invalidates every currently-loaded raster tile immediately,
    // but the isSourceLoaded()/'sourcedata' transition to "loading" isn't
    // synchronous -- flip this eagerly so a fast read of the loading state
    // (e.g. the very next Play-loop tick) never sees a stale "loaded"
    // reading for tiles that are actually about to be discarded and refetched.
    this._rasterLoading = true;
    if (SUITABILITY_DEBUG_TIMING) {
      this._rasterLoadStart = performance.now();
      this._rasterLoadIndex = this._timeIndex;
    }
    this._emitLoading();
    try {
      src?.setTiles([this._buildTileUrl()]);
    } catch (_) { /* source removed mid-update */ }
  }

  // ── summary fetch (time metadata) ────────────────────────────────────────

  async _fetchSummary() {
    this._setLoading(true);
    try {
      const res = await fetch('/cok/suitability/summary');
      if (!res.ok) throw new Error(`Suitability summary: HTTP ${res.status}`);
      const data = await res.json();
      if (this._destroyed) return;

      this._timeCount = data.n_timesteps || 0;
      this._timeLabels = this._buildTimeLabels(
        data.forecast_start,
        data.forecast_end,
        this._timeCount,
      );

      this.onTimeChange?.(this._timeLabels[0] ?? '', 0, this._timeCount - 1);
      this._setLoading(false);
      this._loadTimestep(0);
    } catch (err) {
      if (!this._destroyed) {
        this.onErrorChange?.(err.message);
        this._setLoading(false);
      }
    }
  }

  _buildTimeLabels(startStr, endStr, n) {
    // numpy datetime64 strings look like "2026-08-18T00:00:00.000000000"
    const clean = (s) => (s || '').replace(/\.0+$/, '').replace(' ', 'T');
    const start = new Date(clean(startStr));
    const end   = new Date(clean(endStr));
    if (isNaN(start) || n <= 0) return [];
    const stepMs = n > 1 ? (end - start) / (n - 1) : 3_600_000;
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(start.getTime() + i * stepMs);
      return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    });
  }

  // ── per-timestep data fetch ──────────────────────────────────────────────

  async _loadTimestep(idx) {
    if (this._destroyed) return;

    // Serve from cache immediately and return
    if (this._touchCache(idx)) {
      this._render(idx);
      this._renderAdvisory(idx);
      return;
    }

    // Cancel any previous in-flight request
    this._inflight?.abort();
    const ctrl = new AbortController();
    this._inflight = ctrl;

    this._setLoading(true);
    try {
      const [pointsRes, adviceRes] = await Promise.all([
        fetch(`/cok/suitability/points/${idx}`, { signal: ctrl.signal }),
        fetch(`/cok/suitability/advice/${idx}`, { signal: ctrl.signal }),
      ]);
      if (!pointsRes.ok) throw new Error(`Suitability points t${idx}: HTTP ${pointsRes.status}`);
      const geojson = await pointsRes.json();
      if (this._destroyed) return;

      // Advisory locations are a bonus layer -- a hiccup fetching them
      // shouldn't take down the main points layer, so failures here are
      // swallowed (empty result) rather than routed through onErrorChange.
      let adviceFeatures = [];
      if (adviceRes.ok) {
        const adviceGeojson = await adviceRes.json();
        if (this._destroyed) return;
        adviceFeatures = (adviceGeojson.features ?? []).filter(
          (feature) => feature.properties?.name?.trim().toLowerCase() !== 'ngatangiia harbour',
        );
      }

      this._setCached(idx, { features: geojson.features ?? [], adviceFeatures });

      // Only render if still on this timestep
      if (this._timeIndex === idx) {
        this._render(idx);
        this._renderAdvisory(idx);
      }
      this._setLoading(false);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!this._destroyed) {
        this.onErrorChange?.(err.message);
        this._setLoading(false);
      }
    }
  }

  // Map insertion order is the LRU order. Touch cache hits so a frame the
  // user scrubbed back to is not the next one evicted.
  _touchCache(idx) {
    const value = this._cache.get(idx);
    if (value === undefined) return undefined;
    this._cache.delete(idx);
    this._cache.set(idx, value);
    return value;
  }

  _setCached(idx, value) {
    if (this._destroyed) return;
    this._cache.delete(idx);
    this._cache.set(idx, value);
    // Never evict the timestep currently on screen, even if it happens to
    // be the oldest entry (e.g. the user scrubbed far away and back).
    while (this._cache.size > MAX_CACHE_ENTRIES) {
      const evictionKey = [...this._cache.keys()].find((key) => key !== this._timeIndex);
      if (evictionKey === undefined) break;
      this._cache.delete(evictionKey);
    }
  }

  _render(idx) {
    const src = this._map?.getSource(SOURCE_ID);
    if (!src) return;
    const vessel   = this._vesselClass;
    const features = (this._cache.get(idx)?.features ?? []).filter(
      (f) => f.properties?.vessel_class === vessel,
    );
    src.setData({ type: 'FeatureCollection', features });
  }

  _renderAdvisory(idx) {
    const src = this._map?.getSource(ADVISORY_SOURCE_ID);
    if (!src) return;
    const vessel   = this._vesselClass;
    const features = (this._cache.get(idx)?.adviceFeatures ?? []).filter(
      (f) => f.properties?.vessel_class === vessel,
    );
    src.setData({ type: 'FeatureCollection', features: features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        marker_icon: advisoryMarkerId(feature.properties?.type, feature.properties?.hazard_class),
      },
    })) });
  }

  _setLoading(val) {
    this._jsonLoading = val;
    this._emitLoading();
  }

  // Combines the JSON (points/advice) and raster loading flags -- the
  // caller-facing "loading" state is true while either is still in flight.
  _emitLoading() {
    this.onLoadingChange?.(this._jsonLoading || this._rasterLoading);
  }

  // ── public API (matches useZarrMap overlay interface) ────────────────────

  setTimeIndex(idx) {
    if (this._timeIndex === idx) return;
    if (SUITABILITY_DEBUG_TIMING) this._frameStart = performance.now();
    this._timeIndex = idx;
    this.onTimeChange?.(this._timeLabels[idx] ?? '', idx, this._timeCount - 1);
    this._loadTimestep(idx);
    this._updateRasterTiles();
  }

  setOpacity(opacity) {
    this._opacity = opacity;
    const map = this._map;
    if (map?.getLayer(LAYER_ID)) {
      map.setPaintProperty(LAYER_ID, 'circle-opacity',        opacity);
      map.setPaintProperty(LAYER_ID, 'circle-stroke-opacity', opacity);
    }
    if (map?.getLayer(ADVISORY_LAYER_ID)) {
      map.setPaintProperty(ADVISORY_LAYER_ID, 'icon-opacity', opacity);
    }
    if (map?.getLayer(RASTER_LAYER_ID)) {
      map.setPaintProperty(RASTER_LAYER_ID, 'raster-opacity', opacity);
    }
  }

  setVesselClass(vesselClass) {
    if (this._vesselClass === vesselClass) return;
    this._vesselClass = vesselClass;
    // Re-render immediately from cache; fetch if not cached yet
    if (this._cache.has(this._timeIndex)) {
      this._render(this._timeIndex);
      this._renderAdvisory(this._timeIndex);
    } else {
      this._loadTimestep(this._timeIndex);
    }
    this._updateRasterTiles();
  }

  getTimeLabels() {
    return this._timeLabels;
  }

  setVisible(visible) {
    const map = this._map;
    if (!map) return;
    const visibility = visible ? 'visible' : 'none';
    for (const id of [RASTER_LAYER_ID, LAYER_ID, ADVISORY_LAYER_ID]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
    }
  }

  // Groups every vessel class's reading for one named advisory location at
  // the current timestep, keyed by the location's own "name" property --
  // used by the advisory-location click handler to show a full vessel
  // comparison instead of just whichever single class happens to be
  // selected on the map right now. Pulled straight from the already-fetched
  // cache (advice endpoints return all 4 vessel classes per location per
  // timestep), so this never issues a network request.
  getAdvisoryGroup(locationName) {
    const features = this._cache.get(this._timeIndex)?.adviceFeatures ?? [];
    return features.filter((f) => f.properties?.name === locationName);
  }

  // No timeseries drill-down for suitability points
  getTimeseriesAtPoint() {
    return Promise.resolve(null);
  }

  destroy() {
    this._destroyed = true;
    this._inflight?.abort();
    this._cache.clear();
    const map = this._map;
    this._map = null;
    if (!map) return;
    try {
      if (this._onSourceData) map.off('sourcedata', this._onSourceData);
      if (map.getLayer(LAYER_ID))  map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      if (map.getLayer(ADVISORY_LAYER_ID))  map.removeLayer(ADVISORY_LAYER_ID);
      if (map.getSource(ADVISORY_SOURCE_ID)) map.removeSource(ADVISORY_SOURCE_ID);
      if (map.getLayer(RASTER_LAYER_ID))  map.removeLayer(RASTER_LAYER_ID);
      if (map.getSource(RASTER_SOURCE_ID)) map.removeSource(RASTER_SOURCE_ID);
    } catch (_) {}
  }
}
