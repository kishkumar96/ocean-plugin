import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, DollarSign, Building2, Users, Maximize2, Layers, ChevronDown } from 'lucide-react';
import ImpactSectorChart from './ImpactSectorChart';
import { formatZoned } from '../../utils/timeZoneFormat';
import {
  groupImpactAssetUnits,
  topImpactAssetUnits,
  summarizeImpactAssetTypes,
  IMPACT_SECTOR_COLORS,
  IMPACT_SECTOR_LABELS,
} from '../../services/cookIslandsImpactService';
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
      padding: '0.15rem 0.55rem', borderRadius: 999, fontSize: '0.64rem', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.03em',
      color: meta.color, border: `1px solid ${meta.color}66`, background: `${meta.color}1a`,
      flexShrink: 0,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
      {meta.label}
    </span>
  );
}

function MetricRow({ icon: Icon, label, value, accentColor }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', padding: '0.4rem 0' }}>
      <span style={{
        width: 26, height: 26, borderRadius: 8, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `${accentColor}20`, border: `1px solid ${accentColor}44`,
      }}>
        <Icon size={13} color={accentColor} />
      </span>
      <span style={{ fontSize: '0.72rem', color: TEXT_MUTED, flex: 1 }}>{label}</span>
      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: TEXT_PRIMARY }}>{value}</span>
    </div>
  );
}

function SectionHeading({ children }) {
  return (
    <div style={{ fontSize: '0.66rem', color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.02em', fontWeight: 600 }}>
      {children}
    </div>
  );
}

function AssetsNote({ children, isError }) {
  return <div style={{ fontSize: '0.7rem', color: isError ? '#f87171' : TEXT_MUTED, padding: '0.3rem 0' }}>{children}</div>;
}

function AssetUnitRow({ unit, onSelectAsset }) {
  const clickable = Boolean(onSelectAsset);
  const select = () => onSelectAsset?.(unit.representative);
  const meta = [
    unit.useType && unit.useType !== unit.label ? unit.useType : null,
    Number.isFinite(unit.maxDepth) ? `depth ${unit.maxDepth.toFixed(2)} m` : null,
  ].filter(Boolean).join(' · ');
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? select : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } } : undefined}
      title={clickable ? `Zoom to ${unit.label} on the map` : undefined}
      style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.3rem 0.5rem', borderRadius: 8, cursor: clickable ? 'pointer' : 'default' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 600, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {unit.label}
        </div>
        {meta && <div style={{ fontSize: '0.62rem', color: TEXT_MUTED, marginTop: '0.1rem' }}>{meta}</div>}
      </div>
      <span style={{ fontSize: '0.72rem', fontWeight: 700 }}>{fmtUsd(unit.totalLoss)}</span>
    </div>
  );
}

// Exposed assets across every asset type for the window -- distinct assets
// (ports/roads/pipes are one asset each, not one per RiskScape segment). The
// whole row toggles the list of assets behind the count; no inner scrollbar,
// the list flows in the panel's own scroll.
function AssetTypeRow({ row, expanded, onToggle, onSelectAsset }) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.3rem 0',
          background: 'transparent', border: 'none', cursor: 'pointer', color: TEXT_PRIMARY, textAlign: 'left', fontFamily: 'inherit',
        }}
      >
        <ChevronDown size={14} style={{ flexShrink: 0, color: TEXT_MUTED, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        <span style={{ fontSize: '0.74rem', flex: 1 }}>{row.label}</span>
        <span style={{ fontSize: '0.72rem', color: TEXT_MUTED }}>{row.count} exposed</span>
        <span style={{ fontSize: '0.76rem', fontWeight: 700, minWidth: '3.6rem', textAlign: 'right' }}>{fmtUsd(row.loss)}</span>
      </button>
      {expanded && (
        <div style={{ margin: '0 0 0.3rem 1.2rem', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
          {row.units.map((unit) => <AssetUnitRow key={unit.key} unit={unit} onSelectAsset={onSelectAsset} />)}
        </div>
      )}
    </div>
  );
}

function TopAssetRow({ rank, unit, maxLoss, onSelectAsset }) {
  const color = IMPACT_SECTOR_COLORS[unit.sector] ?? IMPACT_SECTOR_COLORS.unknown;
  const meta = [
    unit.useType && unit.useType !== unit.label ? unit.useType : null,
    IMPACT_SECTOR_LABELS[unit.sector],
    Number.isFinite(unit.maxDepth) ? `depth ${unit.maxDepth.toFixed(2)} m` : null,
  ].filter(Boolean).join(' · ');
  const clickable = Boolean(onSelectAsset);
  const select = () => onSelectAsset?.(unit.representative);
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? select : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } } : undefined}
      title={clickable ? `Zoom to ${unit.label} on the map` : undefined}
      style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.35rem 0.25rem', borderRadius: 8, cursor: clickable ? 'pointer' : 'default' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ fontSize: '0.7rem', fontWeight: 700, color: TEXT_MUTED, width: '1.1rem', textAlign: 'right', paddingTop: 1 }}>{rank}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.76rem', fontWeight: 600, flex: 1, minWidth: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {unit.label}
          </span>
          <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>{fmtUsd(unit.totalLoss)}</span>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', margin: '0.25rem 0 0.2rem' }}>
          <div style={{ height: '100%', width: `${maxLoss > 0 ? Math.max((unit.totalLoss / maxLoss) * 100, 2) : 0}%`, borderRadius: 2, background: color }} />
        </div>
        {meta && <div style={{ fontSize: '0.64rem', color: TEXT_MUTED }}>{meta}</div>}
      </div>
    </div>
  );
}

