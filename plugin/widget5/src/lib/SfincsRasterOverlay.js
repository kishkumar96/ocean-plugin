// SfincsRasterOverlay.js
// MapLibre GL raster overlay for the SFINCS inundation FastAPI.
//
// Single-timestep mode: fetches the raw depth grid from the backend's Zarr
//   store (via /metadata → zarr_url) and colors it client-side on a <canvas>
//   (same pipeline as ZarrOverlay), then hands the canvas to MapLibre as a
//   blob-URL ImageSource. MapLibre keeps the previous frame visible while the
//   new one loads — no blank flash during animation. Thresholds/min-visible-
//   depth changes are pure recoloring, no network round-trip.
//
// Range-max mode: calls ImageSource.updateImage() with the /range-max/raster-png
//   URL directly — the backend doesn't yet expose a raw array for an arbitrary
//   min/max time window, only pre-rendered PNGs. Old frame stays visible during
//   the (slow) server fetch.
//
// Both modes share a single MapLibre `image` source — no canvas source (removed
// in MapLibre 5), no separate tile-based source.

import { withRetry } from './withRetry';
import { renderToCanvas, flipRowsVertically } from './canvasRaster';
import { fetchConsolidatedMeta, getVarAttrs, getVarMeta, discoverCoord, openZarrArray, applyScaleOffset, LAT_NAMES, LON_NAMES } from './zarrClient';
import { getColormap } from './colormaps';

const SOURCE_ID = 'sfincs-frame-source';
const LAYER_ID  = 'sfincs-frame-layer';

// 1×1 transparent GIF — placeholder before the first frame loads.
const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// Fallback continuous colormap when no valid threshold categories are configured
// (mirrors the backend's turbo-colormap fallback for render_mode=continuous).
const FALLBACK_COLORMAP = getColormap('turbo');

const FRAME_CACHE_LIMIT = 10;

