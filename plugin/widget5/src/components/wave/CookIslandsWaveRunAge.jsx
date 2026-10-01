import React from 'react';
import { TriangleAlert } from 'lucide-react';
import { formatZoned } from '../../utils/timeZoneFormat';
import { waveRunAgeHours, WAVE_STALE_HOURS } from '../../services/cookIslandsWaveTimeseriesService';

// Model-run age for the wave timeseries products (harbour table, route
// midpoint chart). Same 30 h threshold as the timeline's "Forecast data may be
// outdated" banner (useZarrMap.js) -- a missed pipeline cycle must be visible
// right where someone is reading a boat-safety number, not only on the
// timeline. `runStart` is the first timestamp of the wave forecast.
function CookIslandsWaveRunAge({ runStart, label = 'Wave model run', timeDisplayZone = 'Pacific/Rarotonga', now = Date.now() }) {
  const age = waveRunAgeHours(runStart, now);
  if (age === null) return null;
  const when = formatZoned(new Date(runStart), timeDisplayZone);

  if (age > WAVE_STALE_HOURS) {
    return (
      <div role="alert" style={{
        display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.72rem', lineHeight: 1.4, color: '#fcd34d',
        background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 6,
        padding: '0.4rem 0.55rem', marginBottom: '0.5rem',
      }}>
        <TriangleAlert size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          {label} may be outdated — it is {Math.round(age)}h old (starts {when}).
          A newer run may not have published yet; check before relying on it.
        </span>
      </div>
    );
  }
  return (
    <div style={{ fontSize: '0.66rem', color: 'rgba(203, 213, 225, 0.72)', marginBottom: '0.4rem' }}>
      {label} starts {when} ({Math.round(age)}h ago).
    </div>
  );
}

export default CookIslandsWaveRunAge;
