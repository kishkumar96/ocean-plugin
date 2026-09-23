import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Award, Copy, FileDown, ListChecks, Loader, Play, Trash2 } from 'lucide-react';
import { HAZARD_COLORS, VESSEL_CLASS_OPTIONS } from '../../lib/CookIslandsSuitabilityOverlay';
import { ROUTE_HAZARD_LABELS } from '../../services/cookIslandsRouteForecastService';
import {
  MAX_SCENARIOS,
  buildScenarioComparisonBriefConfig,
  driverLabel,
  isScenarioRouteStale,
  isScenarioSuperseded,
  rankScenarios,
} from '../../services/cookIslandsScenarioService';
import './CookIslandsScenarioComparisonPanel.css';

// Ported from widget1's ScenarioComparisonPanel.jsx. Two swaps throughout:
// hazard label/color source is this app's own ROUTE_HAZARD_LABELS/
// HAZARD_COLORS (note 'Warning', not widget1's 'Avoid', for class 2) rather
// than widget1's SUITABILITY_HAZARD_LABELS/COLORS; and "Generate Scenario
// Comparison Brief" only renders when a caller passes onExportBrief -- no
// PDF exporter exists in this app yet, so this component stays usable on
// its own rather than hard-depending on one that doesn't exist.

function vesselLabel(code) {
  return VESSEL_CLASS_OPTIONS.find((v) => v.value === code)?.label ?? code;
}

function statusText(scenario, decision, isRunning) {
  if (isRunning || scenario.status === 'running') return 'Running…';
  if (scenario.status === 'error') return scenario.error || 'Failed';
  if (scenario.status === 'draft') return 'Not run yet';
  if (!decision) return 'No result';
  return `${ROUTE_HAZARD_LABELS[decision.worstHazardClass] ?? 'Unknown'} · ${driverLabel(decision.primaryDriver)}`;
}

function statusColor(scenario, decision) {
  if (scenario.status === 'error') return '#f87171';
  if (scenario.status !== 'ready' || !decision) return 'rgba(180, 200, 230, 0.68)';
  return HAZARD_COLORS[decision.worstHazardClass] ?? '#94a3b8';
}

function fmtNumber(value, digits = 1, suffix = '') {
  return Number.isFinite(value) ? `${value.toFixed(digits)}${suffix}` : '—';
}

