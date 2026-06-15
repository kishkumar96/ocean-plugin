import React, { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  VESSEL_CLASSES,
  fetchSuitabilityTimeseries,
  STATUS,
} from '../../services/SuitabilityApiService';
import SuitabilityTimelineChart from './SuitabilityTimelineChart';
import './SuitabilityOutlook.css';

const DEFAULT_MAX_STEPS = 73;

function findNearestByTimeIndex(series, targetTimeIndex) {
  if (!series.length) return null;

  const target = Number(targetTimeIndex);
  if (!Number.isFinite(target)) return series[0] ?? null;

  return series.reduce((best, item) => {
    const itemIndex = Number(item.timeIndex);
    const bestIndex = Number(best?.timeIndex);

    if (!Number.isFinite(itemIndex)) return best;
    if (!best || !Number.isFinite(bestIndex)) return item;

    return Math.abs(itemIndex - target) < Math.abs(bestIndex - target) ? item : best;
  }, null);
}

function formatPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(n % 1 === 0 ? 0 : 1)}%`;
}

const STATUS_LABEL = {
  [STATUS.SUITABLE]:    'Suitable',
  [STATUS.CAUTION]:     'Caution',
  [STATUS.AVOID]:       'Avoid',
  [STATUS.UNAVAILABLE]: 'N/A',
};

export default function SuitabilityOutlookPanel({
  timeIndex          = 0,
  suitabilityBaseUrl = '',
  selectedVessel     = 'small_craft',
  onSelectedVesselChange,
  overlayVisible     = true,
  onOverlayToggle,
}) {
  const [series,      setSeries]      = useState([]);
  const [activeVessel, setActiveVessel] = useState(selectedVessel);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);

  const safeIdx = Number.isFinite(Number(timeIndex)) ? Number(timeIndex) : 0;

  // Fetch full timeseries once on mount (or when baseUrl changes).
  // Individual timestep changes are handled by the currentSummary memo below.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    fetchSuitabilityTimeseries({
      startIndex: 0,
      maxSteps:   DEFAULT_MAX_STEPS,
      baseUrl:    suitabilityBaseUrl,
    })
      .then(data => { if (alive) { setSeries(data); setLoading(false); } })
      .catch(err => {
        if (alive) {
          setError(err?.message || 'Suitability outlook unavailable');
          setSeries([]);
          setLoading(false);
        }
      });

    return () => { alive = false; };
  }, [suitabilityBaseUrl]);

  // Keep the active card highlight in sync if vessel is changed from outside.
  useEffect(() => {
    setActiveVessel(selectedVessel);
  }, [selectedVessel]);

  // Pick the summary that matches the current map timestep.
  const currentSummary = useMemo(() => {
    if (!series.length) return null;
    const exact = series.find(s => Number(s.timeIndex) === safeIdx);
    return exact || findNearestByTimeIndex(series, safeIdx);
  }, [series, safeIdx]);

  const handleVesselClick = code => {
    setActiveVessel(code);
    onSelectedVesselChange?.(code);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const headerRight = (
    <div className="suitability-header-right">
      {onOverlayToggle && (
        <button
          type="button"
          className={`suitability-overlay-toggle${overlayVisible ? ' is-active' : ''}`}
          onClick={onOverlayToggle}
          title={overlayVisible ? 'Hide map overlay' : 'Show map overlay'}
        >
          {overlayVisible ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>
      )}
      <span className="suitability-time-chip">Step {safeIdx}</span>
    </div>
  );

  if (loading) {
    return (
      <div className="suitability-outlook-panel">
        <div className="suitability-outlook-header">
          <span style={{ fontSize: '0.78rem', opacity: 0.6 }}>Loading suitability…</span>
          {headerRight}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="suitability-outlook-panel">
        <div className="suitability-outlook-header">
          <span style={{ fontSize: '0.78rem', opacity: 0.7 }}>Suitability</span>
          {headerRight}
        </div>
        <div className="suitability-message suitability-message-warning">{error}</div>
      </div>
    );
  }

  if (!currentSummary) {
    return (
      <div className="suitability-outlook-panel">
        <div className="suitability-outlook-header">
          <span style={{ fontSize: '0.78rem', opacity: 0.7 }}>Suitability</span>
          {headerRight}
        </div>
        <div className="suitability-message">No suitability data for this timestep.</div>
      </div>
    );
  }

  return (
    <div className="suitability-outlook-panel">
      <div className="suitability-outlook-header">
        <span style={{ fontSize: '0.78rem', color: 'rgba(248,250,252,0.7)' }}>
          Current vessel advisory
        </span>
        {headerRight}
      </div>

      <div className="suitability-vessel-grid">
        {VESSEL_CLASSES.map(vc => {
          const vd     = currentSummary.vessels?.[vc.code];
          const status = vd?.status ?? STATUS.UNAVAILABLE;
          const isActive = activeVessel === vc.code;

          return (
            <button
              key={vc.code}
              type="button"
              className={`suitability-card suitability-card-${status}${isActive ? ' is-active' : ''}`}
              onClick={() => handleVesselClick(vc.code)}
              title={`${vc.label}: ${STATUS_LABEL[status]}`}
            >
              <div className="suitability-card-top">
                <strong>{vc.shortLabel}</strong>
                <span className="suitability-card-badge">{STATUS_LABEL[status]}</span>
              </div>

              <div className="suitability-card-stats">
                <span className="suitability-stat">
                  <span className="suitability-stat-label">S</span>
                  <span className={`suitability-stat-value suitability-stat-suitable`}>
                    {formatPct(vd?.suitablePercent)}
                  </span>
                </span>
                <span className="suitability-stat">
                  <span className="suitability-stat-label">C</span>
                  <span className={`suitability-stat-value suitability-stat-caution`}>
                    {formatPct(vd?.cautionPercent)}
                  </span>
                </span>
                <span className="suitability-stat">
                  <span className="suitability-stat-label">A</span>
                  <span className={`suitability-stat-value suitability-stat-avoid`}>
                    {formatPct(vd?.avoidPercent)}
                  </span>
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <SuitabilityTimelineChart
        series={series}
        vesselCode={activeVessel}
        currentTimeIndex={safeIdx}
      />
    </div>
  );
}
