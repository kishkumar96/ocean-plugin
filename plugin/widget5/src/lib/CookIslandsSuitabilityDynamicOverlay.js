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
// with). setTimeIndex() is the only method that touches the network for the
// classification data (one fetch per timestep, cached, plus a one-frame-
// ahead background prefetch -- see _prefetchNext()); setEnvelope() re-tags
// the already-cached grid with a new tile URL and asks MapLibre to reload
// whatever tiles are on screen -- no data re-fetch, see _refreshTiles().
//
// Rendering: a MapLibre custom tile protocol (addProtocol), not a single
// whole-domain canvas. An earlier version painted one big canvas (the coarse
// grid's own resolution x a fixed upscale factor) and cut precise coastlines
// into it via bounding boxes around named islands. That worked, but could
// never match the preset tiles pixel-for-pixel: resolution was capped by the
// upscale factor regardless of zoom, and it needed a curated island list
// instead of covering the whole domain. Rendering per-tile the same way the
// preset layer does removes both limits: each requested {z}/{x}/{y} is
// classified at that tile's own resolution (so it sharpens with zoom exactly
// like the preset layer), and masked with the SAME {z}/{x}/{y} mask tile
// (/cok/suitability/mask/..., see main.py) -- identical geometry, no
// coordinate transform between the two, so the coastline can't drift out of
// alignment the way a separately-projected island cutout could.
//
// The summary fetch (/cok/suitability/summary, time metadata) is deferred
// until the first real setTimeIndex() call rather than firing from the
// constructor: the controller constructs this overlay alongside the
// fixed/preset one and keeps it warm even while Custom mode is never used
// (see CookIslandsSuitabilityController.js), so an eager fetch here used to
// cost a summary + grid-0 request on every suitability layer mount
// regardless of which mode the user ends up in.

import * as maplibregl from 'maplibre-gl';
import { classifyAgainstOperatingEnvelope, HAZARD_TILE_ALPHA } from './CookIslandsSuitabilityOverlay';
import { SUITABILITY_DEBUG_TIMING, logSuitabilityFrameTiming } from './suitabilityDebugTiming';
import { parseUtcTimestamp } from '../utils/backendTime';

const SOURCE_ID = 'cok-suitability-dynamic-source';
const LAYER_ID = 'cok-suitability-dynamic-layer';
const TILE_SIZE = 256;

const KM_PER_DEGREE_LAT = 111.32;

// A fresh scheme per overlay instance (module-load-time counter -- this
// class isn't a singleton, and maplibregl.addProtocol/removeProtocol are
// global to the library, not per-map) so two overlay instances (or a
// destroy()+recreate cycle) can never collide on the same registration.
let protocolCounter = 0;

// Inverse slippy-tile math -- matches the backend's tile_to_lonlat_bounds
// exactly (both implement the same standard Web Mercator tiling), which is
// what makes a classification tile and its mask tile land in exact register
// with no coordinate transform needed between them.
function tileXYToLonLatBounds(x, y, z) {
  const n = 2 ** z;
  const lonMin = (x / n) * 360 - 180;
  const lonMax = ((x + 1) / n) * 360 - 180;
  const toLat = (yTile) => (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * yTile) / n)));
  return { lonMin, lonMax, latMin: toLat(y + 1), latMax: toLat(y) };
}

const HAZARD_RGB = {
  0: [42, 157, 143],   // #2A9D8F Suitable
  1: [244, 162, 97],   // #F4A261 Caution
  2: [230, 57, 70],    // #E63946 Warning
};

// Same alpha for every class, and the same one the server uses for the preset tiles
// (HAZARD_TILE_ALPHA). Suitable used to be drawn at 0.18 ("contextual, so the satellite basemap stays
// readable") while the preset draws it at 0.82, so switching Preset -> Custom made the green vanish.
export const hazardTileAlpha = (hazardClass) => (HAZARD_RGB[hazardClass] ? HAZARD_TILE_ALPHA : 0);

