// CookIslandsSuitabilityDynamicOverlay.js
// Client-classified suitability overlay for interactively adjustable
// wind/wave thresholds. CookIslandsSuitabilityOverlay.js stays the
// tile-based overlay for the four fixed vessel presets; this is a sibling
// for "custom operating envelope" mode, backed by
// /cok/suitability/grid/{time_index} (a coarser, downsampled raw wind/wave
// grid -- see that endpoint's docstring for why it's coarser than the
// tile-rendering raster) instead of pre-rendered per-vessel PNG tiles.
//
// Simpler than widget1's NiueSuitabilityDynamicOverlay.js in one respect:
// no legacy float32 grid fallback (this endpoint only ever speaks the
// quantized int16 format, so there's no older deployment to stay compatible
// with). setTimeIndex() is the only method that touches the network (one
// fetch per timestep, cached, plus a one-frame-ahead background prefetch --
// see _prefetchNext()); setEnvelope() repaints a canvas already held in
// memory.
//
// The summary fetch (/cok/suitability/summary, time metadata) is deferred
// until the first real setTimeIndex() call rather than firing from the
// constructor: the controller constructs this overlay alongside the
// fixed/preset one and keeps it warm even while Custom mode is never used
// (see CookIslandsSuitabilityController.js), so an eager fetch here used to
// cost a summary + grid-0 request on every suitability layer mount
// regardless of which mode the user ends up in.

import { classifyAgainstOperatingEnvelope } from './CookIslandsSuitabilityOverlay';
import { SUITABILITY_DEBUG_TIMING, logSuitabilityFrameTiming } from './suitabilityDebugTiming';

const SOURCE_ID = 'cok-suitability-dynamic-source';
const LAYER_ID = 'cok-suitability-dynamic-layer';

const KM_PER_DEGREE_LAT = 111.32;

const HAZARD_RGB = {
  0: [42, 157, 143],   // #2A9D8F Suitable
  1: [244, 162, 97],   // #F4A261 Caution
  2: [230, 57, 70],    // #E63946 Warning
};

export class CookIslandsSuitabilityDynamicOverlay {
  constructor(map) {
    this._map = map;
    this._gridCache = new Map(); // time_index -> parsed grid
    this._destroyed = false;
    this._requestId = 0;
    this._timeIndex = 0;
    this._timeLabels = [];
    this._timeCount = 0;
    this._grid = null;
    this._envelope = null;
    this._opacity = 0.85;
    this._canvas = document.createElement('canvas');
    this._ctx = null;
    this._imageData = null;
    // Desired visibility, tracked independently of whether LAYER_ID exists
    // yet. setVisible() below used to be a no-op until the layer was first
    // created (by _ensureMapSource(), from the first repaint) -- if the
    // controller switched back to preset mode while that first custom-mode
    // grid fetch was still in flight, the fetch would later resolve and
    // _ensureMapSource() would create the layer with no layout.visibility
    // (MapLibre defaults to visible), silently showing the custom overlay
    // over a map the user had already switched away from. Recorded here and
    // applied in _ensureMapSource() so a layer created late still comes up
    // in whatever visibility state was most recently requested.
    this._visible = true;
    // Aborts whichever grid fetch a new setTimeIndex() call supersedes, so a
    // slow, no-longer-wanted request doesn't keep competing for bandwidth
    // with the one actually being waited on now (rapid scrubbing otherwise
    // stacks up fetches faster than they resolve).
    this._activeFetchController = null;
    // requestAnimationFrame handle for a pending _repaint(), see
    // _scheduleRepaint().
    this._repaintFrame = null;
    // Memoized summary fetch -- see _ensureSummary(). Not started until the
    // first real setTimeIndex() call.
    this._summaryLoaded = false;
    this._summaryPromise = null;
    // One-frame-ahead prefetch state, see _prefetchNext(). _prefetchPromise
    // is the raw in-flight fetch (before its own .then/.catch handling) so
    // setTimeIndex() can await the same request instead of firing a
    // duplicate one when playback reaches this step before the prefetch
    // has resolved.
    this._prefetchIndex = null;
    this._prefetchController = null;
    this._prefetchPromise = null;

    this.onLoadingChange = null;
    this.onTimeChange = null;
    this.onErrorChange = null;
    this.onStatsChange = null;
  }

