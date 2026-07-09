// GPUParticleOverlay.js — Ventusky-style GPU particle flow for wave direction.
// Wraps GPUParticleFlowLayer (WebGL2 ping-pong FBO) and feeds it from ZarrDataManager.
// Shares StreamlineOverlay's public API (setTimeIndex/setOpacity/setQuality/destroy)
// so useZarrMap can swap between particle and streamline modes transparently.

import { MapboxOverlay } from '@deck.gl/mapbox';
import ZarrDataManager from '../services/ZarrDataManager';
import GPUParticleFlowLayer from '../layers/GPUParticleFlowLayer';

const QUALITY = {
  balanced: { particleResolution: 256, windResolution: 256, speedFactor: 5.0, lineWidth: 2.0 },
  high:     { particleResolution: 320, windResolution: 256, speedFactor: 4.5, lineWidth: 1.8 },
};

function buildUrl(datasetName, baseUrl) {
  const base = ((baseUrl || '').trim()).replace(/\/+$/, '');
  const ds   = (datasetName || '').replace(/^\/+/, '').replace(/\/+$/, '');
  return `${base}/${ds}`;
}

function norm360(v) { return ((v % 360) + 360) % 360; }

function particleCountLabel(quality) {
  const q = QUALITY[quality] || QUALITY.balanced;
  return q.particleResolution * q.particleResolution;
}

// Convert dirm (coming_from or going_to) + hs → normalised u/v travel vectors.
// meshToGrid stores rows south-to-north; OpenGL tex UV y=0 = south. Axes match.
// u = east component (lon increases), v = north component (lat increases).
function fieldToUV(dirGrid, hsGrid, count, convention) {
  const u = new Float32Array(count);
  const v = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const hs  = hsGrid[i];
    const dir = dirGrid[i];
    if (!Number.isFinite(hs) || hs < 0.05 || !Number.isFinite(dir)) continue;
    const travelDeg = convention === 'coming_from' ? norm360(dir + 180) : norm360(dir);
    const rad = travelDeg * Math.PI / 180;
    u[i] = Math.sin(rad);  // east (lon) component
    v[i] = Math.cos(rad);  // north (lat) component
  }
  return { u, v };
}

export class GPUParticleOverlay {
  constructor(map, config) {
    this.map     = map;
    this.config  = config;
    this.mounted = true;

    this._timeIndex = 0;
    this._opacity   = config.opacity ?? 1.0;
    this._quality   = config.quality  ?? 'balanced';
    this._loadGen   = 0;
    this._rafId     = null;
    this._layerData = null;  // { velocityField, colorField, bounds }

    this.onLoadingChange = null;
    this.onErrorChange   = null;

    // deck.gl overlay — GPU layer is added once data is ready.
    this._deckOverlay = new MapboxOverlay({ interleaved: true, layers: [] });
    map.addControl(this._deckOverlay);

    const zarrUrl = buildUrl(config.datasetName, config.zarrBaseUrl);
    this._zarr = new ZarrDataManager(zarrUrl, { cacheSize: 8, prefetchWindow: 2 });
    this._zarr.init()
      .then(() => { if (this.mounted) this._loadTimestep(this._timeIndex); })
      .catch((err) => { if (this.mounted) this.onErrorChange?.(String(err)); });
  }

  async _loadTimestep(idx) {
    if (!this.mounted) return;
    const gen = ++this._loadGen;
    this.onLoadingChange?.(true);

    try {
      const q = QUALITY[this._quality] || QUALITY.balanced;
      const scalarVariable = this.config.scalarVariable || 'hs';
      const directionVariable = this.config.directionVariable || 'dirm';
      const timesteps = this._zarr.getInterpolationTimesteps(idx);

      if (!this.mounted || gen !== this._loadGen) return;

      const width = q.windResolution;
      const height = q.windResolution;
      const count = width * height;
      // Fetch all 4 window timesteps concurrently. Consecutive timestep changes
      // share 3 of these 4 grids — getGriddedTimestep caches by (timestep,
      // variable, gridSize) so only the newly-entered one is actually regridded.
      const gridsByStep = await Promise.all(
        timesteps.map((t) => this._zarr.getGriddedTimestep(t, [scalarVariable, directionVariable], q.windResolution))
      );
      if (!this.mounted || gen !== this._loadGen) return;

      const velocityField = { u: {}, v: {}, width, height, timesteps };
      let hsGrid = null;
      gridsByStep.forEach((grids, slot) => {
        const timestep = timesteps[slot];
        const stepHsGrid = grids[scalarVariable];
        const dirGrid = grids[directionVariable];
        const { u, v } = fieldToUV(dirGrid, stepHsGrid, count, this.config.directionConvention);
        velocityField.u[timestep] = u;
        velocityField.v[timestep] = v;
        if (timestep === idx || hsGrid === null) hsGrid = stepHsGrid;
      });

      const validHs = Array.from(hsGrid).filter(Number.isFinite);
      const minHs = validHs.length ? Math.min(...validHs) : 0;
      const maxHs = validHs.length ? Math.max(...validHs) : 1;

      const colorField = {
        values: new Float32Array(hsGrid),
        width,
        height,
        min: minHs,
        max: Math.max(maxHs, minHs + 0.1),
      };

      this._layerData = { velocityField, colorField, bounds: this._zarr.bounds };
      this._rebuildLayer();
      this._startLoop();
    } catch (err) {
      if (this.mounted && gen === this._loadGen) this.onErrorChange?.(String(err));
    } finally {
      if (this.mounted && gen === this._loadGen) this.onLoadingChange?.(false);
    }
  }

