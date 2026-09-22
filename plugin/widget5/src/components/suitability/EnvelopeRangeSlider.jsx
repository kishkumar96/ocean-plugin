import { useEffect, useId, useState } from 'react';
import { HAZARD_COLORS } from '../../lib/CookIslandsSuitabilityOverlay';
import './EnvelopeRangeSlider.css';

// A slider thumb is imprecise for "I want exactly 15kt" -- this pairs each
// threshold with a small editable number field routed through the same
// onChange the slider itself uses, so typing an exact value gets the same
// caution-must-stay-below-avoid clamping updateCustomEnvelope already
// enforces for drags, instead of needing its own copy of that logic.
//
// Kept as an uncontrolled-ish text buffer rather than binding straight to
// `value`: typing "1.5" passes through an intermediate "1." that Number()
// happily parses as 1, so committing on every keystroke works, but a bare
// controlled input would otherwise fight the user by re-rendering an empty
// or partial field back to its last committed numeric value mid-keystroke.
function NumberField({ value, onChange, min, max, step, ariaLabel, describedBy, className }) {
  const [text, setText] = useState(String(value));

  // Re-sync when the value changes for a reason other than this field's own
  // typing (dragging the slider, switching vessel, an auto-adjustment from
  // the *other* threshold's clamp) -- but not while this field is mid-edit
  // with a value that already matches, which would otherwise fight the
  // cursor on every valid keystroke.
  useEffect(() => {
    setText((prev) => (Number(prev) === value ? prev : String(value)));
  }, [value]);

  return (
    <input
      type="number"
      inputMode="decimal"
      className={className}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      min={min}
      max={max}
      step={step}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const parsed = Number(raw);
        if (raw.trim() !== '' && Number.isFinite(parsed)) onChange(parsed);
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

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
    HAZARD_COLORS[0], HAZARD_COLORS[1], HAZARD_COLORS[2],
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
          <span className="envelope-range__readout-caution">
            Caution
            <NumberField
              value={cautionValue}
              onChange={onCautionChange}
              min={min}
              max={max}
              step={step}
              ariaLabel={`${label} caution threshold, ${unit}`}
              describedBy={constraintId}
              className="envelope-range__number envelope-range__number--caution"
            />
            {unit}
          </span>
          {' · '}
          <span className="envelope-range__readout-avoid">
            Avoid
            <NumberField
              value={avoidValue}
              onChange={onAvoidChange}
              min={min}
              max={max}
              step={step}
              ariaLabel={`${label} avoid threshold, ${unit}`}
              describedBy={constraintId}
              className="envelope-range__number envelope-range__number--avoid"
            />
            {unit}
          </span>
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
