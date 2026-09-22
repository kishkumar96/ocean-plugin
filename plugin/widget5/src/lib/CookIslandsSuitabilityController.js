// CookIslandsSuitabilityController.js
// Public-facing suitability overlay: wraps the fixed tile-based overlay
// (CookIslandsSuitabilityOverlay, four preset vessel classes) and the
// dynamic canvas-based overlay (CookIslandsSuitabilityDynamicOverlay,
// adjustable wind/wave envelope) behind one interface, so useZarrMap only
// ever deals with a single "suitability layer" regardless of Preset/Custom
// mode. Mirrors widget1's NiueSuitabilityController.js.
//
// Preset and Custom are UI modes of the same product, not two different
// layers a user can pick from the layer list.
//
// Both overlays stay constructed, but only the active mode's overlay is
// kept fetching per timestep -- the inactive one just has its desired time
// remembered (see setTimeIndex/setMode below), so a hidden layer's tile/
// grid requests never compete with the one actually on screen. Switching
// mode loads the newly-active overlay's current time immediately.
//
// Unlike Niue's dynamic overlay, CookIslandsSuitabilityDynamicOverlay fetches
// its own summary and reports its own loading/error/stats independently
// (see that file's header comment) -- so callback forwarding here is
// mode-gated rather than always routed through the fixed overlay: whichever
// overlay is actually on screen is the one whose loading/error/stats reach
// the caller.

import { CookIslandsSuitabilityOverlay, resolveOperatingEnvelope } from './CookIslandsSuitabilityOverlay';
import { CookIslandsSuitabilityDynamicOverlay } from './CookIslandsSuitabilityDynamicOverlay';

const HAZARD_LABELS = { 0: 'Suitable', 1: 'Caution', 2: 'Warning' };

export class CookIslandsSuitabilityController {
  constructor(map, config = {}) {
    this._mode = config.suitabilityMode === 'custom' ? 'custom' : 'preset';
    this._timeIndex = config.timeIndex ?? 0;
    this.fixed = new CookIslandsSuitabilityOverlay(map, config);
    this.dynamic = new CookIslandsSuitabilityDynamicOverlay(map);
    this._applyVisibility();

    this.setEnvelope(
      config.vesselClass || 'traditional_craft',
      this._mode === 'custom' ? (config.customEnvelope || {}) : {},
    );
    if (this._mode === 'custom') this._loadDynamicTimeIndex();
  }

  // Mode-gated: only the overlay backing the currently active mode reaches
  // the caller. A background preset fetch continuing while the user is
  // looking at Custom mode (kept warm for a fast switch-back) shouldn't
  // spam the loading/error UI for a layer that isn't even on screen.
  set onTimeChange(fn) {
    this._onTimeChange = fn;
    this.fixed.onTimeChange = fn ? (...args) => { if (this._mode === 'preset') fn(...args); } : null;
    this.dynamic.onTimeChange = fn ? (...args) => { if (this._mode === 'custom') fn(...args); } : null;
  }
  get onTimeChange() { return this._onTimeChange ?? null; }

  set onLoadingChange(fn) {
    this._onLoadingChange = fn;
    this.fixed.onLoadingChange = fn ? (v) => { if (this._mode === 'preset') fn(v); } : null;
    this.dynamic.onLoadingChange = fn ? (v) => { if (this._mode === 'custom') fn(v); } : null;
  }
  get onLoadingChange() { return this._onLoadingChange ?? null; }

  set onErrorChange(fn) {
    this._onErrorChange = fn;
    this.fixed.onErrorChange = fn ? (msg) => { if (this._mode === 'preset') fn(msg); } : null;
    this.dynamic.onErrorChange = fn ? (msg) => { if (this._mode === 'custom') fn(msg); } : null;
  }
  get onErrorChange() { return this._onErrorChange ?? null; }

  set onStatsChange(fn) {
    this._onStatsChange = fn;
    this.fixed.onStatsChange = fn ? (...args) => { if (this._mode === 'preset') fn(...args); } : null;
    this.dynamic.onStatsChange = fn ? (...args) => { if (this._mode === 'custom') fn(...args); } : null;
  }
  get onStatsChange() { return this._onStatsChange ?? null; }

  getTimeLabels() {
    return this.fixed.getTimeLabels();
  }

  // Mode-gated, symmetrically with the dynamic overlay below: while a mode
  // is inactive, its overlay is left alone rather than kept fetching every
  // step for a layer that isn't on screen. The desired index is retained
  // either way, so switching mode starts exactly one foreground load for
  // the correct current time (see setMode's fixed catch-up, and this
  // file's header comment). Previously `fixed` was updated unconditionally
  // here, which meant every Custom-mode timestep also fired the preset
  // overlay's points/advice fetch and raster tile reload for a hidden
  // layer, competing for bandwidth with the custom grid fetch actually on
  // screen (see suitabilityDebugTiming's custom-mode capture).
  setTimeIndex(timeIndex) {
    this._timeIndex = timeIndex;
    if (this._mode === 'preset') {
      this.fixed.setTimeIndex(timeIndex);
    } else {
      this._loadDynamicTimeIndex();
    }
  }

