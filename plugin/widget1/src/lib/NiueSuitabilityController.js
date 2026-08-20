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
// Both underlying overlays stay constructed and kept in sync the whole
// time; setMode() only toggles which one is visible. That avoids losing
// the current time position (and re-fetching the preset's tile set or the
// custom grid) on every Preset<->Custom toggle.
//
// setTimeIndex() drives both overlays regardless of mode, including during
// timeline playback — the dynamic overlay's grid fetch is small enough
// (int16-quantized + gzip, ~640KB, see the backend's /niue/suitability/grid
// docstring) plus prefetched ahead (NiueSuitabilityDynamicOverlay) to
// realistically keep up with a live playback tick. An earlier version of
// this fell back to preset tiles while playing to paper over the old ~15MB
// float32 payload being too slow for that — replaced by actually fixing the
// payload size instead of hiding the symptom.

import { NiueSuitabilityOverlay } from './NiueSuitabilityOverlay';
import { NiueSuitabilityDynamicOverlay } from './NiueSuitabilityDynamicOverlay';

export class NiueSuitabilityController {
  constructor(map, config) {
    this._mode = config.suitabilityMode === 'custom' ? 'custom' : 'preset';
    this.fixed = new NiueSuitabilityOverlay(map, config);
    this.dynamic = new NiueSuitabilityDynamicOverlay(map, config.apiBase);
    this._applyVisibility();

    // Seed the dynamic overlay's first grid fetch immediately rather than
    // waiting on useZarrMap's sliderIndex effect, which is a no-op here if
    // sliderIndex doesn't happen to *change* value on this layer switch
    // (e.g. it's already 0) — without this, _grid stays null forever and
    // every setEnvelope() call after silently no-ops in _repaint().
    this.dynamic.setTimeIndex(config.timeIndex ?? 0).catch((err) => {
      this.onErrorChange?.(err.message);
    });
    // Same reasoning for the envelope itself: seed it from whatever the
    // caller already knows (mirrors useZarrMap's mode/envelope effect) so
    // Custom mode shows real data as soon as its first grid fetch resolves,
    // instead of waiting for selectedVessel/suitabilityMode/customEnvelope
    // to next *change* value.
    this.dynamic.setEnvelope(
      config.vessel,
      this._mode === 'custom' ? (config.customEnvelope || {}) : {}
    );
  }

  // Only NiueSuitabilityOverlay's /niue/suitability/timesteps fetch ever
  // fires these — the dynamic overlay has no independent notion of loading
  // state, error state, or a timestep list, so these forward straight
  // through rather than trying to merge two callback sources.
  set onTimeChange(fn) { this.fixed.onTimeChange = fn; }
  get onTimeChange() { return this.fixed.onTimeChange; }
  set onLoadingChange(fn) { this.fixed.onLoadingChange = fn; }
  get onLoadingChange() { return this.fixed.onLoadingChange; }
  set onErrorChange(fn) { this.fixed.onErrorChange = fn; }
  get onErrorChange() { return this.fixed.onErrorChange; }
  set onStatsChange(fn) { this.fixed.onStatsChange = fn; }
  get onStatsChange() { return this.fixed.onStatsChange; }

  getTimeLabels() {
    return this.fixed.getTimeLabels();
  }

  // Drives both overlays regardless of mode, so switching Preset<->Custom
  // never shows a stale time position while the just-revealed overlay
  // catches up.
  setTimeIndex(timeIndex) {
    this.fixed.setTimeIndex(timeIndex);
    this.dynamic.setTimeIndex(timeIndex).catch((err) => {
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
  setEnvelope(vessel, overrides = {}) {
    this.dynamic.setEnvelope(vessel, overrides);
  }

  setMode(mode) {
    if (mode !== 'preset' && mode !== 'custom') {
      throw new Error(`Unknown suitability mode: ${mode}`);
    }
    this._mode = mode;
    this._applyVisibility();
  }

  _applyVisibility() {
    const showCustomCanvas = this._mode === 'custom';
    this.fixed.setVisible(!showCustomCanvas);
    this.dynamic.setVisible(showCustomCanvas);
  }

  // Point-query hazard reading. NOTE: this currently always reflects the
  // backend's fixed-vessel-preset classification (/niue/suitability/point),
  // even in Custom mode — there's no point-query equivalent of the raw
  // grid yet. A click while in Custom mode will report what Preset mode
  // would have shown, not the custom envelope's classification. Flagged
  // here rather than silently shipped; needs its own follow-up before this
  // is presented as authoritative for Custom mode.
  getSuitabilityAtPoint(lng, lat) {
    return this.fixed.getSuitabilityAtPoint(lng, lat);
  }

  destroy() {
    this.fixed.destroy();
    this.dynamic.destroy();
  }
}