  // alpha defaults to whatever the live cross-fade progress currently is (see
  // setTimeIndex()/tick()), so callers that don't care about interpolation
  // (setOpacity, quality changes) just get the current visual state as-is.
  _rebuildLayer(alpha = this._currentAlpha ?? 0) {
    if (!this._layerData) return;
    const q = QUALITY[this._quality] || QUALITY.balanced;
    const { velocityField, colorField, bounds } = this._layerData;
    const [minLon, minLat, maxLon, maxLat] = bounds;

    // Include quality in the layer id so deck.gl re-initialises GPU state only on quality changes.
    const layer = new GPUParticleFlowLayer({
      id:                 `gpu-wave-particles-${this._quality}`,
      particleResolution: q.particleResolution,
      windResolution:     q.windResolution,
      speedFactor:        q.speedFactor,
      lineWidth:          q.lineWidth,
      dropRate:           0.004,
      maxAge:             160,
      fadeAmount:         0.035,
      normalizeVelocity:  true,
      waveSpeedScale:     35.0,
      useWaveMode:        true,
      interpAlpha:        alpha,
      globalOpacity:      this._opacity,
      bounds:             [minLon, minLat, maxLon, maxLat],
      velocityField,
      colorField,
    });

    this._currentAlpha = alpha;
    this._deckOverlay.setProps({ layers: [layer] });
  }

  _startLoop() {
    if (this._rafId) return;
    const tick = () => {
      if (!this.mounted) { this._rafId = null; return; }

      // Cross-fade interpAlpha 0→1 over the interval between Play advances,
      // so the shader's cubic temporal interpolation (built into
      // GPUParticleFlowLayer but previously always called with a frozen
      // 0.0) actually smooths the transition between the currently-loaded
      // timestep and the next, instead of every advance being a hard cut.
      // getInterpolationTimesteps() already fetches an overlapping 4-step
      // window per timestep, so the "next" keyframe (p1) is already loaded
      // by the time this reaches alpha=1 — no extra fetch needed here.
      // Duration self-adapts to whatever cadence setTimeIndex() is actually
      // called at (see there), rather than hardcoding the Play interval.
      if (this._transitionStart != null) {
        const elapsed = performance.now() - this._transitionStart;
        const alpha = Math.min(1, elapsed / (this._transitionDurationMs || 900));
        if (alpha !== this._currentAlpha) this._rebuildLayer(alpha);
      }

      // triggerRepaint causes MapLibre → deck.gl → GPUParticleFlowLayer.draw() each frame.
      this.map.triggerRepaint();
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopLoop() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  setTimeIndex(idx) {
    if (this._timeIndex === idx) return;

    // Mark the start of a new cross-fade now (not once _loadTimestep's async
    // fetch resolves), and measure how long it's been since the last advance
    // to size the NEXT cross-fade's duration. This self-adapts to whatever
    // interval the caller's Play loop actually uses (useTimeAnimation.js is
    // a fixed 2s for the raster/inundation path, ~1.5-3s adaptive for the
    // general path) without either file needing to know the other's timing.
    // Clamped so one unusually slow/fast tick can't produce a jarring fade.
    const now = performance.now();
    if (this._lastKeyframeAt != null) {
      this._transitionDurationMs = Math.max(300, Math.min(2500, now - this._lastKeyframeAt));
    }
    this._lastKeyframeAt = now;
    this._transitionStart = now;

    this._timeIndex = idx;
    this._loadTimestep(idx);
  }

  setOpacity(opacity) {
    this._opacity = opacity;
    if (this._layerData) this._rebuildLayer();
  }

  // No-op: kept for API parity with StreamlineOverlay (particles+raster mode handled by UgridOverlay).
  setMode() {}

  setQuality(quality) {
    if (this._quality === quality) return;
    this._quality = quality;
    // Reset data so _rebuildLayer doesn't use the old-resolution field.
    this._layerData = null;
    this._loadTimestep(this._timeIndex);
  }

  destroy() {
    this.mounted = false;
    this.onLoadingChange = null;
    this.onErrorChange   = null;
    this._loadGen += 1;
    this._stopLoop();
    try { this.map.removeControl(this._deckOverlay); } catch { /* already removed */ }
  }
}

export { QUALITY as GPU_PARTICLE_QUALITY, particleCountLabel };
