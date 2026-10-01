import { useMemo, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { formatZoned } from '../../utils/timeZoneFormat';
import './currents.css';

const SPEED_OPTIONS = [
  { label: '0.5x', ms: 1400 },
  { label: '1x', ms: 700 },
  { label: '2x', ms: 350 },
  { label: '4x', ms: 175 },
];
const TICK_COUNT = 17;

// e.g. "29 Aug" — matches niu_current's own TimeStep shortDate() format.
function shortDate(date, timeZone) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone }).format(date);
}

export default function TimeStep({
  sliderIndex = 0,
  totalSteps = 0,
  minIndex = 0,
  currentSliderDate,
  availableTimestamps = [],
  isPlaying = false,
  playSpeedMs = 700,
  timeDisplayZone = 'Pacific/Niue',
  onTimeIndexChange,
  onPlayPause,
  onPrevious,
  onNext,
  onSpeedChange,
  depth = null,
}) {
  const ribbonRef = useRef(null);
  const range = Math.max(1, totalSteps - minIndex);
  const cursorFraction = Math.max(0, Math.min(1, (sliderIndex - minIndex) / range));
  const stepsElapsed = Math.max(0, sliderIndex - minIndex);

  const timeLabel = currentSliderDate ? formatZoned(currentSliderDate, timeDisplayZone) : '—';

  const dayMarkers = useMemo(() => {
    
    if (!availableTimestamps.length) return [];
    const markers = [];
    let prevLabel = null;
    for (let idx = minIndex; idx <= Math.min(totalSteps, availableTimestamps.length - 1); idx++) {
      const label = shortDate(availableTimestamps[idx], timeDisplayZone);
      if (!label || label === prevLabel) continue;
      prevLabel = label;
      markers.push({ idx, label, fraction: (idx - minIndex) / range });
    }
  
    const MIN_GAP = 0.1;
    if (markers.length > 2 && markers[1].fraction - markers[0].fraction < MIN_GAP) markers.shift();
    const n = markers.length;
    if (n > 2 && markers[n - 1].fraction - markers[n - 2].fraction < MIN_GAP) markers.pop();
    return markers;
  }, [availableTimestamps, minIndex, totalSteps, range, timeDisplayZone]);

  const handleRibbonClick = (e) => {
    if (!onTimeIndexChange || !ribbonRef.current) return;
    const rect = ribbonRef.current.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onTimeIndexChange(Math.round(minIndex + frac * range));
  };

  return (
    <div className="currents-timestep">
      <div className="currents-timestep__header">
        <div className="currents-timestep__time">{timeLabel}</div>
        <div className="currents-timestep__badges">
          <span className="currents-timestep__badge">T+{stepsElapsed}</span>
          {Number.isFinite(depth) && (
            <span className="currents-timestep__depth-note">{Math.round(depth)}m</span>
          )}
        </div>
      </div>

      <div className="currents-timestep__ribbon-section">
        <div className="currents-timestep__ribbon-label">Click to jump through time</div>

        <div className="currents-timestep__ribbon" ref={ribbonRef} onClick={handleRibbonClick}>
          <div className="currents-timestep__ribbon-wave" />
          <div className="currents-timestep__cursor" style={{ left: `${cursorFraction * 100}%` }} />
          <div className="currents-timestep__buoy" style={{ left: `${cursorFraction * 100}%` }} />
        </div>

        <div className="currents-timestep__ticks">
          {Array.from({ length: TICK_COUNT }).map((_, i) => (
            <span key={i} className={`currents-timestep__tick${i % 4 === 0 ? ' currents-timestep__tick--major' : ''}`} />
          ))}
        </div>

        {dayMarkers.length > 0 && (
          <div className="currents-timestep__labels">
            {dayMarkers.map((m) => (
              <button
                key={m.idx}
                type="button"
                className="currents-timestep__label"
                style={{
                  left: `${m.fraction * 100}%`,
                  // Keep edge labels inside the ribbon instead of centring them off it.
                  transform: `translateX(${m.fraction < 0.05 ? 0 : m.fraction > 0.95 ? -100 : -50}%)`,
                }}
                onClick={() => onTimeIndexChange?.(m.idx)}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="currents-timestep__controls">
        <button
          type="button"
          className="currents-timestep__chip-btn"
          aria-label="Previous timestep"
          onClick={onPrevious}
          disabled={sliderIndex <= minIndex}
        >
          <SkipBack size={11} fill="currentColor" />
        </button>
        <button
          type="button"
          className="currents-timestep__chip-btn currents-timestep__chip-btn--play"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={onPlayPause}
        >
          {isPlaying
            ? <Pause size={12} fill="currentColor" />
            : <Play size={12} fill="currentColor" />}
        </button>
        <button
          type="button"
          className="currents-timestep__chip-btn"
          aria-label="Next timestep"
          onClick={onNext}
          disabled={sliderIndex >= totalSteps}
        >
          <SkipForward size={11} fill="currentColor" />
        </button>

        <div className="currents-timestep__speed-group">
          {SPEED_OPTIONS.map(({ label, ms }) => (
            <button
              key={ms}
              type="button"
              className={`currents-timestep__speed-chip${playSpeedMs === ms ? ' currents-timestep__speed-chip--active' : ''}`}
              onClick={() => onSpeedChange?.(ms)}
              aria-pressed={playSpeedMs === ms}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
