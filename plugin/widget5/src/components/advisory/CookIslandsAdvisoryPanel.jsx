import React, { useCallback, useMemo, useState } from 'react';
import { FileDown, Route, ListChecks, Anchor, Loader2, FileText } from 'lucide-react';
import { VESSEL_CLASS_OPTIONS } from '../../lib/CookIslandsSuitabilityOverlay';
import { rankScenarios, buildScenarioComparisonBriefConfig, suggestBetterVessel, isScenarioSuperseded } from '../../services/cookIslandsScenarioService';
import { exportCookIslandsRouteAdvisoryPdf } from '../../utils/CookIslandsRouteAdvisoryPdf';
import { fetchCookIslandsBestDeparture } from '../../services/cookIslandsRouteForecastService';
import { exportCookIslandsDomainAdvisoryPdf } from '../../utils/CookIslandsDomainAdvisoryPdf';
import { exportCookIslandsCommsPosterPdf } from '../../utils/CookIslandsCommsPosterPdf';
import DomainReportDialog from './DomainReportDialog';
import { normalizeViewBounds } from '../../utils/viewBounds';

const TEXT_MUTED = 'rgba(203, 213, 225, 0.72)';

function vesselLabel(code) {
  return VESSEL_CLASS_OPTIONS.find((v) => v.value === code)?.label ?? code;
}

// map.getCanvas().toDataURL() -- confirmed live to sometimes return a fully blank
// (uniform, no real pixels) image even though the map is visibly showing real
// content: reproduced for the plain Wave Height raster layer too, not just the
// vessel-suitability canvas-source overlay, so this isn't specific to one layer
// type. Decodes via a real <canvas>/Image (browser-only; there's no canvas
// polyfill in this project's Jest env, matching pdfTheme.js's loadVesselSvgIcon,
// so this stays untested the same way that is) and samples a small grid rather
// than trusting the capture blindly.
function isUniformImageDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        const [r0, g0, b0, a0] = data;
        for (let i = 4; i < data.length; i += 4) {
          if (Math.abs(data[i] - r0) > 2 || Math.abs(data[i + 1] - g0) > 2
            || Math.abs(data[i + 2] - b0) > 2 || Math.abs(data[i + 3] - a0) > 2) {
            resolve(false);
            return;
          }
        }
        resolve(true);
      } catch {
        resolve(false); // can't verify (e.g. tainted canvas) -- don't block on an uncertain check
      }
    };
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

