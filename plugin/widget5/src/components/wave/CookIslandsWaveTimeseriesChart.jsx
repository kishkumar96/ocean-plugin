import React, { useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import { Download } from 'lucide-react';
import {
  fetchWaveTimeseries, currentRow, zonedPlotlyTime, buildWaveTimeseriesCsv, downloadCsv,
  seaAngleOffBow, describeSeaAngle, compassPoint,
} from '../../services/cookIslandsWaveTimeseriesService';
import CookIslandsWaveRunAge from './CookIslandsWaveRunAge';
import { tzLabel, formatZoned } from '../../utils/timeZoneFormat';

const TEXT_MUTED = 'rgba(203, 213, 225, 0.72)';
const HS_COLOR = '#38bdf8';
const TP_COLOR = '#fbbf24';
const DIR_COLOR = '#c4b5fd';
const GRID = 'rgba(203,213,225,0.09)';
const TICK = '#a8b5c7';
const FONT = { color: TICK, size: 10.5, family: 'Inter, system-ui, sans-serif' };

function fmt(value, digits, unit) {
  return Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : '—';
}

// Hs (left axis) + peak period (right axis) over the full forecast, with
// peak direction (coming-from) underneath. Fetches its own data from
// /wave/ugrid/timeseries. `site`: {name, lon, lat, headingDeg?}. headingDeg is
// set for a route point, which adds the "angle off the bow" readout -- the
// single most useful number for a small boat crossing.
function CookIslandsWaveTimeseriesChart({ site, timeDisplayZone = 'Pacific/Rarotonga', height = 300, limits = null, departureTime = null, passageTime = null, onHoverTime = null }) {
  const [state, setState] = useState({ loading: true, error: null, rows: [], nodeDistanceKm: null });
  const { lon, lat } = site;

  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, error: null, rows: [], nodeDistanceKm: null });
    fetchWaveTimeseries(lon, lat, { signal: controller.signal })
      .then((ts) => setState({ loading: false, error: ts.rows.length ? null : 'No wave data returned for this point.', rows: ts.rows, nodeDistanceKm: ts.nodeDistanceKm }))
      .catch((err) => { if (err.name !== 'AbortError') setState({ loading: false, error: err.message, rows: [], nodeDistanceKm: null }); });
    return () => controller.abort();
  }, [lon, lat]);

  const { rows } = state;
  const x = useMemo(() => rows.map((r) => zonedPlotlyTime(r.time, timeDisplayZone)), [rows, timeDisplayZone]);
  const now = useMemo(() => currentRow(rows), [rows]);
  const nowX = now ? zonedPlotlyTime(now.time, timeDisplayZone) : null;
  // Route context: when the boat leaves, and when it is at this point. The
  // passage-time row drives the headline readout, since that is the sea state
  // the crossing actually meets here.
  const passage = useMemo(() => (passageTime ? currentRow(rows, new Date(passageTime)) : null), [rows, passageTime]);
  const departureX = departureTime ? zonedPlotlyTime(departureTime, timeDisplayZone) : null;
  const passageX = passage ? zonedPlotlyTime(passageTime, timeDisplayZone) : null;

  const data = useMemo(() => [
    {
      type: 'scatter', mode: 'lines', x, y: rows.map((r) => r.hs), name: 'Hs (m)',
      line: { color: HS_COLOR, width: 2.4 }, fill: 'tozeroy', fillcolor: 'rgba(56,189,248,0.10)',
      hovertemplate: '%{y:.2f} m<extra>Hs</extra>',
    },
    {
      type: 'scatter', mode: 'lines', x, y: rows.map((r) => r.tpeak), name: 'Peak period (s)', yaxis: 'y2',
      line: { color: TP_COLOR, width: 1.8, dash: 'dot' },
      hovertemplate: '%{y:.1f} s<extra>Tp</extra>',
    },
    {
      type: 'scatter', mode: 'markers', x, y: rows.map((r) => r.dirp), name: 'Direction (from)', yaxis: 'y3',
      marker: { color: DIR_COLOR, size: 4 },
      customdata: rows.map((r) => compassPoint(r.dirp)),
      hovertemplate: '%{y:.0f}° (%{customdata})<extra>Dir from</extra>',
    },
  ], [x, rows]);

  // Horizontal caution/stop lines for the user-set unloading limits (Hs on
  // the left axis, period on the right). Wind has no trace on this chart.
  const limitShapes = useMemo(() => {
    const out = [];
    [['caution', '#fbbf24'], ['stop', '#f87171']].forEach(([level, color]) => {
      [['hsM', 'y'], ['tpS', 'y2']].forEach(([key, yref]) => {
        const value = limits?.[level]?.[key];
        if (Number.isFinite(value) && x.length) {
          out.push({ type: 'line', xref: 'paper', yref, x0: 0, x1: 1, y0: value, y1: value, line: { color, width: 1.2, dash: key === 'hsM' ? 'dash' : 'dot' } });
        }
      });
    });
    return out;
  }, [limits, x]);

  const layout = useMemo(() => ({
    autosize: true, height,
    margin: { l: 44, r: 44, t: passageX || departureX ? 20 : 6, b: 36 },
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(8,14,30,0.20)',
    showlegend: false, dragmode: false, hovermode: 'x unified',
    xaxis: { type: 'date', tickformat: '%b %d\n%H:%M', tickfont: FONT, gridcolor: GRID, linecolor: 'transparent', anchor: 'y3' },
    yaxis: { domain: [0.36, 1], title: { text: 'Hs (m)', font: { ...FONT, color: HS_COLOR } }, tickfont: FONT, gridcolor: GRID, zeroline: false, rangemode: 'tozero' },
    yaxis2: { domain: [0.36, 1], overlaying: 'y', side: 'right', title: { text: 'Tp (s)', font: { ...FONT, color: TP_COLOR } }, tickfont: FONT, showgrid: false, zeroline: false, rangemode: 'tozero' },
    yaxis3: {
      domain: [0, 0.26], range: [0, 360], tickvals: [0, 90, 180, 270, 360], ticktext: ['N', 'E', 'S', 'W', 'N'],
      tickfont: FONT, gridcolor: GRID, zeroline: false, title: { text: 'From', font: { ...FONT, color: DIR_COLOR } },
    },
    shapes: [
      ...(nowX ? [{ type: 'line', xref: 'x', yref: 'paper', x0: nowX, x1: nowX, y0: 0, y1: 1, line: { color: 'rgba(248,250,252,0.5)', width: 1.4, dash: 'dashdot' } }] : []),
      ...(departureX ? [{ type: 'line', xref: 'x', yref: 'paper', x0: departureX, x1: departureX, y0: 0, y1: 1, line: { color: 'rgba(148,163,184,0.85)', width: 1.4, dash: 'dash' } }] : []),
      ...(passageX ? [{ type: 'line', xref: 'x', yref: 'paper', x0: passageX, x1: passageX, y0: 0, y1: 1, line: { color: '#f472b6', width: 2.4 } }] : []),
      ...limitShapes,
    ],
    annotations: [
      ...(departureX ? [{ x: departureX, xref: 'x', yref: 'paper', y: 1, yanchor: 'bottom', text: 'Depart', xanchor: 'right', showarrow: false, font: { size: 10, color: '#cbd5e1' } }] : []),
      ...(passageX ? [{ x: passageX, xref: 'x', yref: 'paper', y: 1, yanchor: 'bottom', text: 'At midpoint', xanchor: 'left', showarrow: false, font: { size: 10, color: '#f472b6' } }] : []),
    ],
    hoverlabel: { bgcolor: '#1e293b', bordercolor: '#334155', font: { color: '#f1f5f9', size: 12 } },
  }), [height, nowX, limitShapes, departureX, passageX]);

  const angleFor = (row) => (row && Number.isFinite(site.headingDeg) ? seaAngleOffBow(row.dirp, site.headingDeg) : null);
  const angle = angleFor(now);
  const passageAngle = angleFor(passage);

  const handleCsv = () => {
    const slug = (site.name || `${lat.toFixed(3)}_${lon.toFixed(3)}`).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    downloadCsv(`wave_forecast_${slug}.csv`, buildWaveTimeseriesCsv(rows, site));
  };

  if (state.loading) {
    return <div style={{ textAlign: 'center', padding: '1.25rem', color: TEXT_MUTED, fontSize: '0.74rem' }}>Loading wave forecast…</div>;
  }
  if (state.error) {
    return <div style={{ color: '#f87171', fontSize: '0.74rem', padding: '0.5rem 0' }}>{state.error}</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: '0.72rem', color: TEXT_MUTED, lineHeight: 1.45 }}>
          <span style={{ color: HS_COLOR }}>● Hs</span>{' '}
          <span style={{ color: TP_COLOR }}>● Peak period</span>{' '}
          <span style={{ color: DIR_COLOR }}>● Direction waves come from</span>
          {' · '}times in {tzLabel(timeDisplayZone)}
          {limitShapes.length > 0 && <> · dashed lines = your caution (amber) / stop (red) limits</>}
        </div>
        <button type="button" className="map-display-option__btn" onClick={handleCsv} title="Download the full forecast as CSV">
          <Download size={12} strokeWidth={2} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} />CSV
        </button>
      </div>

      <CookIslandsWaveRunAge runStart={rows[0]?.time} timeDisplayZone={timeDisplayZone} />

      {passage && (
        <div style={{ fontSize: '0.74rem', color: '#f8fafc', marginBottom: 4 }}>
          <span style={{ color: '#f472b6', fontWeight: 700 }}>At midpoint ({formatZoned(new Date(passageTime), timeDisplayZone)}):</span>{' '}
          <strong>{fmt(passage.hs, 2, ' m')}</strong> at <strong>{fmt(passage.tpeak, 1, ' s')}</strong> from{' '}
          <strong>{Number.isFinite(passage.dirp) ? `${compassPoint(passage.dirp)} (${Math.round(passage.dirp)}°)` : '—'}</strong>
          {passageAngle !== null && <> — <strong>{describeSeaAngle(passageAngle)}</strong> ({Math.round(passageAngle)}° off the bow)</>}
        </div>
      )}
      {now && (
        <div style={{ fontSize: '0.72rem', color: passage ? TEXT_MUTED : '#f8fafc', marginBottom: 4 }}>
          Now: <strong>{fmt(now.hs, 2, ' m')}</strong> at <strong>{fmt(now.tpeak, 1, ' s')}</strong> from{' '}
          <strong>{Number.isFinite(now.dirp) ? `${compassPoint(now.dirp)} (${Math.round(now.dirp)}°)` : '—'}</strong>
          {angle !== null && <> — <strong>{describeSeaAngle(angle)}</strong> ({Math.round(angle)}° off the bow)</>}
          {Number.isFinite(now.hs_p2) && Number.isFinite(now.tp_p2) && (
            <div style={{ color: TEXT_MUTED }}>
              Primary swell: {fmt(now.hs_p2, 2, ' m')} at {fmt(now.tp_p2, 1, ' s')} from {compassPoint(now.dirp_p2) ?? '—'}
              {Number.isFinite(now.hs_p1) && <> · Wind sea: {fmt(now.hs_p1, 2, ' m')} at {fmt(now.tp_p1, 1, ' s')} from {compassPoint(now.dirp_p1) ?? '—'}</>}
            </div>
          )}
        </div>
      )}

      <Plot
        data={data}
        layout={layout}
        config={{ displayModeBar: false, responsive: true, doubleClick: false, scrollZoom: false }}
        style={{ width: '100%', height }}
        useResizeHandler
        // Hovered forecast time (epoch ms), so a parent can show it on the map; null on leave.
        onHover={onHoverTime ? (ev) => {
          const idx = ev?.points?.[0]?.pointNumber;
          const time = Number.isInteger(idx) ? rows[idx]?.time : null;
          onHoverTime(time ? new Date(time).getTime() : null);
        } : undefined}
        onUnhover={onHoverTime ? () => onHoverTime(null) : undefined}
      />

      {Number.isFinite(state.nodeDistanceKm) && state.nodeDistanceKm > 2 && (
        <div style={{ fontSize: '0.66rem', color: '#fbbf24', marginTop: 2 }}>
          Nearest wave-model point is {state.nodeDistanceKm.toFixed(1)} km from this location.
        </div>
      )}
    </div>
  );
}

export default CookIslandsWaveTimeseriesChart;