// Compact desktop surface for the Cook Islands RiskScape impact assessment --
// lives in the "Inundation & Impacts" tab in ForecastApp.jsx's right-hand
// control column (see the tab bar there), alongside the inundation layer's own
// controls, replacing the old path of a bottom sheet covering ~72% of the
// viewport. Deliberately narrow/compact (this column is
// only 350-400px) -- the full per-window table lives one click away via
// onExpand, which reuses CookIslandsImpactPanel (the same component mobile's
// bottom sheet shows) rather than duplicating a second table implementation.
function ImpactTabPanel({ data, assets, onRetry, onWindowSelect, onScenarioChange, onSelectAsset, onExpand, initialScenario = null, timeDisplayZone = 'Pacific/Rarotonga' }) {
  const result = data?.result;
  const blocks = useMemo(() => (Array.isArray(result?.blocks) ? result.blocks : []), [result]);

  const worstIndex = useMemo(() => worstBlockIndex(blocks), [blocks]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const userSelectedRef = useRef(false);
  useEffect(() => {
    if (userSelectedRef.current || blocks.length === 0) return;
    // A shared link names the window its sender was looking at; honour it
    // (once) before falling back to the highest-impact window.
    const sharedIndex = initialScenario ? blocks.findIndex((b) => b.scenario === initialScenario) : -1;
    if (sharedIndex >= 0) userSelectedRef.current = true;
    setSelectedIndex(sharedIndex >= 0 ? sharedIndex : worstBlockIndex(blocks));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  const activeIndex = selectedIndex >= 0 && selectedIndex < blocks.length ? selectedIndex : worstIndex;
  const selected = blocks[activeIndex] ?? null;

  // Keep the panel, RiskScape asset layer, and inundation range on the same
  // scenario. This also synchronizes the initial highest-impact selection,
  // rather than waiting for the user to click the already-selected chip.
  useEffect(() => {
    onScenarioChange?.(selected?.scenario ?? null);
    if (selected) onWindowSelect?.(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.scenario, selected?.dateStart, selected?.dateEnd, selected?.windowStart, selected?.windowEnd]);

  // /cok/impact/latest/assets carries every window's per-asset rows in one
  // fetch; narrow to the selected window, then collapse segments into assets.
  const assetsGeojson = assets?.geojson;
  const assetUnits = useMemo(() => {
    const features = assetsGeojson?.features;
    if (!Array.isArray(features) || !selected?.scenario) return [];
    return groupImpactAssetUnits(features.filter((f) => f.properties?.scenario === selected.scenario));
  }, [assetsGeojson, selected?.scenario]);
  const assetTypes = useMemo(() => summarizeImpactAssetTypes(assetUnits), [assetUnits]);
  const [topLimit, setTopLimit] = useState(5);
  // Kept by asset type (not window), so the open type stays open when you
  // switch windows, as long as that type is still exposed there.
  const [expandedAssetType, setExpandedAssetType] = useState(null);
  const topAssets = useMemo(() => topImpactAssetUnits(assetUnits, topLimit), [assetUnits, topLimit]);
  const damagedAssetCount = useMemo(() => assetUnits.filter((u) => u.totalLoss > 0).length, [assetUnits]);
  const assetsPending = Boolean(assets?.loading) && !assetsGeojson;
  const assetsFailed = Boolean(assets?.error) && !assetsGeojson;

  // A finished run that floods nothing: every headline figure is zero and there
  // are no per-asset rows. Say so once, plainly, rather than leaving a page of
  // zeros and "no data" lines to be read as a failure.
  const noImpact = Boolean(selected) && !assetsPending && !assetsFailed && assetUnits.length === 0
    && !(selected.totalLoss > 0) && !(selected.totalExposedBuildings > 0) && !(selected.totalExposedValue > 0);

  const cycleDate = useMemo(() => parseCycleId(result?.cycleId), [result?.cycleId]);
  const modelStatus = computeModelStatus({
    loading: Boolean(data?.loading), error: data?.error ?? null, result,
    hasPriorResult: Boolean(result),
  });

  const wrapperStyle = { display: 'flex', flexDirection: 'column', gap: '0.75rem', color: TEXT_PRIMARY, fontFamily: 'inherit' };

  if (data?.loading && !result) {
    return <div style={{ textAlign: 'center', padding: '1.5rem 0.5rem', color: TEXT_MUTED, fontSize: '0.8rem' }}>Loading impact assessment…</div>;
  }

  if (data?.error && !result) {
    return (
      <div style={{ textAlign: 'center', padding: '1.5rem 0.5rem' }}>
        <div style={{ color: '#f87171', fontSize: '0.8rem', marginBottom: onRetry ? 10 : 0 }}>{data.error}</div>
        {onRetry && (
          <button type="button" className="map-display-option__btn" onClick={onRetry}>
            <RotateCcw size={13} style={{ marginRight: 6 }} />
            Retry
          </button>
        )}
      </div>
    );
  }

  if (!result || blocks.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: TEXT_MUTED, padding: '1.5rem 0.5rem', fontSize: '0.8rem' }}>
        No impact assessment available for this forecast cycle yet.
      </div>
    );
  }

  return (
    <div style={wrapperStyle}>
      <style>{'.impact-tab-chip:focus-visible { outline: 2px solid #38bdf8; outline-offset: 1px; }'}</style>

      {/* Run status + freshness */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.66rem', color: TEXT_MUTED }}>
          {cycleDate ? `Forecast issued ${formatZoned(cycleDate, timeDisplayZone)}` : result.label}
        </div>
        <StatusBadge status={modelStatus} />
      </div>

      {/* Window selector — compact chips, one per consecutive forecast window.
          Selecting a chip updates the stats/chart below AND pushes that
          window onto the map (see onWindowSelect below) -- kept as one
          action, not two, per direct feedback that a separate "commit to
          map" step made the chips feel like they did nothing. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <div style={{ fontSize: '0.66rem', color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
          Forecast window
        </div>
        <div style={{ fontSize: '0.62rem', color: TEXT_MUTED }}>
          Updates the inundation extent and mapped impacts.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
          {blocks.map((block, i) => {
            const isSelected = i === activeIndex;
            const isWorst = i === worstIndex && block.totalLoss > 0;
            return (
              <button
                key={block.scenario ?? i}
                type="button"
                className="impact-tab-chip"
                onClick={() => { userSelectedRef.current = true; setSelectedIndex(i); }}
                aria-pressed={isSelected}
                title={`${isWorst ? 'Highest-impact window. ' : ''}Show this window’s flood extent and impacts on the map`}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.3rem',
                  padding: '0.3rem 0.55rem', borderRadius: 999, fontSize: '0.7rem', fontWeight: isSelected ? 700 : 500,
                  border: isSelected ? '1.5px solid rgba(56, 189, 248, 0.8)' : '1px solid rgba(255,255,255,0.14)',
                  background: isSelected ? 'rgba(56, 189, 248, 0.16)' : 'rgba(255,255,255,0.04)',
                  color: isSelected ? '#7dd3fc' : 'rgba(255,255,255,0.65)',
                  cursor: 'pointer', transition: 'all 0.15s ease',
                }}
              >
                {fmtDateRange(block.dateStart, block.dateEnd)}
                {isWorst && <span style={{ color: '#E63946', fontSize: '0.6rem', fontWeight: 700 }}>●</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Exposure leads: who and what the flood reaches, before what it costs.
          All figures below are for the SAME selected window, so the summary
          never mixes scenarios. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
        <SectionHeading>Exposure</SectionHeading>
        {noImpact && (
          <div role="status" style={{ fontSize: '0.72rem', color: '#5eead4', background: 'rgba(42, 157, 143, 0.14)', border: '1px solid rgba(42, 157, 143, 0.4)', borderRadius: 8, padding: '0.4rem 0.6rem', margin: '0.15rem 0' }}>
            No assets are forecast to be flooded in this window.
          </div>
        )}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <MetricRow icon={Building2} label="Buildings exposed" value={selected?.totalExposedBuildings?.toLocaleString() ?? '—'} accentColor="#F4A261" />
          <MetricRow
            icon={Users}
            label="Population exposed"
            value={
              selected?.population?.value === null || selected?.population?.value === undefined
                ? '—'
                : `${selected.population.value.toLocaleString()}${selected.population.validated ? '' : ' (unconfirmed)'}`
            }
            accentColor="#a78bfa"
          />
        </div>
      </div>

      {/* Aggregated information: window totals, then exposed assets across all
          asset types (buildings, roads, bridges, ports, pipes, ...). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
        <SectionHeading>Aggregated information</SectionHeading>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <MetricRow icon={DollarSign} label="Estimated economic damage" value={fmtUsd(selected?.totalLoss)} accentColor="#E63946" />
          <MetricRow icon={Layers} label="Total exposed asset value" value={fmtUsd(selected?.totalExposedValue)} accentColor="#38bdf8" />
        </div>
        <div style={{ fontSize: '0.66rem', color: TEXT_MUTED, marginTop: '0.4rem' }}>Exposed assets by type</div>
        {assetsPending ? <AssetsNote>Loading asset breakdown…</AssetsNote>
          : assetsFailed ? <AssetsNote isError>Asset breakdown unavailable: {assets.error}</AssetsNote>
          : assetTypes.length === 0 ? <AssetsNote>No per-asset detail for this window.</AssetsNote>
          : assetTypes.map((row) => (
            <AssetTypeRow
              key={row.asset}
              row={row}
              expanded={expandedAssetType === row.asset}
              onToggle={() => setExpandedAssetType((prev) => (prev === row.asset ? null : row.asset))}
              onSelectAsset={onSelectAsset}
            />
          ))}
      </div>

      <div>
        <div style={{ marginBottom: '0.35rem', fontSize: '0.72rem', fontWeight: 600 }}>
          Economic damage by sector — {fmtDateRange(selected?.dateStart, selected?.dateEnd)}
        </div>
        <ImpactSectorChart sectorValues={selected?.lossesBySector} isDarkMode />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem' }}>
          <SectionHeading>Most damaged assets</SectionHeading>
          {damagedAssetCount > 5 && (
            <button
              type="button"
              onClick={() => setTopLimit((n) => (n === 5 ? 10 : 5))}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.66rem', color: '#7dd3fc' }}
            >
              {topLimit === 5 ? 'Show top 10' : 'Show top 5'}
            </button>
          )}
        </div>
        {assetsPending ? <AssetsNote>Loading assets…</AssetsNote>
          : assetsFailed ? <AssetsNote isError>Asset list unavailable: {assets.error}</AssetsNote>
          : topAssets.length === 0 ? <AssetsNote>No assets with modelled damage in this window.</AssetsNote>
          : topAssets.map((unit, i) => (
            <TopAssetRow key={unit.key} rank={i + 1} unit={unit} maxLoss={topAssets[0].totalLoss} onSelectAsset={onSelectAsset} />
          ))}
      </div>

      {onExpand && (
        <button
          type="button"
          className="map-display-option__btn"
          onClick={onExpand}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
        >
          <Maximize2 size={13} />
          View detailed table
        </button>
      )}

      <div style={{ fontSize: '0.64rem', color: TEXT_MUTED, fontStyle: 'italic', lineHeight: 1.4 }}>
        Estimated forecast economic damage, not observed/confirmed economic damage.
      </div>
    </div>
  );
}

export default ImpactTabPanel;