// Bilinearly sample the continuous wind/wave fields at (lon, lat) from a
// decoded /cok/suitability/grid response, then let the caller classify --
// matching the preset tiles' own bilinear-sample-then-classify order (see
// backend bilinear_sample_raster + cok_suitability_tile) rather than
// classifying each coarse cell first and blending the resulting colours,
// which produces "muddy" intermediate legend colours positioned wherever
// two sparse samples happen to sit, not where the interpolated field
// actually crosses a threshold. Missing/land corners are dropped from the
// weighted average (renormalized over whichever corners ARE valid) --
// coastline precision is the mask tile's job now, not this grid's coarse
// per-cell validity.
function sampleGrid(grid, lon, lat) {
  const { width, height, bounds, wind, wave, valid } = grid;
  const colFrac = ((lon - bounds.lonMin) / (bounds.lonMax - bounds.lonMin)) * width - 0.5;
  const rowFrac = ((bounds.latMax - lat) / (bounds.latMax - bounds.latMin)) * height - 0.5;
  const nx0 = Math.max(0, Math.min(width - 1, Math.floor(colFrac)));
  const nx1 = Math.min(width - 1, nx0 + 1);
  const wx = Math.max(0, Math.min(1, colFrac - nx0));
  const ny0 = Math.max(0, Math.min(height - 1, Math.floor(rowFrac)));
  const ny1 = Math.min(height - 1, ny0 + 1);
  const wy = Math.max(0, Math.min(1, rowFrac - ny0));
  // Grid rows run south->north (backend builds lats via np.arange from
  // lat.min()); rowFrac above is already north-based (0 at latMax), so no
  // separate flip is needed here -- ny0/ny1 index the array directly.
  const sy0 = height - 1 - ny0;
  const sy1 = height - 1 - ny1;

  let wSum = 0; let windAcc = 0; let waveAcc = 0;
  const i00 = sy0 * width + nx0; const w00 = (1 - wx) * (1 - wy);
  const i10 = sy0 * width + nx1; const w10 = wx * (1 - wy);
  const i01 = sy1 * width + nx0; const w01 = (1 - wx) * wy;
  const i11 = sy1 * width + nx1; const w11 = wx * wy;
  if (valid[i00]) { wSum += w00; windAcc += wind[i00] * w00; waveAcc += wave[i00] * w00; }
  if (valid[i10]) { wSum += w10; windAcc += wind[i10] * w10; waveAcc += wave[i10] * w10; }
  if (valid[i01]) { wSum += w01; windAcc += wind[i01] * w01; waveAcc += wave[i01] * w01; }
  if (valid[i11]) { wSum += w11; windAcc += wind[i11] * w11; waveAcc += wave[i11] * w11; }
  if (wSum <= 0) return null;
  return { windKt: windAcc / wSum, waveM: waveAcc / wSum };
}

export class CookIslandsSuitabilityDynamicOverlay {
  // opts.opacity: the Overlay Opacity slider's current value, so a Custom overlay created while the
  // slider is already at, say, 100% starts there. (It used to start at a fixed 0.85 and only caught up
  // when the slider next moved, so Custom was drawn dimmer than Preset at the same setting.)
  constructor(map, opts = {}) {
    this._map = map;
    this._gridCache = new Map(); // time_index -> parsed grid
    this._destroyed = false;
    this._requestId = 0;
    this._timeIndex = 0;
    this._timeLabels = [];
    this._timeCount = 0;
    this._grid = null;
    this._envelope = null;
    this._opacity = opts.opacity ?? 0.85;
    // Desired visibility, tracked independently of whether LAYER_ID exists
    // yet. setVisible() below used to be a no-op until the layer was first
    // created (by _refreshTiles(), from the first ready envelope+grid) -- if
    // the controller switched back to preset mode while that first
    // custom-mode grid fetch was still in flight, the fetch would later
    // resolve and the layer would come up with no layout.visibility
    // (MapLibre defaults to visible), silently showing the custom overlay
    // over a map the user had already switched away from. Recorded here and
    // applied when the layer is created so a layer created late still comes
    // up in whatever visibility state was most recently requested.
    this._visible = true;
    // Aborts whichever grid fetch a new setTimeIndex() call supersedes, so a
    // slow, no-longer-wanted request doesn't keep competing for bandwidth
    // with the one actually being waited on now (rapid scrubbing otherwise
    // stacks up fetches faster than they resolve).
    this._activeFetchController = null;
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

    // Mask tiles never change (the coastline doesn't move), so they're
    // cached for the life of this overlay instance regardless of
    // envelope/timestep -- keyed by "z/x/y". null in the cache means "asked,
    // got nothing usable" (fetch failure or a tile the mask endpoint can't
    // produce), which is treated as "no extra masking available" rather
    // than retried every time the same tile is requested again.
    this._maskCache = new Map();
    this._maskFetchPromises = new Map();

    // addProtocol/removeProtocol are global to the maplibregl module, not
    // scoped to `map` -- a unique scheme per instance means a second overlay
    // (or a destroy()+recreate) can never collide on the registration.
    this._protocolScheme = `cok-custom-envelope-${protocolCounter++}`;
    maplibregl.addProtocol(this._protocolScheme, this._handleTileRequest.bind(this));

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
    // Backend timestamps are UTC with no zone marker -- never `new Date()` them directly
    // (utils/backendTime.js).
    const start = parseUtcTimestamp(startStr);
    const end = parseUtcTimestamp(endStr);
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
      if (this._envelope) this._refreshTiles();
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
        if (this._envelope) this._refreshTiles();
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
      if (this._envelope) this._refreshTiles();
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
    // A tile request already in flight for an evicted time_index (see
    // _handleTileRequest) just renders as unavailable -- MapLibre will
    // re-request it if that timestep becomes current again.
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
    if (this._grid) this._refreshTiles();
  }

