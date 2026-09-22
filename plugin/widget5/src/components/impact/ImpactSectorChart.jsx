import React, { useEffect, useMemo, useRef } from 'react';
import { Chart, ArcElement, DoughnutController, Legend, Tooltip } from 'chart.js';
import { IMPACT_SECTOR_COLORS, IMPACT_SECTOR_LABELS, IMPACT_SECTOR_ORDER } from '../../services/cookIslandsImpactService';

Chart.register(ArcElement, DoughnutController, Legend, Tooltip);

const fmtUsd = (value) => `$${Math.round(value).toLocaleString()}`;

// Doughnut breakdown of one block's economic damage by sector, following the same raw
// canvas + manual Chart instance lifecycle already used by
// components/risk/WaterLevelChart.jsx (react-chartjs-2 is a listed
// dependency but unused anywhere in this codebase -- matching the
// established local pattern rather than introducing a second charting
// style). Zero-value sectors are dropped before charting, same as the
// reference PARTneR app's regional popups, so the legend isn't cluttered
// with six slices when only two or three are ever nonzero here.
function ImpactSectorChart({ sectorValues, isDarkMode = false }) {
  const canvasRef = useRef(null);
  const chartInstanceRef = useRef(null);

  const chartData = useMemo(() => {
    const entries = IMPACT_SECTOR_ORDER
      .map((key) => ({ key, value: sectorValues?.[key] ?? 0 }))
      .filter((entry) => entry.value > 0);
    return entries;
  }, [sectorValues]);

  useEffect(() => {
    if (!canvasRef.current || chartData.length === 0) return undefined;

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }

    chartInstanceRef.current = new Chart(canvasRef.current.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: chartData.map((e) => IMPACT_SECTOR_LABELS[e.key] ?? e.key),
        datasets: [{
          data: chartData.map((e) => e.value),
          backgroundColor: chartData.map((e) => IMPACT_SECTOR_COLORS[e.key] ?? '#64748b'),
          borderColor: isDarkMode ? '#0f172a' : '#ffffff',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: isDarkMode ? '#e2e8f0' : '#334155',
              usePointStyle: true,
              boxWidth: 10,
              boxHeight: 10,
              font: { size: 11 },
            },
          },
          tooltip: {
            backgroundColor: isDarkMode ? 'rgba(15, 23, 42, 0.94)' : 'rgba(255, 255, 255, 0.96)',
            titleColor: isDarkMode ? '#f8fafc' : '#0f172a',
            bodyColor: isDarkMode ? '#e2e8f0' : '#1e293b',
            borderColor: isDarkMode ? '#334155' : '#cbd5e1',
            borderWidth: 1,
            callbacks: {
              label: (ctx) => `${ctx.label}: ${fmtUsd(ctx.parsed)}`,
            },
          },
        },
      },
    });

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [chartData, isDarkMode]);

  if (chartData.length === 0) {
    return <div style={{ fontSize: '0.75rem', color: 'rgba(203, 213, 225, 0.65)', textAlign: 'center', padding: '1rem' }}>No economic damage recorded for this window.</div>;
  }

  return (
    <div style={{ height: 180 }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

export default ImpactSectorChart;
