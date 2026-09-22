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

import {
  CUSTOM_ENVELOPE_FIELDS,
  classifyAgainstOperatingEnvelope,
  resolveOperatingEnvelope,
  SUITABILITY_HAZARD_COLORS,
} from './NiueSuitabilityOverlay';

const SOURCE_ID = 'niue-suitability-dynamic-source';
const LAYER_ID = 'niue-suitability-dynamic-layer';

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const HAZARD_RGB = Object.fromEntries(
  Object.entries(SUITABILITY_HAZARD_COLORS).map(([code, hex]) => [code, hexToRgb(hex)])
);

// Fired-and-forgotten background fetches, a few ticks ahead of the currently
// displayed timestep, so playback (which advances on a fixed interval
// regardless of fetch speed) usually finds its next few frames already
// warm in cache instead of starting cold on every tick. Kept modest —
// each is still a real network request, and stacking too many concurrent
// ones would compete with (and slow down) whatever the user is actually
// waiting to see right now.
const PREFETCH_AHEAD_COUNT = 3;

// A decoded production grid is roughly 15 MB even when its wire payload is
// quantized. Current + previous + three prefetched frames is enough for smooth
// playback without retaining an entire multi-gigabyte forecast in the tab.
export const MAX_GRID_CACHE_ENTRIES = 5;

export class NiueSuitabilityDynamicOverlay {
  constructor(map, apiBase) {
    this._map = map;
    this._apiBase = apiBase.replace(/\/$/, '');
    this._gridCache = new Map(); // time_index -> parsed grid
    this._gridFetches = new Map(); // time_index -> shared in-flight Promise
    this._fetchControllers = new Map();
    this._prefetchInFlight = new Set(); // time_index currently being prefetched
    // The time_index setTimeIndex() is actively awaiting a fetch for, if any
    // — distinct from _requestedTimeIndex, which updates even on a cache
    // hit. Lets a new setTimeIndex() call abort the specific fetch it
    // supersedes (see setTimeIndex's comment) without touching unrelated
    // prefetch fetches for other, still-wanted timesteps.
    this._activeFetchTimeIndex = null;
    this._grid = null;
    this._envelope = null;
    this._lastSummary = null;
    this._visible = true;
    this._destroyed = false;
    this._requestId = 0;
    this._requestedTimeIndex = null;
    this._renderedTimeIndex = null;
    this._maxTimeIndex = null;
    this._status = 'idle';
    this._statusError = null;
    this._canvas = document.createElement('canvas');
    this._ctx = null;
    this._imageData = null;
    this._repaintFrame = null;

    // Set by the controller — fired true right before a real (non-cache-hit)
    // grid fetch starts, false once it settles. This isn't loading state in
    // the general sense (NiueSuitabilityOverlay's onLoadingChange covers
    // that, for its own /timesteps fetch) — it's specifically "the canvas
    // you're looking at right now is stale, a fetch is catching up to it",
    // most visible during timeline playback against a backend that hasn't
    // been redeployed with the quantized grid format yet (still ~15MB/~2s
    // per timestep instead of ~640KB) — without this signal the map just
    // looks frozen with no indication anything is happening.
    this.onBufferingChange = null;
    // Fired after every repaint with { warning_percent, caution_percent,
    // suitable_percent } across the currently painted grid's valid cells —
    // the Custom-mode equivalent of the backend's per-vessel
    // /niue/suitability/summary percentages, which only ever reflect preset
    // vessel thresholds. Lets callers (ForecastApp's vessel-selector badges)
    // show numbers that agree with what this overlay is actually painting
    // instead of a stale preset reading for whichever vessel is selected.
    this.onSummaryChange = null;
    // Requested/rendered identity is separate from the loading boolean so a
    // failed fetch can never make an older grid look current indefinitely.
    // Shape: { status, requestedTimeIndex, renderedTimeIndex, error }.
    this.onStatusChange = null;
    // Vessel code passed to the most recent setEnvelope() call — carried on
    // getSuitabilityAtPoint()'s result so callers can label a custom-mode
    // point reading the same way a preset one is labelled.
    this._vesselCode = null;
  }

