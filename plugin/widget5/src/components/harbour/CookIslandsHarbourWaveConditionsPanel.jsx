import React, { useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useCookIslandsHarbourWaveConditions } from '../../hooks/useCookIslandsHarbourWaveConditions';
import CookIslandsWaveTimeseriesChart from '../wave/CookIslandsWaveTimeseriesChart';
import CookIslandsWaveRunAge from '../wave/CookIslandsWaveRunAge';
import CookIslandsHarbourLimitsEditor from './CookIslandsHarbourLimitsEditor';
import { useHarbourUnloadingLimits } from '../../hooks/useHarbourUnloadingLimits';
import { buildHarbourAdvisoryBundle } from '../../reports/harbourAdvisoryBundle';
import { exportCookIslandsHarbourAdvisoryPdf } from '../../utils/CookIslandsHarbourAdvisoryPdf';
import {
  evaluateConditions, worstVerdict, INCOMPLETE, hasAnyLimit, limitsForHarbour, UNLOADING_LABELS,
} from '../../config/cookIslandsHarbourLimits';
import { formatZoned } from '../../utils/timeZoneFormat';

// Status colours: matches the app's single hazard palette semantics
// (green ok / amber caution / red stop), kept local because these are
// unloading verdicts against user-set limits, not vessel-suitability classes.
const UNLOADING_COLORS = { 0: '#4ade80', 1: '#fbbf24', 2: '#f87171' };

// Worst verdict across the next 24 hourly steps from now (see worstVerdict:
// Stop > Incomplete > Caution > OK, so a gap in the data can never be hidden
// behind a good-looking hour).
function worstOver24h(row, limits) {
  return worstVerdict([
    ...(row.outlookSteps ?? []).map((step) => (
      evaluateConditions({ hsM: step.wave_height_m, tpS: step.tp_s, windKt: step.wind_speed_kt }, limits)
    )),
    // A short or holey window can prove a Stop but never "within limits" (see harbourAdvisoryBundle).
    row.outlookMissingHours > 0 ? INCOMPLETE : null,
  ]);
}

function Verdict({ value }) {
  if (value === null) return <span style={{ color: TEXT_MUTED }}>—</span>;
  if (value === INCOMPLETE) {
    return (
      <span
        style={{ color: '#fbbf24', fontWeight: 700 }}
        title="A variable that has a limit set is missing, so conditions can't be confirmed safe. Do not treat as OK."
      >
        Incomplete
      </span>
    );
  }
  return <span style={{ color: UNLOADING_COLORS[value], fontWeight: 700 }}>{UNLOADING_LABELS[value]}</span>;
}

const TEXT_MUTED = 'rgba(203, 213, 225, 0.72)';

