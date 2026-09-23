import React, { useCallback, useMemo, useState } from 'react';
import { FileDown, Route, ListChecks, Anchor, Loader2 } from 'lucide-react';
import { VESSEL_CLASS_OPTIONS } from '../../lib/CookIslandsSuitabilityOverlay';
import { rankScenarios, buildScenarioComparisonBriefConfig } from '../../services/cookIslandsScenarioService';
import { exportCookIslandsRouteAdvisoryPdf } from '../../utils/CookIslandsRouteAdvisoryPdf';

const TEXT_MUTED = 'rgba(203, 213, 225, 0.72)';

function vesselLabel(code) {
  return VESSEL_CLASS_OPTIONS.find((v) => v.value === code)?.label ?? code;
}

// Single consolidated place to find every PDF advisory this app can
// generate -- ported in spirit from widget1's "Generate Advisory Brief"
// button/modal (one obvious place to go for a PDF), but as a panel with
// three rows rather than one button/modal: unlike widget1's single
// vessel+landing-area report, this app produces three genuinely different
// documents (a route's own advisory, a saved-scenario comparison, a
// landing-area comparison), each needing different source data that
// already lives in a different feature's own state. Rather than
// relocating where a route gets drawn or a scenario gets saved, this panel
// just surfaces each export action in one place once its data exists,
// with an explanation instead of a hidden/missing button when it doesn't --
// see each row's own comment for why that's the fix for the actual
// reported problem (PDF buttons existed but were scattered, so most users
// never found them at all).
function AdvisoryRow({ icon: Icon, title, description, action, iconColor }) {
  return (
    <div style={{ display: 'flex', gap: '0.6rem', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
      <span style={{
        width: 26, height: 26, borderRadius: 8, flexShrink: 0, marginTop: 2,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `${iconColor}20`, border: `1px solid ${iconColor}44`,
      }}>
        <Icon size={13} color={iconColor} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.15rem' }}>{title}</div>
        <div style={{ fontSize: '0.7rem', color: TEXT_MUTED, lineHeight: 1.4, marginBottom: '0.4rem' }}>{description}</div>
        {action}
      </div>
    </div>
  );
}

function CookIslandsAdvisoryPanel({
  routeForecastResult,
  vesselClass,
  routeSpeedKt,
  timeDisplayZone = 'Pacific/Rarotonga',
  mapCustomEnvelope = null,
  currentModelRunStart = null,
  scenarios = [],
  onExportScenarioComparisonBrief,
  onShowLandingAreaComparison,
}) {
  const [exportingRoute, setExportingRoute] = useState(false);
  const [routeExportError, setRouteExportError] = useState('');
  const handleExportRoutePdf = useCallback(async () => {
    if (exportingRoute || !routeForecastResult) return;
    setExportingRoute(true);
    setRouteExportError('');
    try {
      await exportCookIslandsRouteAdvisoryPdf({
        result: routeForecastResult, vessel: vesselClass, speedKt: routeSpeedKt,
        timeDisplayZone, mapCustomEnvelope, modelRunStart: currentModelRunStart,
      });
    } catch (err) {
      console.error('[CookIslandsAdvisoryPanel] Route PDF export failed:', err);
      setRouteExportError(err.message || 'PDF export failed.');
    } finally {
      setExportingRoute(false);
    }
  }, [exportingRoute, routeForecastResult, vesselClass, routeSpeedKt, timeDisplayZone, mapCustomEnvelope, currentModelRunStart]);

  const { entries: scenarioEntries, recommendedId } = useMemo(() => rankScenarios(scenarios), [scenarios]);
  const readyScenarioCount = scenarioEntries.filter((e) => e.scenario.status === 'ready').length;
  const [exportingScenarios, setExportingScenarios] = useState(false);
  const [scenarioExportError, setScenarioExportError] = useState('');
  const handleExportScenariosPdf = useCallback(async () => {
    if (exportingScenarios || !onExportScenarioComparisonBrief || readyScenarioCount === 0) return;
    setExportingScenarios(true);
    setScenarioExportError('');
    try {
      const readyScenarios = scenarioEntries.filter((e) => e.scenario.status === 'ready').map((e) => e.scenario);
      await onExportScenarioComparisonBrief(buildScenarioComparisonBriefConfig({
        scenarios: readyScenarios, recommendedId, vesselLabelFor: vesselLabel,
      }));
    } catch (err) {
      console.error('[CookIslandsAdvisoryPanel] Scenario comparison PDF export failed:', err);
      setScenarioExportError(err.message || 'PDF export failed.');
    } finally {
      setExportingScenarios(false);
    }
  }, [exportingScenarios, onExportScenarioComparisonBrief, readyScenarioCount, scenarioEntries, recommendedId]);

  return (
    <div>
      <AdvisoryRow
        icon={Route}
        iconColor="#38bdf8"
        title="Route advisory"
        description={
          routeForecastResult
            ? 'A go/no-go advisory for the route you last ran, with its full hazard table.'
            : 'Draw a route and run a forecast (below) to generate this advisory.'
        }
        action={routeForecastResult ? (
          <>
            <button type="button" className="map-display-option__btn" onClick={handleExportRoutePdf} disabled={exportingRoute}>
              {exportingRoute ? <Loader2 size={13} className="update-spinner" style={{ marginRight: 5, verticalAlign: 'text-bottom' }} /> : <FileDown size={13} style={{ marginRight: 5, verticalAlign: 'text-bottom' }} />}
              {exportingRoute ? 'Preparing…' : 'Download PDF'}
            </button>
            {routeExportError && <div style={{ color: '#f87171', fontSize: '0.68rem', marginTop: '0.3rem' }}>{routeExportError}</div>}
          </>
        ) : null}
      />
      <AdvisoryRow
        icon={ListChecks}
        iconColor="#2A9D8F"
        title="Scenario comparison"
        description={
          readyScenarioCount > 0
            ? `Compares your ${readyScenarioCount} saved route scenario${readyScenarioCount === 1 ? '' : 's'} side by side, with a recommendation.`
            : 'Save at least one route scenario (in Scenario Comparison, below) to generate this brief.'
        }
        action={readyScenarioCount > 0 ? (
          <>
            <button type="button" className="map-display-option__btn" onClick={handleExportScenariosPdf} disabled={exportingScenarios}>
              {exportingScenarios ? <Loader2 size={13} className="update-spinner" style={{ marginRight: 5, verticalAlign: 'text-bottom' }} /> : <FileDown size={13} style={{ marginRight: 5, verticalAlign: 'text-bottom' }} />}
              {exportingScenarios ? 'Preparing…' : 'Download PDF'}
            </button>
            {scenarioExportError && <div style={{ color: '#f87171', fontSize: '0.68rem', marginTop: '0.3rem' }}>{scenarioExportError}</div>}
          </>
        ) : null}
      />
      <AdvisoryRow
        icon={Anchor}
        iconColor="#F4A261"
        title="Landing area comparison"
        description="Compares the next 7 days of suitability at every named landing and fishing-ground site at once."
        action={
          <button type="button" className="map-display-option__btn" onClick={onShowLandingAreaComparison}>
            Compare &amp; export
          </button>
        }
      />
    </div>
  );
}

export default CookIslandsAdvisoryPanel;
