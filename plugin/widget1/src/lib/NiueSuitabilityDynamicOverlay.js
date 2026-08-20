// NiueSuitabilityDynamicOverlay.js
// Client-classified suitability overlay, for interactively adjustable
// wind/wave thresholds. NiueSuitabilityOverlay.js stays the tile-based
// overlay for the fixed vessel presets; this is a sibling for the
// "custom operating envelope" case, backed by /niue/suitability/grid/{time_index}
// (raw wind/wave/valid raster) instead of pre-rendered per-vessel PNG tiles.
//
// setTimeIndex() is the only method that touches the network (one fetch per
// timestep, cached). setEnvelope() repaints a canvas already held in
// memory, so dragging a threshold slider never issues a request.

import { VESSEL_OPERATING_ENVELOPE, SUITABILITY_HAZARD_COLORS } from './NiueSuitabilityOverlay';

const SOURCE_ID = 'niue-suitability-dynamic-source';
const LAYER_ID = 'niue-suitability-dynamic-layer';

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const HAZARD_RGB = Object.fromEntries(
  Object.entries(SUITABILITY_HAZARD_COLORS).map(([code, hex]) => [code, hexToRgb(hex)])
);

// Fired-and-forgotten background fetches, one tick ahead of the currently
// displayed timestep, so playback (which advances on a fixed interval
// regardless of fetch speed) usually finds its next few frames already
// warm in cache instead of starting cold on every tick. Kept modest —
// each is still a real network request, and stacking too many concurrent
// ones would compete with (and slow down) whatever the user is actually
// waiting to see right now.
const PREFETCH_AHEAD_COUNT = 3;