function formatMetres(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} m` : '—';
}

function formatKt(value) {
  return Number.isFinite(value) ? `${value.toFixed(0)} kt` : '—';
}

// One line saying what authority the verdicts (if any) rest on. Every state
// is explicit: a draft must never pass for approved guidance, and approved
// limits that can't be read must not look like "nothing configured".
function LimitsBasisLine({ limitsState, timeDisplayZone, anyLimitSet }) {
  const { published, active } = limitsState;
  const base = { fontSize: '0.68rem', marginBottom: '0.6rem', lineHeight: 1.4 };
  const warn = { ...base, color: '#fcd34d' };
  if (active.basis === 'draft') {
    return (
      <div role="status" style={warn}>
        DRAFT limits (local to this browser, not approved) -- verdicts below are for discussion only, not approved guidance.
      </div>
    );
  }
  if (active.basis === 'provisional') {
    return (
      <div role="status" style={warn}>
        PROVISIONAL unloading limits (placeholder values, not confirmed by Cook Islands Government) -- verdicts are indicative only.
        Use Edit unloading limits to enter your own.
      </div>
    );
  }
  if (published.state === 'unavailable' || published.state === 'invalid') {
    return (
      <div role="alert" style={warn}>
        Approved unloading limits could not be {published.state === 'invalid' ? 'validated' : 'loaded'}
        {published.problems.length ? ` (${published.problems.slice(0, 2).join('; ')})` : ''} -- no verdict is shown.
      </div>
    );
  }
  if (active.basis === 'approved') {
    const m = active.meta;
    return (
      <div style={{ ...base, color: TEXT_MUTED }}>
        Unloading limits: version {m.version}, approved by {m.approvedBy} on {formatZoned(new Date(m.approvedOn), timeDisplayZone, { withLabel: false, hour: undefined, minute: undefined })},
        effective {formatZoned(new Date(m.effectiveFrom), timeDisplayZone, { withLabel: false, hour: undefined, minute: undefined })}.
      </div>
    );
  }
  if (active.basis === 'pending') {
    return (
      <div style={{ ...base, color: TEXT_MUTED }}>
        Approved limits (version {active.meta.version}) take effect {formatZoned(new Date(active.meta.effectiveFrom), timeDisplayZone, { withLabel: false, hour: undefined, minute: undefined })};
        none are applied yet -- showing forecast values only.
      </div>
    );
  }
  return anyLimitSet ? null : (
    <div style={{ ...base, color: TEXT_MUTED }}>
      No approved unloading limits yet -- showing forecast values only, with no OK / Caution / Stop verdict.
    </div>
  );
}

// Current + next-24h-max wave height at the 16 named harbours/anchorages/
// passages Cook Islands Government asked SPC for (email via Herve
// Damlamian, 2026-09-29) -- to plan safe cargo unloading from the
// inter-island barge, not tied to any particular vessel's suitability
// envelope (see useCookIslandsHarbourWaveConditions.js for why vessel='all'
// is used rather than the currently-selected Vessel Suitability class).
//
// Mounted lazily (only while its CollapsibleSection in ForecastApp.jsx is
// open, see the `enabled` prop) so the 16 requests this needs don't fire on
// every page load regardless of whether anyone opens it.
function CookIslandsHarbourWaveConditionsPanel({ enabled, timeDisplayZone = 'Pacific/Rarotonga' }) {
  const { loading, error, rows, suitabilityRunStart } = useCookIslandsHarbourWaveConditions(enabled);
  const [expandedId, setExpandedId] = useState(null);
  const limitsState = useHarbourUnloadingLimits(enabled);
  const [editingLimits, setEditingLimits] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  // The report must know which limits authority it is reporting under, so it
  // cannot be made until the published file has resolved (loaded, invalid or
  // unavailable -- all three are stated honestly in the PDF).
  const limitsResolved = limitsState.published.state !== 'loading';
  const handleExportPdf = async () => {
    if (exporting || !limitsResolved) return;
    setExporting(true);
    setExportError('');
    try {
      const bundle = buildHarbourAdvisoryBundle({
        rows,
        suitabilityRunStart,
        limits: limitsState.active,
        limitsUnavailable: limitsState.published.state === 'unavailable' || limitsState.published.state === 'invalid',
        timeDisplayZone,
        generatedAt: new Date(),
      });
      await exportCookIslandsHarbourAdvisoryPdf(bundle);
    } catch (err) {
      console.error('[CookIslandsHarbourWaveConditionsPanel] PDF export failed:', err);
      setExportError(err.message || 'PDF export failed.');
    } finally {
      setExporting(false);
    }
  };
  // Verdicts are judged against the ACTIVE limits: approved, or a local draft
  // (labelled as such). See HARBOUR_LIMITS.md.
  const limitsConfig = limitsState.active.config;
  const anyLimitSet = useMemo(() => (
    hasAnyLimit(limitsConfig.default) || Object.values(limitsConfig.harbours).some(hasAnyLimit)
  ), [limitsConfig]);

  return (
    <div>
      <div style={{ fontSize: '0.7rem', color: TEXT_MUTED, marginBottom: '0.6rem' }}>
        Current and next-24h-max wave height at each main harbour, anchorage and passage --
        for planning safe cargo unloading from the inter-island barge. Select a harbour for its
        full forecast (wave height, period, direction) and a CSV download.
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        <button
          type="button"
          className="map-display-option__btn"
          aria-expanded={editingLimits}
          onClick={() => setEditingLimits((v) => !v)}
        >
          {editingLimits ? 'Hide unloading limits' : 'Edit unloading limits'}
        </button>
        <button
          type="button"
          className="map-display-option__btn"
          onClick={handleExportPdf}
          disabled={loading || rows.length === 0 || exporting || !limitsResolved}
          title="Download the Harbour Conditions Advisory (2-page PDF)"
        >
          {exporting ? <Loader2 size={12} className="update-spinner" /> : <Download size={12} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} />}
          {exporting ? 'Preparing…' : 'Download advisory PDF'}
        </button>
      </div>
      {exportError && <div role="alert" style={{ color: '#f87171', fontSize: '0.72rem', marginBottom: '0.5rem' }}>{exportError}</div>}
      <LimitsBasisLine limitsState={limitsState} timeDisplayZone={timeDisplayZone} anyLimitSet={anyLimitSet} />
      {editingLimits && (
        <CookIslandsHarbourLimitsEditor
          config={limitsState.editable}
          onChange={limitsState.setDraft}
          hasDraft={Boolean(limitsState.draft)}
          onDiscardDraft={limitsState.discardDraft}
          published={limitsState.published.data}
        />
      )}

      {!loading && rows.length > 0 && (
        <>
          <CookIslandsWaveRunAge
            runStart={suitabilityRunStart}
            label="Harbour forecast (wave height and wind)"
            timeDisplayZone={timeDisplayZone}
          />
          {rows.some((r) => r.periodWithheld) && (
            <div role="alert" style={{
              fontSize: '0.72rem', lineHeight: 1.4, color: '#fcd34d', background: 'rgba(245,158,11,0.12)',
              border: '1px solid rgba(245,158,11,0.4)', borderRadius: 6, padding: '0.4rem 0.55rem', marginBottom: '0.5rem',
            }}>
              Peak period is withheld: the wave-period feed
              ({formatZoned(new Date(rows.find((r) => r.waveRunStart)?.waveRunStart), timeDisplayZone)} run)
              is not from the same model run as wave height and wind
              ({suitabilityRunStart ? `${formatZoned(new Date(suitabilityRunStart), timeDisplayZone)} run` : 'run unconfirmed'}).
              Any period limit shows Incomplete until they match. The harbour charts below use the wave feed alone.
            </div>
          )}
        </>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '1.5rem', color: TEXT_MUTED, fontSize: '0.76rem' }}>
          Loading harbour wave conditions…
        </div>
      )}

      {error && !loading && (
        <div style={{ color: '#f87171', fontSize: '0.76rem', marginBottom: '0.5rem' }}>{error}</div>
      )}

      {!loading && rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem', tableLayout: 'auto' }}>
          <thead>
            <tr style={{ color: TEXT_MUTED, textAlign: 'left' }}>
              <th style={{ fontWeight: 500, padding: '0.25rem 0.4rem 0.35rem 0' }}>Harbour</th>
              <th style={{ fontWeight: 500, padding: '0.25rem 0.4rem 0.35rem' }}>Now</th>
              <th style={{ fontWeight: 500, padding: '0.25rem 0.4rem 0.35rem' }}>Wind</th>
              <th style={{ fontWeight: 500, padding: '0.25rem 0.4rem 0.35rem' }}>24h max</th>
              {anyLimitSet && <th style={{ fontWeight: 500, padding: '0.25rem 0 0.35rem 0.4rem' }}>Unloading{{ draft: ' (draft)', provisional: ' (provisional)' }[limitsState.active.basis] ?? ''}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const expanded = expandedId === row.riskPointId;
              const limits = limitsForHarbour(limitsConfig, row.riskPointId);
              const nowVerdict = row.available
                ? evaluateConditions({ hsM: row.waveHeightM, tpS: row.peakPeriodS, windKt: row.windSpeedKt }, limits)
                : null;
              const dayVerdict = row.available ? worstOver24h(row, limits) : null;
              return (
                <React.Fragment key={row.riskPointId}>
                  <tr style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <td style={{ padding: '0.35rem 0.4rem 0.35rem 0' }}>
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setExpandedId(expanded ? null : row.riskPointId)}
                        style={{ all: 'unset', cursor: 'pointer', display: 'block' }}
                      >
                        <div style={{ color: '#f8fafc' }}><span aria-hidden="true" style={{ color: TEXT_MUTED }}>{expanded ? '▾ ' : '▸ '}</span><span>{row.name}</span></div>
                        <div style={{ color: TEXT_MUTED, fontSize: '0.66rem', paddingLeft: '0.9rem' }}>{row.island}</div>
                      </button>
                    </td>
                    {row.available ? (
                      <>
                        <td style={{ padding: '0.35rem 0.4rem' }}>{formatMetres(row.waveHeightM)}</td>
                        <td style={{ padding: '0.35rem 0.4rem', color: TEXT_MUTED }}>{formatKt(row.windSpeedKt)}</td>
                        <td style={{ padding: '0.35rem 0.4rem' }} title={row.outlookMissingHours > 0 ? `Only ${24 - row.outlookMissingHours} of 24 h of forecast available` : undefined}>{formatMetres(row.outlookMaxWaveHeightM)}{row.outlookMissingHours > 0 ? ' *' : ''}</td>
                        {anyLimitSet && (
                          <td style={{ padding: '0.35rem 0 0.35rem 0.4rem', lineHeight: 1.3 }}>
                            <Verdict value={nowVerdict} />
                            <div style={{ color: TEXT_MUTED, fontSize: '0.68rem' }}>
                              {'24h: '}
                              <Verdict value={dayVerdict} />
                            </div>
                          </td>
                        )}
                      </>
                    ) : (
                      <td colSpan={anyLimitSet ? 4 : 3} style={{ padding: '0.35rem 0.4rem', color: TEXT_MUTED, fontStyle: 'italic' }}>
                        Unavailable
                      </td>
                    )}
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={anyLimitSet ? 5 : 4} style={{ padding: '0.25rem 0 0.75rem' }}>
                        <CookIslandsWaveTimeseriesChart
                          site={{ name: row.name, lon: row.lon, lat: row.lat }}
                          timeDisplayZone={timeDisplayZone}
                          limits={limits}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {!loading && rows.length > 0 && rows.find((r) => r.validTime)?.validTime && (
        <div style={{ fontSize: '0.66rem', color: TEXT_MUTED, marginTop: '0.5rem' }}>
          "Now" is the forecast step valid at {formatZoned(new Date(rows.find((r) => r.validTime).validTime), timeDisplayZone)}.
        </div>
      )}
    </div>
  );
}

export default CookIslandsHarbourWaveConditionsPanel;
