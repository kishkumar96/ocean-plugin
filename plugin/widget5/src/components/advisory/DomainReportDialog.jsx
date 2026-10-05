import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, FileDown, Loader2 } from 'lucide-react';
import { VESSEL_CLASS_OPTIONS } from '../../lib/CookIslandsSuitabilityOverlay';
import { HORIZON_OPTIONS, expectedDomainPageCount } from '../../reports/domainReportBundle';
import { fetchSuitabilityMeta } from '../../reports/suitabilityReportService';
import { formatUtc, formatLocal, parseRunId } from '../../reports/reportRules';
import { tzLabel } from '../../utils/timeZoneFormat';

const TEXT_MUTED = 'rgba(203, 213, 225, 0.72)';
const fieldStyle = { display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.72rem', color: TEXT_MUTED };
const selectStyle = { background: 'rgba(15, 23, 42, 0.9)', color: '#f8fafc', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 6, padding: '0.35rem 0.5rem', fontSize: '0.78rem' };

// Configuration dialog for the domain advisory: what to report on (vessel, scope,
// outlook length), a preview of what that means (scope, model run, valid time,
// page count), then progress with a real Cancel while the report is assembled.
// The parent supplies `onGenerate(options, { signal, onProgress })`.
function DomainReportDialog({
  open, onClose, onGenerate, defaultVessel, hasViewport, viewportBounds = null, validTime, timeDisplayZone = 'Pacific/Rarotonga',
  customEnvelopeActive = false,
}) {
  const [vessel, setVessel] = useState(defaultVessel);
  const [scope, setScope] = useState(hasViewport ? 'viewport' : 'domain');
  const [horizonHours, setHorizonHours] = useState(72);
  const [kind, setKind] = useState('advisory');
  const [meta, setMeta] = useState(null);
  const [state, setState] = useState({ running: false, progress: null, error: '' });
  // With a custom envelope on the map, the report (which only has the preset thresholds) would quietly
  // describe different colours from the ones on screen. Generating then needs an explicit acknowledgement.
  const [presetAcknowledged, setPresetAcknowledged] = useState(false);
  useEffect(() => { if (open) setPresetAcknowledged(false); }, [open]);
  const blockedByCustom = customEnvelopeActive && !presetAcknowledged;
  const abortRef = useRef(null);

  useEffect(() => { if (open) { setVessel(defaultVessel); setScope(hasViewport ? 'viewport' : 'domain'); setState({ running: false, progress: null, error: '' }); } }, [open, defaultVessel, hasViewport]);
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    fetchSuitabilityMeta().then((m) => { if (!cancelled) setMeta(m); }).catch(() => { if (!cancelled) setMeta(null); });
    return () => { cancelled = true; };
  }, [open]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const isPoster = kind === 'poster';
  const pages = isPoster ? 1 : expectedDomainPageCount(horizonHours);
  const run = useMemo(() => (meta?.runId ? parseRunId(meta.runId) : null), [meta]);
  if (!open) return null;

  const label = tzLabel(timeDisplayZone);
  const start = async () => {
    const ac = new AbortController();
    abortRef.current = ac;
    setState({ running: true, progress: { done: 0, total: 1, label: 'Starting' }, error: '' });
    try {
      await onGenerate({ kind, vessel, scope, horizonHours: isPoster && horizonHours === 0 ? 72 : horizonHours }, { signal: ac.signal, onProgress: (p) => setState((s) => ({ ...s, progress: p })) });
      onClose();
    } catch (err) {
      setState({ running: false, progress: null, error: err?.name === 'ReportAbortError' ? 'Cancelled.' : (err?.message || 'PDF export failed.') });
    }
  };
  const cancel = () => { abortRef.current?.abort(); };
  const pct = state.progress ? Math.round((100 * state.progress.done) / Math.max(1, state.progress.total)) : 0;

  return (
    <div role="dialog" aria-modal="true" aria-label="Domain advisory report options" style={{ position: 'fixed', inset: 0, background: 'rgba(2, 6, 23, 0.6)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ width: 'min(440px, 100%)', background: '#0f172a', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 14, padding: '1rem 1.1rem', color: '#f8fafc', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.8rem' }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Domain advisory report</div>
          <button type="button" aria-label="Close" onClick={() => { cancel(); onClose(); }} style={{ background: 'none', border: 'none', color: TEXT_MUTED, cursor: 'pointer' }}><X size={16} /></button>
        </div>

        <div style={{ display: 'grid', gap: '0.7rem' }}>
          <label style={fieldStyle}>Report
            <select aria-label="Report" style={selectStyle} value={kind} disabled={state.running} onChange={(e) => setKind(e.target.value)}>
              <option value="advisory">Operational advisory</option>
              <option value="poster">Communications poster (A3)</option>
            </select>
          </label>
          <label style={fieldStyle}>Vessel
            <select aria-label="Vessel" style={selectStyle} value={vessel} disabled={state.running} onChange={(e) => setVessel(e.target.value)}>
              {VESSEL_CLASS_OPTIONS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </label>
          <label style={fieldStyle}>Area
            <select aria-label="Area" style={selectStyle} value={scope} disabled={state.running} onChange={(e) => setScope(e.target.value)}>
              <option value="viewport" disabled={!hasViewport}>Current map view{hasViewport ? '' : ' (not available)'}</option>
              <option value="domain">Whole forecast domain</option>
            </select>
          </label>
          <label style={fieldStyle}>Period
            <select aria-label="Period" style={selectStyle} value={horizonHours} disabled={state.running} onChange={(e) => setHorizonHours(Number(e.target.value))}>
              {HORIZON_OPTIONS.filter((o) => !isPoster || o.value > 0).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>

        <div style={{ marginTop: '0.9rem', padding: '0.6rem 0.7rem', borderRadius: 10, background: 'rgba(56, 189, 248, 0.07)', border: '1px solid rgba(56, 189, 248, 0.25)', fontSize: '0.7rem', lineHeight: 1.5, color: TEXT_MUTED }}>
          <div><strong style={{ color: '#f8fafc' }}>Scope:</strong> {scope === 'viewport' && viewportBounds
            ? `Current map view (W ${viewportBounds.west.toFixed(2)}, S ${viewportBounds.south.toFixed(2)}, E ${viewportBounds.east.toFixed(2)}, N ${viewportBounds.north.toFixed(2)})`
            : 'Whole forecast domain'}</div>
          <div><strong style={{ color: '#f8fafc' }}>Model run:</strong> {run ? formatUtc(run) : (meta ? 'not reported' : 'loading…')}</div>
          <div><strong style={{ color: '#f8fafc' }}>Valid time:</strong> {validTime ? formatLocal(validTime, timeDisplayZone, label) : '—'}</div>
          <div><strong style={{ color: '#f8fafc' }}>Report:</strong> {isPoster ? '1 page (A3) — map, vessel cards, shared trend; a communications product, not an advisory' : `${pages} pages${horizonHours > 0 ? ' — advisory, outlook, vessel comparison, daily evolution, trend, methodology' : ' — advisory and methodology'}`}</div>
        </div>

        {customEnvelopeActive && (
          <div role="note" style={{ marginTop: '0.7rem', padding: '0.55rem 0.7rem', borderRadius: 10, background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.45)', fontSize: '0.7rem', lineHeight: 1.45, color: '#fde68a' }}>
            <strong>Your map uses a custom envelope.</strong> This report can only use the <strong>preset</strong> vessel thresholds, so its
            colours and percentages can differ from what you see on screen. The report says so on page 1.
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.4rem', color: '#f8fafc', cursor: 'pointer' }}>
              <input
                type="checkbox"
                id="domain-report-preset-ack"
                name="domain-report-preset-ack"
                checked={presetAcknowledged}
                disabled={state.running}
                onChange={(e) => setPresetAcknowledged(e.target.checked)}
              />
              Generate with the preset thresholds
            </label>
          </div>
        )}

        {state.running && (
          <div style={{ marginTop: '0.8rem' }}>
            <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: '#38bdf8', transition: 'width 0.2s' }} />
            </div>
            <div style={{ fontSize: '0.66rem', color: TEXT_MUTED, marginTop: '0.3rem' }}>{state.progress?.label ?? 'Working'} — {pct}%</div>
          </div>
        )}
        {state.error && <div role="alert" style={{ color: '#f87171', fontSize: '0.72rem', marginTop: '0.6rem' }}>{state.error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          {state.running
            ? <button type="button" className="map-display-option__btn" onClick={cancel}>Cancel</button>
            : <button type="button" className="map-display-option__btn" onClick={onClose}>Close</button>}
          <button
            type="button"
            className="map-display-option__btn"
            onClick={start}
            disabled={state.running || blockedByCustom}
            title={blockedByCustom ? 'Confirm the preset thresholds above to generate' : undefined}
          >
            {state.running ? <Loader2 size={13} className="update-spinner" style={{ marginRight: 5, verticalAlign: 'text-bottom' }} /> : <FileDown size={13} style={{ marginRight: 5, verticalAlign: 'text-bottom' }} />}
            {state.running ? 'Preparing…' : 'Generate PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DomainReportDialog;
