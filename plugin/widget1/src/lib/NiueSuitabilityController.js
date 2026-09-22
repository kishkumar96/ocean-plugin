// NiueSuitabilityController.js
// Public-facing suitability overlay: wraps the fixed tile-based overlay
// (NiueSuitabilityOverlay, four preset vessel classes) and the dynamic
// canvas-based overlay (NiueSuitabilityDynamicOverlay, adjustable
// wind/wave envelope) behind one interface, so useZarrMap only ever deals
// with a single "suitability layer" regardless of Preset/Custom mode.
//
// Preset and Custom are UI modes of the same product, not two different
// layers a user can pick from the layer list — mapLayersConfig.js keeps a
// single niue-suitability entry (supportsCustomEnvelope: true) rather than
// exposing this split as separate selectable layers.
//
// Both overlays stay constructed, but the raw dynamic grid is lazy: Preset
// mode only remembers the desired time and never downloads or prefetches
// custom data. Entering Custom loads the current time immediately. This keeps
// the fast preset path fast while preserving instant state synchronization
// once the custom renderer has actually been requested.

import { NiueSuitabilityOverlay } from './NiueSuitabilityOverlay';
import { NiueSuitabilityDynamicOverlay } from './NiueSuitabilityDynamicOverlay';

export class NiueSuitabilityController {
  constructor(map, config) {
    this._mode = config.suitabilityMode === 'custom' ? 'custom' : 'preset';
    this._timeIndex = config.timeIndex ?? 0;
    this.fixed = new NiueSuitabilityOverlay(map, config);
    this.dynamic = new NiueSuitabilityDynamicOverlay(map, config.apiBase);
    this._applyVisibility();

    this.setEnvelope(
      config.vessel,
      this._mode === 'custom' ? (config.customEnvelope || {}) : {}
    );
    if (this._mode === 'custom') this._loadDynamicTimeIndex();
  }

  // Only NiueSuitabilityOverlay's /niue/suitability/timesteps fetch ever
  // fires these — the dynamic overlay has no independent notion of loading
  // state, error state, or a timestep list, so these forward straight
  // through rather than trying to merge two callback sources.
  set onTimeChange(fn) {
    this._onTimeChange = fn;
    this.fixed.onTimeChange = fn
      ? (label, index, maxIndex) => {
          this.dynamic.setMaxTimeIndex?.(maxIndex);
          fn(label, index, maxIndex);
        }
      : null;
  }
  get onTimeChange() { return this._onTimeChange ?? null; }
  set onLoadingChange(fn) { this.fixed.onLoadingChange = fn; }
  get onLoadingChange() { return this.fixed.onLoadingChange; }
  set onErrorChange(fn) { this.fixed.onErrorChange = fn; }
  get onErrorChange() { return this.fixed.onErrorChange; }
  set onStatsChange(fn) { this.fixed.onStatsChange = fn; }
  get onStatsChange() { return this.fixed.onStatsChange; }
  // Unlike the four above, these only the dynamic overlay can fire —
  // see their own comments for what they actually signal.
  set onBufferingChange(fn) { this.dynamic.onBufferingChange = fn; }
  get onBufferingChange() { return this.dynamic.onBufferingChange; }
  set onSummaryChange(fn) { this.dynamic.onSummaryChange = fn; }
  get onSummaryChange() { return this.dynamic.onSummaryChange; }
  set onStatusChange(fn) {
    this.dynamic.onStatusChange = fn;
    const status = this.dynamic.getStatus?.();
    if (fn && status?.status !== 'idle') fn(status);
  }
  get onStatusChange() { return this.dynamic.onStatusChange; }

  getTimeLabels() {
    return this.fixed.getTimeLabels();
  }

  // Preset updates only the tile overlay. The desired index is retained so
  // entering Custom starts one foreground load for the correct current time.
  setTimeIndex(timeIndex) {
    this._timeIndex = timeIndex;
    this.fixed.setTimeIndex(timeIndex);
    if (this._mode === 'custom') this._loadDynamicTimeIndex();
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
  // + thresholds go through setEnvelope instead — callers already
  // recompute the effective envelope from VESSEL_OPERATING_ENVELOPE plus
  // any overrides and pass the merged result there, so this method doesn't
  // need to guess at reset-on-vessel-change semantics for the dynamic side.
  setVessel(vessel) {
    this.fixed.setVessel(vessel);
  }

  // overrides: {} for "just use vessel's preset envelope" (still routes
  // through the dynamic/canvas render path — used so Custom mode shows
  // literally the same numbers as Preset until the user actually moves a
  // slider), or the vessel's envelope fields the user has overridden.
  //
  // dynamic.setEnvelope throws (via resolveOperatingEnvelope) if overrides
  // describe an invalid envelope — non-finite/negative values, or caution >=
  // avoid. The slider UI already clamps input so a bad override should never
  // reach here in practice, but this is also the constructor's call path, so
  // an uncaught throw here would blow up controller construction entirely
  // rather than degrading gracefully. Fall back to the vessel's own preset
  // (still routes through the real render path, same as the {} case above)
  // and report the problem the same way a rejected grid load already does,
  // instead of leaving the map on stale or absent thresholds.
  setEnvelope(vessel, overrides = {}) {
    try {
      this.dynamic.setEnvelope(vessel, overrides);
    } catch (err) {
      this.onErrorChange?.(err.message);
      if (!overrides || Object.keys(overrides).length === 0) return;
      try {
        this.dynamic.setEnvelope(vessel, {});
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
    if (mode === 'custom' && changed) this._loadDynamicTimeIndex();
    if (mode === 'preset' && changed) {
      this.dynamic.cancelPendingRequests?.();
      this.dynamic.onSummaryChange?.(null);
    }
  }

  _applyVisibility() {
    const showCustomCanvas = this._mode === 'custom';
    this.fixed.setVisible(!showCustomCanvas);
    this.dynamic.setVisible(showCustomCanvas);
  }

  // Point-query hazard reading. Preset mode reports the backend's
  // authoritative classification (/niue/suitability/point). Custom mode has
  // no backend equivalent for an arbitrary user-chosen envelope, so it
  // classifies client-side against the dynamic overlay's already-fetched
  // grid (see NiueSuitabilityDynamicOverlay.getSuitabilityAtPoint) — the
  // same data the canvas the user is looking at was painted from, so a
  // click always agrees with what's on screen. Prefer the raw grid response's
  // own X-Valid-Time; the fixed overlay's list is only a compatibility
  // fallback for older deployments that omit that header.
  getSuitabilityAtPoint(lng, lat) {
    if (this._mode === 'custom') {
      return this.dynamic.getSuitabilityAtPoint(lng, lat).then((result) => ({
        ...result,
        valid_time: result.valid_time
          ?? this.fixed.getIsoTimeAt(result.time_index ?? this._timeIndex),
      }));
    }
    return this.fixed.getSuitabilityAtPoint(lng, lat);
  }

  destroy() {
    this.fixed.destroy();
    this.dynamic.destroy();
  }
}