  async setTimeIndex(timeIndex) {
    // Dragging the time slider quickly can fire several overlapping
    // fetches; without this a slow-to-resolve older request can land after
    // a faster newer one and silently repaint stale data over the current
    // timestep. Only the most recent call's result is allowed to apply.
    const requestId = ++this._requestId;
    this._requestedTimeIndex = timeIndex;

    // Cancel whichever grid fetch this call supersedes. requestId fencing
    // (above/below) already stops a stale fetch's *result* from ever being
    // painted, but on its own that leaves the fetch itself running to
    // completion for a frame nobody will see. During playback each tick
    // requests a different time_index, so without this every previous
    // tick's ~15MB fetch (still true against a backend that hasn't been
    // redeployed with the quantized grid format — see the class comment)
    // keeps competing for bandwidth with the one actually being waited on
    // now; ticking faster than one fetch can complete then means the map
    // never repaints again for the rest of the playback session; even at a
    // survivable pace it makes every fetch slower than it needs to be.
    // Scoped to the previous *directly requested* time_index only — a
    // still-relevant prefetch for one of the next few frames is left alone.
    if (this._activeFetchTimeIndex !== null && this._activeFetchTimeIndex !== timeIndex) {
      this._fetchControllers?.get(this._activeFetchTimeIndex)?.abort();
    }
    this._activeFetchTimeIndex = timeIndex;

    let grid = this._getCachedGrid(timeIndex);
    if (!grid) {
      this._lastSummary = null;
      this.onSummaryChange?.(null);
      this.onBufferingChange?.(true);
      this._emitStatus('loading');
      try {
        grid = await this._getOrFetchGrid(timeIndex);
      } catch (err) {
        // A superseded request is no longer user-visible. Its failure must not
        // replace a newer request's status with a stale error.
        if (requestId !== this._requestId || this._destroyed) return;
        this.onBufferingChange?.(false);
        this._emitStatus('error', err.message || String(err));
        throw err;
      }
      if (requestId !== this._requestId) return;
    }
    if (requestId !== this._requestId) return;

    this._grid = grid;
    this._renderedTimeIndex = timeIndex;
    try {
      this._ensureCanvasSize();
      if (this._envelope) this._repaint();
    } catch (err) {
      this.onBufferingChange?.(false);
      this._emitStatus('error', err.message || String(err));
      throw err;
    }
    this.onBufferingChange?.(false);
    this._emitStatus('ready');
    if (this._visible) this._prefetchAhead(timeIndex);
  }

  _emitStatus(status, error = null) {
    this._status = status;
    this._statusError = error;
    this.onStatusChange?.(this.getStatus());
  }

  getStatus() {
    return {
      status: this._status,
      requestedTimeIndex: this._requestedTimeIndex,
      renderedTimeIndex: this._renderedTimeIndex,
      error: this._statusError,
    };
  }

  // The dynamic grid endpoint has no metadata response of its own. The fixed
  // overlay supplies the shared timeline horizon once /timesteps resolves;
  // until then, skip speculative work rather than guessing past the end.
  setMaxTimeIndex(maxTimeIndex) {
    this._maxTimeIndex = Number.isInteger(maxTimeIndex) && maxTimeIndex >= 0
      ? maxTimeIndex
      : null;
    if (this._maxTimeIndex !== null && this._visible && this._renderedTimeIndex !== null) {
      this._prefetchAhead(this._renderedTimeIndex);
    }
  }

  _getCachedGrid(timeIndex) {
    this._gridCache ??= new Map();
    const grid = this._gridCache.get(timeIndex);
    if (!grid) return null;
    // Map insertion order is the LRU order. Touch cache hits so a frame the
    // user scrubbed back to is not the next one evicted.
    this._gridCache.delete(timeIndex);
    this._gridCache.set(timeIndex, grid);
    return grid;
  }

