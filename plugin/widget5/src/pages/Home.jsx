import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { fetchCookIslandsRouteForecast, parseAsUtcWallClock } from '../services/cookIslandsRouteForecastService';
import { fetchCookIslandsImpactLatest, fetchCookIslandsImpactAssets } from '../services/cookIslandsImpactService';
import { findNearestIndex } from '../components/InundationWindowControl';
import { findIslandZoomTarget } from '../config/islandConfig';
import { createAppShareUrl, readAppShareState } from '../domain/share/appStateSnapshot';

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
  });
  const [sliderIndex, setSliderIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeedMs, setPlaySpeedMs] = useState(sharedState?.preferences?.playSpeedMs ?? 700);
  const [rangeWindow, setRangeWindow] = useState({ mode: 'single' });
  const pendingSharedTimeRef = useRef(sharedState?.forecast?.time ?? null);
  const pendingSharedRangeRef = useRef(sharedState?.forecast?.rangeWindow ?? null);
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
  const [routeForecastLoading, setRouteForecastLoading] = useState(false);
  const [routeForecastError, setRouteForecastError] = useState('');

  const handleRoutePointPick = useCallback((lng, lat) => {
    setRoutePoints((prev) => [...prev, { lon: lng, lat }]);
  }, []);

  const handleUndoRoutePoint = useCallback(() => {
    setRoutePoints((prev) => prev.slice(0, -1));
  }, []);

  const handleClearRoute = useCallback(() => {
    setRoutePoints([]);
    setRouteForecastResult(null);
    setRouteForecastError('');
  }, []);

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
  const impactSurfaceVisible = impactsVisible || Boolean(showBottomCanvas && bottomCanvasData?.mode === 'impact');

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
    impactAssetsGeojson: impactAssets.geojson,
    impactAssetsVisible: impactSurfaceVisible,
    impactAssetsScenario: impactSelectedScenario,
    initialMapView: sharedState?.map ?? null,
    initialBasemapId: activeBasemapId,
  });

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
    }

    const pendingRange = pendingSharedRangeRef.current;
    if (!pendingRange) return;
    if (pendingRange.mode === 'rolling-48h') {
      const endIndex = timestamps.length - 1;
      setRangeWindow({ mode: 'rolling-48h', startIndex: Math.max(0, endIndex - 47), endIndex });
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
  }, [capTime.availableTimestamps, capTime.layerId, selectedWaveForecast]);

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

  // Seed the departure picker from the current slider time the first time
  // a forecast window becomes available, rather than leaving it blank.
  useEffect(() => {
    if (!routeDepartureTime && currentSliderDate) {
      setRouteDepartureTime(currentSliderDate.toISOString().slice(0, 16));
    }
  }, [currentSliderDate, routeDepartureTime]);

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
      });
      setRouteForecastResult(result);
      setBottomCanvasData({ mode: 'route-forecast', result, vessel: vesselClass, speedKt: routeSpeedKt });
    } catch (err) {
      setRouteForecastError(err.message);
      setBottomCanvasData({ mode: 'route-forecast', error: err.message, vessel: vesselClass, speedKt: routeSpeedKt, onRetry: handleRunRouteForecast });
    } finally {
      setRouteForecastLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePoints, vesselClass, routeSpeedKt, routeDepartureTime, currentSliderDate, forecastEndTime, forecastStartTime]);

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

  useEffect(() => { loadImpact(); }, [loadImpact]);

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
    setBottomCanvasData({ mode: 'impact', ...impactData, assets: impactAssets, onRetry: loadImpact });
    setShowBottomCanvas(true);
  }, [impactData, impactAssets, loadImpact]);

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

  const handleImpactWindowSelect = useCallback((block) => {
    if (!block?.dateStart || !block?.dateEnd) return;
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
      <ModernHeader timeDisplayZone={timeDisplayZone} onShareView={handleShareView} />
      <ForecastApp
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
        routeForecastLoading={routeForecastLoading}
        routeForecastError={routeForecastError}
        forecastEndTime={forecastEndTime}
        forecastStartTime={forecastStartTime}
        onRunRouteForecast={handleRunRouteForecast}
        onShowImpact={handleShowImpactDetail}
        onClearRoute={handleClearRoute}
        onUndoRoutePoint={handleUndoRoutePoint}
        impactData={impactData}
        impactAssets={impactAssets}
        onSelectImpactAsset={flyToImpactAsset}
        onImpactWindowSelect={handleImpactWindowSelect}
        onImpactScenarioChange={setImpactSelectedScenario}
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
        onRiskThresholdsSaved={refreshRiskMarkerColors}
        onImpactWindowSelect={handleImpactWindowSelect}
        onImpactScenarioChange={setImpactSelectedScenario}
        onSelectImpactAsset={flyToImpactAsset}
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
