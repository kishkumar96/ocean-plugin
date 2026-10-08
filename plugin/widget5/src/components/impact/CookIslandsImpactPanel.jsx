import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, TriangleAlert, DollarSign, Building2, Users, FileDown, Loader2 } from 'lucide-react';
import ImpactSectorChart from './ImpactSectorChart';
import ImpactCategoryAccordion from './ImpactCategoryAccordion';
import { formatZoned } from '../../utils/timeZoneFormat';
import { fmtUsd, fmtDateRange, parseCycleId, MODEL_STATUS, computeModelStatus, worstBlockIndex, fmtHectares, portLossByScenario, blockWithoutPort } from './impactFormat';
import { exportCookIslandsImpactInundationPdf } from '../../utils/CookIslandsImpactInundationPdf';
import {
  DISTRICT_LOSS_COLOR_STOPS,
  MHWS_LINES,
  MHWS_DEPTH_OPTIONS_M,
  MHWS_DEFAULT_MIN_DEPTH_M,
  mhwsBlockIndexFromScenario,
  fetchCookIslandsMhwsInundation,
} from '../../services/cookIslandsImpactService';
import useMhwsSummaries from './useMhwsSummaries';

const TEXT_PRIMARY = '#f8fafc';
const TEXT_MUTED = 'rgba(226, 232, 240, 0.82)';

function StatusBadge({ status }) {
  if (!status) return null;
  const meta = MODEL_STATUS[status];
  if (!meta) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
      padding: '0.15rem 0.55rem', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.03em',
      color: meta.color, border: `1px solid ${meta.color}66`, background: `${meta.color}1a`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
      {meta.label}
    </span>
  );
}

// Area columns for the water-mark comparison: one per MHWS line, the working
// mark (+17.5 cm) emphasised. Shared by the district and window tables so both
// use identical headers and formatting. `areaFor(marginCm)` returns hectares or
// null (still loading / unavailable -> "—").
const WORKING_LINE_COLOR = '#2dd4bf';
function MhwsAreaHeaders({ rowSpan }) {
  return MHWS_LINES.map((line) => (
    <th
      key={line.marginCm}
      role="columnheader"
      scope="col"
      rowSpan={rowSpan}
      title={`Land flooded above ${line.label}`}
      style={{
        padding: '0.4rem 0.5rem', textAlign: 'right', whiteSpace: 'nowrap',
        color: line.kind === 'working' ? WORKING_LINE_COLOR : TEXT_MUTED,
        fontWeight: line.kind === 'working' ? 700 : 500,
      }}
    >
      {line.short}
      <div style={{ fontSize: '0.72rem', fontWeight: 400, opacity: 0.8 }}>{line.kind === 'working' ? 'ha · working mark' : 'ha'}</div>
    </th>
  ));
}

function MhwsAreaCells({ areaFor }) {
  return MHWS_LINES.map((line) => {
    const working = line.kind === 'working';
    return (
      <td
        key={line.marginCm}
        role="gridcell"
        style={{
          padding: '0.45rem 0.5rem', textAlign: 'right', whiteSpace: 'nowrap',
          fontWeight: working ? 700 : 400,
          color: working ? WORKING_LINE_COLOR : TEXT_PRIMARY,
          background: working ? 'rgba(45, 212, 191, 0.07)' : 'transparent',
        }}
      >
        {fmtHectares(areaFor(line.marginCm))}
      </td>
    );
  });
}

