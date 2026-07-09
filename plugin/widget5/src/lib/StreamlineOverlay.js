// StreamlineOverlay.js — Windy-style animated streamlines for wave direction.
// Pre-computes fixed paths from the hs/dirm field then animates dashes along them.
// Fixed paths reveal the true flow topology; animated dashes convey direction and speed.

import ZarrDataManager from '../services/ZarrDataManager';
import { getColormap } from './colormaps';

// Same palette as the swan-rarotonga hs raster layer (mapLayersConfig.js) so
// streamlines read as the same physical quantity as the raster underneath them.
const waveColormap = getColormap('x-sst');

const QUALITY = {
  balanced: { gridSize: 160, seedsX: 30, seedsY: 22, maxSteps: 140, stepScale: 0.0038, dashLen: 22, dashGap: 58, dashSpeedBase: 28, lineWidthBase: 1.5 },
  high:     { gridSize: 224, seedsX: 44, seedsY: 33, maxSteps: 180, stepScale: 0.0032, dashLen: 26, dashGap: 68, dashSpeedBase: 36, lineWidthBase: 1.3 },
};

function buildUrl(datasetName, baseUrl) {
  const base = ((baseUrl || '').trim()).replace(/\/+$/, '');
  const ds   = (datasetName || '').replace(/^\/+/, '').replace(/\/+$/, '');
  return `${base}/${ds}`;
}

function norm360(v) { return ((v % 360) + 360) % 360; }

// Bilinear interpolation over a flat Width×Height grid at normalised [0,1] coords.
function sampleGrid(grid, width, height, u, v) {
  if (!grid || width <= 1 || height <= 1) return NaN;
  const x  = Math.max(0, Math.min(width  - 1, u * (width  - 1)));
  const y  = Math.max(0, Math.min(height - 1, v * (height - 1)));
  const x0 = Math.floor(x), x1 = Math.min(width  - 1, x0 + 1);
  const y0 = Math.floor(y), y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const at = (xi, yi) => { const w = grid[yi * width + xi]; return Number.isFinite(w) ? w : NaN; };
  const v00 = at(x0, y0), v10 = at(x1, y0), v01 = at(x0, y1), v11 = at(x1, y1);
  const valid = [v00, v10, v01, v11].filter(Number.isFinite);
  if (!valid.length) return NaN;
  const fb = valid.reduce((s, n) => s + n, 0) / valid.length;
  const row0 = (Number.isFinite(v00) ? v00 : fb) * (1 - fx) + (Number.isFinite(v10) ? v10 : fb) * fx;
  const row1 = (Number.isFinite(v01) ? v01 : fb) * (1 - fx) + (Number.isFinite(v11) ? v11 : fb) * fx;
  return row0 * (1 - fy) + row1 * fy;
}

function waveColorRGB(hs, minHs, maxHs) {
  const t = Math.max(0, Math.min(1, (hs - minHs) / Math.max(0.1, maxHs - minHs)));
  return waveColormap(t);
}

// Trace streamlines from a jittered seed grid through the hs/dirm field.
function computeStreamlines(field, quality, directionConvention) {
  const { hsGrid, dirGrid, width, height, bounds, minHs, maxHs } = field;
  const { seedsX, seedsY, maxSteps, stepScale } = quality;
  const [minLon, minLat, maxLon, maxLat] = bounds;
  const hsSpan       = Math.max(0.1, maxHs - minHs);
  const domainAspect = Math.max(0.25, Math.abs((maxLat - minLat) / (maxLon - minLon)));
  const lines = [];

  for (let si = 0; si < seedsX; si++) {
    for (let sj = 0; sj < seedsY; sj++) {
      // Slight random jitter prevents all lines from landing exactly on grid intersections.
      let u = (si + 0.25 + Math.random() * 0.5) / seedsX;
      let v = (sj + 0.25 + Math.random() * 0.5) / seedsY;

      const pts    = [];
      const hsVals = [];

      for (let step = 0; step < maxSteps; step++) {
        const hs      = sampleGrid(hsGrid,  width, height, u, v);
        const dirFrom = sampleGrid(dirGrid, width, height, u, v);
        if (!Number.isFinite(hs) || !Number.isFinite(dirFrom) || hs < 0.05) break;

        pts.push([minLon + u * (maxLon - minLon), minLat + v * (maxLat - minLat)]);
        hsVals.push(hs);

        const travelDir = norm360(directionConvention === 'coming_from' ? dirFrom + 180 : dirFrom);
        const theta     = travelDir * Math.PI / 180;
        const hsNorm    = Math.max(0, Math.min(1, (hs - minHs) / hsSpan));
        // Larger waves produce slightly faster steps → proportional path spacing.
        const sz        = stepScale * (0.35 + hsNorm * 1.45);

        const nextU = u + Math.sin(theta) * sz * domainAspect;
        const nextV = v + Math.cos(theta) * sz;
        if (nextU < 0 || nextU > 1 || nextV < 0 || nextV > 1) break;
        u = nextU;
        v = nextV;
      }

      if (pts.length >= 6) {
        const avgHs = hsVals.reduce((s, h) => s + h, 0) / hsVals.length;
        lines.push({ pts, avgHs, minHs, maxHs });
      }
    }
  }

  return lines;
}

