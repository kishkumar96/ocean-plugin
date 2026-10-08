import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeWindowMismatch, selectHazardBlock } from '../components/impact/impactWindowSync';
import 'maplibre-gl/dist/maplibre-gl.css';
import BottomOffCanvas from './BottomOffCanvas';
import BottomBuoyOffCanvas from './BottomBuoyOffCanvas';
import ForecastApp from '../components/ForecastApp';
import useInundationThresholds from '../hooks/useInundationThresholds';
import ModernHeader from '../components/ModernHeader';
import { FLOOD_3D_CONFIG, MAP_LAYERS, MAP_TERRAIN_CONFIG } from '../lib/mapLayersConfig';
import { DEFAULT_BASEMAP_ID } from '../config/basemapConfig';
import { useZarrMap } from '../hooks/useZarrMap';
import {
  customEnvelopesEqual,
  envelopeDiffersFromPreset,
  getCustomEnvelopeForVessel,
  loadCustomEnvelopeProfiles,
  saveCustomEnvelopeProfiles,
  updateCustomEnvelopeForVessel,
} from '../domain/suitability/customEnvelopeProfiles';
import { fetchCookIslandsRouteForecast, parseAsUtcWallClock, defaultDepartureTime } from '../services/cookIslandsRouteForecastService';
import {
  MAX_SCENARIOS,
  createScenario,
  duplicateScenario,
  findBetterDeparture,
  runAllScenarios,
  runScenario,
  isRouteResultStale,
  isScenarioSuperseded,
} from '../services/cookIslandsScenarioService';
import { fetchCookIslandsImpactLatest, fetchCookIslandsImpactAssets, fetchCookIslandsImpactDistricts, fetchCookIslandsImpactDistrictsGeojson, fetchCookIslandsDistrictBoundaries, buildFullDistrictChoropleth, fetchCookIslandsMhwsContour, mhwsFloodFeatureCollection, mhwsBlockIndexFromScenario } from '../services/cookIslandsImpactService';
import { exportCookIslandsScenarioComparisonPdf } from '../utils/CookIslandsScenarioComparisonPdf';
import { findNearestIndex, nextWindowRange } from '../components/InundationWindowControl';
import { useCookIslandsHarbourWaveConditions } from '../hooks/useCookIslandsHarbourWaveConditions';
import { useHarbourUnloadingLimits } from '../hooks/useHarbourUnloadingLimits';
import { buildHarbourAdvisoryBundle } from '../reports/harbourAdvisoryBundle';
import { useForecastUpdatedAt } from '../hooks/useForecastUpdatedAt';
import { buildHarbourOutlookFeatures } from '../lib/harbourOutlookLayer';
import { findIslandZoomTarget } from '../config/islandConfig';
import { COOK_ISLANDS_PRESET_ROUTES, presetRouteBounds, shouldConfirmRouteReplacement } from '../config/cookIslandsPresetRoutes';
import { createAppShareUrl, readAppShareState } from '../domain/share/appStateSnapshot';
import { defaultSliderIndex } from '../utils/forecastTime';
import { IMPACT_ENABLED } from '../config/featureFlags';

const widgetContainerStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100vw',
  height: 'calc(100dvh - 0px)',
  zIndex: 9999,
};

