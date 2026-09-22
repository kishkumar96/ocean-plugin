import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, TriangleAlert, DollarSign, Building2, CalendarClock } from 'lucide-react';
import ImpactSectorChart from './ImpactSectorChart';
import ImpactCategoryAccordion from './ImpactCategoryAccordion';
import { formatZoned } from '../../utils/timeZoneFormat';
import { fmtUsd, fmtDateRange, parseCycleId, MODEL_STATUS, computeModelStatus, worstBlockIndex } from './impactFormat';

const TEXT_PRIMARY = '#f8fafc';
const TEXT_MUTED = 'rgba(203, 213, 225, 0.72)';

function StatusBadge({ status }) {
  if (!status) return null;
  const meta = MODEL_STATUS[status];
  if (!meta) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
      padding: '0.15rem 0.55rem', borderRadius: 999, fontSize: '0.66rem', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.03em',
      color: meta.color, border: `1px solid ${meta.color}66`, background: `${meta.color}1a`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
      {meta.label}
    </span>
  );
}

function HeroCard({ icon: Icon, label, value, subtitle, accentColor }) {
  return (
    <div style={{
      flex: '1 1 150px', display: 'flex', flexDirection: 'column', gap: '0.3rem',
      padding: '0.75rem 0.9rem', borderRadius: 12,
      background: `linear-gradient(135deg, ${accentColor}26, ${accentColor}0d)`,
      border: `1px solid ${accentColor}55`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: TEXT_MUTED, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
        <Icon size={13} color={accentColor} />
        {label}
      </div>
      <div style={{ fontWeight: 700, fontSize: '1.15rem', color: TEXT_PRIMARY }}>{value}</div>
      {subtitle && <div style={{ fontSize: '0.68rem', color: TEXT_MUTED }}>{subtitle}</div>}
    </div>
  );
}

// Detailed full-width impact view: mobile's primary "View impact assessment"
// surface, and desktop's "Expand" target from the compact ImpactTabPanel (see
// ForecastApp.jsx's right-panel Impacts tab). Deliberately does NOT sum
// Total_Loss across the four forecast blocks into one grand-total number:
// each block is a separate 3-day hazard scenario (a different peak-inundation
// raster), not an independent event, so a summed total would read as
// "confirmed damage over the full 10-day outlook" when it actually means "if
// the worst case hit in every window" -- misleadingly precise.
//
// All three hero metrics (damage, buildings, population) come from the SAME
// selected block, defaulting to the highest-damage window -- previously damage
// came from the worst-damage block while buildings was the max across ALL
// blocks (possibly a different window entirely), which silently mixed two
// unrelated scenarios into one "summary".
function CookIslandsImpactPanel({ data, onRetry, onWindowSelect, onScenarioChange, onSelectAsset, timeDisplayZone = 'Pacific/Rarotonga' }) {
  const result = data?.result;
  const blocks = useMemo(() => (Array.isArray(result?.blocks) ? result.blocks : []), [result]);

  const worstIndex = useMemo(() => worstBlockIndex(blocks), [blocks]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  // Only auto-pick the worst window until the user makes their own choice --
  // otherwise a background refresh (new blocks array, same worst window in
  // practice) would silently yank their selection back.
  const userSelectedRef = useRef(false);
  useEffect(() => {
    if (userSelectedRef.current || blocks.length === 0) return;
    setSelectedIndex(worstBlockIndex(blocks));
  }, [blocks]);

  const activeIndex = selectedIndex >= 0 && selectedIndex < blocks.length ? selectedIndex : worstIndex;
  const selected = blocks[activeIndex] ?? null;

  // Use the same selection path as the compact Impacts tab. Every selected
  // row updates both the RiskScape asset filter and the SFINCS inundation
  // range, including the initial highest-impact selection.
  useEffect(() => {
    onScenarioChange?.(selected?.scenario ?? null);
    if (selected) onWindowSelect?.(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.scenario, selected?.dateStart, selected?.dateEnd, selected?.windowStart, selected?.windowEnd]);

  const selectRow = (i) => {
    userSelectedRef.current = true;
    setSelectedIndex(i);
  };
  const handleRowKeyDown = (e, i) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRow(i); }
  };

  // Per-asset detail (buildings/roads/points) for the currently-selected
  // window only -- `data.assets` carries every window's features in one
  // fetch (see Home.jsx's impactAssetsFetchedRef), filtered here by
  // scenario the same way the map layer's own MapLibre filter does.
  const assetsGeojson = data?.assets?.geojson;
  const selectedScenarioFeatures = useMemo(() => {
    const features = assetsGeojson?.features;
    if (!Array.isArray(features) || !selected?.scenario) return [];
    return features.filter((f) => f.properties?.scenario === selected.scenario);
  }, [assetsGeojson, selected?.scenario]);

  const cycleDate = useMemo(() => parseCycleId(result?.cycleId), [result?.cycleId]);
  const modelStatus = computeModelStatus({
    loading: Boolean(data?.loading), error: data?.error ?? null, result,
    hasPriorResult: Boolean(result),
  });

  const wrapperStyle = { padding: '1rem 1.25rem 1.25rem', color: TEXT_PRIMARY, fontFamily: 'inherit' };

  if (data?.loading && !result) {
    return <div style={{ ...wrapperStyle, textAlign: 'center', padding: '2rem', color: TEXT_MUTED }}>Loading impact assessment…</div>;
  }

  if (data?.error && !result) {
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

  if (!result || blocks.length === 0) {
    return (
      <div style={wrapperStyle}>
        <div style={{ textAlign: 'center', color: TEXT_MUTED, padding: '2rem' }}>
          No impact assessment available for this forecast cycle yet.
        </div>
      </div>
    );
  }

  return (
    <div style={wrapperStyle}>
      {/* aria-selected requires role="grid" (set on the table below) for the
          row's selected state to be exposed correctly to assistive tech. */}
      <style>{'.impact-window-row:focus-visible { outline: 2px solid #38bdf8; outline-offset: -2px; }'}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.68rem', color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          {result.label}
          {cycleDate && ` — forecast issued ${formatZoned(cycleDate, timeDisplayZone)}`}
        </div>
        <StatusBadge status={modelStatus} />
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <HeroCard
          icon={DollarSign}
          label="Estimated economic damage"
          value={fmtUsd(selected?.totalLoss)}
          subtitle={fmtDateRange(selected?.dateStart, selected?.dateEnd)}
          accentColor="#E63946"
        />
        <HeroCard
          icon={Building2}
          label="Buildings exposed"
          value={selected?.totalExposedBuildings?.toLocaleString() ?? '—'}
          subtitle={fmtDateRange(selected?.dateStart, selected?.dateEnd)}
          accentColor="#F4A261"
        />
        <HeroCard
          icon={CalendarClock}
          label="Forecast windows"
          value={String(blocks.length)}
          subtitle="consecutive forecast windows"
          accentColor="#38bdf8"
        />
      </div>

      <div style={{ marginBottom: '0.4rem', fontSize: '0.78rem', fontWeight: 600 }}>
        Economic damage by sector — {fmtDateRange(selected?.dateStart, selected?.dateEnd)}
      </div>
      <ImpactSectorChart sectorValues={selected?.lossesBySector} isDarkMode />

      <div style={{ marginTop: '1.1rem', marginBottom: '0.4rem', fontSize: '0.78rem', fontWeight: 600 }}>
        Affected assets by category — {fmtDateRange(selected?.dateStart, selected?.dateEnd)}
      </div>
      {data?.assets?.loading && !assetsGeojson ? (
        <div style={{ fontSize: '0.74rem', color: TEXT_MUTED, padding: '0.5rem 0.25rem' }}>Loading per-asset detail…</div>
      ) : data?.assets?.error ? (
        <div style={{ fontSize: '0.74rem', color: '#f87171', padding: '0.5rem 0.25rem' }}>{data.assets.error}</div>
      ) : (
        <ImpactCategoryAccordion features={selectedScenarioFeatures} onSelectAsset={onSelectAsset} />
      )}

      <div style={{ marginTop: '1.1rem', overflowX: 'auto' }}>
        <table role="grid" aria-label="Impact by forecast window" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
          <thead>
            <tr role="row" style={{ color: TEXT_MUTED, textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
              <th role="columnheader" style={{ padding: '0.4rem 0.5rem' }} scope="col">Window</th>
              <th role="columnheader" style={{ padding: '0.4rem 0.5rem' }} scope="col">Est. economic damage</th>
              <th role="columnheader" style={{ padding: '0.4rem 0.5rem' }} scope="col">Buildings</th>
              <th role="columnheader" style={{ padding: '0.4rem 0.5rem' }} scope="col">Population</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((block, i) => {
              const isSelected = i === activeIndex;
              return (
                <tr
                  key={block.scenario ?? i}
                  role="row"
                  tabIndex={0}
                  aria-selected={isSelected}
                  onClick={() => selectRow(i)}
                  onKeyDown={(e) => handleRowKeyDown(e, i)}
                  title={onWindowSelect ? 'Show this window’s flood extent and impacts on the map' : undefined}
                  className="impact-window-row"
                  style={{
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(56, 189, 248, 0.1)' : 'transparent',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    outline: 'none',
                  }}
                >
                  <td role="gridcell" style={{ padding: '0.45rem 0.5rem' }}>
                    {fmtDateRange(block.dateStart, block.dateEnd)}
                    {i === worstIndex && block.totalLoss > 0 && (
                      <span style={{ marginLeft: 6, fontSize: '0.62rem', color: '#E63946', fontWeight: 700 }}>HIGHEST</span>
                    )}
                    {!block.sectorReconciles && (
                      <span title="Sector totals don't reconcile with the reported total economic damage for this window">
                        <TriangleAlert size={11} color="#fbbf24" style={{ marginLeft: 6, verticalAlign: 'text-bottom' }} />
                      </span>
                    )}
                  </td>
                  <td role="gridcell" style={{ padding: '0.45rem 0.5rem', fontWeight: 600 }}>{fmtUsd(block.totalLoss)}</td>
                  <td role="gridcell" style={{ padding: '0.45rem 0.5rem' }}>{block.totalExposedBuildings.toLocaleString()}</td>
                  <td role="gridcell" style={{ padding: '0.45rem 0.5rem', color: block.population.validated ? TEXT_PRIMARY : TEXT_MUTED }}>
                    {block.population.value === null
                      ? '—'
                      : block.population.validated
                        ? block.population.value.toLocaleString()
                        : `${block.population.value.toLocaleString()} (unconfirmed)`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '0.7rem', fontSize: '0.66rem', color: TEXT_MUTED, fontStyle: 'italic' }}>
        Estimated forecast economic damage, not observed/confirmed economic damage. Generated by RiskScape from the live SFINCS forecast.
      </div>
    </div>
  );
}

export default CookIslandsImpactPanel;
