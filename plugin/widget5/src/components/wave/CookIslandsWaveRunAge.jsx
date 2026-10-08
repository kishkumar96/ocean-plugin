import React from 'react';
import { TriangleAlert } from 'lucide-react';
import { formatZoned } from '../../utils/timeZoneFormat';
import { waveRunAgeHours } from '../../services/cookIslandsWaveTimeseriesService';
import { formatAge, updateFreshness } from '../../utils/modelRunTiming';
import { useForecastUpdatedAt } from '../../hooks/useForecastUpdatedAt';
import { WAVE_PUBLISHED_AT_URL } from '../../lib/mapLayersConfig';

// Forecast freshness for the wave timeseries products (harbour table, route midpoint chart),
// by the same rules as the timeline banner and header (updateFreshness) -- a missed pipeline
// cycle must be visible right where someone is reading a boat-safety number. It says when the
// forecast last *updated*: the model's init time (`runStart`, the first wave timestamp) is
// ~16 h old even for a fresh forecast, so as an age it read like downtime that never happened.
// `updatedAt` overrides the fetched update time (tests, or a caller that already has it).
function CookIslandsWaveRunAge({ runStart, updatedAt, label = 'Wave forecast', timeDisplayZone = 'Pacific/Rarotonga', now = Date.now() }) {
  const fetchedUpdatedAt = useForecastUpdatedAt(updatedAt === undefined ? WAVE_PUBLISHED_AT_URL : null);
  const updated = updatedAt === undefined ? fetchedUpdatedAt : updatedAt;
  const runAge = waveRunAgeHours(runStart, now);
  if (runAge === null) return null;
  const updateAge = waveRunAgeHours(updated, now);
  const { state, reason } = updateFreshness(updateAge, runAge);
  const modelData = formatZoned(new Date(runStart), timeDisplayZone);
  const updatedText = updated ? formatZoned(new Date(updated), timeDisplayZone) : null;

  if (state === 'stale') {
    const message = reason === 'not-updated'
      ? `${label} has not updated for ${formatAge(updateAge)} (last update ${updatedText}).`
      : `${label} may be outdated — no newer model data since ${modelData}.`;
    return (
      <div role="alert" style={{
        display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.72rem', lineHeight: 1.4, color: '#fcd34d',
        background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 6,
        padding: '0.4rem 0.55rem', marginBottom: '0.5rem',
      }}>
        <TriangleAlert size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>{message} Check before relying on it.</span>
      </div>
    );
  }
  return (
    <div style={{ fontSize: '0.66rem', color: 'rgba(203, 213, 225, 0.72)', marginBottom: '0.4rem' }}
      title={`Model data from ${modelData}.`}>
      {updatedText
        ? `${label} updated ${updatedText} (${formatAge(updateAge)} ago).`
        : `${label}: model data from ${modelData}.`}
    </div>
  );
}

export default CookIslandsWaveRunAge;