// A blank capture is sometimes just a paint-timing race between the map's last
// render and the synchronous toDataURL() call made the instant the user clicks
// Generate -- one requestAnimationFrame round-trip is enough for that class of
// race to resolve. If it's still blank after, this genuinely isn't a usable
// fallback: return null so the caller proceeds with no fallback rather than a
// silently-blank one (see domainReportBundle.js's ReportExportBlockedError --
// an honest error beats a polished PDF with an empty map frame).
async function captureVerifiedMapScreenshot(map) {
  if (!map) return null;
  const capture = () => { try { return map.getCanvas().toDataURL('image/png'); } catch { return null; } };
  let dataUrl = capture();
  if (!dataUrl) return null;
  if (await isUniformImageDataUrl(dataUrl)) {
    // A WebGL canvas only holds its picture during a render (no preserveDrawingBuffer), so read it from
    // inside the next 'render' event rather than at an arbitrary later frame, which can read blank.
    dataUrl = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 2000);
      map.once('render', () => { clearTimeout(timer); resolve(capture()); });
      map.triggerRepaint();
    });
    if (!dataUrl || await isUniformImageDataUrl(dataUrl)) return null;
  }
  return dataUrl;
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
  routePoints = [],
  routeResultStale = false,
  routeResultSuperseded = false,
  vesselClass,
  routeSpeedKt,
  timeDisplayZone = 'Pacific/Rarotonga',
  mapCustomEnvelope = null,
  currentModelRunStart = null,
  scenarios = [],
  onExportScenarioComparisonBrief,
  onShowLandingAreaComparison,
  mapInstance = null,
  suitabilityTimeIndex = 0,
  currentSliderDate = null,
}) {
  const [exportingRoute, setExportingRoute] = useState(false);
  const [routeExportError, setRouteExportError] = useState('');
  const handleExportRoutePdf = useCallback(async () => {
    if (exportingRoute || !routeForecastResult || routeResultStale) return;
    setExportingRoute(true);
    setRouteExportError('');
    try {
      // A better later departure, searched on the server; silently skipped if the endpoint is
      // not deployed or the search fails (the report is complete without it).
      let departureSuggestion = null;
      try {
        const found = await fetchCookIslandsBestDeparture({
          routePoints, vessel: vesselClass, departureTime: routeForecastResult.departure_time, speedKt: routeSpeedKt,
        });
        if (found.improves) departureSuggestion = { departureTime: found.best.departure_time, best: found.best, requested: found.requested };
      } catch { departureSuggestion = null; }
      await exportCookIslandsRouteAdvisoryPdf({
        result: routeForecastResult, vessel: vesselClass, speedKt: routeSpeedKt,
        timeDisplayZone, mapCustomEnvelope, modelRunStart: currentModelRunStart,
        superseded: routeResultSuperseded,
        // Minimal upgrade that would clear the worst hazard (a threshold estimate, labelled as such in the PDF).
        vesselSuggestion: suggestBetterVessel(routeForecastResult, vesselClass),
        departureSuggestion,
      });
    } catch (err) {
      console.error('[CookIslandsAdvisoryPanel] Route PDF export failed:', err);
      setRouteExportError(err.message || 'PDF export failed.');
    } finally {
      setExportingRoute(false);
    }
  }, [exportingRoute, routeForecastResult, routePoints, routeResultStale, routeResultSuperseded, vesselClass, routeSpeedKt, timeDisplayZone, mapCustomEnvelope, currentModelRunStart]);

  // Scenarios computed from an older model run are excluded from comparison unless the
  // user opts in: comparing across forecast runs is not like-for-like.
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  const supersededIds = useMemo(
    () => scenarios.filter((s) => isScenarioSuperseded(s, currentModelRunStart)).map((s) => s.id),
    [scenarios, currentModelRunStart],
  );
  const comparableScenarios = useMemo(
    () => (includeSuperseded ? scenarios : scenarios.filter((s) => !supersededIds.includes(s.id))),
    [scenarios, supersededIds, includeSuperseded],
  );
  const { entries: scenarioEntries, recommendedId } = useMemo(() => rankScenarios(comparableScenarios), [comparableScenarios]);
  const readyScenarioCount = scenarioEntries.filter((e) => e.scenario.status === 'ready').length;
  const [exportingScenarios, setExportingScenarios] = useState(false);
  const [scenarioExportError, setScenarioExportError] = useState('');
  const handleExportScenariosPdf = useCallback(async () => {
    if (exportingScenarios || !onExportScenarioComparisonBrief || readyScenarioCount < 2) return;
    setExportingScenarios(true);
    setScenarioExportError('');
    try {
      const readyScenarios = scenarioEntries.filter((e) => e.scenario.status === 'ready').map((e) => e.scenario);
      await onExportScenarioComparisonBrief(buildScenarioComparisonBriefConfig({
        scenarios: readyScenarios, recommendedId, vesselLabelFor: vesselLabel, supersededIds,
      }));
    } catch (err) {
      console.error('[CookIslandsAdvisoryPanel] Scenario comparison PDF export failed:', err);
      setScenarioExportError(err.message || 'PDF export failed.');
    } finally {
      setExportingScenarios(false);
    }
  }, [exportingScenarios, onExportScenarioComparisonBrief, readyScenarioCount, scenarioEntries, recommendedId, supersededIds]);

  // Domain advisory: a configuration dialog (vessel / area / period) rather than a
  // fixed one-click export; the report itself is built from a validated bundle.
  const [domainDialogOpen, setDomainDialogOpen] = useState(false);
  const currentViewBounds = () => {
    const map = mapInstance?.current;
    if (!map) return null;
    const b = map.getBounds();
    return normalizeViewBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
  };
  const handleGenerateDomainPdf = useCallback(async ({ kind, vessel, scope, horizonHours }, { signal, onProgress }) => {
    const map = mapInstance?.current;
    const fallbackMapDataUrl = await captureVerifiedMapScreenshot(map);
    const exporter = kind === 'poster' ? exportCookIslandsCommsPosterPdf : exportCookIslandsDomainAdvisoryPdf;
    await exporter({
      vessel, scope, horizonHours, timeIndex: suitabilityTimeIndex, bounds: currentViewBounds(),
      timeDisplayZone, customEnvelope: mapCustomEnvelope, fallbackMapDataUrl, signal, onProgress,
      // The live dashboard (no hash: no saved view or token), printed as "latest conditions" in the report.
      dashboardUrl: typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : null,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapInstance, suitabilityTimeIndex, timeDisplayZone, mapCustomEnvelope]);

  return (
    <div>
      <AdvisoryRow
        icon={FileText}
        iconColor="#a78bfa"
        title="Domain advisory"
        description="Advisory for the current map view or the whole forecast domain, with an optional 72-hour or seven-day outlook — or an A3 communications poster for public information."
        action={(
          <button type="button" className="map-display-option__btn" onClick={() => setDomainDialogOpen(true)}>
            <FileDown size={13} style={{ marginRight: 5, verticalAlign: 'text-bottom' }} />
            Configure &amp; download…
          </button>
        )}
      />
      <AdvisoryRow
        icon={Route}
        iconColor="#38bdf8"
        title="Route advisory"
        description={
          !routeForecastResult
            ? 'Draw a route and run a forecast (below) to generate this advisory.'
            : routeResultStale
              ? 'Route, vessel, speed, or departure changed since this result — re-run before exporting.'
              : 'Model guidance for the route you last ran, with its full hazard table.'
        }
        action={routeForecastResult ? (
          <>
            <button
              type="button"
              className="map-display-option__btn"
              onClick={handleExportRoutePdf}
              disabled={exportingRoute || routeResultStale}
              title={routeResultStale ? 'Re-run the route before exporting -- inputs have changed since this result' : undefined}
            >
              {exportingRoute ? <Loader2 size={13} className="update-spinner" style={{ marginRight: 5, verticalAlign: 'text-bottom' }} /> : <FileDown size={13} style={{ marginRight: 5, verticalAlign: 'text-bottom' }} />}
              {exportingRoute ? 'Preparing…' : 'Download PDF'}
            </button>
            {!routeResultStale && routeResultSuperseded && (
              <div style={{ color: '#fcd34d', fontSize: '0.68rem', marginTop: '0.3rem' }}>A newer forecast run is available.</div>
            )}
            {routeExportError && <div style={{ color: '#f87171', fontSize: '0.68rem', marginTop: '0.3rem' }}>{routeExportError}</div>}
          </>
        ) : null}
      />
      <AdvisoryRow
        icon={ListChecks}
        iconColor="#2A9D8F"
        title="Scenario comparison"
        description={
          readyScenarioCount >= 2
            ? `Compares your ${readyScenarioCount} saved route scenarios side by side, with a recommendation when coverage allows.${supersededIds.length && !includeSuperseded ? ` ${supersededIds.length} scenario${supersededIds.length === 1 ? '' : 's'} from an older model run left out.` : ''}`
            : `A comparison needs at least two ready scenarios${supersededIds.length && !includeSuperseded ? ` (${supersededIds.length} from an older model run ${supersededIds.length === 1 ? 'is' : 'are'} excluded)` : ''}. Save more route scenarios (in Scenario Comparison, below).`
        }
        action={readyScenarioCount >= 2 || supersededIds.length ? (
          <>
            {supersededIds.length > 0 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.68rem', marginBottom: '0.35rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={includeSuperseded} onChange={(e) => setIncludeSuperseded(e.target.checked)} />
                Include scenarios from an older model run
              </label>
            )}
            <button type="button" className="map-display-option__btn" onClick={handleExportScenariosPdf} disabled={exportingScenarios || readyScenarioCount < 2}>
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
      <DomainReportDialog
        open={domainDialogOpen}
        onClose={() => setDomainDialogOpen(false)}
        onGenerate={handleGenerateDomainPdf}
        defaultVessel={vesselClass}
        hasViewport={Boolean(mapInstance?.current)}
        viewportBounds={domainDialogOpen ? currentViewBounds() : null}
        validTime={currentSliderDate}
        timeDisplayZone={timeDisplayZone}
        customEnvelopeActive={Boolean(mapCustomEnvelope)}
      />
    </div>
  );
}

export default CookIslandsAdvisoryPanel;
