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

export class NiueSuitabilityDynamicOverlay {
  constructor(map, apiBase) {
    this._map = map;
    this._apiBase = apiBase.replace(/\/$/, '');
    this._gridCache = new Map(); // time_index -> parsed grid
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
    if (this._map.getLayer(LAYER_ID)) {
      this._map.setPaintProperty(LAYER_ID, 'raster-opacity', opacity);
    }
  }

  // Safe to call before the first repaint has created the layer (e.g. right
  // after construction, while still on preset mode) — _visible is applied
  // as soon as _ensureMapSource() actually creates it.
  setVisible(visible) {
    this._visible = visible;
    if (this._map.getLayer(LAYER_ID)) {
      this._map.setLayoutProperty(LAYER_ID, 'visibility', visible ? 'visible' : 'none');
    }
  }

  clearCache() {
    this._gridCache.clear();
  }

  destroy() {
    if (this._map.getLayer(LAYER_ID)) this._map.removeLayer(LAYER_ID);
    if (this._map.getSource(SOURCE_ID)) this._map.removeSource(SOURCE_ID);
    this._gridCache.clear();
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
    const buffer = await resp.arrayBuffer();
    return NiueSuitabilityDynamicOverlay._decodeGridBuffer(buffer, width, height, bounds);
  }

  // Layout matches X-Grid-Encoding on the backend: wind (f32le) then wave
  // (f32le) then valid (u8), each row-major (lat, lon).
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

  _ensureCanvasSize() {
    const { width, height } = this._grid;
    if (this._canvas.width !== width || this._canvas.height !== height) {
      this._canvas.width = width;
      this._canvas.height = height;
      this._imageData = this._ctx.createImageData(width, height);
    }
  }

  _repaint() {
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