  // The grid cell under a map position, classified against the envelope in
  // force. Deliberately nearest-cell (not the bilinear sampling the tile
  // protocol below uses for display) -- this reports what the underlying
  // model actually measured at the nearest sample point, for the hover
  // readout, not a smoothed estimate. Null when there is no grid/envelope
  // yet, the position is outside the grid, or the cell is land/no-data.
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

  setOpacity(opacity) {
    this._opacity = opacity;
    if (this._map?.getLayer(LAYER_ID)) {
      this._map.setPaintProperty(LAYER_ID, 'raster-opacity', opacity);
    }
    // raster-opacity is the ONLY place opacity is applied. It used to be baked into every tile's
    // alpha as well, so the slider's value counted twice (50% looked like 25%) and every change
    // regenerated all on-screen tiles for nothing.
  }

  // Recomputes stats from the grid's own native cells (one vote per actual
  // sample -- unaffected by whatever resolution any given on-screen tile
  // happens to render at) and re-tags the tile source with the current
  // envelope/timestep so MapLibre reloads whatever tiles are on screen.
  // Never touches the network itself: the grid is already cached, and each
  // reloaded tile is computed synchronously-async from that cache plus
  // already-cached (or freshly fetched, once) mask tiles.
  _refreshTiles() {
    if (!this._grid || !this._envelope) return;
    const { width, height, wind, wave, valid, bounds } = this._grid;

    let suitableCount = 0, cautionCount = 0, warningCount = 0;
    for (let i = 0; i < width * height; i++) {
      if (!valid[i]) continue;
      const hazardClass = classifyAgainstOperatingEnvelope(this._envelope, wind[i], wave[i]);
      if (hazardClass === null) continue;
      if (hazardClass === 2) warningCount++;
      else if (hazardClass === 1) cautionCount++;
      else suitableCount++;
    }
    const validCount = suitableCount + cautionCount + warningCount;
    this.onStatsChange?.(null, null, null, validCount > 0 ? {
      warning_percent: (warningCount / validCount) * 100,
      caution_percent: (cautionCount / validCount) * 100,
      suitable_percent: (suitableCount / validCount) * 100,
    } : null);

    const tileUrl = this._buildTileUrl();
    const existing = this._map.getSource(SOURCE_ID);
    if (existing) {
      existing.setTiles([tileUrl]);
      return;
    }

    this._map.addSource(SOURCE_ID, {
      type: 'raster',
      tiles: [tileUrl],
      tileSize: TILE_SIZE,
      // Restricts requests to tiles overlapping the product's own domain --
      // MapLibre won't even ask the protocol handler for tiles entirely
      // outside this, unlike the old whole-canvas approach which had no
      // opinion on zoomed-out/out-of-domain requests because there weren't
      // per-tile requests to begin with.
      bounds: [bounds.lonMin, bounds.latMin, bounds.lonMax, bounds.latMax],
    });
    const beforeId = this._map.getLayer('risk-circles') ? 'risk-circles' : undefined;
    this._map.addLayer({
      id: LAYER_ID,
      type: 'raster',
      source: SOURCE_ID,
      layout: { visibility: this._visible ? 'visible' : 'none' },
      paint: { 'raster-opacity': this._opacity, 'raster-resampling': 'linear' },
    }, beforeId);
  }

  // Encodes timestep + envelope into the tile URL template itself (not read
  // from `this` inside the protocol handler) so every tile request is fully
  // self-describing: an in-flight request dispatched under an older
  // template still renders correctly for what it actually asked for, even
  // if setEnvelope()/setTimeIndex() have since moved on. This also means
  // switching back to a previously-used threshold set or timestep is an
  // instant MapLibre-internal cache hit, not a recompute.
  _buildTileUrl() {
    const e = this._envelope;
    const q = new URLSearchParams({
      ti: String(this._timeIndex),
      wc: String(e.cautionWindKt), ww: String(e.maxWindKt),
      cc: String(e.cautionWaveHeightM), cw: String(e.maxWaveHeightM),
    });
    return `${this._protocolScheme}://{z}/{x}/{y}?${q}`;
  }

