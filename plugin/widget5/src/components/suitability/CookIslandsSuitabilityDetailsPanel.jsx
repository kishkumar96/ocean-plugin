import React from 'react';
import { CircleCheck, TriangleAlert, OctagonAlert, Ship, Timer, Wind, Waves, MapPin } from 'lucide-react';
import { VESSEL_CLASS_OPTIONS, HAZARD_COLORS } from '../../lib/CookIslandsSuitabilityOverlay';
import { formatZoned } from '../../utils/timeZoneFormat';

const HAZARD_ICONS = {
  0: CircleCheck,
  1: TriangleAlert,
  2: OctagonAlert,
};

const TEXT_PRIMARY = '#f8fafc';
const TEXT_MUTED = 'rgba(203, 213, 225, 0.65)';

// Single-point vessel-suitability reading, clicked directly off the map's
// own circle-marker layer. Unlike Niue's SuitabilityDetailsPanel (which
// re-queries a backend /point endpoint), every field shown here already
// exists on the clicked GeoJSON feature's own properties -- step11_marine_
// suitability.py bakes hazard_class/action_label/main_driver etc. in at
// pipeline time -- so this never has its own loading/error state.
function CookIslandsSuitabilityDetailsPanel({ data, timeDisplayZone = 'Pacific/Rarotonga' }) {
  const point = data?.point;
  const locationGroup = data?.locationGroup;

  const wrapperStyle = {
    padding: '1rem 1.25rem 1.25rem',
    color: TEXT_PRIMARY,
    fontFamily: 'inherit',
  };

  if (!point) {
    return <div style={{ ...wrapperStyle, textAlign: 'center', color: TEXT_MUTED }}>No suitability data at this location.</div>;
  }

  const hazardClass = point.hazard_class;
  const hazardAvailable = Number.isFinite(hazardClass);
  const hazardColor = hazardAvailable ? (HAZARD_COLORS[hazardClass] ?? '#94a3b8') : '#94a3b8';
  const hazardLabel = point.hazard_label ?? (hazardAvailable ? 'Unknown' : 'Unavailable');
  const HazardIcon = HAZARD_ICONS[hazardClass] ?? TriangleAlert;
  const vesselLabel = VESSEL_CLASS_OPTIONS.find((v) => v.value === point.vessel_class)?.label ?? point.vessel_label ?? point.vessel_class;

  const stats = [
    { icon: Ship, label: 'Vessel class', value: vesselLabel },
    { icon: Timer, label: 'Valid time', value: point.valid_time ? formatZoned(new Date(point.valid_time), timeDisplayZone) : '—' },
    { icon: Wind, label: 'Wind speed', value: Number.isFinite(point.wind_speed_kt) ? `${point.wind_speed_kt.toFixed(1)} kt` : '—' },
    { icon: Waves, label: 'Significant wave height', value: Number.isFinite(point.wave_height_m) ? `${point.wave_height_m.toFixed(2)} m` : '—' },
  ];

  return (
    <div style={wrapperStyle}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.7rem',
        padding: '0.6rem 0.9rem', borderRadius: 12,
        background: `linear-gradient(135deg, ${hazardColor}26, ${hazardColor}0d)`,
        border: `1px solid ${hazardColor}55`,
        marginBottom: '1rem',
      }}>
        <span style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
          background: `${hazardColor}26`,
        }}>
          <HazardIcon size={19} color={hazardColor} strokeWidth={2.25} />
        </span>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '0.01em' }}>{hazardLabel}</div>
          <div style={{ fontSize: '0.72rem', color: TEXT_MUTED }}>
            {point.action_label ?? 'Vessel suitability'}
          </div>
        </div>
      </div>

      {point.advisory && (
        <div style={{ margin: '-0.35rem 0 0.85rem', fontSize: '0.7rem', color: TEXT_MUTED }}>
          {point.advisory}
          {(point.wind_threshold_kt || point.wave_threshold_m) && (
            <> — thresholds {point.wind_threshold_kt ?? '—'}{point.wave_threshold_m ? `, ${point.wave_threshold_m}` : ''}</>
          )}
        </div>
      )}

      {point.custom_envelope && (
        <div style={{ margin: '-0.35rem 0 0.85rem', fontSize: '0.7rem', color: TEXT_MUTED }}>
          Your thresholds: caution {point.custom_envelope.cautionWindKt} kt / {point.custom_envelope.cautionWaveHeightM} m,
          {' '}warning {point.custom_envelope.maxWindKt} kt / {point.custom_envelope.maxWaveHeightM} m.
          {' '}Advisories and route forecasts use the vessel preset.
        </div>
      )}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem',
      }}>
        {stats.map(({ icon: Icon, label, value }) => (
          <div key={label} style={{
            display: 'flex', flexDirection: 'column', gap: '0.3rem',
            padding: '0.65rem 0.8rem', borderRadius: 10,
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em',
              color: TEXT_MUTED,
            }}>
              <Icon size={13} strokeWidth={2} />
              {label}
            </div>
            <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>{value}</div>
          </div>
        ))}
      </div>

      {Number.isFinite(point.lat) && Number.isFinite(point.lon) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.35rem',
          marginTop: '0.9rem', fontSize: '0.72rem', color: TEXT_MUTED,
        }}>
          <MapPin size={12} strokeWidth={2} />
          {point.name ? `${point.name}, ${point.island || ''}` : (point.custom_envelope ? 'Selected location' : 'Forereef point')}: {point.lat.toFixed(4)}, {point.lon.toFixed(4)}
        </div>
      )}

      {Number.isFinite(point.grid_cell_km) && (
        <div style={{ marginTop: '0.35rem', fontSize: '0.68rem', color: TEXT_MUTED }}>
          Reading for the ~{point.grid_cell_km.toFixed(1)} km grid cell at this location, not the exact point.
        </div>
      )}

      {Array.isArray(locationGroup) && locationGroup.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <div style={{
            fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em',
            color: TEXT_MUTED, marginBottom: '0.5rem',
          }}>
            All vessel classes at {point.name}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {VESSEL_CLASS_OPTIONS.map((vc) => {
              const reading = locationGroup.find((f) => f.properties?.vessel_class === vc.value)?.properties;
              const isSelected = vc.value === point.vessel_class;
              const rowColor = reading ? (HAZARD_COLORS[reading.hazard_class] ?? '#94a3b8') : '#94a3b8';
              return (
                <div key={vc.value} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0.5rem 0.7rem', borderRadius: 8,
                  background: isSelected ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isSelected ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)'}`,
                }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: isSelected ? 700 : 500 }}>{vc.label}</span>
                  <span style={{
                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                    fontSize: '0.75rem', fontWeight: 600, color: rowColor,
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: rowColor, flexShrink: 0 }} />
                    {reading?.hazard_label ?? 'No data'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default CookIslandsSuitabilityDetailsPanel;
