import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Plot from 'react-plotly.js';
import Plotly from 'plotly.js/dist/plotly';
import { Download, Printer } from 'lucide-react';
import { HAZARD_COLORS } from '../../lib/CookIslandsSuitabilityOverlay';
import { ROUTE_HAZARD_LABELS } from '../../services/cookIslandsRouteForecastService';

// Ported from widget1's pages/LandingAreaTimeseries.jsx. One deliberate
// deviation, not an oversight: widget1 uses a separate CHART_HAZARD_COLORS
// palette (teal/amber/red) just for this chart, distinct from
// SUITABILITY_HAZARD_COLORS used everywhere else in that app. This app's own
// backend/frontend color comments are explicit about keeping exactly one
// hazard palette everywhere (see COK_SUIT_COLORS in zarr-api/main.py and
// CookIslandsSuitabilityOverlay.js's HAZARD_COLORS) so a reading never looks
// like a different color depending which view shows it -- this chart reuses
// that same HAZARD_COLORS/ROUTE_HAZARD_LABELS pair rather than reproducing
// widget1's inconsistency.
const CHART_BAND_ALPHA_DARK = { 0: 0.18, 1: 0.14, 2: 0.16 };
const CHART_BAND_ALPHA_LIGHT = { 0: 0.10, 1: 0.09, 2: 0.10 };

// Exported so a parent (CookIslandsLandingAreaComparisonPanel) can derive the
// same "current step" for its own header/badge, without this chart having to
// lift it out via a callback prop.
export function closestStep(steps, targetDate) {
  if (!targetDate || !steps?.length) return null;
  const target = new Date(targetDate).getTime();
  return steps.reduce((best, s) => {
    const diff = Math.abs(new Date(s.valid_time).getTime() - target);
    return diff < Math.abs(new Date(best.valid_time).getTime() - target) ? s : best;
  });
}