export class NiueSuitabilityDynamicOverlay {
  constructor(map, apiBase) {
    this._map = map;
    this._apiBase = apiBase.replace(/\/$/, '');
    this._gridCache = new Map(); // time_index -> parsed grid
    this._prefetchInFlight = new Set(); // time_index currently being prefetched
    this._grid = null;
    this._envelope = null;
    this._visible = true;
    this._requestId = 0;
    this._canvas = document.createElement('canvas');
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: false });
    this._imageData = null;
  }

  async setTimeIndex(timeIndex) {
    // Dragging the time slider quickly can fire several overlapping
    // fetches; without this a slow-to-resolve older request can land after
    // a faster newer one and silently repaint stale data over the current
    // timestep. Only the most recent call's result is allowed to apply.
    const requestId = ++this._requestId;

    let grid = this._gridCache.get(timeIndex);
    if (!grid) {
      grid = await this._fetchGrid(timeIndex);
      if (requestId !== this._requestId) return;
      this._gridCache.set(timeIndex, grid);
    }
    if (requestId !== this._requestId) return;

    this._grid = grid;
    this._ensureCanvasSize();
    if (this._envelope) this._repaint();
    this._prefetchAhead(timeIndex);
  }

  // Not awaited by callers — this is deliberately best-effort. A prefetch
  // landing after the user has already scrubbed past it just populates the
  // cache for next time; a prefetch failing (network blip, or timeIndex
  // running past the end of the forecast) is silently dropped rather than
  // surfaced as a layer error, since nothing the user is currently looking
  // at depends on it succeeding.
  _prefetchAhead(fromTimeIndex) {
    for (let offset = 1; offset <= PREFETCH_AHEAD_COUNT; offset++) {
      const timeIndex = fromTimeIndex + offset;
      if (this._gridCache.has(timeIndex) || this._prefetchInFlight.has(timeIndex)) continue;

      this._prefetchInFlight.add(timeIndex);
      // Wrapped in Promise.resolve().then(...) rather than calling
      // this._fetchGrid(timeIndex) directly: if it ever threw synchronously
      // instead of rejecting (e.g. called past the end of the forecast, or
      // in a test with an exhausted mock), that throw would otherwise
      // escape this loop — inside a plain .then() callback it becomes a
      // rejection instead, caught by the .catch() below like every other
      // failure mode this is meant to swallow.
      Promise.resolve()
        .then(() => this._fetchGrid(timeIndex))
        .then((grid) => { this._gridCache.set(timeIndex, grid); })
        .catch(() => {})
        .finally(() => { this._prefetchInFlight.delete(timeIndex); });
    }
  }

  // overrides: { cautionWindKt, maxWindKt, cautionWaveHeightM, maxWaveHeightM }
  //
  // Deliberately not named setThresholds: useZarrMap.js has an existing
  // generic effect (`if (typeof ov.setThresholds === 'function')
  // ov.setThresholds(thresholds)`) for ZarrOverlay's unrelated color-break
  // thresholds. Reusing that name here would make this overlay's vessel
  // envelope get silently called with the wrong (single-argument) shape
  // whenever that unrelated prop changes.
  setEnvelope(vesselCode, overrides = {}) {
    const base = VESSEL_OPERATING_ENVELOPE[vesselCode];
    if (!base) throw new Error(`Unknown vessel class: ${vesselCode}`);

    const envelope = { ...base, ...overrides };
    if (envelope.cautionWindKt > envelope.maxWindKt) {
      throw new Error('Caution wind threshold cannot exceed maximum wind threshold.');
    }
    if (envelope.cautionWaveHeightM > envelope.maxWaveHeightM) {
      throw new Error('Caution wave threshold cannot exceed maximum wave threshold.');
    }
    this._envelope = envelope;

    if (this._grid) this._repaint();
  }

  setOpacity(opacity) {
    try {
      if (this._map.getLayer(LAYER_ID)) {
        this._map.setPaintProperty(LAYER_ID, 'raster-opacity', opacity);
      }
    } catch (_) { /* map may already be torn down */ }
  }

  // Safe to call before the first repaint has created the layer (e.g. right
  // after construction, while still on preset mode) — _visible is applied
  // as soon as _ensureMapSource() actually creates it.
  setVisible(visible) {
    this._visible = visible;
    try {
      if (this._map.getLayer(LAYER_ID)) {
        this._map.setLayoutProperty(LAYER_ID, 'visibility', visible ? 'visible' : 'none');
      }
    } catch (_) { /* map may already be torn down */ }
  }

  clearCache() {
    this._gridCache.clear();
  }

  destroy() {
    // Mirrors NiueSuitabilityOverlay._removeFromMap()'s try/catch: the map
    // instance can already be torn down (map.remove() already ran) by the
    // time this fires, e.g. during a fast layer switch or an error-recovery
    // unmount — getLayer/getSource on a removed map throw rather than
    // returning falsy.
    try {
      if (this._map.getLayer(LAYER_ID)) this._map.removeLayer(LAYER_ID);
      if (this._map.getSource(SOURCE_ID)) this._map.removeSource(SOURCE_ID);
    } catch (_) { /* map may already be torn down */ }
    this._gridCache.clear();
    this._prefetchInFlight.clear();
    this._grid = null;
    this._envelope = null;
  }

  async _fetchGrid(timeIndex) {
    const resp = await fetch(`${this._apiBase}/niue/suitability/grid/${timeIndex}`);
    if (!resp.ok) {
      throw new Error(`Suitability grid request failed: ${resp.status}`);
    }
    return NiueSuitabilityDynamicOverlay._parseGridResponse(resp);
  }

  static async _parseGridResponse(resp) {
    const width = Number(resp.headers.get('X-Grid-Width'));
    const height = Number(resp.headers.get('X-Grid-Height'));
    const bounds = {
      lonMin: Number(resp.headers.get('X-Lon-Min')),
      lonMax: Number(resp.headers.get('X-Lon-Max')),
      latMin: Number(resp.headers.get('X-Lat-Min')),
      latMax: Number(resp.headers.get('X-Lat-Max')),
    };

    // Fails closed (throws, caught by the controller's setTimeIndex .catch)
    // rather than proceeding with a 0x0 grid. The most likely real-world
    // cause isn't a malformed response — it's the backend's CORS config not
    // exposing these custom X-Grid-* headers cross-origin. When that
    // happens resp.headers.get() returns null for every one of them,
    // Number(null) is 0, not NaN, so this can't just check isNaN: it would
    // pass straight through as a "valid" 0x0 grid and crash later, deeper
    // in the call stack, at createImageData(0, 0) instead of here.
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error(
        `Suitability grid response missing/invalid X-Grid-Width or X-Grid-Height ` +
        `(got ${resp.headers.get('X-Grid-Width')}x${resp.headers.get('X-Grid-Height')}). ` +
        `If these headers are present on the actual HTTP response but not readable here, ` +
        `the backend's CORS config likely needs Access-Control-Expose-Headers to include them.`
      );
    }

    // Two supported encodings, distinguished by X-Grid-Encoding — kept
    // backward-compatible with the original float32 format deliberately:
    // this frontend and the production backend don't deploy in lockstep,
    // so a frontend that only understood the new quantized format would
    // break against whatever's already live until someone redeploys the
    // backend. The quantized (i16le) path is ~23x smaller on the wire
    // (measured: a real ~15MB float32 grid -> ~640KB gzipped-quantized) —
    // see the backend's /niue/suitability/grid docstring for the measured
    // numbers this tradeoff is based on.
    const encoding = resp.headers.get('X-Grid-Encoding') || '';
    const buffer = await resp.arrayBuffer();

    if (encoding.includes('i16le')) {
      const windScale = Number(resp.headers.get('X-Wind-Scale')) || 1;
      const waveScale = Number(resp.headers.get('X-Wave-Scale')) || 1;
      return NiueSuitabilityDynamicOverlay._decodeQuantizedGridBuffer(
        buffer, width, height, bounds, windScale, waveScale
      );
    }
    return NiueSuitabilityDynamicOverlay._decodeGridBuffer(buffer, width, height, bounds);
  }

  // Legacy layout: wind (f32le) then wave (f32le) then valid (u8), each
  // row-major (lat, lon). Kept for compatibility with a backend that hasn't
  // been redeployed with quantization yet — see _parseGridResponse.
  static _decodeGridBuffer(buffer, width, height, bounds) {
    const cellCount = width * height;
    const floatBytes = cellCount * 4;
    return {
      width,
      height,
      bounds,
      wind: new Float32Array(buffer, 0, cellCount),
      wave: new Float32Array(buffer, floatBytes, cellCount),
      valid: new Uint8Array(buffer, floatBytes * 2, cellCount),
    };
  }

  // Layout matches X-Grid-Encoding: wind (i16le) then wave (i16le) then
  // valid (u8), each row-major (lat, lon). wind_kt = raw / windScale,
  // wave_m = raw / waveScale (see /niue/suitability/grid's docstring for
  // why int16 rather than float32). Rescaled into Float32Array immediately
  // so _repaint()'s classification math doesn't need to know or care which
  // encoding a given grid came from.
  static _decodeQuantizedGridBuffer(buffer, width, height, bounds, windScale, waveScale) {
    const cellCount = width * height;
    const int16Bytes = cellCount * 2;
    const windRaw = new Int16Array(buffer, 0, cellCount);
    const waveRaw = new Int16Array(buffer, int16Bytes, cellCount);

    const wind = new Float32Array(cellCount);
    const wave = new Float32Array(cellCount);
    for (let i = 0; i < cellCount; i++) {
      wind[i] = windRaw[i] / windScale;
      wave[i] = waveRaw[i] / waveScale;
    }

    return {
      width,
      height,
      bounds,
      wind,
      wave,
      valid: new Uint8Array(buffer, int16Bytes * 2, cellCount),
    };
  }

  _ensureCanvasSize() {
    const { width, height } = this._grid;
    if (this._canvas.width !== width || this._canvas.height !== height) {
      this._canvas.width = width;
      this._canvas.height = height;
      this._imageData = this._ctx.createImageData(width, height);
    }
  }

  _repaint() {
    // Guards against calling this with a grid whose _ensureCanvasSize()
    // never ran (or threw) — e.g. a setEnvelope() call landing after a
    // setTimeIndex() that failed. Both call sites already check
    // this._grid/this._envelope before calling _repaint(), so in practice
    // this only ever catches _imageData being unset.
    if (!this._grid || !this._envelope || !this._imageData) return;

    const { width, height, wind, wave, valid, bounds } = this._grid;
    const { cautionWindKt, maxWindKt, cautionWaveHeightM, maxWaveHeightM } = this._envelope;
    const pixels = this._imageData.data;

    for (let y = 0; y < height; y++) {
      // suit_raster_lats (backend) runs south -> north (np.arange from
      // lat.min()), but canvas row 0 is the top (north). Flip here, once,
      // rather than re-deriving this on every future consumer of the grid.
      const sourceY = height - 1 - y;

      for (let x = 0; x < width; x++) {
        const sourceIndex = sourceY * width + x;
        const pixelIndex = (y * width + x) * 4;

        if (!valid[sourceIndex]) {
          pixels[pixelIndex + 3] = 0;
          continue;
        }

        const windHazard = wind[sourceIndex] >= maxWindKt ? 2 : wind[sourceIndex] >= cautionWindKt ? 1 : 0;
        const waveHazard = wave[sourceIndex] >= maxWaveHeightM ? 2 : wave[sourceIndex] >= cautionWaveHeightM ? 1 : 0;
        const [r, g, b] = HAZARD_RGB[Math.max(windHazard, waveHazard)];

        pixels[pixelIndex] = r;
        pixels[pixelIndex + 1] = g;
        pixels[pixelIndex + 2] = b;
        pixels[pixelIndex + 3] = 205;
      }
    }

    this._ctx.putImageData(this._imageData, 0, 0);
    this._ensureMapSource(bounds);
    this._map.triggerRepaint();
  }

  _ensureMapSource(bounds) {
    const coordinates = [
      [bounds.lonMin, bounds.latMax], // NW
      [bounds.lonMax, bounds.latMax], // NE
      [bounds.lonMax, bounds.latMin], // SE
      [bounds.lonMin, bounds.latMin], // SW
    ];

    const existing = this._map.getSource(SOURCE_ID);
    if (existing) {
      existing.setCoordinates(coordinates);
      // With animate: false, MapLibre's CanvasSource only uploads the
      // canvas to its GPU texture once (on creation) — see prepare() in
      // canvas_source.ts, which only calls texture.update() when
      // `resize || this._playing`, and _playing only ever becomes true
      // between play()/pause(). Without this, every _repaint() after the
      // first correctly redraws the offscreen canvas but the map's texture
      // never reflects it: play() flips _playing on and requests a frame,
      // pause() synchronously does the one texture.update() this repaint
      // needs and flips _playing back off — a one-shot refresh instead of
      // paying for animate: true's continuous per-frame re-upload of a
      // ~1600x1000px canvas on every pan/zoom regardless of whether this
      // layer's content actually changed.
      existing.play?.();
      existing.pause?.();
      return;
    }

    this._map.addSource(SOURCE_ID, {
      type: 'canvas',
      canvas: this._canvas,
      coordinates,
      animate: false,
    });
    this._map.addLayer({
      id: LAYER_ID,
      type: 'raster',
      source: SOURCE_ID,
      layout: { visibility: this._visible ? 'visible' : 'none' },
      paint: { 'raster-opacity': 0.8 },
    });
  }
}
