import React, { useMemo } from 'react';

const WIDTH   = 400;
const HEIGHT  = 100;
const PAD     = { top: 10, right: 8, bottom: 20, left: 26 };
const CHART_W = WIDTH  - PAD.left - PAD.right;
const CHART_H = HEIGHT - PAD.top  - PAD.bottom;

function xPos(index, count) {
  if (count <= 1) return PAD.left;
  return PAD.left + (index / (count - 1)) * CHART_W;
}

function yPos(percent) {
  const v = Math.max(0, Math.min(100, Number(percent) || 0));
  return PAD.top + CHART_H - (v / 100) * CHART_H;
}

function buildPath(series, vesselCode, key) {
  if (!series.length) return '';
  return series
    .map((item, i) => {
      const v = item.vessels?.[vesselCode];
      const x = xPos(i, series.length);
      const y = yPos(v?.[key]);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

const GRID_VALUES = [0, 25, 50, 75, 100];

function nearestSeriesIndex(series, targetTimeIndex) {
  if (!series.length) return 0;

  const target = Number(targetTimeIndex);
  if (!Number.isFinite(target)) return 0;

  return series.reduce((bestIndex, item, index) => {
    const itemIndex = Number(item.timeIndex);
    const bestTimeIndex = Number(series[bestIndex]?.timeIndex);

    if (!Number.isFinite(itemIndex)) return bestIndex;
    if (!Number.isFinite(bestTimeIndex)) return index;

    return Math.abs(itemIndex - target) < Math.abs(bestTimeIndex - target) ? index : bestIndex;
  }, 0);
}

export default function SuitabilityTimelineChart({ series = [], vesselCode, currentTimeIndex = 0 }) {
  const data = useMemo(() => (Array.isArray(series) ? series : []), [series]);

  if (!data.length) {
    return <div className="suitability-chart-empty">No timeline data available.</div>;
  }

  const cursorIdx = (() => {
    const exact = data.findIndex(s => Number(s.timeIndex) === Number(currentTimeIndex));
    if (exact !== -1) return exact;
    return nearestSeriesIndex(data, currentTimeIndex);
  })();

  const cx = xPos(cursorIdx, data.length);

  return (
    <div className="suitability-chart-wrap">
      <div className="suitability-chart-title">Selected vessel — 72 h outlook</div>

      <svg
        className="suitability-timeline-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Suitability timeline chart"
      >
        {/* Grid lines + y-axis labels */}
        {GRID_VALUES.map(v => {
          const y = yPos(v);
          return (
            <g key={v}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} className="suitability-grid-line" />
              <text x={PAD.left - 4} y={y + 3} textAnchor="end" className="suitability-axis-label">
                {v}
              </text>
            </g>
          );
        })}

        {/* x-axis label */}
        <text
          x={PAD.left + CHART_W / 2}
          y={HEIGHT - 4}
          textAnchor="middle"
          className="suitability-axis-label"
        >
          Time →
        </text>

        {/* Data lines — suitable, caution, avoid */}
        <path d={buildPath(data, vesselCode, 'suitablePercent')} className="suitability-line suitability-line-suitable" fill="none" />
        <path d={buildPath(data, vesselCode, 'cautionPercent')}  className="suitability-line suitability-line-caution"  fill="none" />
        <path d={buildPath(data, vesselCode, 'avoidPercent')}    className="suitability-line suitability-line-avoid"    fill="none" />

        {/* Current time cursor */}
        <line x1={cx} x2={cx} y1={PAD.top} y2={HEIGHT - PAD.bottom} className="suitability-cursor" />
      </svg>

      <div className="suitability-chart-legend">
        <span>
          <span className="suitability-legend-dot suitability-legend-dot-suitable" />
          Suitable
        </span>
        <span>
          <span className="suitability-legend-dot suitability-legend-dot-caution" />
          Caution
        </span>
        <span>
          <span className="suitability-legend-dot suitability-legend-dot-avoid" />
          Avoid
        </span>
      </div>
    </div>
  );
}
