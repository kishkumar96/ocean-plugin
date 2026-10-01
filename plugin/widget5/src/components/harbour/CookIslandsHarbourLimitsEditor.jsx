import React, { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { COOK_ISLANDS_HARBOUR_POINTS } from '../../config/cookIslandsHarbourPoints';
import {
  LIMIT_VARIABLES, limitOrderIssues, normalizeLimitsConfig, buildLimitsProposal, limitsForHarbour,
} from '../../config/cookIslandsHarbourLimits';
import { downloadJson } from '../../services/cookIslandsWaveTimeseriesService';

const TEXT_MUTED = 'rgba(203, 213, 225, 0.72)';
const DEFAULT_TARGET = 'default';
const inputStyle = {
  width: '4.2rem', padding: '0.2rem 0.3rem', fontSize: '0.74rem', color: '#f8fafc',
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 4,
};

// Edits the barge-unloading limits (see cookIslandsHarbourLimits.js): one
// default set for every harbour, plus optional per-harbour overrides. Every
// field may be left blank = "no limit on this variable". `config`/`onChange`
// are controlled by the parent, which owns persistence.
function CookIslandsHarbourLimitsEditor({ config, onChange, hasDraft = false, onDiscardDraft, published = null }) {
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [importError, setImportError] = useState('');
  const fileRef = useRef(null);
  const isDefault = target === DEFAULT_TARGET;
  const hasOverride = !isDefault && Boolean(config.harbours[target]);
  const editable = isDefault || hasOverride;
  const shown = isDefault ? config.default : limitsForHarbour(config, target);

  const setField = (level, key, raw) => {
    const value = raw === '' ? null : Number(raw);
    if (value !== null && !(value > 0)) return;
    const next = { ...config, harbours: { ...config.harbours } };
    if (isDefault) next.default = { ...config.default, [level]: { ...config.default[level], [key]: value } };
    else next.harbours[target] = { ...config.harbours[target], [level]: { ...config.harbours[target][level], [key]: value } };
    onChange(next);
  };

  const startOverride = () => {
    onChange({ ...config, harbours: { ...config.harbours, [target]: JSON.parse(JSON.stringify(config.default)) } });
  };
  const revertOverride = () => {
    const harbours = { ...config.harbours };
    delete harbours[target];
    onChange({ ...config, harbours });
  };

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      onChange(normalizeLimitsConfig(JSON.parse(await file.text())));
      setImportError('');
    } catch (err) {
      setImportError('Could not read that file -- expected a limits JSON exported from this panel.');
    }
  };

  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '0.6rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.74rem' }}>
      <div style={{ color: TEXT_MUTED, fontSize: '0.68rem', marginBottom: '0.5rem', lineHeight: 1.4 }}>
        Set the conditions at which barge unloading should be flagged. Leave a box blank for no limit.
        Period is a maximum (long swell surges harbours even when wave height is modest).
        Edits are a local DRAFT (this browser only) and do not become approved limits;
        Export proposal to send them for approval.
      </div>

      <label style={{ display: 'block', marginBottom: '0.5rem' }}>
        <span style={{ color: TEXT_MUTED }}>Applies to </span>
        <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          <option value={DEFAULT_TARGET}>All harbours (default)</option>
          {COOK_ISLANDS_HARBOUR_POINTS.map((p) => (
            <option key={p.riskPointId} value={String(p.riskPointId)}>
              {p.name}{config.harbours[String(p.riskPointId)] ? ' (custom)' : ''}
            </option>
          ))}
        </select>
      </label>

      {!isDefault && !hasOverride && (
        <div style={{ marginBottom: '0.5rem', color: TEXT_MUTED }}>
          Using the default limits.{' '}
          <button type="button" className="map-display-option__btn" onClick={startOverride}>Set custom limits for this harbour</button>
        </div>
      )}
      {hasOverride && (
        <div style={{ marginBottom: '0.5rem' }}>
          <button type="button" className="map-display-option__btn" onClick={revertOverride}>Revert to default limits</button>
        </div>
      )}

      <table style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: TEXT_MUTED, textAlign: 'left' }}>
            <th style={{ fontWeight: 500, paddingRight: '0.75rem' }} />
            <th style={{ fontWeight: 500, paddingRight: '0.5rem' }}>Caution at</th>
            <th style={{ fontWeight: 500 }}>Stop at</th>
          </tr>
        </thead>
        <tbody>
          {LIMIT_VARIABLES.map(({ key, label, unit, step }) => (
            <tr key={key}>
              <td style={{ paddingRight: '0.75rem', paddingTop: 4 }}>{label} ({unit})</td>
              {['caution', 'stop'].map((level) => (
                <td key={level} style={{ paddingRight: '0.5rem', paddingTop: 4 }}>
                  <input
                    type="number" min="0" step={step} inputMode="decimal"
                    aria-label={`${label} ${level} limit${isDefault ? '' : ` for ${COOK_ISLANDS_HARBOUR_POINTS.find((p) => String(p.riskPointId) === target)?.name}`}`}
                    disabled={!editable}
                    value={shown[level][key] ?? ''}
                    onChange={(e) => setField(level, key, e.target.value)}
                    style={{ ...inputStyle, opacity: editable ? 1 : 0.5 }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {limitOrderIssues(shown).length > 0 && (
        <div role="alert" style={{ color: '#f87171', marginTop: 6 }}>
          Stop must be higher than Caution for {limitOrderIssues(shown).map((v) => v.label.toLowerCase()).join(', ')}.
          As entered, the Caution band is empty.
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: '0.6rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="map-display-option__btn"
          onClick={() => downloadJson('harbour_unloading_limits_proposal.json', buildLimitsProposal(config, { basedOnVersion: published?.version ?? 0 }))}
        >
          <Download size={12} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} />Export proposal
        </button>
        <button type="button" className="map-display-option__btn" onClick={() => fileRef.current?.click()}>
          <Upload size={12} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} />Import
        </button>
        {hasDraft && (
          <button type="button" className="map-display-option__btn" onClick={() => { onDiscardDraft?.(); setTarget(DEFAULT_TARGET); }}>
            Discard draft
          </button>
        )}
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={handleImport} style={{ display: 'none' }} data-testid="limits-import" />
      </div>
      {published?.history?.length > 0 && (
        <details style={{ marginTop: '0.6rem', color: TEXT_MUTED }}>
          <summary style={{ cursor: 'pointer' }}>Approved limits history</summary>
          <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem' }}>
            {published.history.map((h) => (
              <li key={`${h.version}-${h.date}`}>v{h.version} · {h.date} · {h.by} — {h.summary}</li>
            ))}
          </ul>
        </details>
      )}
      {importError && <div style={{ color: '#f87171', marginTop: 4 }}>{importError}</div>}
    </div>
  );
}

export default CookIslandsHarbourLimitsEditor;
