import React, { useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useCookIslandsHarbourWaveConditions } from '../../hooks/useCookIslandsHarbourWaveConditions';
import CookIslandsWaveTimeseriesChart from '../wave/CookIslandsWaveTimeseriesChart';
import CookIslandsWaveRunAge from '../wave/CookIslandsWaveRunAge';
import CookIslandsHarbourLimitsEditor from './CookIslandsHarbourLimitsEditor';
import { useHarbourUnloadingLimits } from '../../hooks/useHarbourUnloadingLimits';
import { useForecastUpdatedAt } from '../../hooks/useForecastUpdatedAt';
import { buildHarbourAdvisoryBundle } from '../../reports/harbourAdvisoryBundle';
import { exportCookIslandsHarbourAdvisoryPdf } from '../../utils/CookIslandsHarbourAdvisoryPdf';
import {
  evaluateConditions, worstVerdict, INCOMPLETE, hasAnyLimit, limitsForHarbour, unloadingLabel,
} from '../../config/cookIslandsHarbourLimits';
import { formatZoned } from '../../utils/timeZoneFormat';
import { leadHours, formatLead } from '../../utils/modelRunTiming';

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

function Verdict({ value, basis }) {
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
  return <span style={{ color: UNLOADING_COLORS[value], fontWeight: 700 }}>{unloadingLabel(value, basis)}</span>;
}

const TEXT_MUTED = 'rgba(203, 213, 225, 0.72)';

// Headline over the table: how many locations are over which limit, now and across the next 24 h. Counts
// only; the table below says which and why. Wording follows the limits' authority (see unloadingLabel).
function SummaryBanner({ summary, basis }) {
  const row = (label, t) => {
    const parts = [
      t.stop > 0 && { key: 'stop', color: UNLOADING_COLORS[2], text: `${t.stop} ${unloadingLabel(2, basis).toLowerCase()}` },
      t.caution > 0 && { key: 'caution', color: UNLOADING_COLORS[1], text: `${t.caution} ${unloadingLabel(1, basis).toLowerCase()}` },
      t.within > 0 && { key: 'within', color: UNLOADING_COLORS[0], text: `${t.within} ${unloadingLabel(0, basis).toLowerCase()}` },
      t.incomplete > 0 && { key: 'incomplete', color: '#fbbf24', text: `${t.incomplete} incomplete data` },
      t.unavailable > 0 && { key: 'unavailable', color: TEXT_MUTED, text: `${t.unavailable} unavailable` },
    ].filter(Boolean);
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.15rem 0.7rem', alignItems: 'baseline' }}>
        <span style={{ color: TEXT_MUTED, minWidth: '3.6rem' }}>{label}</span>
        {parts.map((part) => (
          <span key={part.key} style={{ color: part.color, fontWeight: 600 }}>
            <span aria-hidden="true">● </span>{part.text}
          </span>
        ))}
      </div>
    );
  };
  return (
    <div
      role="status"
      aria-label="Harbour outlook summary"
      data-testid="harbour-summary"
      style={{
        fontSize: '0.74rem', lineHeight: 1.5, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 8, padding: '0.45rem 0.6rem', marginBottom: '0.6rem',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: '0.15rem' }}>Marine operations outlook, {summary.total} locations</div>
      {row('Now', summary.now)}
      {row('Next 24 h', summary.next24h)}
    </div>
  );
}

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
// `conditions` / `limitsState`, when given, are the parent's shared copies (Home fetches them once for
// both the Forecast map's harbour badges and this panel); without them the panel fetches its own.
function CookIslandsHarbourWaveConditionsPanel({ enabled, timeDisplayZone = 'Pacific/Rarotonga', conditions = null, limitsState: sharedLimits = null }) {
  const ownConditions = useCookIslandsHarbourWaveConditions(enabled && !conditions);
  const { loading, error, rows, suitabilityRunStart } = conditions ?? ownConditions;
  const [expandedId, setExpandedId] = useState(null);
  const ownLimits = useHarbourUnloadingLimits(enabled && !sharedLimits);
  const updatedAt = useForecastUpdatedAt(enabled ? undefined : null);
  const limitsState = sharedLimits ?? ownLimits;
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
        updatedAt,
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
  // The same facts the PDF reports (verdict drivers, node distance, unavailable reasons), from the one
  // bundle builder, so the screen and the PDF cannot disagree about why a verdict is what it is.
  const reportBundle = useMemo(() => buildHarbourAdvisoryBundle({
    rows,
    suitabilityRunStart,
    updatedAt,
    limits: limitsState.active,
    limitsUnavailable: limitsState.published.state === 'unavailable' || limitsState.published.state === 'invalid',
    timeDisplayZone,
    generatedAt: new Date(),
  }), [rows, suitabilityRunStart, updatedAt, limitsState.active, limitsState.published.state, timeDisplayZone]);
  const detailById = useMemo(() => new Map(reportBundle.harbours.map((h) => [h.riskPointId, h])), [reportBundle]);
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

      {!loading && rows.length > 0 && reportBundle.judged && <SummaryBanner summary={reportBundle.summary} basis={reportBundle.basis} />}

      {!loading && rows.length > 0 && (
        <>
          <CookIslandsWaveRunAge
            runStart={suitabilityRunStart}
            updatedAt={updatedAt}
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
              const detail = detailById.get(row.riskPointId);
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
                          <td
                            style={{ padding: '0.35rem 0 0.35rem 0.4rem', lineHeight: 1.3 }}
                            title={[detail?.detailNow && `Now: ${detail.detailNow}`, detail?.detail24h && `Next 24 h: ${detail.detail24h}`].filter(Boolean).join('\n') || undefined}
                          >
                            <Verdict value={nowVerdict} basis={limitsState.active.basis} />
                            <div style={{ color: TEXT_MUTED, fontSize: '0.68rem' }}>
                              {'24h: '}
                              <Verdict value={dayVerdict} basis={limitsState.active.basis} />
                            </div>
                            {detail?.cause && <div style={{ color: TEXT_MUTED, fontSize: '0.66rem' }}>Cause: {detail.cause}</div>}
                            {detail?.windowText && <div style={{ color: '#cbd5e1', fontSize: '0.66rem' }}>{detail.windowText}</div>}
                          </td>
                        )}
                      </>
                    ) : (
                      <td colSpan={anyLimitSet ? 4 : 3} title={row.unavailableReason ?? undefined} style={{ padding: '0.35rem 0.4rem', color: TEXT_MUTED, fontStyle: 'italic' }}>
                        Unavailable
                      </td>
                    )}
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={anyLimitSet ? 5 : 4} style={{ padding: '0.25rem 0 0.75rem' }}>
                        {(detail?.detailNow || detail?.detail24h) && (
                          <div style={{ fontSize: '0.7rem', lineHeight: 1.45, margin: '0 0 0.45rem' }}>
                            {detail.detailNow && <div><span style={{ color: TEXT_MUTED }}>Now: </span>{detail.detailNow}</div>}
                            {detail.detail24h && <div><span style={{ color: TEXT_MUTED }}>Next 24 h: </span>{detail.detail24h}</div>}
                          </div>
                        )}
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
          "Now" is the forecast step valid at {formatZoned(new Date(rows.find((r) => r.validTime).validTime), timeDisplayZone)}
          {(() => {
            const lead = leadHours(rows.find((r) => r.validTime).validTime, suitabilityRunStart);
            return lead !== null && lead >= 0 ? `, ${formatLead(lead)} after the model run started` : '';
          })()}.
        </div>
      )}
    </div>
  );
}

export default CookIslandsHarbourWaveConditionsPanel;
