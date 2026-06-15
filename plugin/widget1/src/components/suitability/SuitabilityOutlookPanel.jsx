import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Eye, EyeOff } from 'lucide-react';
import {
  VESSEL_CLASSES,
  fetchSuitabilityTimeseries,
  STATUS,
} from '../../services/SuitabilityApiService';
import SuitabilityTimelineChart from './SuitabilityTimelineChart';
import './SuitabilityOutlook.css';

const DEFAULT_MAX_STEPS = 73;

const STATUS_LABEL = {
  [STATUS.SUITABLE]:    'Suitable',
  [STATUS.CAUTION]:     'Caution',
  [STATUS.AVOID]:       'Avoid',
  [STATUS.UNAVAILABLE]: 'N/A',
};

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

function formatUtcCompact(isoString) {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (!Number.isFinite(d.getTime())) return null;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day = d.getUTCDate();
  const mon = months[d.getUTCMonth()];
  const hr  = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${mon} ${hr}:${min} UTC`;
}

function appendTextNode(parent, className, text) {
  if (!text) return null;
  const el = L.DomUtil.create('div', className, parent);
  el.textContent = text;
  return el;
}

function buildSuitabilityBadge({ vesselLabel, status, timeLabel }) {
  const div = L.DomUtil.create('div', 'leaflet-suitability-badge');
  div.setAttribute('role', 'status');
  div.setAttribute('aria-label', `${vesselLabel} suitability map overlay`);
  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);

  appendTextNode(div, 'suit-badge-vessel', `${vesselLabel} · Suitability map`);
  if (status !== STATUS.UNAVAILABLE) {
    appendTextNode(
      div,
      `suit-badge-status suit-badge-status-${status}`,
      STATUS_LABEL[status].toUpperCase(),
    );
  }
  appendTextNode(div, 'suit-badge-time', timeLabel);
  return div;
}

function buildSuitabilityLegend() {
  const div = L.DomUtil.create('div', 'leaflet-suitability-legend');
  div.setAttribute('role', 'img');
  div.setAttribute('aria-label', 'Suitability overlay legend: Suitable, Caution, Avoid');
  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);

  appendTextNode(div, 'suit-legend-title', 'Suitability overlay');
  [
    ['suit-swatch-suitable', 'Suitable'],
    ['suit-swatch-caution', 'Caution'],
    ['suit-swatch-avoid', 'Avoid'],
  ].forEach(([swatchClass, label]) => {
    const item = L.DomUtil.create('div', 'suit-legend-item', div);
    const swatch = L.DomUtil.create('span', `suit-legend-swatch ${swatchClass}`, item);
    swatch.setAttribute('aria-hidden', 'true');
    const text = L.DomUtil.create('span', 'suit-legend-label', item);
    text.textContent = label;
  });
  return div;
}

export default function SuitabilityOutlookPanel({
  timeIndex          = 0,
  suitabilityBaseUrl = '',
  selectedVessel     = 'small_craft',
  onSelectedVesselChange,
  overlayVisible     = true,
  onOverlayToggle,
  mapInstance,
}) {
  const [series,       setSeries]      = useState([]);
  const [activeVessel, setActiveVessel] = useState(selectedVessel);
  const [loading,      setLoading]     = useState(false);
  const [error,        setError]       = useState(null);

  const mapBadgeRef  = useRef(null);
  const mapLegendRef = useRef(null);

  const safeIdx = Number.isFinite(Number(timeIndex)) ? Number(timeIndex) : 0;

  // Fetch full timeseries once on mount (or when baseUrl changes).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchSuitabilityTimeseries({ startIndex: 0, maxSteps: DEFAULT_MAX_STEPS, baseUrl: suitabilityBaseUrl })
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
  useEffect(() => { setActiveVessel(selectedVessel); }, [selectedVessel]);

  // Pick the summary that matches the current map timestep.
  const currentSummary = useMemo(() => {
    if (!series.length) return null;
    const exact = series.find(s => Number(s.timeIndex) === safeIdx);
    return exact || findNearestByTimeIndex(series, safeIdx);
  }, [series, safeIdx]);

  const validTimeStr = useMemo(() => formatUtcCompact(currentSummary?.timeUtc), [currentSummary]);
  const activeVesselLabel = useMemo(
    () => VESSEL_CLASSES.find(vc => vc.code === activeVessel)?.label ?? activeVessel,
    [activeVessel],
  );
  const activeVesselStatus = currentSummary?.vessels?.[activeVessel]?.status ?? STATUS.UNAVAILABLE;

  const handleVesselClick = code => {
    setActiveVessel(code);
    onSelectedVesselChange?.(code);
  };

  // ── Leaflet map badge + legend ───────────────────────────────────────────────
  // Both controls are created/destroyed together with the overlay state.
  useEffect(() => {
    const map = mapInstance?.current;
    if (!map) return;

    const removeCurrent = () => {
      if (mapBadgeRef.current)  { try { map.removeControl(mapBadgeRef.current);  } catch {} mapBadgeRef.current  = null; }
      if (mapLegendRef.current) { try { map.removeControl(mapLegendRef.current); } catch {} mapLegendRef.current = null; }
    };

    removeCurrent();
    if (!overlayVisible) return;

    // ── Badge (topleft) ──
    const BadgeControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        return buildSuitabilityBadge({
          vesselLabel: activeVesselLabel,
          status: activeVesselStatus,
          timeLabel: validTimeStr,
        });
      },
    });

    // ── Legend (bottomright) ──
    const LegendControl = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd() {
        return buildSuitabilityLegend();
      },
    });

    mapBadgeRef.current  = new BadgeControl();
    mapLegendRef.current = new LegendControl();
    mapBadgeRef.current.addTo(map);
    mapLegendRef.current.addTo(map);

    return removeCurrent;
  }, [mapInstance, overlayVisible, activeVesselLabel, activeVesselStatus, validTimeStr]);

  // ── Render ───────────────────────────────────────────────────────────────────

  const headerRight = (
    <div className="suitability-header-right">
      {onOverlayToggle && (
        <button
          type="button"
          className={`suitability-overlay-toggle${overlayVisible ? ' is-active' : ''}`}
          onClick={onOverlayToggle}
          title={overlayVisible ? 'Hide suitability map overlay' : 'Show suitability map overlay'}
        >
          {overlayVisible ? <Eye size={11} /> : <EyeOff size={11} />}
          <span className="suitability-overlay-toggle-label">Suitability map</span>
        </button>
      )}
      <span
        className="suitability-time-chip"
        title={`Step ${safeIdx}`}
      >
        {validTimeStr || `Step ${safeIdx}`}
      </span>
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
                  <span className="suitability-stat-value suitability-stat-suitable">
                    {formatPct(vd?.suitablePercent)}
                  </span>
                </span>
                <span className="suitability-stat">
                  <span className="suitability-stat-label">C</span>
                  <span className="suitability-stat-value suitability-stat-caution">
                    {formatPct(vd?.cautionPercent)}
                  </span>
                </span>
                <span className="suitability-stat">
                  <span className="suitability-stat-label">A</span>
                  <span className="suitability-stat-value suitability-stat-avoid">
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