  _ensureSummary() {
    if (!this._summaryPromise) this._summaryPromise = this._fetchSummary();
    return this._summaryPromise;
  }

  async _fetchSummary() {
    this._setLoading(true);
    try {
      const res = await fetch('/cok/suitability/summary');
      if (!res.ok) throw new Error(`Suitability summary: HTTP ${res.status}`);
      const data = await res.json();
      if (this._destroyed) return false;
      this._timeCount = data.n_timesteps || 0;
      this._timeLabels = this._buildTimeLabels(data.forecast_start, data.forecast_end, this._timeCount);
      this._summaryLoaded = true;
      return true;
    } catch (err) {
      if (!this._destroyed) this.onErrorChange?.(err.message);
      // Let a later setTimeIndex() call retry instead of permanently
      // remembering this failure as "the" summary result.
      this._summaryPromise = null;
      return false;
    } finally {
      if (!this._destroyed) this._setLoading(false);
    }
  }

  _buildTimeLabels(startStr, endStr, n) {
    const clean = (s) => (s || '').replace(/\.0+$/, '').replace(' ', 'T');
    const start = new Date(clean(startStr));
    const end = new Date(clean(endStr));
    if (isNaN(start) || n <= 0) return [];
    const stepMs = n > 1 ? (end - start) / (n - 1) : 3_600_000;
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(start.getTime() + i * stepMs);
      return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    });
  }

  async setTimeIndex(timeIndex) {
    const frameStart = SUITABILITY_DEBUG_TIMING ? performance.now() : 0;
    this._timeIndex = timeIndex;

    if (!this._summaryLoaded) {
      const ok = await this._ensureSummary();
      if (this._destroyed || !ok) return; // error already reported by _fetchSummary
      // A newer setTimeIndex() call may have superseded this one while the
      // summary request was in flight.
      if (this._timeIndex !== timeIndex) return;
    }

    this.onTimeChange?.(this._timeLabels[timeIndex] ?? '', timeIndex, this._timeCount - 1);

    if (this._gridCache.has(timeIndex)) {
      this._grid = this._gridCache.get(timeIndex);
      const repaintStart = SUITABILITY_DEBUG_TIMING ? performance.now() : 0;
      if (this._envelope) this._repaint();
      if (SUITABILITY_DEBUG_TIMING) {
        logSuitabilityFrameTiming({
          timeIndex, cacheHit: true, fetchMs: 0, downloadDecodeMs: 0,
          repaintMs: performance.now() - repaintStart,
          totalMs: performance.now() - frameStart,
        });
      }
      this._prefetchNext(timeIndex);
      return;
    }

    // Reuse an already in-flight prefetch for this exact step instead of
    // firing a duplicate request. Playback reaching a step before its
    // one-frame-ahead prefetch has resolved is the common case whenever a
    // grid fetch takes longer than the step interval (see
    // suitabilityDebugTiming's custom-mode findings) -- without this, the
    // foreground request and the prefetch raced each other for the same
    // bytes with no benefit from either.
    if (this._prefetchIndex === timeIndex && this._prefetchPromise) {
      const requestId = ++this._requestId;
      this._setLoading(true);
      try {
        const grid = await this._prefetchPromise;
        if (this._destroyed || requestId !== this._requestId) return;
        this._cacheGrid(timeIndex, grid);
        this._grid = grid;
        if (this._envelope) this._repaint();
        this._setLoading(false);
        this._prefetchNext(timeIndex);
        return;
      } catch (err) {
        if (this._destroyed || requestId !== this._requestId) return;
        // The prefetch we tried to reuse failed/was aborted -- fall through
        // to a fresh foreground fetch below rather than surfacing an error
        // for a frame playback still wants to display.
      }
    }

    // A stale, still-in-flight fetch for whatever time_index this call
    // supersedes would otherwise keep running to completion for a frame
    // nobody will see, competing for bandwidth with the fetch below. The
    // requestId check on the awaited result already stops a late-arriving
    // stale response from being painted, but that alone doesn't free up the
    // network/CPU work itself.
    this._activeFetchController?.abort();
    const controller = new AbortController();
    this._activeFetchController = controller;

    const requestId = ++this._requestId;
    this._setLoading(true);
    const timing = SUITABILITY_DEBUG_TIMING ? {} : null;
    try {
      const grid = await CookIslandsSuitabilityDynamicOverlay._fetchGrid(timeIndex, controller.signal, timing);
      if (this._destroyed || requestId !== this._requestId) return;
      this._cacheGrid(timeIndex, grid);
      this._grid = grid;
      const repaintStart = SUITABILITY_DEBUG_TIMING ? performance.now() : 0;
      if (this._envelope) this._repaint();
      if (SUITABILITY_DEBUG_TIMING) {
        logSuitabilityFrameTiming({
          timeIndex, cacheHit: false,
          fetchMs: timing.headersReceived - timing.fetchStart,
          downloadDecodeMs: timing.decodeComplete - timing.headersReceived,
          repaintMs: performance.now() - repaintStart,
          totalMs: performance.now() - frameStart,
        });
      }
      this._setLoading(false);
      this._prefetchNext(timeIndex);
    } catch (err) {
      // A superseded fetch rejects (aborted above) at the same moment a
      // newer setTimeIndex() call has already bumped _requestId, so this
      // check alone is enough to distinguish "cancelled, ignore it" from a
      // real fetch failure — no separate AbortError name check needed.
      if (!this._destroyed && requestId === this._requestId) {
        this.onErrorChange?.(err.message);
        this._setLoading(false);
      }
    }
  }

  _cacheGrid(idx, grid) {
    this._gridCache.set(idx, grid);
    // Bound memory: current + a few recent/prefetched frames is enough,
    // this isn't meant to hold a whole forecast's worth of decoded grids.
    if (this._gridCache.size > 5) {
      const oldestKey = this._gridCache.keys().next().value;
      this._gridCache.delete(oldestKey);
    }
  }

  // Loads the next timestep's grid in the background while the current one
  // is on screen, so useZarrMap's load-aware Play pacing finds the frame
  // already cached instead of paying a fresh network round-trip on every
  // tick -- the sequential fetch-wait-render loop this overlay used to have
  // no way around. Best-effort: a failure here is silently dropped, since
  // the real setTimeIndex() call for that frame (once Play actually reaches
  // it) retries the fetch itself and reports any genuine error normally.
  _prefetchNext(currentIndex) {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= this._timeCount) return;
    if (this._gridCache.has(nextIndex) || this._prefetchIndex === nextIndex) return;

    this._prefetchController?.abort();
    const controller = new AbortController();
    this._prefetchController = controller;
    this._prefetchIndex = nextIndex;

    const fetchPromise = CookIslandsSuitabilityDynamicOverlay._fetchGrid(nextIndex, controller.signal);
    this._prefetchPromise = fetchPromise;

    fetchPromise
      .then((grid) => {
        if (this._destroyed || this._prefetchIndex !== nextIndex) return;
        this._cacheGrid(nextIndex, grid);
      })
      .catch(() => {})
      .finally(() => {
        if (this._prefetchIndex === nextIndex) {
          this._prefetchIndex = null;
          this._prefetchPromise = null;
        }
      });
  }

  // timing (optional): when provided, filled in with performance.now()
  // marks at each stage -- see setTimeIndex()'s SUITABILITY_DEBUG_TIMING
  // block for how these turn into fetchMs/downloadDecodeMs. Left null for
  // prefetch calls (see _prefetchNext()), which aren't the frame the user
  // is actually waiting on.
  static async _fetchGrid(timeIndex, signal, timing = null) {
    if (timing) timing.fetchStart = performance.now();
    const resp = await fetch(`/cok/suitability/grid/${timeIndex}`, { signal });
    // fetch() resolves once response headers arrive; the body may still be
    // streaming in, hence the separate bufferComplete mark below.
    if (timing) timing.headersReceived = performance.now();
    if (!resp.ok) throw new Error(`Suitability grid t${timeIndex}: HTTP ${resp.status}`);

    const width = Number(resp.headers.get('X-Grid-Width'));
    const height = Number(resp.headers.get('X-Grid-Height'));
    const bounds = {
      lonMin: Number(resp.headers.get('X-Lon-Min')),
      lonMax: Number(resp.headers.get('X-Lon-Max')),
      latMin: Number(resp.headers.get('X-Lat-Min')),
      latMax: Number(resp.headers.get('X-Lat-Max')),
    };
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error(
        `Suitability grid response missing/invalid X-Grid-Width or X-Grid-Height ` +
        `(got ${resp.headers.get('X-Grid-Width')}x${resp.headers.get('X-Grid-Height')}).`
      );
    }
    if (!Object.values(bounds).every(Number.isFinite) || bounds.lonMin >= bounds.lonMax || bounds.latMin >= bounds.latMax) {
      throw new Error('Suitability grid response has missing, non-finite, or unordered coordinate bounds.');
    }

    const windScale = Number(resp.headers.get('X-Wind-Scale'));
    const waveScale = Number(resp.headers.get('X-Wave-Scale'));
    if (!Number.isFinite(windScale) || windScale <= 0 || !Number.isFinite(waveScale) || waveScale <= 0) {
      throw new Error('Suitability grid is missing valid positive wind/wave scale headers.');
    }

    const cellCount = width * height;
    const buffer = await resp.arrayBuffer();
    if (timing) timing.bufferComplete = performance.now();
    const expectedBytes = cellCount * 5; // i16 + i16 + u8
    if (buffer.byteLength !== expectedBytes) {
      throw new Error(`Suitability grid payload length mismatch: expected ${expectedBytes} bytes, got ${buffer.byteLength}.`);
    }

    const int16Bytes = cellCount * 2;
    const windRaw = new Int16Array(buffer, 0, cellCount);
    const waveRaw = new Int16Array(buffer, int16Bytes, cellCount);
    const wind = new Float32Array(cellCount);
    const wave = new Float32Array(cellCount);
    for (let i = 0; i < cellCount; i++) {
      wind[i] = windRaw[i] / windScale;
      wave[i] = waveRaw[i] / waveScale;
    }
    const valid = new Uint8Array(buffer, int16Bytes * 2, cellCount);
    if (timing) timing.decodeComplete = performance.now();

    return { width, height, bounds, wind, wave, valid, validTime: resp.headers.get('X-Valid-Time') || null };
  }

  setEnvelope(envelope) {
    this._envelope = envelope;
    if (this._grid) this._scheduleRepaint();
  }

  // The grid cell under a map position, classified against the envelope in
  // force. Uses the same pixel mapping _repaint()/_ensureMapSource() draw with
  // (canvas spans lonMin..lonMax x latMax..latMin, row 0 north), so the hazard
  // returned is always the colour visibly under the cursor. Null when there is
  // no grid/envelope yet, the position is outside the grid, or the cell is
  // land/no-data (painted transparent).
  getPointAt(lng, lat) {
    const grid = this._grid;
    const envelope = this._envelope;
    if (!grid || !envelope || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;

    const { width, height, bounds, wind, wave, valid, validTime } = grid;
    if (lng < bounds.lonMin || lng >= bounds.lonMax || lat <= bounds.latMin || lat > bounds.latMax) return null;

    const x = Math.floor(((lng - bounds.lonMin) / (bounds.lonMax - bounds.lonMin)) * width);
    const canvasRow = Math.floor(((bounds.latMax - lat) / (bounds.latMax - bounds.latMin)) * height);
    const sourceIndex = (height - 1 - canvasRow) * width + x;
    if (!valid[sourceIndex]) return null;

    const windKt = wind[sourceIndex];
    const waveM = wave[sourceIndex];
    const hazardClass = classifyAgainstOperatingEnvelope(envelope, windKt, waveM);
    if (hazardClass === null) return null;
    // Cell height derived from the grid's own bounds (row spacing = span / (rows - 1)),
    // not the backend's COK_SUITABILITY_GRID_STRIDE, so it stays right if that changes.
    const cellSizeKm = height > 1
      ? ((bounds.latMax - bounds.latMin) / (height - 1)) * KM_PER_DEGREE_LAT
      : null;
    return { hazardClass, windKt, waveM, validTime, cellSizeKm, envelope: { ...envelope } };
  }

  // Range inputs can emit many changes inside one display frame. Painting
  // the full grid for every intermediate event stalls the main thread;
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

  setOpacity(opacity) {
    this._opacity = opacity;
    if (this._map?.getLayer(LAYER_ID)) {
      this._map.setPaintProperty(LAYER_ID, 'raster-opacity', opacity);
    }
  }

  _ensureCanvasSize() {
    const { width, height } = this._grid;
    if (!this._ctx) this._ctx = this._canvas.getContext('2d', { willReadFrequently: false });
    if (this._canvas.width !== width || this._canvas.height !== height) {
      this._canvas.width = width;
      this._canvas.height = height;
      this._imageData = this._ctx.createImageData(width, height);
    }
  }

  _repaint() {
    if (!this._grid || !this._envelope) return;
    this._ensureCanvasSize();
    const { width, height, wind, wave, valid, bounds } = this._grid;
    const pixels = this._imageData.data;
    let suitableCount = 0, cautionCount = 0, warningCount = 0;

    for (let y = 0; y < height; y++) {
      // Grid rows run south->north (backend builds lats via np.arange from
      // lat.min()), but canvas row 0 is the top (north) -- flip once here.
      const sourceY = height - 1 - y;
      for (let x = 0; x < width; x++) {
        const sourceIndex = sourceY * width + x;
        const pixelIndex = (y * width + x) * 4;

        if (!valid[sourceIndex]) {
          pixels[pixelIndex + 3] = 0;
          continue;
        }
        const hazardClass = classifyAgainstOperatingEnvelope(this._envelope, wind[sourceIndex], wave[sourceIndex]);
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
        pixels[pixelIndex + 3] = Math.round(this._opacity * 255);
      }
    }

    const validCount = suitableCount + cautionCount + warningCount;
    this.onStatsChange?.(null, null, null, validCount > 0 ? {
      warning_percent: (warningCount / validCount) * 100,
      caution_percent: (cautionCount / validCount) * 100,
      suitable_percent: (suitableCount / validCount) * 100,
    } : null);

    this._ctx.putImageData(this._imageData, 0, 0);
    this._ensureMapSource(bounds);
    this._map.triggerRepaint();
  }

  _ensureMapSource(bounds) {
    const coordinates = [
      [bounds.lonMin, bounds.latMax],
      [bounds.lonMax, bounds.latMax],
      [bounds.lonMax, bounds.latMin],
      [bounds.lonMin, bounds.latMin],
    ];

    const existing = this._map.getSource(SOURCE_ID);
    if (existing) {
      existing.setCoordinates(coordinates);
      // animate:false CanvasSources only re-upload their GPU texture on
      // creation or while "playing" (see MapLibre's canvas_source.ts) -- a
      // play()/pause() pair forces exactly one refresh per repaint instead
      // of paying for animate:true's continuous re-upload on every pan/zoom.
      existing.play?.();
      existing.pause?.();
      return;
    }

    this._map.addSource(SOURCE_ID, { type: 'canvas', canvas: this._canvas, coordinates, animate: false });
    const beforeId = this._map.getLayer('risk-circles') ? 'risk-circles' : undefined;
    this._map.addLayer({
      id: LAYER_ID,
      type: 'raster',
      source: SOURCE_ID,
      layout: { visibility: this._visible ? 'visible' : 'none' },
      paint: { 'raster-opacity': this._opacity, 'raster-resampling': 'nearest' },
    }, beforeId);
  }

  _setLoading(val) {
    this.onLoadingChange?.(val);
  }

  getTimeLabels() {
    return this._timeLabels;
  }

  setVisible(visible) {
    this._visible = visible;
    if (this._map?.getLayer(LAYER_ID)) {
      this._map.setLayoutProperty(LAYER_ID, 'visibility', visible ? 'visible' : 'none');
    }
  }

  getTimeseriesAtPoint() {
    return Promise.resolve(null);
  }

  destroy() {
    this._destroyed = true;
    if (this._repaintFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._repaintFrame);
      this._repaintFrame = null;
    }
    this._activeFetchController?.abort();
    this._prefetchController?.abort();
    this._gridCache.clear();
    const map = this._map;
    this._map = null;
    if (!map) return;
    try {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    } catch (_) {}
  }
}