function HeroCard({ icon: Icon, label, value, subtitle, accentColor }) {
  return (
    <div style={{
      flex: '1 1 150px', display: 'flex', flexDirection: 'column', gap: '0.3rem',
      padding: '0.75rem 0.9rem', borderRadius: 12,
      background: `linear-gradient(135deg, ${accentColor}26, ${accentColor}0d)`,
      border: `1px solid ${accentColor}55`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: TEXT_MUTED, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
        <Icon size={13} color={accentColor} />
        {label}
      </div>
      <div style={{ fontWeight: 700, fontSize: '1.15rem', color: TEXT_PRIMARY }}>{value}</div>
      {subtitle && <div style={{ fontSize: '0.72rem', color: TEXT_MUTED }}>{subtitle}</div>}
    </div>
  );
}

// Detailed full-width impact view: mobile's primary "View impact assessment"
// surface, and desktop's "Expand" target from the compact ImpactTabPanel (see
// ForecastApp.jsx's right-panel Impacts tab). Deliberately does NOT sum
// Total_Loss across the forecast blocks into one grand-total number: each
// block is a separate hazard scenario (a different peak-inundation raster) --
// block 1 is the first 3 days, block 2 is everything after that collapsed
// into one max-inundation window for the rest of the outlook -- not
// independent events, so a summed total would read as "confirmed damage over
// the full outlook" when it actually means "if the worst case hit in every
// window" -- misleadingly precise.
//
// All three hero metrics (damage, buildings, population) come from the SAME
// selected block, defaulting to the highest-damage window -- previously damage
// came from the worst-damage block while buildings was the max across ALL
// blocks (possibly a different window entirely), which silently mixed two
// unrelated scenarios into one "summary".
function CookIslandsImpactPanel({ data, onRetry, onWindowSelect, onScenarioChange, onMhwsResult, onSelectAsset, initialScenario = null, timeDisplayZone = 'Pacific/Rarotonga' }) {
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
    // Opened from the compact panel's "View detailed table" (or a shared
    // link) naming the window it was showing; honour it (once) before
    // falling back to the highest-impact window -- see ImpactTabPanel.
    const sharedIndex = initialScenario ? blocks.findIndex((b) => b.scenario === initialScenario) : -1;
    if (sharedIndex >= 0) userSelectedRef.current = true;
    setSelectedIndex(sharedIndex >= 0 ? sharedIndex : worstBlockIndex(blocks));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  const activeIndex = selectedIndex >= 0 && selectedIndex < blocks.length ? selectedIndex : worstIndex;
  const selected = blocks[activeIndex] ?? null;

  // Optional view without Port assets (see impactFormat.portLossByScenario). Only
  // available once the per-asset feed is loaded; selection and the map keep using
  // the reported blocks, only the displayed damage figures change.
  const [excludePort, setExcludePort] = useState(false);
  const allAssetFeatures = data?.assets?.geojson?.features;
  const portLoss = useMemo(() => portLossByScenario(allAssetFeatures), [allAssetFeatures]);
  const portAvailable = Array.isArray(allAssetFeatures);
  const portOff = excludePort && portAvailable;
  const viewBlocks = useMemo(
    () => (portOff ? blocks.map((b) => blockWithoutPort(b, portLoss.get(b.scenario) ?? 0)) : blocks),
    [portOff, blocks, portLoss],
  );
  const viewSelected = viewBlocks[activeIndex] ?? null;
  const viewWorstIndex = useMemo(() => worstBlockIndex(viewBlocks), [viewBlocks]);
  const selectedPortLoss = portLoss.get(selected?.scenario) ?? 0;

  // Use the same selection path as the compact Impacts tab. Every selected
  // row updates both the RiskScape asset filter and the SFINCS inundation
  // range, including the initial highest-impact selection.
  useEffect(() => {
    onScenarioChange?.(selected?.scenario ?? null);
    if (selected) onWindowSelect?.({ ...selected, cycleId: result?.cycleId ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.cycleId, selected?.scenario, selected?.dateStart, selected?.dateEnd, selected?.windowStart, selected?.windowEnd]);

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

  // /cok/impact/latest/districts, same one-fetch-covers-every-window shape as
  // data.assets above -- filtered to the selected window here the same way.
  // 'unmatched' (an asset outside the backend's spatial-join buffer, e.g. a
  // wharf) has no meaningful district name, so it's excluded from this
  // ranked table specifically -- it's still counted in every other total
  // this panel shows, just not attributable to a named district.
  const districtRows = data?.districts?.districts?.districts;
  const selectedScenarioDistricts = useMemo(() => {
    if (!Array.isArray(districtRows) || !selected?.scenario) return [];
    return districtRows
      .filter((d) => d.scenario === selected.scenario && !d.unmatched && d.totalLoss > 0)
      .sort((a, b) => b.totalLoss - a.totalLoss);
  }, [districtRows, selected?.scenario]);

  // Area of land flooded above each MHWS water mark, per window and per district,
  // so the marks can be compared next to the RiskScape figures.
  const [mhwsDepthM, setMhwsDepthM] = useState(MHWS_DEFAULT_MIN_DEPTH_M);
  const mhws = useMhwsSummaries(blocks, mhwsDepthM);
  // The hazard endpoints only serve the latest published cycle. If it is not the
  // cycle these RiskScape figures belong to (e.g. mid-publication), don't set the
  // two side by side: show dashes and say why.
  const summaryFor = (scenario) => {
    const summary = mhws.byBlock[mhwsBlockIndexFromScenario(scenario)] ?? null;
    if (summary && result?.cycleId && summary.cycleId && summary.cycleId !== String(result.cycleId)) return null;
    return summary;
  };
  const mhwsCycleMismatch = Object.values(mhws.byBlock).find(
    (sm) => sm.cycleId && result?.cycleId && sm.cycleId !== String(result.cycleId),
  )?.cycleId ?? null;
  const selectedSummary = summaryFor(selected?.scenario);
  const summariesByScenario = useMemo(() => Object.fromEntries(
    blocks
      .map((block) => [block.scenario, mhws.byBlock[mhwsBlockIndexFromScenario(block.scenario)] ?? null])
      .filter(([scenario, summary]) => scenario && summary && (!result?.cycleId || !summary.cycleId || summary.cycleId === String(result.cycleId))),
  ), [blocks, mhws.byBlock, result?.cycleId]);

  // Area columns appear only when there is something honest to show: not when the hazard run and the
  // impact run differ, and not when the area service failed. Otherwise they would be columns of dashes.
  const showAreaColumns = !mhwsCycleMismatch && !mhws.error;

  // Only when a parent asks for it (the mobile sheet, which has no Impacts-tab
  // section): report the working-mark flood geometry for the selected window so
  // the map's "flooded above MHWS" layer is not left empty.
  const selectedBlockIndex = mhwsBlockIndexFromScenario(selected?.scenario);
  const onMhwsResultRef = useRef(onMhwsResult);
  onMhwsResultRef.current = onMhwsResult;
  const reportsGeometry = Boolean(onMhwsResult);
  useEffect(() => {
    if (!reportsGeometry || !selectedBlockIndex) return undefined;
    let cancelled = false;
    onMhwsResultRef.current?.(null);
    fetchCookIslandsMhwsInundation({ block: selectedBlockIndex, minDepthM: mhwsDepthM })
      .then((r) => {
        if (cancelled) return;
        const mismatch = r.cycleId && result?.cycleId && r.cycleId !== String(result.cycleId);
        onMhwsResultRef.current?.(mismatch ? null : r);
      })
      .catch(() => { if (!cancelled) onMhwsResultRef.current?.(null); });
    return () => { cancelled = true; };
  }, [reportsGeometry, selectedBlockIndex, mhwsDepthM, result?.cycleId]);
  useEffect(() => () => onMhwsResultRef.current?.(null), []);
  const levelFor = (summary, marginCm) => summary?.levels?.find((lv) => lv.marginCm === marginCm) ?? null;
  const windowAreaHa = (scenario) => (marginCm) => levelFor(summaryFor(scenario), marginCm)?.areaHa ?? null;
  const districtAreaHa = (districtId) => (marginCm) => {
    const level = levelFor(summaryFor(selected?.scenario), marginCm);
    if (!level) return null;
    // The backend lists every district (0 ha when dry), so a missing one means
    // the id did not match -> "—", not a false 0.
    return level.districts.find((d) => d.districtId === String(districtId))?.areaHa ?? null;
  };

  const cycleDate = useMemo(() => parseCycleId(result?.cycleId), [result?.cycleId]);
  const modelStatus = computeModelStatus({
    loading: Boolean(data?.loading), error: data?.error ?? null, result,
    hasPriorResult: Boolean(result),
  });
  const [pdfState, setPdfState] = useState({ loading: false, error: '' });
  const exportReport = async () => {
    setPdfState({ loading: true, error: '' });
    try {
      const inundationUnavailableReason = selectedSummary ? null
        : mhwsCycleMismatch
          ? `Inundation run ${mhwsCycleMismatch} does not match impact run ${result?.cycleId ?? 'not reported'}; inundation values are omitted.`
          : mhws.error
            ? `Inundation summary unavailable: ${mhws.error}`
            : 'No matching inundation summary is available for this forecast window.';
      await exportCookIslandsImpactInundationPdf({
        impact: result,
        selected: viewSelected,
        districts: selectedScenarioDistricts,
        summariesByScenario,
        selectedSummary,
        inundationUnavailableReason,
        portLoss: selectedPortLoss,
        excludePortAssets: portOff,
        timeZone: timeDisplayZone,
      });
      setPdfState({ loading: false, error: '' });
    } catch (error) {
      setPdfState({ loading: false, error: error?.message || 'PDF export failed.' });
    }
  };

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
        <div style={{ fontSize: '0.72rem', color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          {result.label}
          {cycleDate && ` — forecast issued ${formatZoned(cycleDate, timeDisplayZone)}`}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <StatusBadge status={modelStatus} />
          <button
            type="button"
            className="map-display-option__btn"
            onClick={exportReport}
            disabled={pdfState.loading || (mhws.loading && !selectedSummary)}
            title="Download a PDF of the selected impact window and matching inundation summary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          >
            {pdfState.loading ? <Loader2 size={13} className="spin" /> : <FileDown size={13} />}
            {pdfState.loading ? 'Preparing PDF…' : 'Export PDF'}
          </button>
        </div>
      </div>
      {pdfState.error && <div role="alert" style={{ marginBottom: '0.5rem', fontSize: '0.75rem', color: '#f87171' }}>{pdfState.error}</div>}
      {mhwsCycleMismatch && (
        <div role="status" style={{ marginBottom: '0.5rem', fontSize: '0.78rem', color: '#fde68a' }}>
          Available, but based on the previous hazard run: the newest hazard run ({mhwsCycleMismatch}) is not yet in this impact estimate ({String(result.cycleId)}).
        </div>
      )}

      <div role="group" aria-label="Forecast window" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '0.78rem', color: TEXT_MUTED }}>Selected window</span>
        {blocks.map((block, i) => {
          const isSelected = i === activeIndex;
          return (
            <button
              key={block.scenario ?? i}
              type="button"
              aria-pressed={isSelected}
              onClick={() => selectRow(i)}
              title={onWindowSelect ? 'Show this window’s flood extent and impacts on the map' : undefined}
              style={{
                padding: '0.35rem 0.75rem', borderRadius: 999, fontSize: '0.82rem', fontWeight: isSelected ? 700 : 500, cursor: 'pointer',
                border: isSelected ? '1.5px solid rgba(56, 189, 248, 0.8)' : '1px solid rgba(255,255,255,0.18)',
                background: isSelected ? 'rgba(56, 189, 248, 0.16)' : 'rgba(255,255,255,0.04)',
                color: isSelected ? '#7dd3fc' : 'rgba(255,255,255,0.75)',
              }}
            >
              {fmtDateRange(block.dateStart, block.dateEnd)}
              {i === viewWorstIndex && block.totalLoss > 0 && <span style={{ marginLeft: 6, fontSize: '0.72rem', color: '#E63946', fontWeight: 700 }}>HIGHEST</span>}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <HeroCard
          icon={DollarSign}
          label={portOff ? 'Estimated damage (excl. Port)' : 'Estimated economic damage'}
          value={fmtUsd(viewSelected?.totalLoss)}
          accentColor="#E63946"
        />
        <HeroCard
          icon={Building2}
          label="Buildings exposed"
          value={selected?.totalExposedBuildings?.toLocaleString() ?? '—'}
          accentColor="#F4A261"
        />
        <HeroCard
          icon={Users}
          label="Population affected"
          value={selected?.population?.value === null || selected?.population?.value === undefined ? '—' : `${selected.population.value.toLocaleString()}${selected.population.validated ? '' : '*'}`}
          subtitle={selected?.population?.validated === false ? '*unconfirmed' : undefined}
          accentColor="#a78bfa"
        />
      </div>

      {portAvailable && selectedPortLoss > 0 && (
        <div style={{ marginBottom: '0.9rem', padding: '0.55rem 0.7rem', borderRadius: 10, border: '1px solid rgba(251, 191, 36, 0.35)', background: 'rgba(251, 191, 36, 0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '0.76rem', color: TEXT_MUTED, maxWidth: '36rem' }}>
            <strong style={{ color: TEXT_PRIMARY }}>Port assets (wharf, marina, jetty) are {fmtUsd(selectedPortLoss)}</strong>
            {selected?.totalLoss > 0 && ` — ${Math.round((100 * selectedPortLoss) / selected.totalLoss)}% — of this window’s estimate.`}
            {' '}Their modelled depth is often the harbour water beside the structure rather than flooding on it, so this part
            of the estimate is likely overstated. The land-area columns further down are not affected by this.
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={excludePort} onChange={(e) => setExcludePort(e.target.checked)} />
            Exclude Port assets
          </label>
        </div>
      )}

      <h3 style={{ margin: '0 0 0.4rem', fontSize: '0.9rem', fontWeight: 600 }}>
        Economic damage by sector
      </h3>
      <ImpactSectorChart sectorValues={viewSelected?.lossesBySector} isDarkMode />

      <h3 style={{ margin: '1.1rem 0 0.4rem', fontSize: '0.9rem', fontWeight: 600 }}>
        Affected assets by category
      </h3>
      {data?.assets?.loading && !assetsGeojson ? (
        <div style={{ fontSize: '0.74rem', color: TEXT_MUTED, padding: '0.5rem 0.25rem' }}>Loading per-asset detail…</div>
      ) : data?.assets?.error ? (
        <div style={{ fontSize: '0.74rem', color: '#f87171', padding: '0.5rem 0.25rem' }}>{data.assets.error}</div>
      ) : (
        <ImpactCategoryAccordion features={selectedScenarioFeatures} onSelectAsset={onSelectAsset} />
      )}

      {showAreaColumns ? (
        <div style={{ marginTop: '1.1rem', padding: '0.5rem 0.7rem', borderRadius: 10, border: '1px solid rgba(45, 212, 191, 0.3)', background: 'rgba(45, 212, 191, 0.06)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '0.76rem', color: TEXT_MUTED, maxWidth: '38rem' }}>
            <strong style={{ color: TEXT_PRIMARY }}>Land flooded above each water mark</strong> (last four columns, hectares of dry land with forecast depth of at least {Math.round(mhwsDepthM * 100)} cm).
            {' '}Working mark: <strong style={{ color: TEXT_PRIMARY }}>MHWS + 17.5 cm (0.503 m)</strong>.
            <details style={{ marginTop: '0.2rem' }}>
              <summary style={{ cursor: 'pointer', color: '#7dd3fc' }}>About this figure</summary>
              <div style={{ marginTop: '0.25rem', lineHeight: 1.4 }}>
                MHWS (Mean High Water Springs) is 0.328 m above mean sea level, so land below it is normally wetted at spring tides and is not
                counted as flooding. The scientists advised adding 15–20 cm, so MHWS + 17.5 cm is the working mark. This is land area, not RiskScape
                damage: the two measure different things and can disagree.
              </div>
            </details>
          </div>
          <div role="group" aria-label="Minimum flood depth" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', color: TEXT_MUTED }}>
            Minimum counted flood depth ≥
            {MHWS_DEPTH_OPTIONS_M.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={mhwsDepthM === d}
                onClick={() => setMhwsDepthM(d)}
                className="map-display-option__btn"
                style={{ padding: '0.15rem 0.5rem', fontSize: '0.72rem', opacity: mhwsDepthM === d ? 1 : 0.6, fontWeight: mhwsDepthM === d ? 700 : 500 }}
              >
                {Math.round(d * 100)} cm
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div role="status" style={{ marginTop: '1.1rem', padding: '0.4rem 0.7rem', borderRadius: 10, border: '1px solid rgba(251, 191, 36, 0.4)', background: 'rgba(251, 191, 36, 0.07)', fontSize: '0.76rem', color: '#fde68a' }}>
          {mhwsCycleMismatch
            ? <>Land-area columns are hidden: the hazard run ({mhwsCycleMismatch}) is newer than this impact estimate ({String(result.cycleId)}). They return when the impact run catches up.</>
            : <>Land-area columns are unavailable: {mhws.error}</>}
        </div>
      )}

      <details style={{ marginTop: '1.1rem' }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, color: '#7dd3fc' }}>Detailed analysis: districts</summary>
      <div style={{ marginTop: '1.1rem', marginBottom: '0.4rem', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span>Affected districts</span>
        {/* Shared color key for the map's district choropleth layer (see
            useZarrMap's buildDistrictLossColorExpression) -- same
            DISTRICT_LOSS_COLOR_STOPS source of truth, so a shade on the map
            always matches the bucket a district's own row would fall into
            here. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          {DISTRICT_LOSS_COLOR_STOPS.map((stop) => (
            <span key={stop.label} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.72rem', fontWeight: 400, color: TEXT_MUTED }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: stop.color, flexShrink: 0 }} />
              {stop.label}
            </span>
          ))}
        </div>
      </div>
      {data?.districts?.loading && !districtRows ? (
        <div style={{ fontSize: '0.74rem', color: TEXT_MUTED, padding: '0.5rem 0.25rem' }}>Loading district breakdown…</div>
      ) : data?.districts?.error && !districtRows ? (
        <div style={{ fontSize: '0.74rem', color: '#f87171', padding: '0.5rem 0.25rem' }}>{data.districts.error}</div>
      ) : selectedScenarioDistricts.length === 0 ? (
        <div style={{ fontSize: '0.74rem', color: TEXT_MUTED, padding: '0.5rem 0.25rem' }}>No district-level damage modelled for this window.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table role="grid" aria-label="Impact by district" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
            <thead>
              <tr role="row" style={{ color: TEXT_MUTED, textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
                <th role="columnheader" style={{ padding: '0.4rem 0.5rem' }} scope="col">District</th>
                <th role="columnheader" style={{ padding: '0.4rem 0.5rem' }} scope="col">Est. economic damage</th>
                <th role="columnheader" style={{ padding: '0.4rem 0.5rem' }} scope="col">Buildings</th>
                {showAreaColumns && <MhwsAreaHeaders />}
              </tr>
            </thead>
            <tbody>
              {selectedScenarioDistricts.map((district) => (
                <tr key={district.districtId} role="row" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <td role="gridcell" style={{ padding: '0.45rem 0.5rem', textTransform: 'capitalize' }}>{district.districtName}</td>
                  <td role="gridcell" style={{ padding: '0.45rem 0.5rem', fontWeight: 600 }}>{fmtUsd(district.totalLoss)}</td>
                  <td role="gridcell" style={{ padding: '0.45rem 0.5rem' }}>{district.totalExposedBuildings.toLocaleString()}</td>
                  {showAreaColumns && <MhwsAreaCells areaFor={districtAreaHa(district.districtId)} />}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAreaColumns && (() => {
        const level = levelFor(summaryFor(selected?.scenario), 17.5);
        if (!level || selectedScenarioDistricts.length === 0) return null;
        const listed = selectedScenarioDistricts.reduce((sum, d) => sum + (level.districts.find((x) => x.districtId === String(d.districtId))?.areaHa ?? 0), 0);
        const elsewhere = Math.max(level.areaHa - listed, 0);
        return (
          <div style={{ marginTop: '0.4rem', fontSize: '0.72rem', color: TEXT_MUTED, fontStyle: 'italic' }}>
            District rows list only districts with modelled damage. Of {fmtHectares(level.areaHa)} flooded above MHWS + 17.5 cm in this window,
            {' '}{fmtHectares(listed)} is in the districts above and {fmtHectares(elsewhere)} is elsewhere (other districts, coast and harbours outside any census district).
          </div>
        );
      })()}

      </details>

      <details style={{ marginTop: '0.8rem' }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, color: '#7dd3fc' }}>Compare all forecast windows</summary>
      <div style={{ marginTop: '1.1rem', overflowX: 'auto' }}>
        <table role="grid" aria-label="Impact by forecast window" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
          <thead>
            <tr role="row" style={{ color: TEXT_MUTED, textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
              <th role="columnheader" style={{ padding: '0.4rem 0.5rem' }} scope="col">Window</th>
              <th role="columnheader" style={{ padding: '0.4rem 0.5rem' }} scope="col">Est. economic damage{portOff ? ' (excl. Port)' : ''}</th>
              <th role="columnheader" style={{ padding: '0.4rem 0.5rem' }} scope="col">Buildings</th>
              <th role="columnheader" style={{ padding: '0.4rem 0.5rem' }} scope="col">Population</th>
              {showAreaColumns && <MhwsAreaHeaders />}
            </tr>
          </thead>
          <tbody>
            {blocks.map((reported, i) => {
              const block = viewBlocks[i] ?? reported;
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
                    {i === viewWorstIndex && block.totalLoss > 0 && (
                      <span style={{ marginLeft: 6, fontSize: '0.72rem', color: '#E63946', fontWeight: 700 }}>HIGHEST</span>
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
                  {showAreaColumns && <MhwsAreaCells areaFor={windowAreaHa(block.scenario)} />}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      </details>

      <details style={{ marginTop: '0.8rem' }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.76rem', color: '#7dd3fc' }}>Why don’t these numbers match?</summary>
        <div style={{ fontSize: '0.76rem', color: TEXT_MUTED, lineHeight: 1.45, marginTop: '0.3rem' }}>
          They count different things. “Buildings” counts buildings only; the asset lists count every asset type (wharves, roads, pipes, bridges), so an
          asset type can show many affected items while buildings show few. A district can show damage with no buildings when the loss is to roads, wharves or pipes.
          Population is a separate estimate and is 0 when no homes are flooded.
        </div>
      </details>
      <div style={{ marginTop: '0.7rem', fontSize: '0.72rem', color: TEXT_MUTED, fontStyle: 'italic' }}>
        Estimated forecast economic damage, not observed/confirmed economic damage. Generated by RiskScape from the live SFINCS forecast.
      </div>
    </div>
  );
}

export default CookIslandsImpactPanel;