function hexToRgba(hex, alpha) {
  const h = (hex || '#888888').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function CookIslandsLandingAreaTimeseries({ steps, vesselLabel, currentSliderDate, isDarkMode = true }) {
  const [plotHeight, setPlotHeight] = useState(260);
  const chartRef = useRef(null);
  const resizeFrameRef = useRef(null);
  const plotlyDivRef = useRef(null);

  const schedulePlotResize = useCallback(() => {
    if (resizeFrameRef.current) cancelAnimationFrame(resizeFrameRef.current);
    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      const el = chartRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setPlotHeight((cur) => (cur === rect.height ? cur : Math.max(160, rect.height)));
      if (plotlyDivRef.current) Plotly.Plots.resize(plotlyDivRef.current);
    });
  }, []);

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return undefined;
    schedulePlotResize();
    window.addEventListener('resize', schedulePlotResize);
    const obs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedulePlotResize) : null;
    obs?.observe(el);
    return () => {
      window.removeEventListener('resize', schedulePlotResize);
      obs?.disconnect();
      if (resizeFrameRef.current) cancelAnimationFrame(resizeFrameRef.current);
    };
  }, [schedulePlotResize]);

  const handleExportPNG = useCallback(() => {
    if (!plotlyDivRef.current) return;
    Plotly.downloadImage(plotlyDivRef.current, {
      format: 'png', width: 1200, height: 500, scale: 2, filename: 'landing-area-suitability',
    });
  }, []);

  const handlePrintChart = useCallback(() => {
    if (!plotlyDivRef.current) return;
    Plotly.toImage(plotlyDivRef.current, { format: 'svg', width: 1200, height: 500 }).then((svgDataUrl) => {
      const win = window.open('', '_blank', 'width=960,height=720');
      if (!win) return;
      win.document.write(`<!DOCTYPE html><html><head>
        <title>Landing Area Suitability</title>
        <style>
          body { margin: 20px; font-family: Inter, system-ui, sans-serif; color: #0f172a; }
          h2 { margin: 0 0 4px; font-size: 16px; }
          img { max-width: 100%; margin-top: 12px; display: block; }
          .footer { margin-top: 12px; font-size: 11px; color: #94a3b8; }
          @media print { body { margin: 0; } }
        </style>
      </head><body>
        <h2>Landing Area Suitability${vesselLabel ? ` — ${vesselLabel}` : ''}</h2>
        <img src="${svgDataUrl}" alt="Landing area suitability chart" />
        <div class="footer">Generated ${new Date().toLocaleString('en-NZ', { timeZone: 'UTC' })} UTC</div>
        <script>window.onload = function() { window.print(); };</script>
      </body></html>`);
      win.document.close();
    });
  }, [vesselLabel]);

  const scoredSteps = useMemo(() => (
    (steps || []).filter((s) => Number.isFinite(s?.hazard_class))
  ), [steps]);
  const times = useMemo(() => scoredSteps.map((s) => new Date(s.valid_time)), [scoredSteps]);
  const hazardClasses = useMemo(() => scoredSteps.map((s) => s.hazard_class), [scoredSteps]);
  const hoverLabels = useMemo(() => hazardClasses.map((h) => ROUTE_HAZARD_LABELS[h] ?? 'Unknown'), [hazardClasses]);

  // Line only, no per-point markers -- a marker on every observation reads
  // as a dense row of dots for a 7-day/hourly series. hovertemplate still
  // works on hover with mode: 'lines' (Plotly snaps to the nearest point).
  const trace = useMemo(() => ({
    type: 'scatter',
    x: times,
    y: hazardClasses,
    mode: 'lines',
    line: { shape: 'hv', color: isDarkMode ? 'rgba(226,232,240,0.78)' : 'rgba(15,23,42,0.62)', width: 2.4 },
    customdata: hoverLabels,
    hovertemplate: '<b>%{x|%b %d %H:%M UTC}</b><br>%{customdata}<extra></extra>',
  }), [times, hazardClasses, hoverLabels, isDarkMode]);

  const nowStep = useMemo(() => closestStep(steps, currentSliderDate), [steps, currentSliderDate]);

  // Selected-time marker -- one highlighted point, not per-observation clutter.
  const selectedTrace = useMemo(() => {
    if (!nowStep || !Number.isFinite(nowStep.hazard_class)) return null;
    return {
      type: 'scatter',
      x: [new Date(nowStep.valid_time)],
      y: [nowStep.hazard_class],
      mode: 'markers',
      marker: {
        size: 13,
        color: HAZARD_COLORS[nowStep.hazard_class] ?? '#94a3b8',
        line: { color: isDarkMode ? '#f8fafc' : '#0f172a', width: 2.6 },
      },
      hoverinfo: 'skip',
      showlegend: false,
    };
  }, [nowStep, isDarkMode]);

  // Background hazard bands, one filled rect per class across the full x-range.
  const bandShapes = useMemo(() => {
    if (!times.length) return [];
    const x0 = times[0];
    const x1 = times[times.length - 1];
    const alphas = isDarkMode ? CHART_BAND_ALPHA_DARK : CHART_BAND_ALPHA_LIGHT;
    return [0, 1, 2].map((h) => ({
      type: 'rect', xref: 'x', yref: 'y',
      x0, x1, y0: h - 0.5, y1: h + 0.5,
      fillcolor: hexToRgba(HAZARD_COLORS[h], alphas[h]),
      line: { width: 0 },
      layer: 'below',
    }));
  }, [times, isDarkMode]);

  const nowShape = useMemo(() => {
    if (!currentSliderDate || !times.length) return null;
    const t = new Date(currentSliderDate);
    return {
      type: 'line', xref: 'x', yref: 'paper',
      x0: t, x1: t, y0: 0, y1: 1,
      line: { color: isDarkMode ? 'rgba(248,250,252,0.58)' : 'rgba(15,23,42,0.32)', width: 1.6, dash: 'dashdot' },
    };
  }, [currentSliderDate, times, isDarkMode]);

  const grid = isDarkMode ? 'rgba(203,213,225,0.09)' : 'rgba(15,23,42,0.07)';
  const tick = isDarkMode ? '#a8b5c7' : '#64748b';
  const muted = isDarkMode ? '#94a3b8' : '#64748b';

  if (!steps?.length) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 2rem', color: isDarkMode ? '#475569' : '#94a3b8', fontSize: 14 }}>
        No suitability data at this landing area.
      </div>
    );
  }

  if (!scoredSteps.length) {
    return (
      <div className="cok-landing-area-timeseries">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: isDarkMode ? '#f1f5f9' : '#0f172a' }}>
              Landing suitability unavailable
            </div>
            <div style={{ fontSize: '0.72rem', color: muted, marginTop: 1 }}>
              {vesselLabel ? `Forecast for ${vesselLabel}` : 'Forecast'}
            </div>
          </div>
        </div>
        <div style={{
          border: `1px solid ${isDarkMode ? 'rgba(148,163,184,0.18)' : 'rgba(100,116,139,0.18)'}`,
          background: isDarkMode ? 'rgba(15,23,42,0.52)' : 'rgba(241,245,249,0.72)',
          borderRadius: 12,
          padding: '1rem 1.2rem',
          color: muted,
          fontSize: 13,
          lineHeight: 1.55,
        }}>
          This landing point has no scored suitability samples in the current deployment. It may be on land, outside the marine mesh, or too far from a valid model point.
        </div>
      </div>
    );
  }

  return (
    <div className="cok-landing-area-timeseries">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: isDarkMode ? '#f1f5f9' : '#0f172a' }}>
            7-day landing suitability
          </div>
          <div style={{ fontSize: '0.72rem', color: muted, marginTop: 1 }}>
            {vesselLabel ? `Forecast for ${vesselLabel}` : 'Forecast'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button type="button" className="map-display-option__btn" onClick={handleExportPNG} title="Download chart as PNG">
            <Download size={12} strokeWidth={2} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} />PNG
          </button>
          <button type="button" className="map-display-option__btn" onClick={handlePrintChart} title="Print this chart (or save as PDF from the print dialog)">
            <Printer size={12} strokeWidth={2} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} />Print
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.68rem', color: muted, marginBottom: 6 }}>
        {[0, 1, 2].map((h) => (
          <span key={h} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: HAZARD_COLORS[h], display: 'inline-block' }} />
            {ROUTE_HAZARD_LABELS[h]}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', border: `2px solid ${muted}`, display: 'inline-block', boxSizing: 'border-box' }} />
          Selected time
        </span>
      </div>

      <div ref={chartRef} style={{ height: 'clamp(220px, 32vh, 320px)' }}>
        <Plot
          data={selectedTrace ? [trace, selectedTrace] : [trace]}
          layout={{
            autosize: true,
            height: plotHeight,
            margin: { l: 70, r: 18, t: 8, b: 36 },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: isDarkMode ? 'rgba(8,14,30,0.20)' : 'rgba(248,250,252,0.55)',
            xaxis: {
              tickfont: { color: tick, size: 10.5, family: 'Inter, system-ui, sans-serif' },
              gridcolor: grid, linecolor: 'transparent', zerolinecolor: 'transparent',
              tickformat: '%b %d\n%H:%M', type: 'date', showgrid: true,
              ticks: 'outside', ticklen: 4, tickcolor: 'transparent',
            },
            yaxis: {
              tickvals: [0, 1, 2],
              ticktext: [ROUTE_HAZARD_LABELS[0], ROUTE_HAZARD_LABELS[1], ROUTE_HAZARD_LABELS[2]],
              range: [-0.5, 2.5],
              tickfont: { color: tick, size: 10.5, family: 'Inter, system-ui, sans-serif' },
              gridcolor: grid, linecolor: 'transparent', zerolinecolor: 'transparent',
              ticks: 'outside', ticklen: 4, tickcolor: 'transparent',
            },
            showlegend: false,
            dragmode: false,
            shapes: [...bandShapes, ...(nowShape ? [nowShape] : [])],
            hoverlabel: {
              bgcolor: isDarkMode ? '#1e293b' : '#ffffff',
              bordercolor: isDarkMode ? '#334155' : '#e2e8f0',
              font: { color: isDarkMode ? '#f1f5f9' : '#0f172a', size: 12, family: 'Inter, system-ui, sans-serif' },
            },
            hovermode: 'closest',
          }}
          config={{ displayModeBar: false, responsive: true, doubleClick: false, scrollZoom: false }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
          onInitialized={(fig, div) => { plotlyDivRef.current = div; schedulePlotResize(); }}
          onUpdate={(fig, div) => { plotlyDivRef.current = div; }}
        />
      </div>
    </div>
  );
}

export default CookIslandsLandingAreaTimeseries;