  _cacheGrid(timeIndex, grid) {
    if (this._destroyed) return;
    this._gridCache ??= new Map();
    this._gridCache.delete(timeIndex);
    this._gridCache.set(timeIndex, grid);

    while (this._gridCache.size > MAX_GRID_CACHE_ENTRIES) {
      const evictionKey = [...this._gridCache.keys()].find((key) => key !== this._renderedTimeIndex);
      if (evictionKey === undefined) break;
      this._gridCache.delete(evictionKey);
    }
  }

  _getOrFetchGrid(timeIndex) {
    const cached = this._getCachedGrid(timeIndex);
    if (cached) return Promise.resolve(cached);

    this._gridFetches ??= new Map();
    this._fetchControllers ??= new Map();
    const inFlight = this._gridFetches.get(timeIndex);
    if (inFlight) return inFlight;

    const controller = new AbortController();
    this._fetchControllers.set(timeIndex, controller);
    let fetchResult;
    try {
      fetchResult = this._fetchGrid(timeIndex, controller.signal);
    } catch (err) {
      fetchResult = Promise.reject(err);
    }
    const request = Promise.resolve(fetchResult)
      .then((loadedGrid) => {
        this._cacheGrid(timeIndex, loadedGrid);
        return loadedGrid;
      })
      .finally(() => {
        if (this._gridFetches.get(timeIndex) === request) {
          this._gridFetches.delete(timeIndex);
        }
        if (this._fetchControllers.get(timeIndex) === controller) {
          this._fetchControllers.delete(timeIndex);
        }
      });
    this._gridFetches.set(timeIndex, request);
    return request;
  }