export class StreamlineOverlay {
  constructor(map, config) {
    this.map    = map;
    this.config = config;
    this.mounted = true;

    this._timeIndex    = 0;
    this._opacity      = config.opacity ?? 0.85;
    this._quality      = config.quality  ?? 'balanced';
    this._field        = null;
    this._lines        = [];
    this._screenLines  = null;  // cached per-frame projected coords; null = stale
    this._rafId        = null;
    this._loadGen      = 0;
    this._animTime     = 0;
    this._lastTs       = null;

    this.onLoadingChange = null;
    this.onErrorChange   = null;

    // Canvas overlay — sits above the MapLibre canvas, pointer-events disabled.
    this._canvas = document.createElement('canvas');
    this._ctx    = this._canvas.getContext('2d');
    this._canvas.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
    map.getContainer().appendChild(this._canvas);
    this._resize();

    this._onMapMove = () => { this._screenLines = null; };
    this._onResize  = () => { this._resize(); this._screenLines = null; };
    map.on('move',   this._onMapMove);
    map.on('resize', this._onResize);

    const zarrUrl = buildUrl(config.datasetName, config.zarrBaseUrl);
    this._zarr = new ZarrDataManager(zarrUrl, { cacheSize: 6, prefetchWindow: 2 });
    this._zarr.init()
      .then(() => { if (this.mounted) this._loadTimestep(this._timeIndex); })
      .catch((err) => { if (this.mounted) this.onErrorChange?.(String(err)); });
  }

  _resize() {
    const c = this.map.getContainer();
    this._canvas.width  = c.clientWidth;
    this._canvas.height = c.clientHeight;
  }

  async _loadTimestep(idx) {
    if (!this.mounted) return;
    const gen = ++this._loadGen;
    this.onLoadingChange?.(true);

    try {
      const quality = QUALITY[this._quality] || QUALITY.balanced;
      const field = await this._zarr.getWaveDirectionFieldForParticles(
        idx,
        this.config.scalarVariable    || 'hs',
        this.config.directionVariable || 'dirm',
        quality.gridSize,
      );
      if (!this.mounted || gen !== this._loadGen) return;
      this._field       = field;
      this._lines       = computeStreamlines(field, quality, this.config.directionConvention);
      this._screenLines = null;
      this._startLoop();
    } catch (err) {
      if (this.mounted && gen === this._loadGen) this.onErrorChange?.(String(err));
    } finally {
      if (this.mounted && gen === this._loadGen) this.onLoadingChange?.(false);
    }
  }

  _projectLines() {
    this._screenLines = this._lines.map(line => ({
      ...line,
      screen: line.pts.map(([lon, lat]) => {
        const p = this.map.project([lon, lat]);
        return [p.x, p.y];
      }),
    }));
  }

  _drawFrame(timestamp) {
    if (!this.mounted || !this._field) return;

    const dt = Math.min(0.05, (timestamp - (this._lastTs ?? timestamp)) / 1000);
    this._lastTs    = timestamp;
    this._animTime += dt;

    if (!this._screenLines) this._projectLines();

    const canvas = this._canvas;
    const ctx    = this._ctx;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this._screenLines?.length) return;

    const quality = QUALITY[this._quality] || QUALITY.balanced;
    const { dashLen, dashGap, dashSpeedBase, lineWidthBase } = quality;
    const PERIOD = dashLen + dashGap;
    const { minHs, maxHs } = this._field;
    const cw = canvas.width, ch = canvas.height;
    const opacity = this._opacity;

    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    for (const sline of this._screenLines) {
      const pts = sline.screen;
      if (pts.length < 2) continue;

      // Cull lines completely outside the viewport (with 120 px margin for dashes)
      const visible = pts.some(([x, y]) => x > -120 && x < cw + 120 && y > -120 && y < ch + 120);
      if (!visible) continue;

      const t = Math.max(0, Math.min(1, (sline.avgHs - minHs) / Math.max(0.1, maxHs - minHs)));
      const [r, g, b] = waveColorRGB(sline.avgHs, minHs, maxHs);

      // Ghost baseline: faint, reveals path structure between dash gaps.
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.strokeStyle = `rgba(${r},${g},${b},${(0.07 + t * 0.07) * opacity})`;
      ctx.lineWidth   = lineWidthBase * 0.6;
      ctx.setLineDash([]);
      ctx.stroke();

      // Animated dashes: faster + wider for larger wave heights.
      const animOffset = (this._animTime * dashSpeedBase * (0.4 + t * 1.8)) % PERIOD;
      ctx.strokeStyle   = `rgba(${r},${g},${b},${(0.42 + t * 0.48) * opacity})`;
      ctx.lineWidth     = lineWidthBase + t * 1.8;
      ctx.setLineDash([dashLen, dashGap]);
      ctx.lineDashOffset = -animOffset;

      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    }

    ctx.setLineDash([]);
  }

  _startLoop() {
    if (this._rafId) return;
    const loop = (ts) => {
      if (!this.mounted) { this._rafId = null; return; }
      this._drawFrame(ts);
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _stopLoop() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (this._ctx && this._canvas) {
      this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    }
  }

  setTimeIndex(idx) {
    if (this._timeIndex === idx) return;
    this._timeIndex = idx;
    this._loadTimestep(idx);
  }

  setOpacity(opacity) { this._opacity = opacity; }

  setQuality(quality) {
    if (this._quality === quality) return;
    this._quality = quality;
    this._lines        = [];
    this._screenLines  = null;
    this._loadTimestep(this._timeIndex);
  }

  destroy() {
    this.mounted = false;
    this.onLoadingChange = null;
    this.onErrorChange   = null;
    this._loadGen += 1;
    this._stopLoop();
    this.map.off('move',   this._onMapMove);
    this.map.off('resize', this._onResize);
    try { this._canvas.remove(); } catch { /* already removed */ }
  }
}
