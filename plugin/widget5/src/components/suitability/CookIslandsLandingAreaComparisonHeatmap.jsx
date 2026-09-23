import React, { useMemo } from 'react';
import { HAZARD_COLORS } from '../../lib/CookIslandsSuitabilityOverlay';
import { ROUTE_HAZARD_LABELS } from '../../services/cookIslandsRouteForecastService';
import { selectHeatmapSteps, findMatchingStep } from '../../utils/heatmapSteps';
import { formatZoned, tzLabel } from '../../utils/timeZoneFormat';

// Ported from widget1's LandingAreaComparisonHeatmap.jsx. Hazard label/color
// source swapped for this app's own (ROUTE_HAZARD_LABELS/HAZARD_COLORS --
// note 'Warning' not 'Avoid' for class 2, same as everywhere else in this
// app), and "statistics_basis" strings match
// useCookIslandsLandingAreaComparison's own field names (area_500m /
// nearest_point_area_fallback / nearest_point_fallback) rather than Niue's
// face-based equivalents.

const TEXT_PRIMARY = '#f8fafc';
const TEXT_MUTED = 'rgba(203, 213, 225, 0.65)';
const UNAVAILABLE_COLOR = '#475569';

const formatColumnTime = (date, timeZone) => formatZoned(date, timeZone, {
  withLabel: false, year: undefined, month: 'short', day: '2-digit',
});
const formatCellTime = (date, timeZone) => formatZoned(date, timeZone, {
  withLabel: false, year: undefined, month: 'short', day: '2-digit', weekday: 'short',
});

function CookIslandsLandingAreaComparisonHeatmap({ rows, loading, vesselLabel, timeDisplayZone = 'Pacific/Rarotonga' }) {
  const referenceSteps = useMemo(() => (
    rows.reduce((best, row) => (row.steps.length > (best?.length ?? 0) ? row.steps : best), null) ?? []
  ), [rows]);

  // windowHours: 168 (7 days), matching this app's other "next 7 days"
  // framing (Route Forecast's own forecast window).
  const heatmapSteps = useMemo(() => selectHeatmapSteps(referenceSteps, 168), [referenceSteps]);
  const hasAreaBasis = rows.some((row) => row.statistics_basis === 'area_500m');
  const hasNearestPointAreaFallback = rows.some((row) => row.statistics_basis === 'nearest_point_area_fallback');
  const hasFallbackBasis = rows.some((row) => row.statistics_basis === 'nearest_point_fallback');

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem', color: TEXT_MUTED }}>Loading landing area comparison…</div>;
  }
  if (!rows.length || !heatmapSteps.length) {
    return <div style={{ textAlign: 'center', padding: '2rem', color: TEXT_MUTED }}>No comparison data available.</div>;
  }

  return (
    <div>
      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: TEXT_PRIMARY }}>Landing area comparison</div>
      <div style={{ fontSize: '0.72rem', color: TEXT_MUTED, marginTop: 1, marginBottom: 10 }}>
        {vesselLabel ? `${vesselLabel} · next 7 days` : 'Next 7 days'}
        {' · '}
        {hasAreaBasis ? '500 m area' : hasNearestPointAreaFallback ? 'nearest-point area fallback' : hasFallbackBasis ? 'nearest-point fallback' : 'landing area'}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: `104px repeat(${heatmapSteps.length}, minmax(30px, 1fr))`,
          gap: 3,
          minWidth: 104 + heatmapSteps.length * 32,
        }}>
          <div />
          {heatmapSteps.map((hs, i) => (
            <div
              key={hs.time_index ?? i}
              style={{ fontSize: '0.6rem', color: TEXT_MUTED, textAlign: 'center', lineHeight: 1.25, whiteSpace: 'pre-line' }}
            >
              {formatColumnTime(new Date(hs.time), timeDisplayZone).replace(', ', '\n')}
            </div>
          ))}

          {rows.map((row) => (
            <React.Fragment key={row.id ?? row.label}>
              <div style={{
                fontSize: '0.72rem', color: TEXT_PRIMARY, fontWeight: 600,
                display: 'flex', alignItems: 'center', paddingRight: 6,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {row.name ?? row.label}
              </div>
              {heatmapSteps.map((hs, i) => {
                const matched = findMatchingStep(row.steps, hs);
                // Explicit null-check, not `hazard ?? 0` -- a landing area
                // with no matching step at this column is unavailable, not
                // a silently-fabricated "Suitable" reading.
                const hazard = matched && Number.isFinite(matched.hazard_class) ? matched.hazard_class : null;
                const color = hazard === null ? UNAVAILABLE_COLOR : (HAZARD_COLORS[hazard] ?? UNAVAILABLE_COLOR);
                const label = hazard === null ? 'Unavailable' : (ROUTE_HAZARD_LABELS[hazard] ?? 'Unknown');
                const sampleCount = matched?.sample_count ?? matched?.point_count ?? row.point_count;
                return (
                  <div
                    key={hs.time_index ?? i}
                    title={`${row.name ?? row.label}: ${label}${sampleCount ? ` · ${sampleCount} points` : ''} — ${formatCellTime(new Date(hs.time), timeDisplayZone)} ${tzLabel(timeDisplayZone)}`}
                    style={{ height: 18, borderRadius: 3, background: color }}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.68rem', color: TEXT_MUTED, marginTop: 10 }}>
        {[0, 1, 2].map((h) => (
          <span key={h} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: HAZARD_COLORS[h], display: 'inline-block' }} />
            {ROUTE_HAZARD_LABELS[h]}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: UNAVAILABLE_COLOR, display: 'inline-block' }} />
          Unavailable
        </span>
      </div>
    </div>
  );
}

export default CookIslandsLandingAreaComparisonHeatmap;
