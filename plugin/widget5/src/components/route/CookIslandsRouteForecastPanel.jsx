import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TriangleAlert, RotateCcw, Download, Loader2, Compass, Clock3, CheckCircle2, Loader } from 'lucide-react';
import { HAZARD_COLORS, VESSEL_CLASS_OPTIONS } from '../../lib/CookIslandsSuitabilityOverlay';
import { ROUTE_HAZARD_LABELS } from '../../services/cookIslandsRouteForecastService';
import { MAX_SCENARIOS, suggestBetterVessel } from '../../services/cookIslandsScenarioService';
import { formatZoned, tzLabel } from '../../utils/timeZoneFormat';
import { exportCookIslandsRouteAdvisoryPdf } from '../../utils/CookIslandsRouteAdvisoryPdf';

const TEXT_MUTED = 'rgba(203, 213, 225, 0.72)';

function fmtNumber(value, digits = 1, suffix = '') {
  return Number.isFinite(value) ? `${value.toFixed(digits)}${suffix}` : '—';
}

// Results view for one Cook Islands route forecast (/cok/suitability/route).
// Trimmed relative to widget1's RouteForecastPanel.jsx in one remaining way:
// no sea-level context (this app has no sea-level dataset). "Suggest a
// better vessel/departure" are ported below, feeding into
// CookIslandsScenarioComparisonPanel (in ForecastApp.jsx) the same way
// widget1's do.
function CookIslandsRouteForecastPanel({
  data, onRetry, timeDisplayZone = 'Pacific/Rarotonga', mapCustomEnvelope = null, modelRunStart = null,
  scenarioCount = 0, onConfirmVesselSuggestion,
  departureSuggestionLoading, departureSuggestionProgress, departureSuggestionResult, departureSuggestionError,
  onSuggestBetterDeparture, onApplyDepartureSuggestion, onSaveDepartureSuggestionAsScenario,
}) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [confirmingVessel, setConfirmingVessel] = useState(false);
  const [confirmedScenarioName, setConfirmedScenarioName] = useState('');
  const confirmedClearTimerRef = useRef(null);
  const result = data?.result;
  const summary = result?.summary;
  const samples = useMemo(() => (Array.isArray(result?.samples) ? result.samples : []), [result]);
  const vesselLabel = VESSEL_CLASS_OPTIONS.find((v) => v.value === data?.vessel)?.label ?? data?.vessel;
  // worst_hazard_class is only null when every sample was unavailable (out
  // of the model domain) -- defaulting it to 0 would paint that state with
  // the same green "Suitable" badge as a real all-clear route.
  const hazard = summary?.worst_hazard_class;
  const hazardColor = Number.isFinite(hazard) ? (HAZARD_COLORS[hazard] ?? '#94a3b8') : '#94a3b8';

  // Free, client-side estimate -- no network call. See suggestBetterVessel's
  // own header comment for why this must never be presented as
  // route-checked; "Confirm & compare" below is what actually verifies it.
  const vesselSuggestion = useMemo(() => (
    result ? suggestBetterVessel(result, data?.vessel) : null
  ), [result, data?.vessel]);

  const handleConfirmVesselSuggestion = useCallback(async () => {
    if (!vesselSuggestion || confirmingVessel) return;
    setConfirmingVessel(true);
    try {
      const created = await onConfirmVesselSuggestion?.(vesselSuggestion.vessel);
      if (created?.name) {
        setConfirmedScenarioName(created.name);
        clearTimeout(confirmedClearTimerRef.current);
        confirmedClearTimerRef.current = setTimeout(() => setConfirmedScenarioName(''), 5000);
      }
    } finally {
      setConfirmingVessel(false);
    }
  }, [vesselSuggestion, confirmingVessel, onConfirmVesselSuggestion]);

  useEffect(() => () => clearTimeout(confirmedClearTimerRef.current), []);

  function fmtTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return '—';
    return formatZoned(d, timeDisplayZone, { year: undefined, month: 'short', day: 'numeric' });
  }

  const wrapperStyle = { padding: '1rem 1.25rem 1.25rem', color: '#f8fafc', fontFamily: 'inherit' };

  if (data?.loading) {
    return <div style={{ ...wrapperStyle, textAlign: 'center', padding: '2rem', color: TEXT_MUTED }}>Running route forecast…</div>;
  }

  if (data?.error) {
    return (
      <div style={wrapperStyle}>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div style={{ color: '#f87171', marginBottom: onRetry ? 12 : 0 }}>{data.error}</div>
          {onRetry && (
            <button type="button" className="map-display-option__btn" onClick={onRetry}>
              <RotateCcw size={13} style={{ marginRight: 6 }} />
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div style={wrapperStyle}>
        <div style={{ textAlign: 'center', color: TEXT_MUTED, padding: '2rem' }}>
          Draw a route on the map, then run the route forecast.
        </div>
      </div>
    );
  }

  const hazardCounts = samples.reduce((acc, sample) => {
    if (sample.hazard_class === 0) acc.suitable += 1;
    else if (sample.hazard_class === 1) acc.caution += 1;
    else if (sample.hazard_class === 2) acc.warning += 1;
    else acc.unavailable += 1;
    return acc;
  }, { suitable: 0, caution: 0, warning: 0, unavailable: 0 });
  const stripSummary = samples.length
    ? `Route hazard progression, in order of travel: ${hazardCounts.suitable} suitable, ${hazardCounts.caution} caution, ${hazardCounts.warning} warning`
      + (hazardCounts.unavailable ? `, ${hazardCounts.unavailable} unavailable` : '') + ' segments.'
    : 'Route hazard progression: no samples available.';

  const handleExportPdf = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError('');
    try {
      await exportCookIslandsRouteAdvisoryPdf({
        result, vessel: data?.vessel, speedKt: data?.speedKt, timeDisplayZone, mapCustomEnvelope, modelRunStart,
      });
    } catch (err) {
      console.error('[CookIslandsRouteForecastPanel] PDF export failed:', err);
      setExportError(err.message || 'PDF export failed.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={wrapperStyle}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.6rem', marginBottom: '0.8rem' }}>
        <div style={{
          border: `1px solid ${hazardColor}66`,
          background: `linear-gradient(135deg, ${hazardColor}2b, rgba(255,255,255,0.04))`,
          borderRadius: 8, padding: '0.75rem 0.85rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: hazardColor, fontWeight: 800 }}>
            <TriangleAlert size={16} />
            {summary?.recommendation ?? 'Route forecast'}
          </div>
          <div style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 4 }}>{vesselLabel}</div>
        </div>
        <Stat label="Distance" value={fmtNumber(summary?.distance_nm, 1, ' nm')} />
        <Stat label="Duration" value={fmtNumber(summary?.duration_hours, 1, ' h')} />
        <Stat label="Speed" value={fmtNumber(Number(data?.speedKt), 1, ' kt')} />
      </div>

      {vesselSuggestion && (
        <div style={{
          border: '1px dashed rgba(255,255,255,0.18)', borderRadius: 8,
          padding: '0.6rem 0.75rem', marginBottom: '0.6rem', fontSize: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 4 }}>
            <Compass size={13} />
            Suggestion
          </div>
          <div style={{ color: TEXT_MUTED, fontStyle: 'italic' }}>
            <strong style={{ color: '#f8fafc', fontStyle: 'normal' }}>{vesselSuggestion.vesselLabel}</strong> would reduce worst conditions from{' '}
            <strong style={{ color: '#f8fafc', fontStyle: 'normal' }}>{ROUTE_HAZARD_LABELS[vesselSuggestion.currentWorstHazardClass]}</strong> to{' '}
            <strong style={{ color: '#f8fafc', fontStyle: 'normal' }}>{ROUTE_HAZARD_LABELS[vesselSuggestion.estimatedWorstHazardClass]}</strong> for this same route and time
            {' '}(threshold estimate — confirm before changing vessel class).
          </div>
          <button
            type="button"
            className="map-display-option__btn"
            style={{ marginTop: 6 }}
            onClick={handleConfirmVesselSuggestion}
            disabled={confirmingVessel || scenarioCount >= MAX_SCENARIOS}
            title={scenarioCount >= MAX_SCENARIOS ? `Remove a scenario first — up to ${MAX_SCENARIOS} at a time` : 'Confirm & compare'}
          >
            {confirmingVessel ? <Loader size={13} /> : <Compass size={13} />}
            {confirmingVessel ? 'Confirming…' : 'Confirm & compare'}
          </button>
          {confirmedScenarioName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#4ade80', fontSize: 12, marginTop: 6 }}>
              <CheckCircle2 size={13} />
              Added as {confirmedScenarioName} — see Scenario Comparison above.
            </div>
          )}
        </div>
      )}

      {onSuggestBetterDeparture && (
        <div style={{
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
          padding: '0.6rem 0.75rem', marginBottom: '0.6rem', fontSize: 12,
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
              <Clock3 size={13} />
              Better departure?
            </div>
            <button
              type="button"
              className="map-display-option__btn"
              onClick={onSuggestBetterDeparture}
              disabled={departureSuggestionLoading}
            >
              {departureSuggestionLoading ? <Loader size={12} /> : <Clock3 size={12} />}
              {departureSuggestionLoading
                ? `Checking +${departureSuggestionProgress?.offsetHours}h… (${(departureSuggestionProgress?.index ?? 0) + 1}/${departureSuggestionProgress?.total ?? '?'})`
                : 'Suggest better departure'}
            </button>
          </div>
          {departureSuggestionError && <div style={{ color: '#f87171' }}>{departureSuggestionError}</div>}
          {departureSuggestionResult && (
            <div style={{ color: TEXT_MUTED }}>
              Leaving <strong style={{ color: '#f8fafc' }}>+{departureSuggestionResult.offsetHours}h</strong> later
              ({fmtTime(departureSuggestionResult.departureTime)}) would be{' '}
              <strong style={{ color: '#f8fafc' }}>{ROUTE_HAZARD_LABELS[departureSuggestionResult.worstHazardClass]}</strong>
              {departureSuggestionResult.allClear ? '' : ' (best of the offsets checked)'} — checked against the route forecast.
              {departureSuggestionResult.failedOffsets?.length > 0 && (
                <> {departureSuggestionResult.failedOffsets.length === 1 ? 'One offset' : `${departureSuggestionResult.failedOffsets.length} offsets`} (+{departureSuggestionResult.failedOffsets.join('h, +')}h) could not be checked.</>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button type="button" className="map-display-option__btn" onClick={onApplyDepartureSuggestion}>Apply</button>
                <button
                  type="button"
                  className="map-display-option__btn"
                  onClick={onSaveDepartureSuggestionAsScenario}
                  disabled={scenarioCount >= MAX_SCENARIOS}
                >
                  Save as scenario
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {mapCustomEnvelope && (
        <div
          role="note"
          style={{
            border: `1px solid ${HAZARD_COLORS[1]}66`, background: `${HAZARD_COLORS[1]}1f`,
            borderRadius: 8, padding: '0.5rem 0.75rem', marginBottom: '0.8rem',
            color: '#f8fafc', fontSize: 12, lineHeight: 1.4,
          }}
        >
          The map is showing custom thresholds. This route forecast is classified against the
          vessel preset, so the route result and the map colours can differ.
        </div>
      )}

      <div style={{ position: 'relative', marginBottom: '0.8rem' }}>
        <div
          role="img"
          aria-label={stripSummary}
          style={{ display: 'flex', height: 14, overflow: 'hidden', borderRadius: 4, border: '1px solid rgba(255,255,255,0.12)' }}
        >
          {samples.length ? samples.map((sample, index) => (
            <span
              key={`${sample.sample_index}-${index}`}
              title={`${fmtTime(sample.eta)} · ${sample.hazard_label}`}
              style={{ flex: 1, background: Number.isFinite(sample.hazard_class) ? (HAZARD_COLORS[sample.hazard_class] ?? '#64748b') : '#64748b' }}
            />
          )) : (
            <span style={{ flex: 1, background: '#64748b' }} />
          )}
        </div>
      </div>

      {samples.length === 0 && (
        <div style={{ color: '#fbbf24', fontSize: 12, marginBottom: '0.7rem' }}>
          No route samples were returned. The route may be entirely outside the model domain.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: '0.6rem' }}>
        <div style={{ fontSize: 11, color: TEXT_MUTED }}>
          {fmtTime(result.departure_time)} departure · {samples.length} sample{samples.length === 1 ? '' : 's'}
        </div>
        <button
          type="button"
          className="map-display-option__btn"
          onClick={handleExportPdf}
          disabled={exporting}
          title="Download route advisory PDF"
        >
          {exporting ? <Loader2 size={13} className="update-spinner" /> : <Download size={13} style={{ marginRight: 5, verticalAlign: 'text-bottom' }} />}
          {exporting ? 'Preparing…' : 'Download PDF'}
        </button>
      </div>
      {exportError && (
        <div style={{ color: '#f87171', fontSize: 12, marginBottom: 8 }}>{exportError}</div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: TEXT_MUTED, textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
              <th style={thStyle}>{`ETA (${tzLabel(timeDisplayZone)})`}</th>
              <th style={thStyle}>Distance</th>
              <th style={thStyle}>Hazard</th>
              <th style={thStyle}>Wave</th>
              <th style={thStyle}>Wind</th>
              <th style={thStyle}>Position</th>
            </tr>
          </thead>
          <tbody>
            {samples.map((sample, index) => (
              <tr key={`${sample.sample_index}-${index}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <td style={tdStyle}>{fmtTime(sample.eta)}</td>
                <td style={tdStyle}>{fmtNumber(sample.distance_nm, 1, ' nm')}</td>
                <td style={{ ...tdStyle, color: Number.isFinite(sample.hazard_class) ? (HAZARD_COLORS[sample.hazard_class] ?? '#e2e8f0') : '#e2e8f0', fontWeight: 700 }}>
                  {sample.hazard_label}
                </td>
                <td style={tdStyle}>{fmtNumber(sample.wave_height_m, 2, ' m')}</td>
                <td style={tdStyle}>{fmtNumber(sample.wind_speed_kt, 1, ' kt')}</td>
                <td style={tdStyle}>{Number.isFinite(sample.lat) ? `${sample.lat.toFixed(4)}, ${sample.lon.toFixed(4)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle = { padding: '0.4rem 0.5rem', fontWeight: 700, whiteSpace: 'nowrap' };
const tdStyle = { padding: '0.45rem 0.5rem', color: '#f8fafc', whiteSpace: 'nowrap' };

function Stat({ label, value }) {
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '0.75rem 0.85rem' }}>
      <div style={{ color: TEXT_MUTED, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontWeight: 800, marginTop: 3 }}>{value}</div>
    </div>
  );
}

export default CookIslandsRouteForecastPanel;
