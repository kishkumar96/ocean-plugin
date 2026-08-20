import { SUITABILITY_HAZARD_COLORS } from '../../lib/NiueSuitabilityOverlay';
import './EnvelopeRangeSlider.css';

// Dual-handle range slider for one hazard metric (wind or wave): a caution
// handle and a danger handle sharing one track, colored in the same
// Suitable/Caution/Avoid zones as the map legend above it. Two native
// <input type="range"> elements are stacked on the same track rather than a
// bespoke drag implementation — each is only pointer-interactive at its own
// thumb (see EnvelopeRangeSlider.css), which is the standard, accessible way
// to build this without reimplementing native slider keyboard/touch/ARIA
// behavior from scratch.
export default function EnvelopeRangeSlider({
  label,
  unit,
  min,
  max,
  step,
  minGap,
  cautionValue,
  dangerValue,
  onCautionChange,
  onDangerChange,
  formatValue,
}) {
  const format = formatValue || ((v) => `${v} ${unit}`);
  const toPercent = (v) => ((v - min) / (max - min)) * 100;
  const cautionPct = toPercent(cautionValue);
  const dangerPct = toPercent(dangerValue);

  // Each handle's own min/max is clamped to the other handle's current
  // position (minus/plus minGap) — the native slider then physically
  // refuses to drag past that point, rather than accepting the drag and
  // having the controlled value snap back on the next render.
  const cautionMax = Math.max(min, dangerValue - minGap);
  const dangerMin = Math.min(max, cautionValue + minGap);

  // Same colors as the "Forecast classes" legend two cards up (and every
  // suitability map tile) — imported from the one place that defines them
  // rather than re-picked here, so this can't silently drift from what the
  // rest of the UI calls "suitable"/"caution"/"avoid".
  const [suitableColor, cautionColor, dangerColor] = [
    SUITABILITY_HAZARD_COLORS[0], SUITABILITY_HAZARD_COLORS[1], SUITABILITY_HAZARD_COLORS[2],
  ];

  return (
    <div className="envelope-range">
      <div className="envelope-range__header">
        <span className="envelope-range__label">{label}</span>
        <span className="envelope-range__readout">
          <span className="envelope-range__readout-caution">Caution {format(cautionValue)}</span>
          {' · '}
          <span className="envelope-range__readout-danger">Danger {format(dangerValue)}</span>
        </span>
      </div>
      <div className="envelope-range__track-wrap">
        <div
          className="envelope-range__track"
          style={{
            background:
              `linear-gradient(to right, ` +
              `${suitableColor} 0%, ${suitableColor} ${cautionPct}%, ` +
              `${cautionColor} ${cautionPct}%, ${cautionColor} ${dangerPct}%, ` +
              `${dangerColor} ${dangerPct}%, ${dangerColor} 100%)`,
          }}
        />
        <input
          type="range"
          className="envelope-range__input envelope-range__input--caution"
          aria-label={`${label} caution threshold`}
          min={min}
          max={cautionMax}
          step={step}
          value={cautionValue}
          onChange={(e) => onCautionChange(Number(e.target.value))}
        />
        <input
          type="range"
          className="envelope-range__input envelope-range__input--danger"
          aria-label={`${label} danger threshold`}
          min={dangerMin}
          max={max}
          step={step}
          value={dangerValue}
          onChange={(e) => onDangerChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