function CookIslandsScenarioComparisonPanel({
  scenarios,
  currentInputs,
  currentModelRunStart,
  runningScenarioIds = [],
  onSaveCurrent,
  onDuplicate,
  onRemove,
  onRun,
  onRunAll,
  onExportBrief,
  highlightScenarioId = null,
}) {
  const { entries, recommendedId } = useMemo(() => rankScenarios(scenarios), [scenarios]);
  const readyCount = scenarios.filter((s) => s.status === 'ready').length;
  const canSaveCurrent = (currentInputs?.routePoints?.length ?? 0) >= 2 && scenarios.length < MAX_SCENARIOS;
  const canRunAll = scenarios.length > 0 && runningScenarioIds.length === 0;

  // "Confirm & compare" (in the route-forecast results panel, elsewhere on
  // screen) creates a scenario here silently -- scroll to it and pulse it
  // briefly so the result of that click is actually visible to the user.
  const [pulseId, setPulseId] = useState(null);
  const cardRefs = useRef({});
  useEffect(() => {
    if (!highlightScenarioId) return undefined;
    setPulseId(highlightScenarioId);
    cardRefs.current[highlightScenarioId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timer = setTimeout(() => setPulseId(null), 2200);
    return () => clearTimeout(timer);
  }, [highlightScenarioId]);

  const [exportingBrief, setExportingBrief] = useState(false);

  const handleExportComparisonBrief = useCallback(async () => {
    if (exportingBrief || !onExportBrief) return;
    setExportingBrief(true);
    try {
      const readyScenarios = entries.filter((e) => e.scenario.status === 'ready').map((e) => e.scenario);
      await onExportBrief(buildScenarioComparisonBriefConfig({
        scenarios: readyScenarios,
        recommendedId,
        vesselLabelFor: vesselLabel,
      }));
    } catch (err) {
      console.error('[CookIslandsScenarioComparisonPanel] Comparison brief export failed:', err);
    } finally {
      setExportingBrief(false);
    }
  }, [entries, exportingBrief, onExportBrief, recommendedId]);

  return (
    <div className="map-display-option">
      <div className="map-display-option__label">Scenario comparison</div>
      <div className="map-display-option__hint">
        Save the current route as a scenario, duplicate it with a different vessel, speed, or departure time, and compare up to {MAX_SCENARIOS} side by side. Classifications use each vessel&apos;s preset thresholds.
      </div>

      <div className="map-display-option__segmented" role="group" aria-label="Scenario comparison actions" style={{ marginTop: '0.5rem' }}>
        <button type="button" className="map-display-option__btn" onClick={onSaveCurrent} disabled={!canSaveCurrent}>
          Save current
        </button>
        <button type="button" className="map-display-option__btn" onClick={onRunAll} disabled={!canRunAll}>
          <ListChecks size={13} style={{ marginRight: 5, verticalAlign: 'text-bottom' }} />
          Run all
        </button>
      </div>

      {scenarios.length === 0 && (
        <div className="map-display-option__hint" style={{ marginTop: '0.5rem' }}>
          No scenarios saved yet. Draw a route above, then &quot;Save current&quot; to start comparing.
        </div>
      )}

      {entries.map(({ scenario, decision }) => {
        const isRunning = runningScenarioIds.includes(scenario.id) || scenario.status === 'running';
        const isRecommended = scenario.id === recommendedId;
        const stale = isScenarioRouteStale(scenario, currentInputs?.routePoints);
        const superseded = isScenarioSuperseded(scenario, currentModelRunStart);
        return (
          <div
            key={scenario.id}
            ref={(el) => { cardRefs.current[scenario.id] = el; }}
            className={`scenario-card${isRecommended ? ' scenario-card--recommended' : ''}${pulseId === scenario.id ? ' scenario-card--pulse' : ''}`}
          >
            <div className="scenario-card__header">
              <span className="scenario-card__name">{scenario.name}</span>
              {isRecommended && (
                <span className="scenario-card__badge">
                  <Award size={11} />
                  Recommended
                </span>
              )}
            </div>
            <div className="scenario-card__meta">
              {vesselLabel(scenario.vessel)} · {fmtNumber(Number(scenario.speedKt), 1, ' kt')} · {scenario.routePoints?.length ?? 0} pts
            </div>
            <div className="scenario-card__status" style={{ color: statusColor(scenario, decision) }}>
              {statusText(scenario, decision, isRunning)}
            </div>
            {stale && <div className="scenario-card__note">Route changed since this was run — re-run recommended.</div>}
            {superseded && <div className="scenario-card__note">Superseded by a newer forecast run.</div>}
            <div className="scenario-card__actions">
              <button type="button" onClick={() => onRun(scenario.id)} disabled={isRunning}>
                {isRunning ? <Loader size={12} /> : <Play size={12} />}
                Run
              </button>
              <button type="button" onClick={() => onDuplicate(scenario.id)} disabled={scenarios.length >= MAX_SCENARIOS}>
                <Copy size={12} />
                Duplicate
              </button>
              <button type="button" onClick={() => onRemove(scenario.id)} aria-label={`Remove ${scenario.name}`}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        );
      })}

      {readyCount >= 2 && (
        <>
          <div className="scenario-compare-table-wrap">
            <table className="scenario-compare-table">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Worst</th>
                  <th>Caution+Warning</th>
                  <th>Unavailable</th>
                  <th>Duration</th>
                  <th>Driver</th>
                </tr>
              </thead>
              <tbody>
                {entries.filter((e) => e.scenario.status === 'ready').map(({ scenario, decision }) => {
                  const recommendedRow = scenario.id === recommendedId;
                  // Hazard-severity color, matching statusColor() on the cards
                  // above -- Worst and Driver render as one hazard-colored
                  // reading up there, so the table's Worst/Driver columns
                  // should agree, rather than the table using its own
                  // unrelated "is this the recommended row" color rule.
                  const hazardTextColor = decision ? HAZARD_COLORS[decision.worstHazardClass] : undefined;
                  return (
                    <tr key={scenario.id} className={recommendedRow ? 'scenario-compare-table__recommended-row' : undefined}>
                      <td>{scenario.name}{recommendedRow ? ' ★' : ''}</td>
                      <td style={{ color: hazardTextColor }}>{decision ? (ROUTE_HAZARD_LABELS[decision.worstHazardClass] ?? '—') : '—'}</td>
                      <td>{fmtNumber((decision?.cautionPercent ?? 0) + (decision?.warningPercent ?? 0), 0, '%')}</td>
                      <td>{decision?.unavailableSamples ?? '—'}</td>
                      <td>{fmtNumber(decision?.durationHours, 1, ' h')}</td>
                      <td style={{ color: hazardTextColor }}>{decision ? driverLabel(decision.primaryDriver) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {onExportBrief && (
            <button
              type="button"
              className="map-display-option__btn"
              style={{ marginTop: '0.5rem', width: '100%' }}
              onClick={handleExportComparisonBrief}
              disabled={exportingBrief}
            >
              <FileDown size={13} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
              {exportingBrief ? 'Generating…' : 'Generate Scenario Comparison Brief'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default CookIslandsScenarioComparisonPanel;
