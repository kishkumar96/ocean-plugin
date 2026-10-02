import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, DollarSign, Building2, Users, Maximize2, Layers, ChevronDown, Waves } from 'lucide-react';
import ImpactSectorChart from './ImpactSectorChart';
import useMhwsSummaries from './useMhwsSummaries';
import { formatZoned } from '../../utils/timeZoneFormat';
import {
  groupImpactAssetUnits,
  topImpactAssetUnits,
  summarizeImpactAssetTypes,
  IMPACT_SECTOR_COLORS,
  IMPACT_SECTOR_LABELS,
  MHWS_DEFAULT_MIN_DEPTH_M,
  MHWS_DEPTH_OPTIONS_M,
  mhwsBlockIndexFromScenario,
  mhwsMarginLabel,
  fetchCookIslandsMhwsInundation,
} from '../../services/cookIslandsImpactService';
import { fmtUsd, fmtDateRange, parseCycleId, MODEL_STATUS, computeModelStatus, worstBlockIndex, fmtHectares, portLossByScenario } from './impactFormat';

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

function SummaryTile({ icon: Icon, label, value, color, badge = null }) {
  return (
    <div style={{ padding: '0.4rem 0.5rem', borderRadius: 10, background: `${color}14`, border: `1px solid ${color}44`, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.6rem', color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
        <Icon size={11} color={color} />
        {label}
      </div>
      <div style={{ fontSize: '1.02rem', fontWeight: 700, color: TEXT_PRIMARY, lineHeight: 1.2 }}>{value}</div>
      {badge && <div title="Port assets often reflect harbour water beside the structure, not flooding of it; see the note under Impact." style={{ fontSize: '0.58rem', color: '#fcd34d' }}>{badge}</div>}
    </div>
  );
}

// The three stages of the assessment, in the order they are caused: the HAZARD (what the water does),
// the EXPOSURE (what is in its way) and the IMPACT (what that is estimated to cost). Each figure sits in
// exactly one stage, so a depth is never read as damage nor a count of assets as a loss.
function StageHeading({ step, title, gloss }) {
  return (
    <div style={{ borderLeft: '3px solid rgba(125, 211, 252, 0.6)', paddingLeft: '0.5rem', margin: '0.2rem 0 0.15rem' }}>
      <h3 style={{ margin: 0, fontSize: '0.8rem', fontWeight: 700, color: TEXT_PRIMARY }}>{step} · {title}</h3>
      <div style={{ fontSize: '0.64rem', color: TEXT_MUTED }}>{gloss}</div>
    </div>
  );
}

function SectionHeading({ children }) {
  return (
    <h3 style={{ margin: 0, fontSize: '0.72rem', color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.02em', fontWeight: 600 }}>
      {children}
    </h3>
  );
}

function AssetsNote({ children, isError }) {
  return <div style={{ fontSize: '0.7rem', color: isError ? '#f87171' : TEXT_MUTED, padding: '0.3rem 0' }}>{children}</div>;
}

function AssetUnitRow({ unit, onSelectAsset }) {
  const clickable = Boolean(onSelectAsset);
  const select = () => onSelectAsset?.(unit.representative, { features: unit.segments, label: unit.label });
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
        <span title="Deepest modelled flooding at any asset of this type" style={{ fontSize: '0.76rem', fontWeight: 700, minWidth: '3.6rem', textAlign: 'right' }}>
          {Number.isFinite(row.maxDepth) ? `up to ${row.maxDepth.toFixed(1)} m` : '—'}
        </span>
      </button>
      {expanded && (
        <div style={{ margin: '0 0 0.3rem 1.2rem', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
          {row.units.map((unit) => <AssetUnitRow key={unit.key} unit={unit} onSelectAsset={onSelectAsset} />)}
        </div>
      )}
    </div>
  );
}

function DistrictRow({ rank, district, maxLoss }) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.35rem 0.25rem' }}>
      <span style={{ fontSize: '0.7rem', fontWeight: 700, color: TEXT_MUTED, width: '1.1rem', textAlign: 'right', paddingTop: 1 }}>{rank}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.76rem', fontWeight: 600, flex: 1, minWidth: 0, textTransform: 'capitalize' }}>
            {district.districtName}
          </span>
          <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>{fmtUsd(district.totalLoss)}</span>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', margin: '0.25rem 0 0.2rem' }}>
          <div style={{ height: '100%', width: `${maxLoss > 0 ? Math.max((district.totalLoss / maxLoss) * 100, 2) : 0}%`, borderRadius: 2, background: '#E63946' }} />
        </div>
        {district.totalExposedBuildings > 0 && (
          <div style={{ fontSize: '0.64rem', color: TEXT_MUTED }}>{district.totalExposedBuildings.toLocaleString()} buildings exposed</div>
        )}
      </div>
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
  const select = () => onSelectAsset?.(unit.representative, { features: unit.segments, label: unit.label });
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
// Area inundated above Mean High Water Springs (see fetchCookIslandsMhwsInundation
// for what the number means and why it isn't RiskScape's exposed-area column).
// Fetches on its own rather than through Home.jsx: it's one small request keyed
// on (window, depth threshold), and the backend only ever serves the latest
// cycle, so there's nothing to share with the other impact fetches.
function MhwsInundationSection({ scenario, impactCycleId, onMhwsResult }) {
  const block = mhwsBlockIndexFromScenario(scenario);
  const [minDepthM, setMinDepthM] = useState(MHWS_DEFAULT_MIN_DEPTH_M);
  const [state, setState] = useState({ loading: false, error: null, result: null });

  // Hand the latest result up so the map's "flooded above MHWS" layer always
  // matches the numbers shown here (same window, same depth threshold).
  const onMhwsResultRef = useRef(onMhwsResult);
  onMhwsResultRef.current = onMhwsResult;
  // The hazard endpoint always serves the newest hazard run. If that is not the run these impact figures
  // (and the map's depth range, which follows the impact window dates) belong to, the two would describe
  // different periods, so the flooded-land layer stays off the map rather than contradict the depth layer.
  useEffect(() => {
    const r = state.result;
    const mismatch = r?.cycleId && impactCycleId && r.cycleId !== String(impactCycleId);
    onMhwsResultRef.current?.(mismatch ? null : r);
  }, [state.result, impactCycleId]);
  useEffect(() => () => onMhwsResultRef.current?.(null), []);

  useEffect(() => {
    if (block === null) return undefined;
    let cancelled = false;
    // Clear the previous window/depth's result (and, via the effect above, the
    // map's flood layer) so stale numbers never sit under the new selection.
    setState({ loading: true, error: null, result: null });
    fetchCookIslandsMhwsInundation({ block, minDepthM })
      .then((result) => { if (!cancelled) setState({ loading: false, error: null, result }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err.message, result: null }); });
    return () => { cancelled = true; };
  }, [block, minDepthM]);

  if (block === null) return null;
  const { loading, error, result } = state;
  const topDistricts = (result?.districts ?? []).filter((d) => d.areaM2 > 0).slice(0, 5);
  const cycleMismatch = result?.cycleId && impactCycleId && result.cycleId !== String(impactCycleId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem' }}>
        <SectionHeading>Area inundated above {mhwsMarginLabel(result?.marginAboveMhwsM)}</SectionHeading>
        <div role="group" aria-label="Minimum flood depth" title="Minimum counted flood depth" style={{ display: 'flex', gap: '0.25rem' }}>
          {MHWS_DEPTH_OPTIONS_M.map((depth) => (
            <button
              key={depth}
              type="button"
              aria-pressed={depth === minDepthM}
              onClick={() => setMinDepthM(depth)}
              style={{
                background: depth === minDepthM ? 'rgba(125, 211, 252, 0.18)' : 'none',
                border: `1px solid ${depth === minDepthM ? '#7dd3fc' : 'rgba(255,255,255,0.15)'}`,
                borderRadius: 6, padding: '0.05rem 0.4rem', cursor: 'pointer',
                fontSize: '0.64rem', color: depth === minDepthM ? '#7dd3fc' : TEXT_MUTED,
              }}
            >
              ≥ {Math.round(depth * 100)} cm
            </button>
          ))}
        </div>
      </div>
      {error ? <AssetsNote isError>{error}</AssetsNote>
        : !result ? <AssetsNote>{loading ? 'Loading…' : 'Unavailable.'}</AssetsNote>
        : (
          <div style={{ opacity: loading ? 0.55 : 1 }}>
            <MetricRow icon={Waves} label="Land inundated beyond routine spring-tide wetting" value={fmtHectares(result.areaHa)} accentColor="#38bdf8" />
            {topDistricts.length === 0
              ? <AssetsNote>No land inundated above MHWS in this window at this depth.</AssetsNote>
              : topDistricts.map((d) => (
                <div key={d.districtId} style={{ display: 'flex', gap: '0.5rem', padding: '0.2rem 0.25rem', fontSize: '0.74rem' }}>
                  <span style={{ flex: 1, minWidth: 0, textTransform: 'capitalize' }}>{d.districtName}</span>
                  <span style={{ color: TEXT_MUTED }}>{Math.round(d.percentOfTotal)}%</span>
                  <span style={{ fontWeight: 700, minWidth: '4.2rem', textAlign: 'right' }}>{fmtHectares(d.areaHa)}</span>
                </div>
              ))}
            {result.outsideDistrictsHa > 0.005 && (
              <div style={{ display: 'flex', gap: '0.5rem', padding: '0.2rem 0.25rem', fontSize: '0.74rem', color: TEXT_MUTED }}>
                <span style={{ flex: 1, minWidth: 0 }}>Outside census districts (coast, harbours)</span>
                <span>{result.areaHa > 0 ? `${Math.round((100 * result.outsideDistrictsHa) / result.areaHa)}%` : ''}</span>
                <span style={{ minWidth: '4.2rem', textAlign: 'right' }}>{fmtHectares(result.outsideDistrictsHa)}</span>
              </div>
            )}
            <div style={{ fontSize: '0.62rem', color: TEXT_MUTED, fontStyle: 'italic', lineHeight: 1.4, paddingTop: '0.3rem' }}>
              Forecast flood depth ≥ {Math.round((result.depthThresholdM ?? minDepthM) * 100)} cm on land above {mhwsMarginLabel(result.marginAboveMhwsM)}{' '}
              ({result.filterElevationM ?? result.mhwsElevationM ?? 0.328} m above MSL; MHWS itself is {result.mhwsElevationM ?? 0.328} m).
              The sea, lagoon and the beach below that line are not counted.
            </div>
            {cycleMismatch && (
              <div style={{ fontSize: '0.62rem', color: '#fcd34d', paddingTop: '0.2rem' }}>
                Hazard cycle {result.cycleId} differs from the impact estimate's cycle {impactCycleId}, so this figure is shown for reference only and its map layer is hidden until the impact run catches up.
              </div>
            )}
          </div>
        )}
    </div>
  );
}

function ImpactTabPanel({ data, assets, districts, onRetry, onWindowSelect, onScenarioChange, onSelectAsset, onExpand, onMhwsResult, initialScenario = null, timeDisplayZone = 'Pacific/Rarotonga' }) {
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
    if (selected) onWindowSelect?.({ ...selected, cycleId: result?.cycleId ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.cycleId, selected?.scenario, selected?.dateStart, selected?.dateEnd, selected?.windowStart, selected?.windowEnd]);

  // /cok/impact/latest/assets carries every window's per-asset rows in one
  // fetch; narrow to the selected window, then collapse segments into assets.
  const assetsGeojson = assets?.geojson;
  const assetUnits = useMemo(() => {
    const features = assetsGeojson?.features;
    if (!Array.isArray(features) || !selected?.scenario) return [];
    return groupImpactAssetUnits(features.filter((f) => f.properties?.scenario === selected.scenario));
  }, [assetsGeojson, selected?.scenario]);
  const assetTypes = useMemo(() => summarizeImpactAssetTypes(assetUnits), [assetUnits]);
  // Hazard as seen by what it touches: the deepest modelled flooding at any exposed asset.
  const deepestAssetDepthM = useMemo(() => {
    const depths = assetUnits.map((u) => u.maxDepth).filter(Number.isFinite);
    return depths.length ? Math.max(...depths) : null;
  }, [assetUnits]);
  const [topLimit, setTopLimit] = useState(5);
  // Kept by asset type (not window), so the open type stays open when you
  // switch windows, as long as that type is still exposed there.
  const [expandedAssetType, setExpandedAssetType] = useState(null);
  const topAssets = useMemo(() => topImpactAssetUnits(assetUnits, topLimit), [assetUnits, topLimit]);
  const damagedAssetCount = useMemo(() => assetUnits.filter((u) => u.totalLoss > 0).length, [assetUnits]);
  // Port assets (wharf/marina/jetty) usually dominate the damage total but often reflect harbour
  // water beside the structure, not flooding of it -- state that right under the headline number.
  const portLoss = useMemo(() => portLossByScenario(assetsGeojson?.features).get(selected?.scenario) ?? 0, [assetsGeojson, selected?.scenario]);
  const assetsPending = Boolean(assets?.loading) && !assetsGeojson;
  const assetsFailed = Boolean(assets?.error) && !assetsGeojson;

  // /cok/impact/latest/districts, same one-fetch-covers-every-window shape as
  // assets above. 'unmatched' (an asset outside the backend's spatial-join
  // buffer, e.g. a wharf) is a real bucket, not dropped from the total on
  // /latest -- but has no meaningful district name to rank here, so it's
  // excluded from this ranked list specifically.
  const districtRows = districts?.districts?.districts;
  const topDistricts = useMemo(() => {
    if (!Array.isArray(districtRows) || !selected?.scenario) return [];
    return districtRows
      .filter((d) => d.scenario === selected.scenario && !d.unmatched && d.totalLoss > 0)
      .sort((a, b) => b.totalLoss - a.totalLoss)
      .slice(0, 5);
  }, [districtRows, selected?.scenario]);
  const districtsPending = Boolean(districts?.loading) && !districtRows;
  const districtsFailed = Boolean(districts?.error) && !districtRows;

  // A finished run that floods nothing: every headline figure is zero and there
  // are no per-asset rows. Say so once, plainly, rather than leaving a page of
  // zeros and "no data" lines to be read as a failure.
  const noImpact = Boolean(selected) && !assetsPending && !assetsFailed && assetUnits.length === 0
    && !(selected.totalLoss > 0) && !(selected.totalExposedBuildings > 0) && !(selected.totalExposedValue > 0);

  const cycleDate = useMemo(() => parseCycleId(result?.cycleId), [result?.cycleId]);
  // The hazard endpoints serve the newest hazard run; if it is not the run these impact figures came from,
  // say so beside the status rather than in a separate notice further down.
  const hazardProbe = useMemo(() => (result?.blocks ?? []).slice(0, 1), [result]);
  const hazardCheck = useMhwsSummaries(hazardProbe);
  const newerHazardCycle = Object.values(hazardCheck.byBlock).find(
    (sm) => sm.cycleId && result?.cycleId && sm.cycleId !== String(result.cycleId),
  )?.cycleId ?? null;
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

      {/* The answer first: what is affected, when, how badly. Sticky so it stays in view while the
          rest of the rail scrolls. Window chips select the period; the tiles below them are for
          that SAME window, so the summary never mixes scenarios. */}
      <div style={{ position: 'sticky', top: -1, zIndex: 6, margin: '-0.15rem -0.1rem 0', padding: '0.4rem 0.1rem 0.55rem', background: 'rgb(10, 20, 44)', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '0.66rem', color: TEXT_MUTED }}>
            {cycleDate ? `Forecast issued ${formatZoned(cycleDate, timeDisplayZone)}` : result.label}
          </div>
          <StatusBadge status={modelStatus} />
        </div>
        {newerHazardCycle && (
          <div role="status" style={{ fontSize: '0.72rem', color: '#fde68a' }}>
            Available, but based on the previous hazard run (newer run {newerHazardCycle} is not in this estimate yet).
          </div>
        )}

        <div role="group" aria-label="Forecast window" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
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

        {noImpact ? (
          <div role="status" style={{ fontSize: '0.72rem', color: '#5eead4', background: 'rgba(42, 157, 143, 0.14)', border: '1px solid rgba(42, 157, 143, 0.4)', borderRadius: 8, padding: '0.4rem 0.6rem' }}>
            No assets are forecast to be flooded in this window.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem' }}>
            <SummaryTile icon={Building2} label="Buildings" color="#F4A261" value={selected?.totalExposedBuildings?.toLocaleString() ?? '—'} />
            <SummaryTile
              icon={Users}
              label="Population"
              color="#a78bfa"
              value={selected?.population?.value === null || selected?.population?.value === undefined ? '—' : `${selected.population.value.toLocaleString()}${selected.population.validated ? '' : '*'}`}
            />
            <SummaryTile
              icon={DollarSign}
              label="Est. damage"
              color="#E63946"
              value={fmtUsd(selected?.totalLoss)}
              badge={portLoss > 0 && selected?.totalLoss > 0 ? `${Math.round((100 * portLoss) / selected.totalLoss)}% Port*` : null}
            />
          </div>
        )}
      </div>

      {/* HAZARD -> EXPOSURE -> IMPACT. Hazard: what the water does. Exposure: what is in its way.
          Impact: what that is estimated to cost. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
        <StageHeading step="1" title="Hazard" gloss="What the water does: how deep, and how much land." />
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <MetricRow
            icon={Waves}
            label="Deepest flooding at an exposed asset"
            value={deepestAssetDepthM === null ? '—' : `${deepestAssetDepthM.toFixed(1)} m`}
            accentColor="#38bdf8"
          />
        </div>
        <MhwsInundationSection scenario={selected?.scenario ?? null} impactCycleId={result?.cycleId ?? null} onMhwsResult={onMhwsResult} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
        <StageHeading step="2" title="Exposure" gloss="What is in the water’s way. Counts and values, not losses." />
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <MetricRow icon={Building2} label="Buildings exposed" value={selected?.totalExposedBuildings?.toLocaleString() ?? '—'} accentColor="#F4A261" />
          <MetricRow
            icon={Users}
            label="Population exposed"
            value={selected?.population?.value === null || selected?.population?.value === undefined ? '—' : `${selected.population.value.toLocaleString()}${selected.population.validated ? '' : '*'}`}
            accentColor="#a78bfa"
          />
          <MetricRow icon={Layers} label="Total exposed asset value" value={fmtUsd(selected?.totalExposedValue)} accentColor="#38bdf8" />
        </div>
        <div style={{ fontSize: '0.66rem', color: TEXT_MUTED, marginTop: '0.4rem' }}>Exposed assets by type (select one to outline it on the map)</div>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
        <StageHeading step="3" title="Impact" gloss="What that is estimated to cost: forecast economic damage." />
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <MetricRow icon={DollarSign} label="Estimated economic damage" value={fmtUsd(selected?.totalLoss)} accentColor="#E63946" />
          {portLoss > 0 && selected?.totalLoss > 0 && (
            <div style={{ fontSize: '0.64rem', color: '#fcd34d', lineHeight: 1.4, padding: '0 0 0.4rem 2.1rem' }}>
              {Math.round((100 * portLoss) / selected.totalLoss)}% ({fmtUsd(portLoss)}) is Port assets, likely overstated (harbour water, not
              flooding of the structures). Excluding them: <strong>{fmtUsd(Math.max(selected.totalLoss - portLoss, 0))}</strong>.
            </div>
          )}
        </div>

        <h3 style={{ margin: '0.5rem 0 0.35rem', fontSize: '0.8rem', fontWeight: 600 }}>Economic damage by sector</h3>
        <ImpactSectorChart sectorValues={selected?.lossesBySector} isDarkMode />

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem', marginTop: '0.5rem' }}>
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

        <div style={{ marginTop: '0.5rem' }}>
          <SectionHeading>By district</SectionHeading>
        </div>
        {districtsPending ? <AssetsNote>Loading district breakdown…</AssetsNote>
          : districtsFailed ? <AssetsNote isError>District breakdown unavailable: {districts.error}</AssetsNote>
          : topDistricts.length === 0 ? <AssetsNote>No district-level damage modelled for this window.</AssetsNote>
          : topDistricts.map((district, i) => (
            <DistrictRow key={district.districtId} rank={i + 1} district={district} maxLoss={topDistricts[0].totalLoss} />
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

      <details style={{ marginTop: '0.5rem' }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.76rem', color: '#7dd3fc' }}>Why don’t these numbers match?</summary>
        <div style={{ fontSize: '0.76rem', color: TEXT_MUTED, lineHeight: 1.45, marginTop: '0.3rem' }}>
          They count different things. “Buildings” counts buildings only; the asset lists count every asset type (wharves, roads, pipes, bridges), so an
          asset type can show many affected items while buildings show few. A district can show damage with no buildings when the loss is to roads, wharves or pipes.
          Population is a separate estimate and is 0 when no homes are flooded.
        </div>
      </details>
      <div style={{ fontSize: '0.64rem', color: TEXT_MUTED, fontStyle: 'italic', lineHeight: 1.4 }}>
        Estimated forecast economic damage, not observed/confirmed economic damage.
      </div>
    </div>
  );
}

export default ImpactTabPanel;