  _loadDynamicTimeIndex() {
    this.dynamic.setTimeIndex(this._timeIndex).catch((err) => {
      if (err?.name === 'AbortError') return;
      this.onErrorChange?.(err.message);
    });
  }

  setOpacity(opacity) {
    this.fixed.setOpacity(opacity);
    this.dynamic.setOpacity(opacity);
  }

  // Preset-mode vessel selection (tile overlay only). Custom mode's vessel
  // + thresholds go through setEnvelope instead -- callers already
  // recompute the effective envelope from VESSEL_OPERATING_ENVELOPE plus
  // any overrides and pass the merged result there.
  setVesselClass(vesselClass) {
    this.fixed.setVesselClass(vesselClass);
  }

  // overrides: {} for "just use vessel's preset envelope" (still routes
  // through the dynamic/canvas render path -- used so Custom mode shows
  // literally the same numbers as Preset until the user actually moves a
  // slider), or the vessel's envelope fields the user has overridden.
  //
  // resolveOperatingEnvelope throws for an unknown vessel code, or overrides
  // that describe an invalid envelope (non-finite/negative, or caution >=
  // avoid). The slider UI already clamps input so a bad override should
  // never reach here in practice, but this is also the constructor's call
  // path, so an uncaught throw here would blow up controller construction
  // entirely rather than degrading gracefully. Fall back to the vessel's own
  // preset and report the problem the same way a rejected grid load already
  // does, instead of leaving the map on stale or absent thresholds.
  setEnvelope(vesselClass, overrides = {}) {
    this._vesselClass = vesselClass;
    try {
      this.dynamic.setEnvelope(resolveOperatingEnvelope(vesselClass, overrides));
    } catch (err) {
      this.onErrorChange?.(err.message);
      if (!overrides || Object.keys(overrides).length === 0) return;
      try {
        this.dynamic.setEnvelope(resolveOperatingEnvelope(vesselClass, {}));
      } catch (_) { /* vessel itself is unknown; already reported above */ }
    }
  }

  setMode(mode) {
    if (mode !== 'preset' && mode !== 'custom') {
      throw new Error(`Unknown suitability mode: ${mode}`);
    }
    const changed = mode !== this._mode;
    this._mode = mode;
    this._applyVisibility();
    // Catch the just-activated overlay up to the current time: while it was
    // inactive, setTimeIndex() above left it alone, so it may be stale.
    if (changed && mode === 'preset') this.fixed.setTimeIndex(this._timeIndex);
    if (changed && mode === 'custom') this._loadDynamicTimeIndex();
  }

  _applyVisibility() {
    const showCustomCanvas = this._mode === 'custom';
    this.fixed.setVisible(!showCustomCanvas);
    this.dynamic.setVisible(showCustomCanvas);
  }

  // Named advisory-location comparison -- only meaningful in Preset mode
  // (the custom canvas has no discrete markers to click; setVisible above
  // already hides ADVISORY_LAYER_ID while Custom is active, so this is never
  // actually reached from a Custom-mode click).
  getAdvisoryGroup(locationName) {
    return this.fixed.getAdvisoryGroup(locationName);
  }

  // Custom mode's counterpart to clicking a preset marker: the grid cell under
  // the click, shaped like the marker properties CookIslandsSuitabilityDetails
  // Panel already renders. Null in Preset mode (its markers open the panel
  // themselves) and for clicks on land/outside the grid.
  getCustomPointAt(lng, lat) {
    if (this._mode !== 'custom') return null;
    const cell = this.dynamic.getPointAt?.(lng, lat);
    if (!cell) return null;
    return {
      hazard_class: cell.hazardClass,
      hazard_label: HAZARD_LABELS[cell.hazardClass],
      action_label: 'Custom thresholds (what-if)',
      vessel_class: this._vesselClass,
      wind_speed_kt: cell.windKt,
      wave_height_m: cell.waveM,
      valid_time: cell.validTime,
      custom_envelope: cell.envelope,
      grid_cell_km: cell.cellSizeKm,
      lat,
      lon: lng,
    };
  }

  // No timeseries drill-down for suitability points, in either mode.
  getTimeseriesAtPoint() {
    return this.fixed.getTimeseriesAtPoint();
  }

  destroy() {
    this.fixed.destroy();
    this.dynamic.destroy();
  }
}
