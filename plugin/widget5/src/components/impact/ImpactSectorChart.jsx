import React, { useMemo } from 'react';
import { IMPACT_SECTOR_COLORS, IMPACT_SECTOR_LABELS, IMPACT_SECTOR_ORDER } from '../../services/cookIslandsImpactService';

const fmtUsd = (value) => `$${Math.round(value).toLocaleString()}`;

// Sorted horizontal bars for one window's economic damage by sector, with the value and share printed
// on each row: comparison needs no legend lookup and no hovering. Zero-value sectors are dropped.
// `isDarkMode` is kept for call-site compatibility; the panel is always dark.
function ImpactSectorChart({ sectorValues }) {
  const rows = useMemo(() => {
    const entries = IMPACT_SECTOR_ORDER
      .map((key) => ({ key, value: sectorValues?.[key] ?? 0 }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value);
    const total = entries.reduce((sum, e) => sum + e.value, 0);
    return entries.map((e) => ({ ...e, share: total > 0 ? e.value / total : 0 }));
  }, [sectorValues]);

  if (rows.length === 0) {
    return <div style={{ fontSize: '0.8rem', color: 'rgba(203, 213, 225, 0.75)', textAlign: 'center', padding: '1rem' }}>No economic damage recorded for this window.</div>;
  }

  return (
    <div role="list" aria-label="Economic damage by sector" style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
      {rows.map((row) => (
        <div key={row.key} role="listitem">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.8rem', color: '#f8fafc', marginBottom: 2 }}>
            <span>{IMPACT_SECTOR_LABELS[row.key] ?? row.key}</span>
            <span style={{ fontWeight: 700 }}>
              {fmtUsd(row.value)}
              <span style={{ fontWeight: 500, color: 'rgba(203, 213, 225, 0.75)', marginLeft: '0.4rem' }}>{Math.round(row.share * 100)}%</span>
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)' }}>
            <div style={{ width: `${Math.max(row.share * 100, 2)}%`, height: '100%', borderRadius: 4, background: IMPACT_SECTOR_COLORS[row.key] ?? '#64748b' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default ImpactSectorChart;
