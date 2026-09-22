import { useId } from 'react';
import { SUITABILITY_HAZARD_COLORS } from '../../lib/NiueSuitabilityOverlay';
import './EnvelopeRangeSlider.css';

// Dual-handle range slider for one hazard metric (wind or wave): a caution
// handle and an avoid handle sharing one track, colored in the same
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
  cautionValue,
  avoidValue,
  onCautionChange,
  onAvoidChange,
  formatValue,
}) {
  const constraintId = useId();
  const format = formatValue || ((v) => `${v} ${unit}`);
  const toPercent = (v) => ((v - min) / (max - min)) * 100;
  const cautionPct = toPercent(cautionValue);
  const avoidPct = toPercent(avoidValue);

  // Same colors as the "Forecast classes" legend two cards up (and every
  // suitability map tile) — imported from the one place that defines them
  // rather than re-picked here, so this can't silently drift from what the
  // rest of the UI calls "suitable"/"caution"/"avoid".
  const [suitableColor, cautionColor, avoidColor] = [
    SUITABILITY_HAZARD_COLORS[0], SUITABILITY_HAZARD_COLORS[1], SUITABILITY_HAZARD_COLORS[2],
  ];

  return (
    <div
      className="envelope-range"
      role="group"
      aria-label={`${label} classification thresholds`}
      style={{ '--envelope-caution-color': cautionColor, '--envelope-avoid-color': avoidColor }}
    >
      <div className="envelope-range__header">
        <span className="envelope-range__label">{label}</span>
        <span className="envelope-range__readout">
          <span className="envelope-range__readout-caution">Caution {format(cautionValue)}</span>
          {' · '}
          <span className="envelope-range__readout-avoid">Avoid {format(avoidValue)}</span>
        </span>
      </div>
      <span id={constraintId} className="envelope-range__constraint">
        Caution must remain at least {format(step)} below Avoid.
      </span>
      <div className="envelope-range__track-wrap">
        <div
          className="envelope-range__track"
          style={{
            background:
              `linear-gradient(to right, ` +
              `${suitableColor} 0%, ${suitableColor} ${cautionPct}%, ` +
              `${cautionColor} ${cautionPct}%, ${cautionColor} ${avoidPct}%, ` +
              `${avoidColor} ${avoidPct}%, ${avoidColor} 100%)`,
          }}
        />
        {/* Both inputs deliberately share the same [min, max] as the track's
            own gradient calculation above, rather than each being narrowed
            to stop at the other handle's position. A native range input
            always maps its thumb across its own min-to-max onto its full
            rendered width — if the two overlaid inputs had different
            ranges, their thumbs would render at different percentages than
            the color track's boundaries (verified: with min=0/max=40 and
            handles at 15/20, a narrowed range put the "caution" thumb to
            the visual *right* of the "avoid" thumb despite caution < avoid
            — badly, silently wrong). Keeping ranges identical is what makes
            "thumb position" and "color boundary" agree. The caution < avoid
            constraint is enforced by the parent's onChange handler
            (updateCustomEnvelope) clamping the value instead — the thumb can
            be dragged toward the other and stops there via a value that
            stops changing, not via the native input refusing the drag. */}
        <input
          type="range"
          className="envelope-range__input envelope-range__input--caution"
          aria-label={`${label} caution threshold`}
          min={min}
          max={max}
          step={step}
          value={cautionValue}
          aria-valuetext={format(cautionValue)}
          aria-describedby={constraintId}
          onChange={(e) => onCautionChange(Number(e.target.value))}
        />
        <input
          type="range"
          className="envelope-range__input envelope-range__input--avoid"
          aria-label={`${label} avoid threshold`}
          min={min}
          max={max}
          step={step}
          value={avoidValue}
          aria-valuetext={format(avoidValue)}
          aria-describedby={constraintId}
          onChange={(e) => onAvoidChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