  // MapLibre custom-protocol handler (see maplibregl.addProtocol) -- called
  // once per tile MapLibre actually needs on screen, with {z}/{x}/{y}
  // already substituted into the URL. Fully determined by the URL's own
  // query params (see _buildTileUrl) plus this._gridCache, not by whatever
  // this._grid/this._envelope currently are.
  async _handleTileRequest(requestParameters, abortController) {
    const url = requestParameters.url;
    const rest = url.slice(this._protocolScheme.length + 3); // strip "scheme://"
    const [pathPart, queryPart] = rest.split('?');
    const [z, x, y] = pathPart.split('/').map(Number);
    const params = new URLSearchParams(queryPart || '');
    const timeIndex = Number(params.get('ti'));
    const envelope = {
      cautionWindKt: Number(params.get('wc')), maxWindKt: Number(params.get('ww')),
      cautionWaveHeightM: Number(params.get('cc')), maxWaveHeightM: Number(params.get('cw')),
    };

    const grid = this._gridCache.get(timeIndex);
    const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
    const ctx = canvas.getContext('2d');
    if (!grid) return { data: await createImageBitmap(canvas) }; // evicted/not-yet-cached -- blank, MapLibre will re-request if this timestep comes back

    const tileBounds = tileXYToLonLatBounds(x, y, z);
    const imageData = ctx.createImageData(TILE_SIZE, TILE_SIZE);
    const pixels = imageData.data;
    for (let py = 0; py < TILE_SIZE; py++) {
      const lat = tileBounds.latMax - ((py + 0.5) / TILE_SIZE) * (tileBounds.latMax - tileBounds.latMin);
      for (let px = 0; px < TILE_SIZE; px++) {
        const lon = tileBounds.lonMin + ((px + 0.5) / TILE_SIZE) * (tileBounds.lonMax - tileBounds.lonMin);
        const pixelIndex = (py * TILE_SIZE + px) * 4;
        const sample = sampleGrid(grid, lon, lat);
        if (!sample) { pixels[pixelIndex + 3] = 0; continue; }
        const hazardClass = classifyAgainstOperatingEnvelope(envelope, sample.windKt, sample.waveM);
        if (hazardClass === null) { pixels[pixelIndex + 3] = 0; continue; }
        const [r, g, b] = HAZARD_RGB[hazardClass];
        pixels[pixelIndex] = r;
        pixels[pixelIndex + 1] = g;
        pixels[pixelIndex + 2] = b;
        pixels[pixelIndex + 3] = Math.round(hazardTileAlpha(hazardClass) * 255);
      }
    }
    ctx.putImageData(imageData, 0, 0);

    // Same {z}/{x}/{y} as this classification tile -- exact pixel register,
    // no bounding-box/reprojection math, so the coastline is precisely
    // where the preset layer's own per-pixel _is_marine check puts it. A
    // failed/unavailable mask tile (see _getMaskTile) just leaves this
    // classification tile un-clipped rather than blocking it.
    const mask = await this._getMaskTile(z, x, y, abortController.signal);
    if (mask) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(mask, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }

    return { data: await createImageBitmap(canvas) };
  }

  async _getMaskTile(z, x, y, signal) {
    const key = `${z}/${x}/${y}`;
    if (this._maskCache.has(key)) return this._maskCache.get(key);
    if (this._maskFetchPromises.has(key)) return this._maskFetchPromises.get(key);

    const promise = (async () => {
      try {
        const resp = await fetch(`/cok/suitability/mask/${z}/${x}/${y}.png`, { signal });
        if (!resp.ok) { this._maskCache.set(key, null); return null; }
        const bitmap = await createImageBitmap(await resp.blob());
        if (!this._destroyed) this._maskCache.set(key, bitmap);
        return bitmap;
      } catch {
        // Network failure or this specific tile request's own AbortController
        // firing (e.g. panned away before it resolved) -- not cached as null,
        // so a genuinely-still-needed tile gets a fresh attempt next time,
        // unlike a real 404/500 from the endpoint itself (cached above).
        return null;
      } finally {
        this._maskFetchPromises.delete(key);
      }
    })();
    this._maskFetchPromises.set(key, promise);
    return promise;
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
    this._activeFetchController?.abort();
    this._prefetchController?.abort();
    this._gridCache.clear();
    this._maskCache.clear();
    maplibregl.removeProtocol(this._protocolScheme);
    const map = this._map;
    this._map = null;
    if (!map) return;
    try {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    } catch (_) {}
  }
}