  // Not awaited by callers — this is deliberately best-effort. A prefetch
  // landing after the user has already scrubbed past it just populates the
  // cache for next time; a prefetch failing because of a network blip is
  // silently dropped rather than
  // surfaced as a layer error, since nothing the user is currently looking
  // at depends on it succeeding.
  _prefetchAhead(fromTimeIndex) {
    if (this._maxTimeIndex === null) return;
    this._gridFetches ??= new Map();
    this._prefetchInFlight ??= new Set();
    for (let offset = 1; offset <= PREFETCH_AHEAD_COUNT; offset++) {
      const timeIndex = fromTimeIndex + offset;
      if (timeIndex > this._maxTimeIndex) break;
      if (this._gridCache.has(timeIndex) || this._gridFetches.has(timeIndex) || this._prefetchInFlight.has(timeIndex)) continue;

      this._prefetchInFlight.add(timeIndex);
      Promise.resolve()
        .then(() => this._getOrFetchGrid(timeIndex))
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
    this._envelope = resolveOperatingEnvelope(vesselCode, overrides);
    this._vesselCode = vesselCode;

    if (this._grid) this._scheduleRepaint();
  }

  // Range inputs can emit many changes inside one display frame. Painting
  // ~1.7 million cells for every intermediate event stalls the main thread;
  // coalescing keeps only the latest envelope for each browser frame.
  _scheduleRepaint() {
    if (this._repaintFrame !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      this._repaint();
      return;
    }
    this._repaintFrame = requestAnimationFrame(() => {
      this._repaintFrame = null;
      if (!this._destroyed) this._repaint();
    });
  }

  // Custom-mode counterpart to NiueSuitabilityOverlay.getSuitabilityAtPoint:
  // classifies the already-fetched grid cell nearest (lng, lat) against the
  // live envelope, client-side — there's no backend endpoint for an
  // arbitrary custom envelope. Returns a shape compatible with what
  // SuitabilityDetailsPanel already renders for the preset/backend result
  // (hazard_class, wind_speed_kt, wave_height_m, nearest_face_lat/lon,
  // unavailable_reason), plus is_custom_envelope so callers can label it
  // distinctly from an authoritative backend reading. Async to match
  // NiueSuitabilityOverlay's fetch-based signature even though this never
  // touches the network.
  async getSuitabilityAtPoint(lng, lat) {
    if (this._requestedTimeIndex !== this._renderedTimeIndex) {
      return {
        available: false,
        hazard_class: null,
        is_custom_envelope: true,
        requested_time_index: this._requestedTimeIndex,
        rendered_time_index: this._renderedTimeIndex,
        unavailable_reason: 'The custom map has not finished loading the selected forecast time. Point inspection is paused to avoid reporting an older frame as current.',
      };
    }

    if (!this._grid || !this._envelope) {
      return {
        available: false,
        hazard_class: null,
        is_custom_envelope: true,
        unavailable_reason: 'Custom envelope map is still loading for this forecast time.',
      };
    }

    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return {
        available: false,
        hazard_class: null,
        is_custom_envelope: true,
        unavailable_reason: 'Point coordinates are invalid.',
      };
    }

    const { width, height, bounds, wind, wave, valid } = this._grid;
    const col = Math.round(((lng - bounds.lonMin) / (bounds.lonMax - bounds.lonMin)) * (width - 1));
    // Grid rows run south→north (see _repaint's sourceY comment) and match
    // lat directly — no flip needed here, unlike the canvas-row mapping.
    const row = Math.round(((lat - bounds.latMin) / (bounds.latMax - bounds.latMin)) * (height - 1));

    if (col < 0 || col >= width || row < 0 || row >= height) {
      return {
        available: false,
        hazard_class: null,
        is_custom_envelope: true,
        unavailable_reason: 'Point is outside the custom-envelope forecast grid.',
      };
    }

    const index = row * width + col;
    if (!valid[index]) {
      return {
        available: false,
        hazard_class: null,
        is_custom_envelope: true,
        unavailable_reason: 'No valid model point at this location.',
      };
    }

    const windSpeedKt = wind[index];
    const waveHeightM = wave[index];
    const hazardClass = classifyAgainstOperatingEnvelope(this._envelope, windSpeedKt, waveHeightM);
    if (hazardClass === null) {
      return {
        available: false,
        hazard_class: null,
        vessel: this._vesselCode,
        time_index: this._renderedTimeIndex,
        valid_time: this._grid.validTime ?? null,
        is_custom_envelope: true,
        unavailable_reason: 'Wind or wave data is invalid at this grid cell.',
      };
    }
    const gridCellLat = bounds.latMin + (row / Math.max(height - 1, 1)) * (bounds.latMax - bounds.latMin);
    const gridCellLon = bounds.lonMin + (col / Math.max(width - 1, 1)) * (bounds.lonMax - bounds.lonMin);

    return {
      available: true,
      hazard_class: hazardClass,
      classification_basis: 'custom_wind_wave_thresholds',
      thresholds_used: Object.fromEntries(
        CUSTOM_ENVELOPE_FIELDS.map((field) => [field, this._envelope[field]])
      ),
      vessel: this._vesselCode,
      wind_speed_kt: windSpeedKt,
      wave_height_m: waveHeightM,
      grid_cell_lat: gridCellLat,
      grid_cell_lon: gridCellLon,
      nearest_face_lat: gridCellLat,
      nearest_face_lon: gridCellLon,
      time_index: this._renderedTimeIndex,
      valid_time: this._grid.validTime ?? null,
      is_custom_envelope: true,
    };
  }

  getSummary() {
    return this._lastSummary;
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

  cancelPendingRequests() {
    this._requestId += 1;
    this._activeFetchTimeIndex = null;
    this._fetchControllers?.forEach((controller) => controller.abort());
    this._gridFetches?.clear();
    this._fetchControllers?.clear();
    this._prefetchInFlight?.clear();
    this.onBufferingChange?.(false);
    this._emitStatus('idle');
  }

  clearCache() {
    this._gridCache.clear();
  }

  destroy() {
    this._destroyed = true;
    this._requestId += 1;
    if (this._repaintFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._repaintFrame);
      this._repaintFrame = null;
    }
    this._fetchControllers?.forEach((controller) => controller.abort());
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
    this._gridFetches?.clear();
    this._fetchControllers?.clear();
    this._prefetchInFlight.clear();
    this._grid = null;
    this._envelope = null;
    this._lastSummary = null;
  }