function CookIslandsForecast() {
  const inundationThresholds = useInundationThresholds();
  const [sharedState] = useState(() => readAppShareState());

  // ── layer / variable selection ───────────────────────────────────────────
  const ALL_LAYERS = useMemo(() => MAP_LAYERS, []);
  const sharedLayer = sharedState?.forecast?.layer;
  const initialLayer = ALL_LAYERS.some((layer) => layer.value === sharedLayer)
    ? sharedLayer
    : (ALL_LAYERS[0]?.value ?? '');
  const [selectedWaveForecast, setSelectedWaveForecast] = useState(initialLayer);
  const [wmsOpacity, setWmsOpacity] = useState(sharedState?.forecast?.opacity ?? 1.0);
  const [activeLayers, setActiveLayers] = useState({
    waveForecast: true,
    riskPoints: sharedState?.filters?.riskPoints !== false,
    impactDistricts: sharedState?.filters?.impactDistricts !== false,
    mhwsContour: true,
    // Off by default: the +15/+20 cm lines sit ~1-3 m from the working mark on the ground, so at
    // most zooms they merge into one line. The table compares the areas; turn on to see them.
    mhwsAltContours: false,
    mhwsFlood: true,
    harbourPoints: true,
  });
  const [sliderIndex, setSliderIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeedMs, setPlaySpeedMs] = useState(sharedState?.preferences?.playSpeedMs ?? 700);
  const [rangeWindow, setRangeWindow] = useState({ mode: 'single' });
  const pendingSharedTimeRef = useRef(sharedState?.forecast?.time ?? null);
  const pendingSharedRangeRef = useRef(sharedState?.forecast?.rangeWindow ?? null);
  // The layer id the default ("now") slider position was last applied for; see the effect that resolves it.
  const defaultTimeLayerRef = useRef(null);
  // App-wide display zone for every date/time readout (CKT = Pacific/Rarotonga,
  // fixed UTC-10 year-round, or UTC) — lifted here (rather than living inside
  // ForecastApp, which owned it before) so ModernHeader and the BottomOffCanvas
  // panels can respect the same toggle as the timeline.
  const [timeDisplayZone, setTimeDisplayZone] = useState(
    sharedState?.preferences?.timeDisplayZone ?? 'Pacific/Rarotonga'
  );
  const [terrainEnabled, setTerrainEnabled] = useState(sharedState?.filters?.terrainEnabled ?? false);
  const [floodDisplayMode, setFloodDisplayMode] = useState(sharedState?.filters?.floodDisplayMode ?? '2d');
  const [flood3dElevScale, setFlood3dElevScale] = useState(
    sharedState?.filters?.flood3dElevScale ?? FLOOD_3D_CONFIG.elevationScale ?? 6
  );
  // 'bands' | 'continuous' — lets the inundation layer render as a smooth
  // depth gradient (default, matching the wave/period forecast layers) or
  // the user's edited hazard bands, switchable from the threshold editor.
  const [inundationRenderMode, setInundationRenderMode] = useState(
    sharedState?.filters?.inundationRenderMode ?? 'continuous'
  );
  const [vesselClass, setVesselClass] = useState(
    sharedState?.filters?.vesselClass ?? 'traditional_craft'
  );
  // 'preset' | 'custom' -- Custom lets the user drag the wind/wave hazard
  // thresholds away from the selected vessel's preset. customEnvelopesByVessel
  // is keyed by vessel class (not a single shared object) so switching, say,
  // Larger vessels → Traditional craft can never carry the former's far more
  // permissive limits onto the latter; customEnvelope below is whichever
  // vessel is currently selected's own overrides (null until that vessel's
  // Custom mode has actually been touched). Saved profiles are kept separately
  // so slider edits can preview live on the map before the user persists them.
  const [suitabilityMode, setSuitabilityMode] = useState(
    sharedState?.filters?.suitabilityMode ?? 'preset'
  );
  const [savedCustomEnvelopesByVessel, setSavedCustomEnvelopesByVessel] = useState(
    () => loadCustomEnvelopeProfiles()
  );
  const [customEnvelopesByVessel, setCustomEnvelopesByVessel] = useState(
    () => sharedState?.filters?.customEnvelope
      ? updateCustomEnvelopeForVessel(
          savedCustomEnvelopesByVessel,
          vesselClass,
          sharedState.filters.customEnvelope
        )
      : savedCustomEnvelopesByVessel
  );
  const customEnvelope = getCustomEnvelopeForVessel(customEnvelopesByVessel, vesselClass);
  const savedCustomEnvelope = getCustomEnvelopeForVessel(savedCustomEnvelopesByVessel, vesselClass);
  const customEnvelopeIsDirty = !customEnvelopesEqual(customEnvelope, savedCustomEnvelope);
  // A shared link's envelope is applied to the live profile only, so it shows
  // as unsaved -- but Save would then replace the recipient's own saved ranges
  // for that vessel. Remember which vessel came from the link so the panel can
  // say so, and clear it once the user saves.
  const [sharedEnvelopeVessel, setSharedEnvelopeVessel] = useState(
    () => (sharedState?.filters?.customEnvelope ? (sharedState.filters.vesselClass ?? 'traditional_craft') : null)
  );
  const customEnvelopeFromShare = customEnvelopeIsDirty && sharedEnvelopeVessel === vesselClass;
  // Route forecasts are classified server-side against the vessel preset, so
  // when the map is showing edited thresholds the route panel/PDF must say
  // the two differ. Null whenever the map is on the preset.
  const mapCustomEnvelope = suitabilityMode === 'custom' && envelopeDiffersFromPreset(vesselClass, customEnvelope)
    ? customEnvelope
    : null;
  const setCustomEnvelope = useCallback((update) => {
    setCustomEnvelopesByVessel((profiles) => updateCustomEnvelopeForVessel(profiles, vesselClass, update));
  }, [vesselClass]);
  const saveCustomEnvelope = useCallback(() => {
    const nextSavedProfiles = updateCustomEnvelopeForVessel(
      savedCustomEnvelopesByVessel,
      vesselClass,
      customEnvelope
    );
    const saved = saveCustomEnvelopeProfiles(nextSavedProfiles);
    if (saved) {
      setSavedCustomEnvelopesByVessel(nextSavedProfiles);
      setSharedEnvelopeVessel(null);
    }
    return saved;
  }, [customEnvelope, savedCustomEnvelopesByVessel, vesselClass]);

  // ── route forecast ───────────────────────────────────────────────────────
  const [routePoints, setRoutePoints] = useState(sharedState?.route?.points ?? []);
  const [routePickMode, setRoutePickMode] = useState(false);
  const [routeSpeedKt, setRouteSpeedKt] = useState(sharedState?.route?.speedKt ?? 8);
  // Always a UTC-wall-clock string (no zone designator) -- see
  // cookIslandsRouteForecastService.js's parseAsUtcWallClock and
  // CookIslandsRouteControls.jsx's own header comment for why.
  const [routeDepartureTime, setRouteDepartureTime] = useState(sharedState?.route?.departureTime ?? '');
  const [routeForecastResult, setRouteForecastResult] = useState(null);
  // What the midpoint wave chart is pointing at, drawn on the map: {midpoint:{lon,lat}, vessel:{lon,lat,label}|null}.
  const [routeProbe, setRouteProbe] = useState(null);
  // Snapshot of exactly what routeForecastResult was actually run against
  // (routePoints/vessel/speedKt/departureTime/modelRunStartAtRun) -- kept
  // separate from routeForecastResult itself (the raw backend response
  // shape other code already depends on) rather than folded into it.
  // Compared against the live route/vessel/speed/departure below so the
  // route PDF/panel can warn when the result on screen no longer describes
  // the current plan, the same protection isScenarioRouteStale/
  // isScenarioSuperseded already give saved comparison Scenarios but this
  // single plain result previously had none of.
  const [routeForecastResultInputs, setRouteForecastResultInputs] = useState(null);
  const [routeForecastLoading, setRouteForecastLoading] = useState(false);
  const [routeForecastError, setRouteForecastError] = useState('');
  // Named-route identity, set only by loading a preset crossing (see
  // handleLoadPresetRoute below) -- carried into the route-forecast request
  // (start_label/destination_label) so results and PDFs can say "Pukapuka to
  // Nassau" instead of being generic. Cleared by any hand-edit of the route
  // (handleRoutePointPick/handleUndoRoutePoint/handleClearRoute), since at
  // that point the route no longer IS the named crossing.
  const [activePresetRouteId, setActivePresetRouteId] = useState(null);
  const [routeStartLabel, setRouteStartLabel] = useState(null);
  const [routeDestinationLabel, setRouteDestinationLabel] = useState(null);

  // Scenario comparison: saved snapshots of route/vessel/speed/departure,
  // each independently run against /cok/suitability/route and kept
  // side-by-side, unlike routeForecastResult above which is a single slot
  // that gets clobbered on every new run.
  const [scenarios, setScenarios] = useState([]);
  const [runningScenarioIds, setRunningScenarioIds] = useState([]);
  // Set to the scenario's id right after "Confirm & compare" creates it, so
  // CookIslandsScenarioComparisonPanel can scroll to and briefly highlight
  // that specific card -- the confirm button lives in the route-forecast
  // results panel (BottomOffCanvas), a different part of the screen than
  // where its result appears (ForecastApp's suitability tools).
  const [confirmedScenarioId, setConfirmedScenarioId] = useState(null);

  // "Suggest a better vessel" is computed client-side inline in
  // CookIslandsRouteForecastPanel (pure, no fetch -- see
  // handleConfirmVesselSuggestion below for its one-call confirm step).
  // "Suggest a better departure" makes several real backend calls, so its
  // progress/result live here alongside the other routeForecast* state it
  // parallels.
  const [departureSuggestionLoading, setDepartureSuggestionLoading] = useState(false);
  const [departureSuggestionProgress, setDepartureSuggestionProgress] = useState(null);
  const [departureSuggestionResult, setDepartureSuggestionResult] = useState(null);
  const [departureSuggestionError, setDepartureSuggestionError] = useState('');

  // A stale suggestion must not be applyable/exportable against inputs it no
  // longer describes -- clear it whenever any of those inputs change, or a
  // fresh route forecast is run.
  const clearRouteSuggestions = useCallback(() => {
    setDepartureSuggestionResult(null);
    setDepartureSuggestionError('');
  }, []);
  useEffect(() => {
    clearRouteSuggestions();
  }, [routePoints, vesselClass, routeSpeedKt, routeDepartureTime, clearRouteSuggestions]);

  // Clears the loaded-preset identity: once the user hand-edits a route
  // (adds, undoes, or clears a point), it is no longer exactly the named
  // crossing a preset loaded, so the result/PDF must stop claiming it is.
  const clearActivePresetIdentity = useCallback(() => {
    setActivePresetRouteId(null);
    setRouteStartLabel(null);
    setRouteDestinationLabel(null);
  }, []);

  const handleRoutePointPick = useCallback((lng, lat) => {
    setRoutePoints((prev) => [...prev, { lon: lng, lat }]);
    clearActivePresetIdentity();
  }, [clearActivePresetIdentity]);

  const handleUndoRoutePoint = useCallback(() => {
    setRoutePoints((prev) => prev.slice(0, -1));
    clearActivePresetIdentity();
  }, [clearActivePresetIdentity]);

  const handleClearRoute = useCallback(() => {
    setRoutePoints([]);
    setRouteForecastResult(null);
    setRouteForecastError('');
    clearActivePresetIdentity();
  }, [clearActivePresetIdentity]);

  // ── canvas visibility ────────────────────────────────────────────────────
  const [showBottomCanvas, setShowBottomCanvas] = useState(false);
  const [bottomCanvasData, setBottomCanvasData] = useState(null);
  const [showBuoyCanvas, setShowBuoyCanvas] = useState(false);

  // ── RiskScape impact assets (per-building/per-road map layer) ────────────
  // Declared here (ahead of the fetch effect further down, which needs
  // fetchCookIslandsImpactAssets in scope alongside loadImpact) only because
  // useZarrMap below reads impactAssets/impactsVisible/
  // impactSelectedScenario as call arguments -- hooks can't reference state
  // declared later in the component. See the fetch effect near loadImpact
  // for what actually populates these.
  const [impactsVisible, setImpactsVisible] = useState(false);
  const [impactSelectedScenario, setImpactSelectedScenario] = useState(
    sharedState?.filters?.impactScenario ?? null
  );
  const [activeBasemapId, setActiveBasemapId] = useState(
    sharedState?.map?.basemap ?? DEFAULT_BASEMAP_ID
  );
  const [impactAssets, setImpactAssets] = useState({ loading: false, error: null, geojson: null });
  // ── RiskScape impact by census district (table only, no map layer) ───────
  // Same lazy-once-visible fetch pattern as impactAssets above -- see the
  // fetch effect near loadImpact.
  const [impactDistricts, setImpactDistricts] = useState({ loading: false, error: null, districts: null });
  // The map-layer counterpart of impactDistricts above -- same underlying
  // rows, but the /geojson endpoint (polygon geometry attached) instead of
  // the numbers-only one the table uses. Kept as its own fetch/state rather
  // than reusing impactDistricts: different endpoint, different shape, and
  // a table-only view (e.g. a session that never opens the map's districts
  // layer) shouldn't need to pull polygon geometry it'll never render.
  const [impactDistrictsGeojson, setImpactDistrictsGeojson] = useState({ loading: false, error: null, geojson: null });
  const impactSurfaceVisible = impactsVisible || Boolean(showBottomCanvas && bottomCanvasData?.mode === 'impact');
  // Harbour unloading outlook: one fetch shared by the Forecast map's harbour badges and the Harbour
  // Wave Conditions panel (which used to fetch on its own), and one limits state, so a draft limit typed
  // in the panel recolours the map at once. Fetched while the Forecast tab is up (where the badges show).
  const harbourOutlookEnabled = !impactsVisible;
  const harbourConditions = useCookIslandsHarbourWaveConditions(harbourOutlookEnabled);
  const harbourLimits = useHarbourUnloadingLimits(harbourOutlookEnabled);
  const harbourUpdatedAt = useForecastUpdatedAt(harbourOutlookEnabled ? undefined : null);
  const harbourBundle = useMemo(() => buildHarbourAdvisoryBundle({
    rows: harbourConditions.rows,
    suitabilityRunStart: harbourConditions.suitabilityRunStart,
    updatedAt: harbourUpdatedAt,
    limits: harbourLimits.active,
    limitsUnavailable: harbourLimits.published.state === 'unavailable' || harbourLimits.published.state === 'invalid',
    timeDisplayZone,
    generatedAt: new Date(),
  }), [harbourConditions.rows, harbourConditions.suitabilityRunStart, harbourUpdatedAt, harbourLimits.active, harbourLimits.published.state, timeDisplayZone]);
  const harbourOutlookGeojson = useMemo(() => buildHarbourOutlookFeatures(harbourBundle), [harbourBundle]);
  // The impact window on screen -> the hazard block (same cycle, same window) RiskScape read, so the
  // map's depth layer is exactly what the impact figures were computed from. Only while an impact
  // surface is showing; elsewhere the inundation layer keeps its own time controls.
  const [impactHazardSelection, setImpactHazardSelection] = useState(null); // { cycleId, block, window }
  const [hazardBlockStatus, setHazardBlockStatus] = useState(null);
  // Only while the map's range IS that impact window: the block is one fixed 3-day maximum, so drawing
  // it over a "Timestep", "48 h" or a different custom range silently replaced what the user picked
  // (the slider moved, the map did not). Any other range falls through to the normal time controls.
  const hazardBlock = useMemo(
    () => selectHazardBlock(impactHazardSelection, rangeWindow, impactSurfaceVisible),
    [impactSurfaceVisible, impactHazardSelection, rangeWindow],
  );
  // MHWS reference layers: the static routine-tide zone, and the latest
  // "flooded above MHWS" result reported up by the Impacts tab (so the map
  // always matches the figure and depth threshold shown there).
  const [mhwsContour, setMhwsContour] = useState({ loading: false, error: null, geojson: null });
  const [mhwsResult, setMhwsResult] = useState(null);
  const mhwsFloodGeojson = useMemo(() => mhwsFloodFeatureCollection(mhwsResult), [mhwsResult]);

  // Mutual exclusion: only one panel open at a time
  useEffect(() => { if (showBottomCanvas) setShowBuoyCanvas(false); }, [showBottomCanvas]);
  useEffect(() => { if (showBuoyCanvas) setShowBottomCanvas(false); }, [showBuoyCanvas]);

  // ── thresholds → zarr overlay thresholds ────────────────────────────────
  const zarrThresholds = useMemo(() => {
    const cats = inundationThresholds.lastValidCategories;
    if (!Array.isArray(cats) || cats.length === 0) return null;
    return cats
      .filter((c) => Number.isFinite(c?.thresholdM))
      .sort((a, b) => a.thresholdM - b.thresholdM)
      .map((c) => ({ value: c.thresholdM, color: hexToRgb(c.color) }));
  }, [inundationThresholds.lastValidCategories]);

  // ── main map + overlay hook ──────────────────────────────────────────────
  const {
    mapRef,
    mapInstance,
    timeCount,
    currentSliderDate,
    capTime,
    loading,
    error: overlayError,
    overlayStats,
    fitBounds,
    setBasemap,
    removePinMarker,
    setShowContours,
    refreshRiskMarkerColors,
    flyToImpactAsset,
  } = useZarrMap({
    selectedLayerId: selectedWaveForecast,
    sliderIndex,
    setSliderIndex,
    isPlaying,
    setIsPlaying,
    playSpeedMs,
    opacity: wmsOpacity,
    thresholds: zarrThresholds,
    riskEnabled: activeLayers?.riskPoints !== false,
    setBottomCanvasData,
    setShowBottomCanvas,
    inundationCategories: inundationThresholds.lastValidCategories,
    minVisibleDepth: inundationThresholds.minVisibleDepth,
    inundationRenderMode,
    rangeWindow,
    hazardBlock,
    onHazardBlockStatus: setHazardBlockStatus,
    terrainEnabled,
    terrainConfig: MAP_TERRAIN_CONFIG,
    flood3dEnabled: floodDisplayMode === '3d',
    flood3dConfig: FLOOD_3D_CONFIG,
    flood3dElevScale,
    vesselClass,
    suitabilityMode,
    customEnvelope,
    routePickMode,
    onRoutePointPick: handleRoutePointPick,
    routePoints,
    routeForecastResult,
    routeProbe,
    impactAssetsGeojson: impactAssets.geojson,
    impactAssetsVisible: impactSurfaceVisible,
    impactAssetsScenario: impactSelectedScenario,
    impactExposedHighlight: activeLayers?.impactExposed === true,
    impactDistrictsGeojson: impactDistrictsGeojson.geojson,
    impactDistrictsVisible: impactSurfaceVisible && activeLayers?.impactDistricts !== false,
    impactDistrictsScenario: impactSelectedScenario,
    mhwsContourGeojson: mhwsContour.geojson,
    mhwsContourVisible: impactSurfaceVisible && activeLayers?.mhwsContour !== false,
    mhwsAltContourVisible: impactSurfaceVisible && activeLayers?.mhwsAltContours !== false,
    mhwsFloodGeojson,
    mhwsFloodVisible: impactSurfaceVisible && activeLayers?.mhwsFlood !== false,
    initialMapView: sharedState?.map ?? null,
    initialBasemapId: activeBasemapId,
    harbourOutlookGeojson,
    harbourOutlookBundle: harbourBundle,
    harbourOutlookVisible: harbourOutlookEnabled && activeLayers?.harbourPoints !== false,
  });

  // Pre-fills "Plan route" with one of the standing inter-island crossings
  // (see cookIslandsPresetRoutes.js) instead of the user drawing it
  // point-by-point. Guards against silently discarding hand-drawn work
  // (shouldConfirmRouteReplacement), frames the map on the loaded route
  // (fitBounds -- route points alone don't move the camera), and closes a
  // stale route-forecast result sheet rather than leaving it on screen
  // marked stale. Still needs the user's own "Run forecast" click: firing
  // that off automatically here would run against routePoints/vesselClass
  // this same render's setState calls haven't actually applied yet (state
  // updates are async), not the values just set.
  const handleLoadPresetRoute = useCallback((routeId) => {
    const preset = COOK_ISLANDS_PRESET_ROUTES.find((r) => r.id === routeId);
    if (!preset) return;
    if (shouldConfirmRouteReplacement({ existingPointCount: routePoints.length, activePresetRouteId })) {
      const proceed = window.confirm(`Replace your current route with the ${preset.label} preset?`);
      if (!proceed) return;
    }
    setRoutePoints(preset.points.map((p) => ({ ...p })));
    setVesselClass(preset.vessel);
    setRouteSpeedKt(preset.defaultSpeedKt);
    setActivePresetRouteId(preset.id);
    setRouteStartLabel(preset.start);
    setRouteDestinationLabel(preset.destination);
    setRoutePickMode(false);
    setRouteForecastResult(null);
    setRouteForecastError('');
    if (showBottomCanvas && bottomCanvasData?.mode === 'route-forecast') {
      setShowBottomCanvas(false);
    }
    fitBounds?.(presetRouteBounds(preset), { padding: 60 });
  }, [routePoints.length, activePresetRouteId, showBottomCanvas, bottomCanvasData, fitBounds]);

  // Whether the currently-shown route result/PDF still describes the live
  // plan -- see routeForecastResultInputs' own comment. Recomputed on every
  // render (cheap: a handful of field comparisons), not memoized, since
  // memoizing correctly would need the exact same dependency list anyway.
  const routeResultStale = isRouteResultStale(routeForecastResultInputs, {
    routePoints, vessel: vesselClass, speedKt: routeSpeedKt, departureTime: routeDepartureTime,
  });
  const routeResultSuperseded = isScenarioSuperseded(
    routeForecastResultInputs ? { status: 'ready', modelRunStartAtRun: routeForecastResultInputs.modelRunStartAtRun } : null,
    capTime.modelRunStart,
  );

  const totalSteps = Math.max(1, timeCount) - 1;

  const handleBasemapChange = useCallback((basemapId) => {
    setActiveBasemapId(basemapId);
    setBasemap(basemapId);
  }, [setBasemap]);

  // Shared links store timestamps rather than slider indices because each new
  // forecast cycle can have a different number of steps. Resolve the shared
  // time and any inundation range only after metadata for the selected layer
  // is confirmed to be current.
  useEffect(() => {
    const timestamps = capTime.availableTimestamps;
    if (capTime.layerId !== selectedWaveForecast || !timestamps?.length) return;

    if (pendingSharedTimeRef.current) {
      setSliderIndex(findNearestIndex(timestamps, pendingSharedTimeRef.current));
      pendingSharedTimeRef.current = null;
      defaultTimeLayerRef.current = selectedWaveForecast; // a shared link's time wins; don't override it
    } else if (selectedWaveForecast !== 'sfincs-inundation' && defaultTimeLayerRef.current !== selectedWaveForecast) {
      // Open the forecast on the hour we are in, once per layer (the layer switch itself resets the
      // slider to 0, so this re-applies on every switch but never fights a user's own scrubbing),
      // and skip the Cook suitability layer's frozen hindcast frames. The inundation layer keeps its
      // own range-window behaviour.
      setSliderIndex(defaultSliderIndex(timestamps, { modelRunStart: capTime.modelRunStart }));
      defaultTimeLayerRef.current = selectedWaveForecast;
    }

    const pendingRange = pendingSharedRangeRef.current;
    if (!pendingRange) return;
    if (pendingRange.mode === 'rolling-48h') {
      // A shared "Next 48h Max" means the next 48 h for whoever opens the link, from their now.
      const next = nextWindowRange(timestamps);
      if (next) setRangeWindow(next);
    } else if (pendingRange.mode === 'custom' && pendingRange.startTime && pendingRange.endTime) {
      const startIndex = findNearestIndex(timestamps, pendingRange.startTime);
      const endIndex = findNearestIndex(timestamps, pendingRange.endTime);
      if (startIndex < endIndex) {
        setRangeWindow({
          mode: 'custom',
          startIndex,
          endIndex,
          startTime: timestamps[startIndex],
          endTime: timestamps[endIndex],
        });
      }
    }
    pendingSharedRangeRef.current = null;
  }, [capTime.availableTimestamps, capTime.layerId, capTime.modelRunStart, selectedWaveForecast]);

  // Bounds for the route departure-time picker: the currently active wave-
  // forecast layer's own first/last timestep, so a route can never be asked
  // to depart outside the window this app actually has data for. Shared by
  // CookIslandsRouteControls' min/max and the run-forecast clamp below, so
  // both always agree on the same boundary.
  const forecastEndTime = useMemo(
    () => capTime.availableTimestamps?.[capTime.availableTimestamps.length - 1] ?? null,
    [capTime.availableTimestamps]
  );
  const forecastStartTime = useMemo(
    () => capTime.availableTimestamps?.[0] ?? null,
    [capTime.availableTimestamps]
  );

  // Seed the departure picker the first time a forecast window is available, rather than
  // leaving it blank: the next whole hour from now (clamped to the window) -- NOT the
  // slider's initial time, which is the window's first timestamp and so in the past.
  // Falls back to the slider time when there is no usable window. Only ever seeds an
  // empty picker; a time the user (or a preset/suggestion) chose is left alone.
  useEffect(() => {
    if (routeDepartureTime) return;
    const seeded = defaultDepartureTime({ windowStart: forecastStartTime, windowEnd: forecastEndTime })
      ?? (currentSliderDate ? currentSliderDate.toISOString().slice(0, 16) : null);
    if (seeded) setRouteDepartureTime(seeded);
  }, [currentSliderDate, routeDepartureTime, forecastStartTime, forecastEndTime]);

  const handleRunRouteForecast = useCallback(async () => {
    let departureTime = routeDepartureTime || currentSliderDate?.toISOString?.();
    // Belt-and-braces: CookIslandsRouteControls constrains and clamps the
    // date picker itself, but a departure time can still reach here stale
    // (e.g. set before a layer switch shortened the forecast window) --
    // never send the backend a departure beyond the data we actually have.
    if (departureTime && forecastEndTime && parseAsUtcWallClock(departureTime)?.getTime() > forecastEndTime.getTime()) {
      departureTime = forecastEndTime.toISOString();
    }
    if (departureTime && forecastStartTime && parseAsUtcWallClock(departureTime)?.getTime() < forecastStartTime.getTime()) {
      departureTime = forecastStartTime.toISOString();
    }

    setRouteForecastLoading(true);
    setRouteForecastError('');
    setBottomCanvasData({ mode: 'route-forecast', loading: true, vessel: vesselClass, speedKt: routeSpeedKt });
    setShowBottomCanvas(true);
    try {
      const result = await fetchCookIslandsRouteForecast({
        routePoints,
        vessel: vesselClass,
        departureTime,
        speedKt: routeSpeedKt,
        startLabel: routeStartLabel,
        destinationLabel: routeDestinationLabel,
      });
      setRouteForecastResult(result);
      setRouteForecastResultInputs({
        routePoints, vessel: vesselClass, speedKt: routeSpeedKt, departureTime,
        modelRunStartAtRun: capTime.modelRunStart,
      });
      setBottomCanvasData({ mode: 'route-forecast', result, vessel: vesselClass, speedKt: routeSpeedKt });
    } catch (err) {
      setRouteForecastError(err.message);
      setBottomCanvasData({ mode: 'route-forecast', error: err.message, vessel: vesselClass, speedKt: routeSpeedKt, onRetry: handleRunRouteForecast });
    } finally {
      setRouteForecastLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePoints, vesselClass, routeSpeedKt, routeDepartureTime, currentSliderDate, forecastEndTime, forecastStartTime, capTime.modelRunStart, routeStartLabel, routeDestinationLabel]);

  // ── Scenario comparison ──────────────────────────────────────────────────
  const handleSaveCurrentAsScenario = useCallback(() => {
    setScenarios((prev) => {
      if (prev.length >= MAX_SCENARIOS || routePoints.length < 2) return prev;
      const departureTime = routeDepartureTime || currentSliderDate?.toISOString?.() || '';
      return [...prev, createScenario({
        vessel: vesselClass,
        routePoints,
        departureTime,
        speedKt: routeSpeedKt,
        existingScenarios: prev,
      })];
    });
  }, [currentSliderDate, routeDepartureTime, routePoints, routeSpeedKt, vesselClass]);

  const handleDuplicateScenario = useCallback((scenarioId) => {
    setScenarios((prev) => {
      if (prev.length >= MAX_SCENARIOS) return prev;
      const original = prev.find((s) => s.id === scenarioId);
      if (!original) return prev;
      return [...prev, duplicateScenario(original, {}, prev)];
    });
  }, []);

  const handleRemoveScenario = useCallback((scenarioId) => {
    setScenarios((prev) => prev.filter((s) => s.id !== scenarioId));
    setRunningScenarioIds((prev) => prev.filter((id) => id !== scenarioId));
  }, []);

  const handleRunScenario = useCallback(async (scenarioId) => {
    const target = scenarios.find((s) => s.id === scenarioId);
    if (!target) return;
    setRunningScenarioIds((prev) => (prev.includes(scenarioId) ? prev : [...prev, scenarioId]));
    setScenarios((prev) => prev.map((s) => (s.id === scenarioId ? { ...s, status: 'running' } : s)));
    const updated = await runScenario(target, { modelRunStart: capTime.modelRunStart });
    setScenarios((prev) => prev.map((s) => (s.id === scenarioId ? updated : s)));
    setRunningScenarioIds((prev) => prev.filter((id) => id !== scenarioId));
  }, [scenarios, capTime.modelRunStart]);

  const handleRunAllScenarios = useCallback(async () => {
    if (!scenarios.length) return;
    const ids = scenarios.map((s) => s.id);
    setRunningScenarioIds(ids);
    setScenarios((prev) => prev.map((s) => (ids.includes(s.id) ? { ...s, status: 'running' } : s)));
    await runAllScenarios(scenarios, {
      modelRunStart: capTime.modelRunStart,
      onScenarioSettled: (updated) => {
        setScenarios((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        setRunningScenarioIds((prev) => prev.filter((id) => id !== updated.id));
      },
    });
  }, [scenarios, capTime.modelRunStart]);

  // config here is already the fully-built object from
  // cookIslandsScenarioService.js's buildScenarioComparisonBriefConfig
  // (CookIslandsScenarioComparisonPanel.jsx builds it itself before calling
  // this, since it's the one that knows which scenarios are ready and who's
  // recommended) -- this handler only supplies what that pure-data config
  // doesn't carry (timeDisplayZone) and calls the actual exporter. Errors
  // are left to the panel's own handleExportComparisonBrief, which already
  // catches and logs them around this call.
  const handleExportScenarioComparisonBrief = useCallback((config) => (
    exportCookIslandsScenarioComparisonPdf(config, { timeDisplayZone })
  ), [timeDisplayZone]);

  // ── Route-forecast suggestions ───────────────────────────────────────────
  // "Suggest a better vessel"'s initial estimate is computed inline in
  // CookIslandsRouteForecastPanel (pure, no fetch). This "Confirm & compare"
  // step is its only network call: exactly one real
  // fetchCookIslandsRouteForecast (via the existing runScenario), which
  // becomes a normal comparable scenario -- no bespoke fetch logic needed.
  const handleConfirmVesselSuggestion = useCallback(async (vesselCode) => {
    if (!vesselCode || scenarios.length >= MAX_SCENARIOS) return;
    const departureTime = routeForecastResult?.departure_time || routeDepartureTime || currentSliderDate?.toISOString?.() || '';
    const draft = createScenario({
      vessel: vesselCode, routePoints, departureTime, speedKt: routeSpeedKt, existingScenarios: scenarios,
    });
    setScenarios((prev) => [...prev, draft]);
    setRunningScenarioIds((prev) => [...prev, draft.id]);
    const updated = await runScenario(draft, { modelRunStart: capTime.modelRunStart });
    setScenarios((prev) => prev.map((s) => (s.id === draft.id ? updated : s)));
    setRunningScenarioIds((prev) => prev.filter((id) => id !== draft.id));
    setConfirmedScenarioId(updated.id);
    return updated;
  }, [scenarios, routeForecastResult, routeDepartureTime, currentSliderDate, routePoints, routeSpeedKt, capTime.modelRunStart]);

  const handleSuggestBetterDeparture = useCallback(async () => {
    if (!routeForecastResult || departureSuggestionLoading) return;
    setDepartureSuggestionLoading(true);
    setDepartureSuggestionError('');
    setDepartureSuggestionResult(null);
    setDepartureSuggestionProgress(null);
    try {
      const result = await findBetterDeparture({
        routePoints,
        vessel: vesselClass,
        departureTime: routeForecastResult.departure_time,
        speedKt: routeSpeedKt,
        maxDepartureTime: forecastEndTime,
      }, { onProgress: setDepartureSuggestionProgress });
      setDepartureSuggestionResult(result.found ? result : null);
      if (!result.found) {
        setDepartureSuggestionError(
          result.checkedOffsets.length === 0
            ? 'Already at the end of the available forecast -- no later departure times to check.'
            : result.skippedOffsets.length > 0
              ? `No better departure window found in the next ${Math.max(...result.checkedOffsets)}h (the forecast ends before later options could be checked).`
              : 'No better departure window found in the next 24 hours.'
        );
      }
    } catch (err) {
      console.error('[Home] Departure suggestion failed:', err);
      setDepartureSuggestionError(err.message || 'Could not check alternative departure times.');
    } finally {
      setDepartureSuggestionLoading(false);
      setDepartureSuggestionProgress(null);
    }
  }, [routeForecastResult, departureSuggestionLoading, routePoints, vesselClass, routeSpeedKt, forecastEndTime]);

  // Applies an already-fetched suggestion directly -- no redundant re-fetch,
  // we already have the real result from findBetterDeparture. Setting
  // routeDepartureTime triggers the clearRouteSuggestions effect above,
  // which is fine: departureTime/result are already captured locally here.
  const handleApplyDepartureSuggestion = useCallback(() => {
    if (!departureSuggestionResult) return;
    const { departureTime, result } = departureSuggestionResult;
    setRouteDepartureTime(departureTime.slice(0, 16));
    setRouteForecastResult(result);
    setRouteForecastResultInputs({
      routePoints, vessel: vesselClass, speedKt: routeSpeedKt, departureTime,
      modelRunStartAtRun: capTime.modelRunStart,
    });
    setBottomCanvasData({ mode: 'route-forecast', result, vessel: vesselClass, speedKt: routeSpeedKt });
    setShowBottomCanvas(true);
  }, [departureSuggestionResult, vesselClass, routeSpeedKt, routePoints, capTime.modelRunStart]);

  // Also skips a redundant re-fetch -- builds a ready scenario directly from
  // the result findBetterDeparture already confirmed.
  const handleSaveDepartureSuggestionAsScenario = useCallback(() => {
    if (!departureSuggestionResult || scenarios.length >= MAX_SCENARIOS) return;
    const { departureTime, result } = departureSuggestionResult;
    const now = new Date().toISOString();
    const draft = createScenario({
      vessel: vesselClass, routePoints, departureTime, speedKt: routeSpeedKt, existingScenarios: scenarios,
    });
    setScenarios((prev) => [...prev, {
      ...draft, status: 'ready', forecastResult: result, updatedAt: now, generatedAt: now, modelRunStartAtRun: capTime.modelRunStart,
    }]);
  }, [departureSuggestionResult, scenarios, vesselClass, routePoints, routeSpeedKt, capTime.modelRunStart]);

  // Impact assessment data — fetched once on mount rather than on-demand from
  // a button click, since desktop's Impacts tab (ForecastApp.jsx) is now a
  // persistent part of the right panel, not something opened after a click.
  // Unlike route forecast, it isn't parameterized by anything the user picks
  // (vessel, departure time, a drawn route) -- "show me the latest RiskScape
  // run's impact estimate" needs no arguments.
  const [impactData, setImpactData] = useState({ loading: true, error: null, result: null });

  const loadImpact = useCallback(async () => {
    // Keep any previously-loaded result visible while a refresh is in
    // flight (spread prev) -- computeModelStatus in impactFormat.js reads
    // "loading with a prior result" as "Updating", not a blank reload.
    setImpactData((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const result = await fetchCookIslandsImpactLatest();
      setImpactData({ loading: false, error: null, result });
      // If the detailed bottom-sheet view is open on stale/loading data,
      // keep it in sync with this same fetch rather than leaving it to
      // silently go stale until the user closes and reopens it.
      setBottomCanvasData((prev) => (prev?.mode === 'impact' ? { mode: 'impact', result } : prev));
    } catch (err) {
      setImpactData({ loading: false, error: err.message, result: null });
      setBottomCanvasData((prev) => (prev?.mode === 'impact' ? { mode: 'impact', error: err.message, onRetry: loadImpact } : prev));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (IMPACT_ENABLED) loadImpact(); }, [loadImpact]);

  // Whether the desktop Inundation & Impacts tab is the one currently on
  // screen (lifted up from ForecastApp.jsx's own rightPanelTab state via
  // onImpactsVisibleChange below) and which forecast window it's showing
  // (from ImpactTabPanel's onScenarioChange -- see that component for why
  // this is deliberately separate from onImpactWindowSelect/
  // handleImpactWindowSelect, which jumps the map/layer/zoom instead) --
  // state declarations live up near showBottomCanvas since useZarrMap above
  // needs them as call arguments.
  const impactAssetsFetchedRef = useRef(false);

  // Fetched lazily (once) the first time the Impacts tab is actually shown,
  // not on mount alongside impactData above -- unlike the block/region
  // summary, this is real per-asset geometry (~1,000 features) that most
  // sessions (map view left on the default Forecast tab) never need.
  useEffect(() => {
    if (!impactSurfaceVisible || impactAssetsFetchedRef.current) return;
    impactAssetsFetchedRef.current = true;
    setImpactAssets((prev) => ({ ...prev, loading: true, error: null }));
    fetchCookIslandsImpactAssets()
      .then((result) => setImpactAssets({ loading: false, error: null, geojson: result }))
      .catch((err) => {
        impactAssetsFetchedRef.current = false; // allow a retry on next tab visit
        setImpactAssets({ loading: false, error: err.message, geojson: null });
      });
  }, [impactSurfaceVisible]);

  // Same lazy-once-visible fetch as impactAssets above, kept as its own ref/
  // request rather than piggybacking on that one -- /latest/districts is a
  // separate, smaller (~40-row) endpoint, and either fetch failing shouldn't
  // block the other from showing.
  const impactDistrictsFetchedRef = useRef(false);
  useEffect(() => {
    if (!impactSurfaceVisible || impactDistrictsFetchedRef.current) return;
    impactDistrictsFetchedRef.current = true;
    setImpactDistricts((prev) => ({ ...prev, loading: true, error: null }));
    fetchCookIslandsImpactDistricts()
      .then((result) => setImpactDistricts({ loading: false, error: null, districts: result }))
      .catch((err) => {
        impactDistrictsFetchedRef.current = false; // allow a retry on next tab visit
        setImpactDistricts({ loading: false, error: err.message, districts: null });
      });
  }, [impactSurfaceVisible]);

  // Same lazy-once-visible fetch again for the geojson (map-layer) variant --
  // plus the full 44-district boundary set, merged in via
  // buildFullDistrictChoropleth so districts the API's inner join left out
  // (most of them -- see that function's own comment) still draw as
  // zero-loss polygons instead of just not existing on the map. The
  // boundary fetch failing (static asset missing/misconfigured) degrades to
  // showing only whatever districts the API itself returned, rather than
  // failing the whole layer.
  const impactDistrictsGeojsonFetchedRef = useRef(false);
  useEffect(() => {
    if (!impactSurfaceVisible || impactDistrictsGeojsonFetchedRef.current) return;
    impactDistrictsGeojsonFetchedRef.current = true;
    setImpactDistrictsGeojson((prev) => ({ ...prev, loading: true, error: null }));
    Promise.all([
      fetchCookIslandsImpactDistrictsGeojson(),
      fetchCookIslandsDistrictBoundaries().catch(() => null),
    ])
      .then(([impact, boundaries]) => {
        const geojson = boundaries
          ? { ...impact, features: buildFullDistrictChoropleth(boundaries, impact.features).features }
          : impact;
        setImpactDistrictsGeojson({ loading: false, error: null, geojson });
      })
      .catch((err) => {
        impactDistrictsGeojsonFetchedRef.current = false; // allow a retry on next tab visit
        setImpactDistrictsGeojson({ loading: false, error: err.message, geojson: null });
      });
  }, [impactSurfaceVisible]);

  // Static MHWS contour line: fetched once, the first time the impact
  // surface is visible and that layer is switched on.
  const mhwsContourFetchedRef = useRef(false);
  const wantMhwsContour = impactSurfaceVisible && (activeLayers?.mhwsContour !== false || activeLayers?.mhwsAltContours !== false);
  useEffect(() => {
    if (!wantMhwsContour || mhwsContourFetchedRef.current) return;
    mhwsContourFetchedRef.current = true;
    setMhwsContour((prev) => ({ ...prev, loading: true, error: null }));
    fetchCookIslandsMhwsContour()
      .then((geojson) => setMhwsContour({ loading: false, error: null, geojson }))
      .catch((err) => {
        mhwsContourFetchedRef.current = false;
        setMhwsContour({ loading: false, error: err.message, geojson: null });
      });
  }, [wantMhwsContour]);

  // "View impact assessment" (mobile) / "Expand"→"View detailed table"
  // (desktop Impacts tab) — opens the full per-window table in the bottom
  // sheet using whatever impactData already has (no extra fetch; loadImpact
  // above keeps it current).
  const handleShowImpactDetail = useCallback(() => {
    // `assets` rides along unfetched/loading if the user opens this before
    // impactAssetsFetchedRef's lazy fetch (triggered by the Impacts tab
    // becoming visible, above) has resolved -- CookIslandsImpactPanel's own
    // category accordion handles that loading/empty state rather than this
    // callback waiting on it.
    setBottomCanvasData({ mode: 'impact', ...impactData, assets: impactAssets, districts: impactDistricts, onRetry: loadImpact });
    setShowBottomCanvas(true);
  }, [impactData, impactAssets, impactDistricts, loadImpact]);

  // "Compare landing areas" — opens the multi-site suitability heatmap in the
  // bottom sheet instead of rendering it inline in the sidebar. The old
  // sidebar placement forced that table's own horizontal scroll inside an
  // already-narrow column; the bottom sheet has the full viewport width to
  // work with, matching how every other detail view (risk/suitability/route/
  // impact) already uses this space rather than the sidebar. vesselClass and
  // currentSliderDate ride along in bottomCanvasData rather than the panel
  // reading them from closure, mirroring how route-forecast/impact already
  // pass their own parameters through this same mode-tagged data object.
  const handleShowLandingAreaComparison = useCallback(() => {
    setBottomCanvasData({ mode: 'landing-area-comparison', vesselClass, currentSliderDate });
    setShowBottomCanvas(true);
  }, [vesselClass, currentSliderDate]);

  // Layer errors are dev/ops signal, not something to alarm the end user with —
  // log to console instead of the "Layer error" banner this used to render.
  useEffect(() => {
    if (overlayError) console.error('[Home] Layer error:', overlayError);
  }, [overlayError]);

  // ── impact-assessment window → map sync ──────────────────────────────────
  // Clicking a date-window row in CookIslandsImpactPanel (the RiskScape impact
  // table) jumps the map to show that window's flood extent: switch to the
  // Rarotonga inundation layer, zoom there, and set the layer's own "Custom
  // Max" range to the row's exact date span.
  //
  // The tricky part: startIndex/endIndex (what SfincsRasterOverlay actually
  // sends the backend -- see updateConfig/_applyRangeMax) must be computed
  // against the INUNDATION layer's own availableTimestamps, not whatever
  // layer happened to be selected when the row was clicked. If a layer switch
  // is needed, capTime.availableTimestamps still reflects the OLD layer for a
  // beat after setSelectedWaveForecast() (useZarrMap's overlay-switch effect
  // deliberately doesn't clear timeLabels early -- see its own comment), so
  // computing indices synchronously in the click handler would silently send
  // the wrong indices to the backend. Deferred via pendingImpactWindowRef,
  // applied by the effect below once capTime.layerId confirms availableTimestamps
  // really belongs to the now-selected layer (not on availableTimestamps'
  // mere non-emptiness -- confirmed live that during the gap between
  // requesting the switch and the new overlay's own metadata landing,
  // availableTimestamps is routinely non-empty but stale, e.g. 181 hourly
  // points ending two days earlier than the real 229-point array, which
  // silently computed a range against the wrong array and consumed the
  // pending window without ever calling setRangeWindow on the right data).
  // Also not tied to a loading-flag true->false *transition* (tried first,
  // also dropped): waiting for an edge is inherently racy -- if the new
  // layer's metadata resolves fast, or was already warm/cached, loading may
  // never actually dip to true and back on this specific switch.
  const pendingImpactWindowRef = useRef(null);
  // The impact window whose figures are on screen, kept so a map range that drifts away from it
  // (manual Custom Max, restored saved range) can be flagged and re-synced.
  const [impactWindowBlock, setImpactWindowBlock] = useState(null);
  const impactWindowRequestedAtRef = useRef(0);
  const IMPACT_WINDOW_PENDING_TIMEOUT_MS = 15000;

  const applyPendingImpactWindow = useCallback(() => {
    const pending = pendingImpactWindowRef.current;
    if (!pending) return;
    if (capTime.layerId !== 'sfincs-inundation') return; // availableTimestamps not confirmed for this layer yet — wait for the next trigger
    const timestamps = capTime.availableTimestamps;
    if (!timestamps?.length) return; // inundation layer metadata not in yet — wait for the next trigger
    if (Date.now() - impactWindowRequestedAtRef.current > IMPACT_WINDOW_PENDING_TIMEOUT_MS) {
      // Gave up waiting (layer switch stalled/failed) — drop it rather than risk
      // applying it against timestamps from a much later, unrelated load.
      pendingImpactWindowRef.current = null;
      return;
    }
    // Prefer the backend's hour-precise block boundaries (real RiskScape
    // window, e.g. issue-hour-aligned start / one-timestep-before-next-block
    // end) over the calendar-day reconstruction below -- the latter is a
    // fallback for cycles whose cycle_id couldn't be parsed server-side
    // (_cok_impact_block_dates returns null window_start/window_end then),
    // and is what let a window's applied range bleed ~19h into the next
    // block's own window.
    const startTime = pending.windowStart
      ? new Date(pending.windowStart)
      : new Date(`${pending.dateStart}T00:00:00Z`);
    const endTime = pending.windowEnd
      ? new Date(pending.windowEnd)
      : new Date(`${pending.dateEnd}T23:59:59.999Z`);
    const startIndex = findNearestIndex(timestamps, startTime);
    const endIndex = findNearestIndex(timestamps, endTime);
    pendingImpactWindowRef.current = null;
    if (startIndex >= endIndex) return;
    setRangeWindow({ mode: 'custom', startIndex, endIndex, startTime, endTime });
  }, [capTime.availableTimestamps, capTime.layerId, setRangeWindow]);

  const impactWindowMismatch = useMemo(
    () => {
      if (selectedWaveForecast !== 'sfincs-inundation') return null;
      const ts = capTime.availableTimestamps;
      const available = ts?.length ? { minMs: new Date(ts[0]).getTime(), maxMs: new Date(ts[ts.length - 1]).getTime() } : null;
      // The depth layer is the impact window's own hazard block: it cannot describe another period.
      if (hazardBlock && hazardBlockStatus?.state === 'ok') return null;
      return describeWindowMismatch(impactWindowBlock, rangeWindow, timeDisplayZone, available);
    },
    [selectedWaveForecast, impactWindowBlock, rangeWindow, timeDisplayZone, capTime.availableTimestamps, hazardBlock, hazardBlockStatus],
  );

  const handleImpactWindowSelect = useCallback((block) => {
    if (!block?.dateStart || !block?.dateEnd) return;
    setImpactWindowBlock(block);
    const hazardIndex = mhwsBlockIndexFromScenario(block.scenario);
    setImpactHazardSelection(block.cycleId && hazardIndex ? {
      cycleId: String(block.cycleId),
      block: hazardIndex,
      window: { windowStart: block.windowStart, windowEnd: block.windowEnd, dateStart: block.dateStart, dateEnd: block.dateEnd },
    } : null);
    pendingImpactWindowRef.current = block;
    impactWindowRequestedAtRef.current = Date.now();

    if (selectedWaveForecast === 'sfincs-inundation') {
      // Already on the right layer — its availableTimestamps are current, apply
      // now, and leave the map's current pan/zoom alone. Re-fitting to the whole
      // island on every window click (this used to run unconditionally, above
      // this branch) fought anyone who'd zoomed into a specific spot to compare
      // one place across windows -- each click yanked them back out to the
      // island-wide view, destroying the exact comparison they were doing.
      applyPendingImpactWindow();
    } else {
      // Switching onto the inundation layer for the first time -- zoom to the
      // island so there's something on screen to look at, since whatever was
      // previously selected/framed is unrelated to this layer's own extent.
      const rarotonga = findIslandZoomTarget('rarotonga');
      if (rarotonga && fitBounds) fitBounds(rarotonga.bounds, { padding: 20, maxZoom: 17 });
      setSelectedWaveForecast('sfincs-inundation');
      // applyPendingImpactWindow() fires from the loading-transition effect
      // below once this new layer's own metadata has actually loaded.
    }
  }, [selectedWaveForecast, fitBounds, applyPendingImpactWindow, setSelectedWaveForecast]);

  // Catches the "just switched layers" case handleImpactWindowSelect defers
  // (the "already on this layer" case applies immediately, synchronously,
  // in handleImpactWindowSelect itself -- this effect is then a no-op the
  // next time it runs, since applyPendingImpactWindow() already cleared
  // pendingImpactWindowRef; and if capTime.layerId hadn't confirmed the
  // layer's own metadata yet even in that "already selected" case, this
  // effect is what actually applies it once capTime.layerId catches up).
  //
  // Keyed on capTime.layerId (not just availableTimestamps, and not a
  // loading-flag true->false *transition*, both tried first and dropped):
  // a loading-flag edge is inherently racy -- if the new layer's metadata
  // resolves fast, or was already warm/cached, loading may never actually
  // dip to true and back on this specific switch, so the edge this used to
  // watch for never fires and the pending window sits in the ref forever,
  // unconsumed (confirmed live: switching to Rarotonga Inundation from
  // another layer zoomed/relabeled correctly, but the flood-extent raster
  // itself never updated to the selected window -- exactly this). Firing on
  // availableTimestamps' mere non-emptiness instead of loading fixed that,
  // but introduced a narrower race of its own: useZarrMap deliberately keeps
  // the OLD layer's availableTimestamps around (non-empty, but stale) for a
  // beat after the switch is requested and before the new overlay's own
  // metadata lands (see timeLabelsLayerId's comment) -- confirmed live via a
  // debug trace: the effect fired against a stale 181-point array while
  // capTime.layerId still lagged, computed indices, and cleared
  // pendingImpactWindowRef before the real 229-point array for the newly
  // selected layer ever arrived, permanently stranding the window. Gating on
  // capTime.layerId === selectedWaveForecast means it doesn't matter whether
  // loading blipped, skipped, overlapped another render, or availableTimestamps
  // looked ready too early -- this only runs once the data is confirmed to
  // actually belong to the layer just selected.
  useEffect(() => {
    if (
      pendingImpactWindowRef.current &&
      selectedWaveForecast === 'sfincs-inundation' &&
      capTime.layerId === 'sfincs-inundation'
    ) {
      applyPendingImpactWindow();
    }
  }, [capTime.availableTimestamps, capTime.layerId, selectedWaveForecast, applyPendingImpactWindow]);

  const handleHideBottomCanvas = useCallback(() => {
    setShowBottomCanvas(false);
    removePinMarker();
  }, [removePinMarker]);

  const handleTimeSelect = useCallback((date) => {
    const timestamps = capTime.availableTimestamps;
    if (!timestamps?.length || !date) return;
    const t = date.getTime();
    let best = 0, bestDiff = Infinity;
    timestamps.forEach((ts, i) => {
      const diff = Math.abs(ts.getTime() - t);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    });
    setSliderIndex(best);
  }, [capTime.availableTimestamps, setSliderIndex]);

  const handleShareView = useCallback(async () => {
    const map = mapInstance.current;
    if (!map) return { ok: false, error: 'The map is still loading.' };

    const center = map.getCenter();
    const bounds = map.getBounds();
    const sharedRangeWindow = rangeWindow?.mode === 'custom'
      ? {
          mode: 'custom',
          startTime: rangeWindow.startTime instanceof Date
            ? rangeWindow.startTime.toISOString()
            : rangeWindow.startTime,
          endTime: rangeWindow.endTime instanceof Date
            ? rangeWindow.endTime.toISOString()
            : rangeWindow.endTime,
        }
      : { mode: rangeWindow?.mode ?? 'single' };

    try {
      const url = createAppShareUrl({
        map: {
          center: [center.lng, center.lat],
          bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
          basemap: activeBasemapId,
        },
        forecast: {
          layer: selectedWaveForecast,
          time: currentSliderDate?.toISOString(),
          opacity: wmsOpacity,
          rangeWindow: sharedRangeWindow,
        },
        filters: {
          riskPoints: activeLayers?.riskPoints !== false,
          inundationRenderMode,
          vesselClass,
          suitabilityMode,
          customEnvelope: suitabilityMode === 'custom' ? customEnvelope : undefined,
          terrainEnabled,
          floodDisplayMode,
          flood3dElevScale,
          impactScenario: impactSelectedScenario ?? undefined,
        },
        route: {
          points: routePoints,
          speedKt: routeSpeedKt,
          departureTime: routeDepartureTime || undefined,
        },
        preferences: { timeDisplayZone, playSpeedMs },
      });

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = url;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (!copied) throw new Error('Clipboard access is unavailable.');
      }
      return { ok: true, url };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not copy the share link.' };
    }
  }, [
    activeBasemapId,
    activeLayers,
    currentSliderDate,
    customEnvelope,
    flood3dElevScale,
    floodDisplayMode,
    impactSelectedScenario,
    inundationRenderMode,
    mapInstance,
    playSpeedMs,
    rangeWindow,
    routeDepartureTime,
    routePoints,
    routeSpeedKt,
    selectedWaveForecast,
    suitabilityMode,
    terrainEnabled,
    timeDisplayZone,
    vesselClass,
    wmsOpacity,
  ]);

  return (
    <div style={widgetContainerStyle}>
      <ModernHeader timeDisplayZone={timeDisplayZone} onShareView={handleShareView} modelRunStart={capTime.modelRunStart} updatedAt={capTime.updatedAt} />
      <ForecastApp
        harbourConditions={harbourConditions}
        harbourLimits={harbourLimits}
        harbourBundle={harbourBundle}
        WAVE_FORECAST_LAYERS={ALL_LAYERS}
        ALL_LAYERS={ALL_LAYERS}
        selectedWaveForecast={selectedWaveForecast}
        setSelectedWaveForecast={setSelectedWaveForecast}
        opacity={wmsOpacity}
        setOpacity={setWmsOpacity}
        sliderIndex={sliderIndex}
        setSliderIndex={setSliderIndex}
        totalSteps={totalSteps}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        playSpeedMs={playSpeedMs}
        setPlaySpeedMs={setPlaySpeedMs}
        currentSliderDate={currentSliderDate}
        capTime={capTime}
        overlayStats={overlayStats}
        activeLayers={activeLayers}
        setActiveLayers={setActiveLayers}
        mapRef={mapRef}
        mapInstance={mapInstance}
        setBasemap={setBasemap}
        activeBasemapId={activeBasemapId}
        onBasemapChange={handleBasemapChange}
        preserveInitialMapView={Boolean(sharedState?.map)}
        impactInitialScenario={sharedState?.filters?.impactScenario ?? null}
        isUpdatingVisualization={loading}
        minIndex={0}
        isBuffering={false}
        inundationThresholds={inundationThresholds}
        inundationRenderMode={inundationRenderMode}
        setInundationRenderMode={setInundationRenderMode}
        rangeWindow={rangeWindow}
        setRangeWindow={setRangeWindow}
        fitBounds={fitBounds}
        setShowContours={setShowContours}
        terrainEnabled={terrainEnabled}
        setTerrainEnabled={setTerrainEnabled}
        terrainConfig={MAP_TERRAIN_CONFIG}
        floodDisplayMode={floodDisplayMode}
        setFloodDisplayMode={setFloodDisplayMode}
        flood3DConfig={FLOOD_3D_CONFIG}
        flood3dElevScale={flood3dElevScale}
        setFlood3dElevScale={setFlood3dElevScale}
        timeDisplayZone={timeDisplayZone}
        setTimeDisplayZone={setTimeDisplayZone}
        vesselClass={vesselClass}
        setVesselClass={setVesselClass}
        suitabilityMode={suitabilityMode}
        setSuitabilityMode={setSuitabilityMode}
        customEnvelope={customEnvelope}
        setCustomEnvelope={setCustomEnvelope}
        customEnvelopeIsDirty={customEnvelopeIsDirty}
        customEnvelopeFromShare={customEnvelopeFromShare}
        onSaveCustomEnvelope={saveCustomEnvelope}
        routePoints={routePoints}
        routePickMode={routePickMode}
        setRoutePickMode={setRoutePickMode}
        routeSpeedKt={routeSpeedKt}
        setRouteSpeedKt={setRouteSpeedKt}
        routeDepartureTime={routeDepartureTime}
        setRouteDepartureTime={setRouteDepartureTime}
        routeForecastResult={routeForecastResult}
        routeResultStale={routeResultStale}
        routeResultSuperseded={routeResultSuperseded}
        routeForecastLoading={routeForecastLoading}
        routeForecastError={routeForecastError}
        forecastEndTime={forecastEndTime}
        forecastStartTime={forecastStartTime}
        onRunRouteForecast={handleRunRouteForecast}
        onShowImpact={handleShowImpactDetail}
        onShowLandingAreaComparison={handleShowLandingAreaComparison}
        onClearRoute={handleClearRoute}
        onUndoRoutePoint={handleUndoRoutePoint}
        onLoadPresetRoute={handleLoadPresetRoute}
        scenarios={scenarios}
        confirmedScenarioId={confirmedScenarioId}
        runningScenarioIds={runningScenarioIds}
        currentModelRunStart={capTime.modelRunStart}
        onSaveCurrentAsScenario={handleSaveCurrentAsScenario}
        onDuplicateScenario={handleDuplicateScenario}
        onRemoveScenario={handleRemoveScenario}
        onRunScenario={handleRunScenario}
        onRunAllScenarios={handleRunAllScenarios}
        onExportScenarioComparisonBrief={handleExportScenarioComparisonBrief}
        impactData={impactData}
        impactAssets={impactAssets}
        impactDistricts={impactDistricts}
        onSelectImpactAsset={flyToImpactAsset}
        onImpactWindowSelect={handleImpactWindowSelect}
        onImpactScenarioChange={setImpactSelectedScenario}
        onMhwsResult={setMhwsResult}
        impactWindowMismatch={impactWindowMismatch}
        onSyncImpactWindow={impactWindowBlock ? () => handleImpactWindowSelect(impactWindowBlock) : undefined}
        onImpactsVisibleChange={setImpactsVisible}
        onRetryImpact={loadImpact}
      />

      <BottomOffCanvas
        show={showBottomCanvas}
        onTimeSelect={handleTimeSelect}
        onHide={handleHideBottomCanvas}
        data={bottomCanvasData}
        currentSliderDate={currentSliderDate}
        timeDisplayZone={timeDisplayZone}
        mapCustomEnvelope={mapCustomEnvelope}
        modelRunStart={capTime.modelRunStart}
        routeResultStale={routeResultStale}
        routeResultSuperseded={routeResultSuperseded}
        onRiskThresholdsSaved={refreshRiskMarkerColors}
        onImpactWindowSelect={handleImpactWindowSelect}
        onImpactScenarioChange={setImpactSelectedScenario}
        impactInitialScenario={impactSelectedScenario}
        onSelectImpactAsset={flyToImpactAsset}
        // The desktop Impacts tab already reports the flood geometry; this covers
        // the mobile sheet, which has no such section.
        onMhwsResult={impactsVisible ? undefined : setMhwsResult}
        scenarioCount={scenarios.length}
        onConfirmVesselSuggestion={handleConfirmVesselSuggestion}
        departureSuggestionLoading={departureSuggestionLoading}
        departureSuggestionProgress={departureSuggestionProgress}
        departureSuggestionResult={departureSuggestionResult}
        departureSuggestionError={departureSuggestionError}
        onSuggestBetterDeparture={handleSuggestBetterDeparture}
        onApplyDepartureSuggestion={handleApplyDepartureSuggestion}
        onSaveDepartureSuggestionAsScenario={handleSaveDepartureSuggestionAsScenario}
        onRouteProbeChange={setRouteProbe}
      />
      <BottomBuoyOffCanvas
        show={showBuoyCanvas}
        onHide={() => setShowBuoyCanvas(false)}
        buoyId={null}
      />
    </div>
  );
}

export default CookIslandsForecast;

// ── helpers ──────────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return [128, 128, 128];
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m || m.length < 3) return [128, 128, 128];
  return [parseInt(m[0], 16), parseInt(m[1], 16), parseInt(m[2], 16)];
}
