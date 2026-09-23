import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileDown } from 'lucide-react';
import { VESSEL_CLASS_OPTIONS } from '../../lib/CookIslandsSuitabilityOverlay';
import { useCookIslandsLandingAreaComparison } from '../../hooks/useCookIslandsLandingAreaComparison';
import CookIslandsLandingAreaComparisonHeatmap from './CookIslandsLandingAreaComparisonHeatmap';
import CookIslandsLandingAreaTimeseries from './CookIslandsLandingAreaTimeseries';
import { exportCookIslandsLandingAreaComparisonPdf } from '../../utils/CookIslandsLandingAreaComparisonPdf';

const TEXT_MUTED = 'rgba(203, 213, 225, 0.72)';

// "Compare all" is widget1's LandingAreaDetailsPanel.jsx's own comparison
// tab, standalone here. "This location" is the same idea as widget1's own
// first tab, adapted: widget1 populates it from a map-click point-picker
// mode this app doesn't have; here it's a selector over the SAME named
// sites the comparison fetch already pulled a full 7-day series for, so
// picking a site is free (no second fetch) rather than needing its own
// point-picker feature built first.
//
// Lives in the bottom sheet (BottomOffCanvas's 'landing-area-comparison'
// mode), not the sidebar -- the heatmap is naturally wide (15 time columns
// x every named site), and the sidebar column forced it into its own
// cramped horizontal scroll. Mounting here only happens once the user opens
// that mode, which is what gates the fetch below now -- no separate
// open/closed state of its own the way this used to need before the sheet
// existed to gate it from the outside.
function CookIslandsLandingAreaComparisonPanel({ vesselClass, currentSliderDate, timeDisplayZone = 'Pacific/Rarotonga' }) {
  const [activeTab, setActiveTab] = useState('compare');
  const [selectedSiteId, setSelectedSiteId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const vesselLabel = VESSEL_CLASS_OPTIONS.find((v) => v.value === vesselClass)?.label ?? vesselClass;
  const comparison = useCookIslandsLandingAreaComparison(vesselClass, true);

  // Default to the first site once data arrives, and re-pick one if the
  // previously selected site drops out of the list (e.g. vessel changed and
  // that site now has no scored samples).
  useEffect(() => {
    if (!comparison.rows.length) return;
    if (!comparison.rows.some((r) => r.id === selectedSiteId)) {
      setSelectedSiteId(comparison.rows[0].id);
    }
  }, [comparison.rows, selectedSiteId]);

  const selectedRow = useMemo(
    () => comparison.rows.find((r) => r.id === selectedSiteId) ?? null,
    [comparison.rows, selectedSiteId],
  );

  const handleExportPdf = useCallback(async () => {
    if (exporting || !comparison.rows.length) return;
    setExporting(true);
    setExportError('');
    try {
      await exportCookIslandsLandingAreaComparisonPdf({ rows: comparison.rows, vesselLabel, timeDisplayZone });
    } catch (err) {
      console.error('[CookIslandsLandingAreaComparisonPanel] PDF export failed:', err);
      setExportError(err.message || 'PDF export failed.');
    } finally {
      setExporting(false);
    }
  }, [comparison.rows, exporting, vesselLabel, timeDisplayZone]);

  return (
    <div>
      <div style={{ fontSize: '0.7rem', color: TEXT_MUTED, marginBottom: '0.6rem' }}>
        Shows the next 7 days of suitability at every named landing and fishing-ground site at once.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.6rem' }}>
        <div role="tablist" aria-label="Landing area view" style={{ display: 'flex', gap: 6 }}>
          {[
            { key: 'compare', label: 'Compare all' },
            { key: 'location', label: 'This location' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '0.32rem 0.75rem', borderRadius: 999, fontSize: '0.74rem', fontWeight: 600,
                cursor: 'pointer', border: `1px solid ${activeTab === tab.key ? 'rgba(56, 189, 248, 0.5)' : 'rgba(255, 255, 255, 0.12)'}`,
                background: activeTab === tab.key ? 'rgba(56, 189, 248, 0.16)' : 'rgba(255, 255, 255, 0.04)',
                color: activeTab === tab.key ? '#7dd3fc' : TEXT_MUTED,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="map-display-option__btn"
          style={{ marginLeft: 'auto' }}
          onClick={handleExportPdf}
          disabled={exporting || !comparison.rows.length}
          title="Export the full site-by-site comparison as a PDF, regardless of which tab is showing"
        >
          <FileDown size={13} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
          {exporting ? 'Generating…' : 'Export PDF'}
        </button>
      </div>

      {comparison.error && !comparison.loading && (
        <div style={{ color: '#f87171', fontSize: '0.76rem', marginBottom: '0.5rem' }}>{comparison.error}</div>
      )}
      {exportError && (
        <div style={{ color: '#f87171', fontSize: '0.76rem', marginBottom: '0.5rem' }}>{exportError}</div>
      )}

      {activeTab === 'compare' ? (
        <CookIslandsLandingAreaComparisonHeatmap
          rows={comparison.rows}
          loading={comparison.loading}
          vesselLabel={vesselLabel}
          timeDisplayZone={timeDisplayZone}
        />
      ) : comparison.loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: TEXT_MUTED }}>Loading landing area sites…</div>
      ) : !comparison.rows.length ? null : (
        <>
          <label style={{ display: 'block', fontSize: '0.7rem', color: TEXT_MUTED, marginBottom: '0.3rem' }}>
            Site
            <select
              value={selectedSiteId ?? ''}
              onChange={(e) => setSelectedSiteId(e.target.value)}
              style={{
                display: 'block', width: '100%', marginTop: '0.25rem',
                padding: '0.35rem 0.5rem', borderRadius: 6, fontSize: '0.78rem',
                background: 'rgba(255,255,255,0.05)', color: '#f8fafc',
                border: '1px solid rgba(255,255,255,0.14)',
              }}
            >
              {comparison.rows.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </label>
          <CookIslandsLandingAreaTimeseries
            steps={selectedRow?.steps ?? []}
            vesselLabel={vesselLabel}
            currentSliderDate={currentSliderDate}
            isDarkMode
          />
        </>
      )}
    </div>
  );
}

export default CookIslandsLandingAreaComparisonPanel;