  async _fetchGrid(timeIndex, signal) {
    const resp = await fetch(`${this._apiBase}/niue/suitability/grid/${timeIndex}`, { signal });
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

    if (
      !Object.values(bounds).every(Number.isFinite)
      || bounds.lonMin >= bounds.lonMax
      || bounds.latMin >= bounds.latMax
    ) {
      throw new Error('Suitability grid response has missing, non-finite, or unordered coordinate bounds.');
    }

    const cellCount = width * height;
    if (!Number.isSafeInteger(cellCount) || cellCount <= 0) {
      throw new Error('Suitability grid dimensions produce an invalid cell count.');
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
    const quantized = encoding.includes('i16le');
    const expectedBytes = cellCount * (quantized ? 5 : 9);
    if (buffer.byteLength !== expectedBytes) {
      throw new Error(
        `Suitability grid payload length mismatch: expected ${expectedBytes} bytes, got ${buffer.byteLength}.`
      );
    }

    let grid;
    if (quantized) {
      const windScale = Number(resp.headers.get('X-Wind-Scale'));
      const waveScale = Number(resp.headers.get('X-Wave-Scale'));
      if (!Number.isFinite(windScale) || windScale <= 0 || !Number.isFinite(waveScale) || waveScale <= 0) {
        throw new Error('Quantized suitability grid is missing valid positive wind/wave scale headers.');
      }
      grid = NiueSuitabilityDynamicOverlay._decodeQuantizedGridBuffer(
        buffer, width, height, bounds, windScale, waveScale
      );
    } else {
      grid = NiueSuitabilityDynamicOverlay._decodeGridBuffer(buffer, width, height, bounds);
    }
    return {
      ...grid,
      validTime: resp.headers.get('X-Valid-Time') || null,
    };
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
      valid: new Uint8Array(new Uint8Array(buffer, int16Bytes * 2, cellCount)),
    };
  }

  _ensureCanvasSize() {
    const { width, height } = this._grid;
    if (!this._ctx) {
      this._ctx = this._canvas.getContext('2d', { willReadFrequently: false });
    }
    if (!this._ctx) throw new Error('Custom suitability map requires a 2D canvas context.');
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
    const pixels = this._imageData.data;
    let suitableCount = 0;
    let cautionCount = 0;
    let warningCount = 0;

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

        const hazardClass = classifyAgainstOperatingEnvelope(
          this._envelope, wind[sourceIndex], wave[sourceIndex]
        );
        if (hazardClass === null) {
          pixels[pixelIndex + 3] = 0;
          continue;
        }
        const [r, g, b] = HAZARD_RGB[hazardClass];

        if (hazardClass === 2) warningCount++;
        else if (hazardClass === 1) cautionCount++;
        else suitableCount++;

        pixels[pixelIndex] = r;
        pixels[pixelIndex + 1] = g;
        pixels[pixelIndex + 2] = b;
        pixels[pixelIndex + 3] = 205;
      }
    }

    const validCount = suitableCount + cautionCount + warningCount;
    // Percentages, matching the field names/shape of the backend's per-vessel
    // /niue/suitability/summary entries — so ForecastApp's existing
    // normaliseVesselSummaryForIcon/deriveVesselIconHazard helpers can
    // consume this without a Custom-mode-specific code path.
    this._lastSummary = validCount > 0 ? {
      warning_percent: (warningCount / validCount) * 100,
      caution_percent: (cautionCount / validCount) * 100,
      suitable_percent: (suitableCount / validCount) * 100,
    } : null;
    this.onSummaryChange?.(this._lastSummary);

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