function serializeThresholdParams(categories) {
  if (!Array.isArray(categories) || categories.length < 2) return null;
  const thresholds = [];
  const colors = [];
  for (const cat of categories) {
    const t = Number(cat?.thresholdM);
    const c = String(cat?.color ?? '').replace(/^#/, '');
    if (!Number.isFinite(t) || !/^[0-9a-fA-F]{6}$/.test(c)) continue;
    thresholds.push(t);
    colors.push(c.toLowerCase());
  }
  if (thresholds.length < 2) return null;
  return {
    render_mode: 'thresholds',
    thresholds: thresholds.join(','),
    colors:     colors.join(','),
  };
}

// Same categories, shaped for canvasRaster's renderToCanvas ({value, color:[r,g,b]}).
function thresholdBands(categories) {
  if (!Array.isArray(categories) || categories.length < 2) return null;
  const bands = [];
  for (const cat of categories) {
    const value = Number(cat?.thresholdM);
    const hex = String(cat?.color ?? '').replace(/^#/, '');
    if (!Number.isFinite(value) || !/^[0-9a-fA-F]{6}$/.test(hex)) continue;
    bands.push({
      value,
      color: [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)],
    });
  }
  return bands.length >= 2 ? bands : null;
}

export class SfincsRasterOverlay {
  constructor(map, config) {
    this._map       = map;
    this._apiBase   = (config.apiBase || '').replace(/\/$/, '');
    this._vmin      = config.minVisibleDepth ?? config.colorRange?.min ?? 0.05;
    this._vmax      = config.colorRange?.max ?? 3.0;
    this._opacity   = config.opacity ?? 0.75;
    this._timeIndex = 0;
    this._rangeWindow  = null;
    // { cycleId, block }: draw the RiskScape hazard block (the 3-day maximum the impact figures were
    // computed from) instead of a time range from the model archive. Falls back to the range when the
    // server does not have that cycle.
    this._hazardBlock  = config.hazardBlock ?? null;
    this._hazardToken  = 0;
    this._hazardKey    = null;
    this._hazardShown  = false;
    // A block that 404s (e.g. the hazard endpoint not deployed for this cycle
    // yet) stays not-found until the block/cycle itself changes -- otherwise
    // any unrelated re-render that calls updateConfig() while _hazardBlock is
    // still set (this._hazardKey/_hazardShown get cleared on failure, below)
    // retries the exact same known-404 URL every time, hammering the endpoint
    // on every incidental parent re-render (confirmed live: dozens of retries
    // during a single color-picker drag elsewhere on the page).
    this._hazardFailedKey = null;
    this.onHazardBlockStatus = null;
    this._categories   = config.inundationCategories ?? null;
    this._renderMode   = config.inundationRenderMode ?? 'continuous';
    this._timesteps    = [];
    this._destroyed    = false;
    this._sourceReady  = false;
    this._inRangeMax   = false;
    this._pendingLoad  = null;   // cancellation token for in-flight fetch
    this._queuedFrameIndex = null; // latest requested frame while a fetch is in flight
    this._loadedFrameIndex = null;
    this._currentBlobUrl = null; // most recent blob URL (revoked on next update)
    // bounds: { southWest: [lat, lon], northEast: [lat, lon] }
    this._bounds = config.bounds ?? null;
    // Cancels this instance's in-flight /timesteps, /metadata, and Zarr
    // metadata/chunk fetches — aborted in destroy(). Without this, rapid
    // layer switching leaves abandoned fetches running to completion in the
    // background, which can pile up enough of them to exhaust the browser's
    // per-origin connection limit and starve the *current* layer's own
    // fetch with a genuine "TypeError: Failed to fetch". The array is opened
    // once with this signal baked into its HTTPStore, so every later
    // per-frame chunk fetch through it is covered too, not just init.
    // Mirrors UgridOverlay's _abortController.
    this._abortController = new AbortController();

    // Client-side Zarr rendering state (populated by _loadZarrArray during init)
    this._variableArr  = null;
    this._varAttrs     = null;
    this._variableIs3D = true;
    this._rows = 0;
    this._cols = 0;
    this._latAscending = false;
    this._frameCache = new Map(); // frameIndex → canvas

    this.onTimeChange    = null;
    this.onLoadingChange = null;
    this.onErrorChange   = null;
    this.onStatsChange   = null;

    this._initialize();
  }

  // ── init ─────────────────────────────────────────────────────────────────

  async _initialize() {
    this._setLoading(true);
    try {
      const signal = this._abortController.signal;
      const [timestepsPayload, metadata] = await Promise.all([
        fetch(`${this._apiBase}/timesteps`, { signal }).then((r) => {
          if (!r.ok) throw new Error(`/timesteps returned ${r.status}`);
          return r.json();
        }),
        fetch(`${this._apiBase}/metadata`, { signal }).then((r) => {
          if (!r.ok) throw new Error(`/metadata returned ${r.status}`);
          return r.json();
        }),
      ]);

      const raw = Array.isArray(timestepsPayload?.timesteps) ? timestepsPayload.timesteps : [];
      this._timesteps = raw
        .map((v) => new Date(v))
        .filter((d) => !Number.isNaN(d.getTime()));

      if (this._destroyed) return;

      if (!metadata?.zarr_url || !metadata?.variable) {
        throw new Error('Inundation /metadata response is missing zarr_url/variable');
      }
      await this._loadZarrArray(`${this._apiBase}${metadata.zarr_url}`, metadata.variable);
      if (this._destroyed) return;

      // One rAF so any prior deck.gl GL-context finalization settles before we
      // write into MapLibre's style (MapLibreOverlay shares the GL context).
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (this._destroyed) return;

      this._addToMap();

      const maxIdx = Math.max(0, this._timesteps.length - 1);
      this.onTimeChange?.(this._timesteps[0]?.toISOString() ?? '', 0, maxIdx);
    } catch (err) {
      if (!this._destroyed && err.name !== 'AbortError') this.onErrorChange?.(err.message);
    } finally {
      if (!this._destroyed) this._setLoading(false);
    }
  }

  // Opens the raw depth Zarr array and determines row orientation (the backend
  // flips vertically when latitude is stored ascending — replicate that here so
  // row 0 of the canvas is always north, matching the image-source coordinates).
  async _loadZarrArray(storeUrl, varName) {
    const signal = this._abortController.signal;
    const consolidated = await fetchConsolidatedMeta(storeUrl, signal);

    const latName = discoverCoord(consolidated, LAT_NAMES);
    const lonName = discoverCoord(consolidated, LON_NAMES);
    if (!latName || !lonName) throw new Error('Could not find lat/lon coordinate arrays in inundation Zarr store');

    const varMeta = getVarMeta(consolidated, varName);
    if (!varMeta) throw new Error(`Variable "${varName}" not found in inundation Zarr store`);
    const [rows, cols] = varMeta.shape.slice(-2);
    this._rows = rows;
    this._cols = cols;
    this._variableIs3D = varMeta.shape.length === 3;

    this._variableArr = await openZarrArray(storeUrl, varName, signal);
    this._varAttrs = getVarAttrs(consolidated, varName);

    const latArrRef = await openZarrArray(storeUrl, latName, signal);
    const latData = await latArrRef.get(null).then((r) => Array.from(r.data, Number));
    this._latAscending = latData.length > 1 && latData[0] < latData[latData.length - 1];
  }

  // ── map source/layer management ───────────────────────────────────────────

  _addToMap() {
    this._removeFromMap();

    const coords = this._imageCoords();
    if (coords) {
      // Image source: starts with transparent placeholder, updated via updateImage()
      this._map.addSource(SOURCE_ID, { type: 'image', url: PLACEHOLDER, coordinates: coords });
    } else {
      // Fallback when no bounds are configured: tile source
      this._map.addSource(SOURCE_ID, {
        type: 'raster',
        tiles: [`${this._apiBase}/tiles/${this._timeIndex}/{z}/{x}/{y}.png`],
        tileSize: 256,
      });
    }

    // Inserted below the RiskScape impact-assets layers (buildings/roads,
    // added once at map init -- see useZarrMap's onLoad) so they stay
    // visible on top of the flood raster instead of being painted over by
    // it. addLayer() with no beforeId always goes to the very top of the
    // whole stack, which is what this used to do -- confirmed live: the
    // impact assets layer was completely hidden under this raster whenever
    // both were on screen together. 'cok-impact-assets-fill' is the bottom
    // of that three-layer group (fill/line/circle all share one beforeId at
    // init, each stacking directly above the last), so targeting it puts
    // this raster below all three, not just the first. Falls back to
    // 'risk-circles' (still above this raster, just not below impact
    // assets) if that layer somehow isn't there yet, matching the same
    // fallback UgridOverlay already uses for the same reason.
    // The MHWS reference layers (land flooded above MHWS + the MHWS contour)
    // sit directly below the impact assets, so the raster goes below THEM
    // first: they are a reference line drawn over the depth colours, and were
    // completely hidden under this raster along the coast when it was
    // inserted just below the assets instead.
    const beforeId = this._map.getLayer('cok-mhws-flood-fill')
      ? 'cok-mhws-flood-fill'
      : this._map.getLayer('cok-impact-assets-fill')
        ? 'cok-impact-assets-fill'
        : (this._map.getLayer('risk-circles') ? 'risk-circles' : undefined);
    this._map.addLayer({
      id: LAYER_ID,
      type: 'raster',
      source: SOURCE_ID,
      // The SFINCS grid is ~5m/cell — well below typical zoomed-in screen
      // resolution — and MapLibre's default 'linear' resampling bilinearly
      // blurs between threshold-colored bands when overscaled. 'nearest'
      // keeps threshold-band edges crisp instead of smearing colors together.
      paint: { 'raster-opacity': this._opacity, 'raster-resampling': 'nearest' },
    }, beforeId);
    this._sourceReady = true;

    if (coords) {
      const source = this._map.getSource(SOURCE_ID);
      // Wait for MapLibre's own placeholder load to finish before calling
      // _loadFrame() (-> updateImage()). ImageSource.onAdd() -> load() runs
      // async on MapLibre's own schedule, separate from addSource() above;
      // if updateImage() overwrites this.options.url before that first
      // load ever starts, and the blob URL involved gets revoked before
      // MapLibre gets around to loading *anything* for this source,
      // ImageSource.image is never set. That leaves prepare()'s `if
      // (!this.image) return;` guard permanently true, so tile.texture is
      // never created and every future render crashes in maplibre-gl's
      // drawRaster on tile.texture.bind(...) ("Cannot read properties of
      // undefined (reading 'bind')") -- confirmed against
      // maplibre-gl's source/image_source.ts. Waiting for the placeholder's
      // own 'data' event first guarantees `image` is set at least once
      // before we ever call updateImage(), closing that race for good.
      if (source && typeof source.once === 'function' && !source.loaded?.()) {
        source.once('data', () => {
          if (!this._destroyed) this._loadFrame(this._timeIndex);
        });
      } else {
        this._loadFrame(this._timeIndex);
      }
    }
  }

  _removeFromMap() {
    this._cancelPendingLoad();
    this._revokeBlobUrl();
    try {
      if (this._map.getLayer(LAYER_ID))   this._map.removeLayer(LAYER_ID);
      if (this._map.getSource(SOURCE_ID)) this._map.removeSource(SOURCE_ID);
    } catch (_) {}
    this._sourceReady = false;
    this._inRangeMax  = false;
  }

  // ── URL builders (range-max mode only — see file header) ──────────────────

  // Colour parameters shared by every server-rendered depth image.
  _renderParams(params) {
    params.set('vmin', String(this._vmin));
    params.set('vmax', String(this._vmax));
    if (this._renderMode === 'continuous') {
      params.set('render_mode', 'continuous');
    } else {
      const tp = serializeThresholdParams(this._categories);
      if (tp) Object.entries(tp).forEach(([k, v]) => params.set(k, v));
    }
    return params;
  }

  _buildRangeMaxImageUrl(rw) {
    const params = this._renderParams(new URLSearchParams({
      start_index: String(rw.startIndex ?? 0),
      end_index:   String(rw.endIndex   ?? 47),
    }));
    return `${this._apiBase}/range-max/raster-png?${params}`;
  }

  _buildHazardBlockUrl({ cycleId, block }) {
    const params = this._renderParams(new URLSearchParams());
    return `${this._apiBase}/cok/hazard/${encodeURIComponent(cycleId)}/block/${encodeURIComponent(block)}/raster-png?${params}`;
  }

  // [lat, lon] bounds → MapLibre image coordinates [TL, TR, BR, BL]
  _imageCoords() {
    if (!this._bounds) return null;
    const [latS, lonW] = this._bounds.southWest;
    const [latN, lonE] = this._bounds.northEast;
    return [[lonW, latN], [lonE, latN], [lonE, latS], [lonW, latS]];
  }

  // ── frame loading ─────────────────────────────────────────────────────────

  _cancelPendingLoad({ clearQueue = true } = {}) {
    if (this._pendingLoad) {
      this._pendingLoad.cancelled = true;
      this._pendingLoad = null;
    }
    if (clearQueue) this._queuedFrameIndex = null;
  }

  _revokeBlobUrl() {
    if (this._currentBlobUrl) {
      const url = this._currentBlobUrl;
      // Deferred, not immediate: MapLibre's ImageSource.updateImage()
      // decodes the blob URL asynchronously. When frames come from
      // _frameCache, _applyCanvasFrame() calls can land back-to-back
      // (e.g. fast timeline scrubbing), and revoking a URL the instant
      // the next one is set can race MapLibre's still-in-flight decode
      // of it, throwing "InvalidStateError: The source image could not
      // be decoded." in the console. blob: URLs are local/in-memory, so
      // a short delay costs nothing and comfortably outlasts any pending
      // decode.
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      this._currentBlobUrl = null;
    }
  }

  async _fetchFrameValues(frameIndex) {
    const selection = this._variableIs3D ? [frameIndex, null, null] : [null, null];
    // .get() returns a NestedArray for multi-dim results — .data is an array of
    // arrays, not a flat typed array. .flatten() gives the row-major flat buffer
    // that renderToCanvas's `values[r * cols + c]` indexing actually needs.
    const raw = await this._variableArr.get(selection).then((r) => r.flatten());
    const scaled = applyScaleOffset(raw, this._varAttrs);
    return this._latAscending ? flipRowsVertically(scaled, this._rows, this._cols) : scaled;
  }

  _cacheFrame(frameIndex, canvas) {
    this._frameCache.set(frameIndex, canvas);
    if (this._frameCache.size > FRAME_CACHE_LIMIT) {
      const firstKey = this._frameCache.keys().next().value;
      this._frameCache.delete(firstKey);
    }
  }

  _applyCanvasFrame(canvas, coords, frameIndex) {
    canvas.toBlob((blob) => {
      if (this._destroyed || !blob) return;
      const blobUrl = URL.createObjectURL(blob);
      const source = this._map.getSource(SOURCE_ID);
      if (source && typeof source.updateImage === 'function') {
        this._revokeBlobUrl();
        this._currentBlobUrl = blobUrl;
        source.updateImage({ url: blobUrl, coordinates: coords });
        this._loadedFrameIndex = frameIndex;
      } else {
        URL.revokeObjectURL(blobUrl);
      }
    });
  }

  // Fetches the raw depth grid for a timestep from the Zarr store, colors it
  // client-side, then hands the canvas to MapLibre as a blob-URL ImageSource.
  // The image source keeps displaying the previous frame until the new one is
  // ready. Transient network failures (a dropped chunk fetch) are retried with
  // backoff rather than dropping the frame silently.
  async _loadFrame(timeIndex) {
    const coords = this._imageCoords();
    if (!coords) { this._updateTiles(); return; }
    if (!this._sourceReady || this._inRangeMax || this._destroyed) return;

    const frameIndex = Math.max(0, Math.min(
      Number.isFinite(timeIndex) ? timeIndex : 0,
      Math.max(0, this._timesteps.length - 1)
    ));

    if (this._pendingLoad) {
      this._queuedFrameIndex = frameIndex;
      return;
    }

    const cached = this._frameCache.get(frameIndex);
    if (cached) {
      this._applyCanvasFrame(cached, coords, frameIndex);
      this._loadQueuedFrame();
      return;
    }

    const token = { cancelled: false, frameIndex };
    this._pendingLoad = token;

    try {
      const values = await withRetry(
        () => this._fetchFrameValues(frameIndex),
        {
          shouldAbort: () => token.cancelled || this._destroyed,
          onRetry: (err, attempt, delay) => {
            console.warn(`[SfincsRasterOverlay] fetch failed for frame ${frameIndex} (attempt ${attempt}), retrying in ${delay}ms`, err);
          },
        }
      );
      if (token.cancelled || this._destroyed) return;

      // Opacity is applied via the layer's raster-opacity paint property (see
      // setOpacity), not baked into pixel alpha — keeps the frame cache valid
      // across opacity changes instead of needing a full re-render.
      const canvas = renderToCanvas(
        values, this._rows, this._cols, FALLBACK_COLORMAP,
        this._vmin, this._vmax, /* opacity */ 1,
        this._renderMode === 'continuous' ? null : thresholdBands(this._categories),
        this._vmin
      );
      this._cacheFrame(frameIndex, canvas);
      this._applyCanvasFrame(canvas, coords, frameIndex);
    } catch (err) {
      if (!token.cancelled && !this._destroyed) {
        console.error(`[SfincsRasterOverlay] gave up on frame ${frameIndex} after retries`, err);
      }
    } finally {
      if (this._pendingLoad === token) this._pendingLoad = null;
      this._loadQueuedFrame();
    }
  }

  _loadQueuedFrame() {
    if (this._destroyed || this._inRangeMax || !this._sourceReady || this._pendingLoad) return;
    const frameIndex = this._queuedFrameIndex;
    this._queuedFrameIndex = null;
    if (frameIndex == null || frameIndex === this._loadedFrameIndex) return;
    this._loadFrame(frameIndex);
  }

  // Fallback tile update (used when no bounds are configured)
  _updateTiles() {
    if (!this._sourceReady) return;
    try {
      this._map.getSource(SOURCE_ID)
        ?.setTiles([`${this._apiBase}/tiles/${this._timeIndex}/{z}/{x}/{y}.png`]);
    } catch (_) {}
  }

  // ── range-max mode ────────────────────────────────────────────────────────
  // The backend only exposes pre-rendered PNGs for an arbitrary min/max time
  // window (no raw-array compositing endpoint yet) — this mode stays server-side.

  _applyRangeMax(rw) {
    const coords = this._imageCoords();
    if (!coords) { this._updateTiles(); return; }

    this._cancelPendingLoad();
    this._revokeBlobUrl(); // range-max uses a direct URL, not a blob
    const url = this._buildRangeMaxImageUrl(rw);
    const source = this._map.getSource(SOURCE_ID);
    if (source && typeof source.updateImage === 'function') {
      source.updateImage({ url, coordinates: coords });
    }
    this._inRangeMax = true;
  }

  // ── hazard-block mode ─────────────────────────────────────────────────────
  // The exact raster RiskScape read for one forecast window of one cycle. Fetched as a blob so a
  // server that lacks the cycle (404) can be detected and the time-range image used instead.

  async _applyHazardBlock() {
    const hb = this._hazardBlock;
    const coords = this._imageCoords();
    if (!hb || !coords) return;
    const url = this._buildHazardBlockUrl(hb);
    if ((this._hazardShown && this._hazardKey === url) || this._hazardFailedKey === url) return;

    this._cancelPendingLoad();
    const token = ++this._hazardToken;
    try {
      const resp = await fetch(url, { signal: this._abortController.signal });
      if (token !== this._hazardToken || this._destroyed) return;
      if (!resp.ok) throw new Error(`hazard block ${hb.cycleId}/${hb.block} returned ${resp.status}`);
      const blob = await resp.blob();
      if (token !== this._hazardToken || this._destroyed) return;
      const blobUrl = URL.createObjectURL(blob);
      const source = this._map.getSource(SOURCE_ID);
      if (!source || typeof source.updateImage !== 'function') { URL.revokeObjectURL(blobUrl); return; }
      this._revokeBlobUrl();
      this._currentBlobUrl = blobUrl;
      source.updateImage({ url: blobUrl, coordinates: coords });
      this._inRangeMax = true;
      this._hazardShown = true;
      this._hazardKey = url;
      this._hazardFailedKey = null;
      this.onHazardBlockStatus?.({ state: 'ok', cycleId: resp.headers.get('X-Hazard-Cycle') || hb.cycleId, block: hb.block });
    } catch (err) {
      if (err?.name === 'AbortError' || token !== this._hazardToken || this._destroyed) return;
      console.warn('[SfincsRasterOverlay] hazard block unavailable, using the time range instead', err);
      this._hazardShown = false;
      this._hazardKey = null;
      this._hazardFailedKey = url;
      this.onHazardBlockStatus?.({ state: 'unavailable', cycleId: hb.cycleId, block: hb.block, reason: err?.message });
      this._applyTimeRangeOrFrame();
    }
  }

  // Whatever the map would show with no hazard block: the range image, else the timestep frame.
  _applyTimeRangeOrFrame() {
    const isRangeMax = this._rangeWindow && this._rangeWindow.mode !== 'single';
    if (isRangeMax && this._bounds) {
      this._applyRangeMax(this._rangeWindow);
    } else {
      this._inRangeMax = false;
      this._cancelPendingLoad();
      if (this._imageCoords()) this._loadFrame(this._timeIndex);
      else this._updateTiles();
    }
  }

  // ── public interface ──────────────────────────────────────────────────────

  setTimeIndex(timeIndex) {
    const max = Math.max(0, this._timesteps.length - 1);
    this._timeIndex = Math.max(0, Math.min(timeIndex, max));
    if (this._inRangeMax) return;

    const coords = this._imageCoords();
    if (coords) {
      this._loadFrame(this._timeIndex);
    } else {
      this._updateTiles();
    }
  }

  setOpacity(opacity) {
    this._opacity = opacity;
    if (!this._sourceReady) return;
    try {
      if (this._map.getLayer(LAYER_ID))
        this._map.setPaintProperty(LAYER_ID, 'raster-opacity', opacity);
    } catch (_) {}
  }

  updateConfig({ rangeWindow, hazardBlock, inundationCategories, minVisibleDepth, inundationRenderMode } = {}) {
    if (rangeWindow          !== undefined) this._rangeWindow = rangeWindow;
    if (hazardBlock          !== undefined) this._hazardBlock = hazardBlock;
    const recolor = inundationCategories !== undefined
      || (minVisibleDepth !== undefined && minVisibleDepth !== null)
      || (inundationRenderMode !== undefined && inundationRenderMode !== this._renderMode);
    if (inundationCategories !== undefined) this._categories  = inundationCategories;
    if (minVisibleDepth      !== undefined && minVisibleDepth !== null) this._vmin = minVisibleDepth;
    if (inundationRenderMode !== undefined) this._renderMode = inundationRenderMode;
    // Cached canvases were colored with the old thresholds/floor/render mode — drop them.
    if (recolor) this._frameCache.clear();
    if (!this._sourceReady) return;

    if (this._hazardBlock) {
      this._applyHazardBlock();
      return;
    }
    if (this._hazardShown) {
      this._hazardShown = false;
      this._hazardKey = null;
      this._hazardToken += 1; // drop any fetch still in flight
      this.onHazardBlockStatus?.(null);
    }
    this._applyTimeRangeOrFrame();
  }

  async getTimeseriesAtPoint(lng, lat) {
    const url = `${this._apiBase}/depth-timeseries?lat=${lat}&lon=${lng}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`/depth-timeseries ${resp.status}`);
    const payload = await resp.json();

    const rawValues = Array.isArray(payload?.values) ? payload.values : [];
    if (rawValues.length === 0) return null;

    const timeLabels = rawValues.map((v) => v.time ?? '');
    const depthValues = rawValues.map((v) => {
      const d = v.depth_m;
      return typeof d === 'number' && Number.isFinite(d) ? d : 0;
    });

    return {
      lon: payload.lon_requested ?? lng,
      lat: payload.lat_requested ?? lat,
      timeLabels,
      variables: [{ name: 'depth', values: depthValues }],
    };
  }

  getTimeLabels() {
    return this._timesteps.map((t) =>
      t.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
    );
  }

  destroy() {
    this._destroyed = true;
    this._abortController.abort();
    this._frameCache.clear();
    this._removeFromMap();
  }

  _setLoading(value) {
    this.onLoadingChange?.(value);
  }
}
