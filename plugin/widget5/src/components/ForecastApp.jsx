import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './ForecastApp.css';
import '../styles/MapMarker.css';
import { UI_CONFIG } from '../config/UIConfig';
import { getLayerBounds, isRasterSourceLayer } from '../config/layerConfig';
import { ISLAND_ZOOM_TARGETS, findIslandZoomTarget } from '../config/islandConfig';
import CompassRose from './CompassRose';
import BasemapSwitcher from './BasemapSwitcher';
import ForecastTimeline from './ForecastTimeline';
import {
  ControlGroup,
  VariableButtons,
  OpacityControl,
  IslandZoomControl,
  DataInfo,
} from './shared/UIComponents';
import { Waves, Wind, Navigation, Activity, Info, Settings, Timer, Triangle, CloudRain, MapPin, SlidersHorizontal, BarChart2, FastForward, Route, DollarSign, AlertTriangle, RotateCcw, Save } from 'lucide-react';
import { RISK_COLORS, RISK_LABELS } from '../services/riskDataService';
import { useResponsiveUI } from '../hooks/useWindowSize';
import ImpactTabPanel from './impact/ImpactTabPanel';
import { computeModelStatus, MODEL_STATUS } from './impact/impactFormat';
import FancyIcon from './FancyIcon';
import '../styles/fancyIcons.css';
import InundationThresholdEditor from './InundationThresholdEditor';
import InundationWindowControl from './InundationWindowControl';
import { X_SST_GRADIENT, buildInundationLegendBands, buildBreakLegendConfig, buildContinuousLegendConfig, parseLegendColorRange } from '../domain/inundation/legendBands';
import { getColormap } from '../lib/colormaps';
import { VESSEL_CLASS_OPTIONS, VESSEL_OPERATING_ENVELOPE } from '../lib/CookIslandsSuitabilityOverlay';
import { Anchor, Fish } from 'lucide-react';
import EnvelopeRangeSlider from './suitability/EnvelopeRangeSlider';
import { applyEnvelopeEdit, envelopeDiffersFromPreset, envelopeSliderMax } from '../domain/suitability/customEnvelopeProfiles';
import CookIslandsRouteControls from './route/CookIslandsRouteControls';


const ForecastApp = ({
  WAVE_FORECAST_LAYERS,
  ALL_LAYERS,
  selectedWaveForecast,
  setSelectedWaveForecast,
  opacity,
  setOpacity,
  sliderIndex,
  setSliderIndex,
  totalSteps,
  isPlaying,
  setIsPlaying,
  playSpeedMs = 700,
  setPlaySpeedMs,
  currentSliderDate,
  capTime,
  overlayStats,
  activeLayers,
  setActiveLayers,
  mapRef,
  mapInstance,
  setBasemap,
  activeBasemapId = 'satellite',
  onBasemapChange,
  preserveInitialMapView = false,
  impactInitialScenario = null,
  isUpdatingVisualization,
  currentSliderDateStr,
  minIndex = 0,
  inundationThresholds,
  inundationRenderMode,
  setInundationRenderMode,
  rangeWindow,
  setRangeWindow,
  fitBounds,       // (islandBounds) → map.fitBounds with coord conversion — from useZarrMap
  setShowContours,
  // Unused while the Terrain/Aerial imagery toggles and Flood display's
  // terrain-aware warning banner are commented out below (moved to
  // advanced-features branch).
  // eslint-disable-next-line no-unused-vars
  terrainEnabled = false,
  // eslint-disable-next-line no-unused-vars
  setTerrainEnabled,
  terrainConfig,
  // Unused while the Flood display (2D/3D) toggle is commented out below
  // (moved to advanced-features branch).
  // eslint-disable-next-line no-unused-vars
  floodDisplayMode = '2d',
  // eslint-disable-next-line no-unused-vars
  setFloodDisplayMode,
  flood3DConfig,
  // eslint-disable-next-line no-unused-vars
  flood3dElevScale = 6,
  // eslint-disable-next-line no-unused-vars
  setFlood3dElevScale,
  timeDisplayZone,
  setTimeDisplayZone,
  vesselClass = 'traditional_craft',
  setVesselClass,
  suitabilityMode = 'preset',
  setSuitabilityMode,
  customEnvelope = null,
  setCustomEnvelope,
  customEnvelopeIsDirty = false,
  customEnvelopeFromShare = false,
  onSaveCustomEnvelope,
  routePoints = [],
  routePickMode = false,
  setRoutePickMode,
  routeSpeedKt = 8,
  setRouteSpeedKt,
  routeDepartureTime = '',
  setRouteDepartureTime,
  routeForecastLoading = false,
  routeForecastError = '',
  forecastEndTime = null,
  forecastStartTime = null,
  onRunRouteForecast,
  onShowImpact,
  onClearRoute,
  onUndoRoutePoint,
  impactData,
  impactAssets,
  onSelectImpactAsset,
  onImpactWindowSelect,
  onImpactScenarioChange,
  onRetryImpact,
  onImpactsVisibleChange,
}) => {
  const lastZoomedLayerRef = useRef(preserveInitialMapView ? selectedWaveForecast : null);
  const [selectedIslandId, setSelectedIslandId] = useState(ISLAND_ZOOM_TARGETS[0]?.id || '');
  const [showThresholdEditor, setShowThresholdEditor] = useState(false);
  const [showTimelineInPanel, setShowTimelineInPanel] = useState(false);
  const [contoursEnabled, setContoursEnabled] = useState(false);
  const [customEnvelopeSaveError, setCustomEnvelopeSaveError] = useState('');
  const [rightPanelTab, setRightPanelTab] = useState('forecast');
  const lastForecastLayerRef = useRef(null);
  // The 350-400px right-hand column (see .controls-panel's own responsive
  // widths in ForecastApp.css) only exists as an actual side column at
  // >=1024px -- below that, .main-container switches to a single-column
  // stacked layout where a persistent tab bar has nowhere sensible to live
  // and a bottom sheet is the right call instead. Matches that CSS
  // breakpoint exactly rather than reusing useResponsiveUI's isDesktop
  // (>1024, off-by-one) or isTablet (which CSS treats as "not a side column"
  // here, unlike its name might suggest).
  const { width: viewportWidth } = useResponsiveUI();
  const isDesktopPanel = viewportWidth === undefined ? true : viewportWidth >= 1024;

  const selectedLayer = useMemo(() => {
    return ALL_LAYERS.find(l => l.value === selectedWaveForecast) || null;
  }, [ALL_LAYERS, selectedWaveForecast]);
  const isRasterInundation = isRasterSourceLayer(selectedLayer);
  const isSuitabilityLayer = selectedLayer?.sourceType === 'cok-suitability';

  // Desktop: the inundation layer and its controls live in the Impacts tab, so
  // the Forecast tab's layer picker omits it. Below 1024px there are no tabs,
  // so the picker keeps every layer.
  const inundationLayer = useMemo(() => ALL_LAYERS.find(isRasterSourceLayer) || null, [ALL_LAYERS]);
  const forecastTabLayers = useMemo(
    () => (isDesktopPanel ? ALL_LAYERS.filter((l) => !isRasterSourceLayer(l)) : ALL_LAYERS),
    [ALL_LAYERS, isDesktopPanel]
  );

  // Matches the exact condition gating whether <ImpactTabPanel> below is
  // even mounted (isDesktopPanel && rightPanelTab === 'impacts', not just
  // rightPanelTab on its own -- on mobile that tab bar/panel doesn't exist
  // at all). Home.jsx uses this to decide whether the RiskScape impact
  // assets map layer should be visible, so it only ever shows while the
  // panel a user could actually be looking at is the one describing it.
  const impactsVisible = isDesktopPanel && rightPanelTab === 'impacts';
  useEffect(() => {
    onImpactsVisibleChange?.(impactsVisible);
  }, [impactsVisible, onImpactsVisibleChange]);

  // Something else (e.g. the bottom-sheet impact table) selected the
  // inundation layer while the Forecast tab is showing, which no longer lists
  // it -- follow it to the tab that owns it.
  useEffect(() => {
    if (isDesktopPanel && isRasterInundation && rightPanelTab === 'forecast') {
      setRightPanelTab('impacts');
    }
  }, [isDesktopPanel, isRasterInundation, rightPanelTab]);

  // Route controls only exist on the suitability layer; leaving it mid-draw
  // would strand the crosshair cursor with no button to cancel.
  useEffect(() => {
    if (!isSuitabilityLayer && routePickMode) setRoutePickMode?.(false);
  }, [isSuitabilityLayer, routePickMode, setRoutePickMode]);

  const impactModelStatus = computeModelStatus({
    loading: Boolean(impactData?.loading),
    error: impactData?.error ?? null,
    result: impactData?.result,
    hasPriorResult: Boolean(impactData?.result),
  });

  // ── custom operating envelope (suitability layer only) ───────────────────
  const isCustomEnvelope = suitabilityMode === 'custom';
  const selectedVesselEnvelope = VESSEL_OPERATING_ENVELOPE[vesselClass] ?? null;
  // What the map is actually rendering right now, regardless of mode -- a
  // vessel without saved custom values starts at its own preset, while a
  // previously edited vessel restores only that vessel's session profile
  // (see domain/suitability/customEnvelopeProfiles.js).
  const effectiveEnvelope = isCustomEnvelope
    ? { ...selectedVesselEnvelope, ...(customEnvelope ?? {}) }
    : selectedVesselEnvelope;
  const customEnvelopeChanged = isCustomEnvelope && envelopeDiffersFromPreset(vesselClass, customEnvelope);

  // Slider track range scales to the selected vessel's own preset (not the
  // live-editing effectiveEnvelope -- that would make the track grow while
  // dragging its own upper handle, a moving-goalpost feel) rather than one
  // fixed range for every vessel. Without this, Traditional Craft's entire
  // meaningful range (0-12kt) sits inside a small fraction of the same track
  // Larger Vessels uses out to 25kt+, making fine control cramped for
  // smaller vessel classes specifically.
  const { windMax: windSliderMax, waveMax: waveSliderMax } = envelopeSliderMax(vesselClass);

  const formatWave = useCallback((v) => `${v.toFixed(1)} m`, []);
  const formatWind = useCallback((v) => `${Math.round(v)} kt`, []);

  const resetCustomEnvelope = useCallback(() => {
    setCustomEnvelopeSaveError('');
    setCustomEnvelope?.(null);
  }, [setCustomEnvelope]);

  const saveCustomEnvelope = useCallback(() => {
    const saved = onSaveCustomEnvelope?.();
    setCustomEnvelopeSaveError(saved === false ? 'Could not save ranges in this browser.' : '');
  }, [onSaveCustomEnvelope]);

  useEffect(() => {
    setCustomEnvelopeSaveError('');
  }, [vesselClass]);

  // Clamping, caution < avoid push-along and step rounding live in
  // domain/suitability/customEnvelopeProfiles.js (applyEnvelopeEdit) so the
  // slider, the number fields, and the tests all exercise one implementation.
  const updateCustomEnvelope = useCallback((field, value) => {
    setCustomEnvelopeSaveError('');
    setCustomEnvelope?.((prev) => applyEnvelopeEdit(vesselClass, prev, field, value));
  }, [vesselClass, setCustomEnvelope]);
  // Unused while the Terrain toggle is commented out below (moved to
  // advanced-features branch).
  // eslint-disable-next-line no-unused-vars
  const terrainAvailable = Array.isArray(terrainConfig?.tiles) && terrainConfig.tiles.some(Boolean);
  // Unused while the Flood display toggle is commented out below (moved to
  // advanced-features branch).
  // eslint-disable-next-line no-unused-vars
  const flood3DAvailable = Boolean(flood3DConfig?.available);

  const zoomToLayerBounds = useCallback((layerValue, { force = false } = {}) => {
    if (!layerValue) return;
    const layerBounds = getLayerBounds(layerValue);
    if (!layerBounds) return;
    if (!force && lastZoomedLayerRef.current === layerValue) return;

    const layer = ALL_LAYERS.find(l => l.value === layerValue);
    const isInundation = layer?.isStatic || layer?.sourceType === 'zarr' || false;
    const maxZoom = isInundation ? 17 : 14;

    if (fitBounds) {
      fitBounds(layerBounds, { padding: 20, maxZoom, animate: true });
    } else if (mapInstance?.current) {
      const map = mapInstance.current;
      const sw = layerBounds.southWest;
      const ne = layerBounds.northEast;
      map.fitBounds([[sw[1], sw[0]], [ne[1], ne[0]]], { padding: 20, maxZoom, animate: true });
    }
    lastZoomedLayerRef.current = layerValue;
  }, [mapInstance, ALL_LAYERS, fitBounds]);

  const zoomToIsland = useCallback((islandId = selectedIslandId) => {
    const island = findIslandZoomTarget(islandId);
    if (!island) return;
    setActiveLayers(prev => ({ ...prev, riskPoints: true }));
    if (fitBounds) {
      fitBounds(island.bounds, { padding: 42, maxZoom: 12 });
    } else if (mapInstance?.current) {
      const { southWest: sw, northEast: ne } = island.bounds;
      mapInstance.current.fitBounds([[sw[1], sw[0]], [ne[1], ne[0]]], { padding: 42, maxZoom: 12, animate: true });
    }
  }, [mapInstance, selectedIslandId, setActiveLayers, fitBounds]);

  const zoomToRarotonga = useCallback(() => {
    const rarotonga = findIslandZoomTarget('rarotonga');
    if (!rarotonga) return;
    if (fitBounds) {
      fitBounds(rarotonga.bounds, { padding: 20, maxZoom: 17 });
    } else if (mapInstance?.current) {
      const { southWest: sw, northEast: ne } = rarotonga.bounds;
      mapInstance.current.fitBounds([[sw[1], sw[0]], [ne[1], ne[0]]], { padding: 20, maxZoom: 17, animate: true });
    }
  }, [mapInstance, fitBounds]);

  useEffect(() => {
    zoomToLayerBounds(selectedWaveForecast);
  }, [selectedWaveForecast, zoomToLayerBounds]);

  // Reset contour toggle when layer changes so UI state matches the new overlay.
  useEffect(() => {
    const defaultEnabled = selectedLayer?.contours?.visibleByDefault ?? false;
    setContoursEnabled(defaultEnabled);
    setShowContours?.(defaultEnabled);
  }, [selectedLayer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedLegendLayer = useMemo(() => {
    if (!selectedWaveForecast) return null;

    const findLayerByValue = (layers, value) => {
      if (!Array.isArray(layers)) return null;
      for (const layer of layers) {
        if (layer?.value === value) {
          return layer;
        }
        if (layer?.composite && Array.isArray(layer.layers)) {
          const match = findLayerByValue(layer.layers, value);
          if (match) return match;
        }
      }
      return null;
    };

    const dynamicMatch = findLayerByValue(WAVE_FORECAST_LAYERS, selectedWaveForecast);
    const baseLayer = dynamicMatch || findLayerByValue(ALL_LAYERS, selectedWaveForecast);
    if (!baseLayer) {
      return null;
    }

    if (!baseLayer.composite) {
      return baseLayer;
    }

    const PRIORITY_VARIABLES = ['hs', 'wave_height', 'tm02', 'tpeak', 'period', 'inun', 'flood'];
    const { layers } = baseLayer;
    if (!Array.isArray(layers)) {
      return baseLayer;
    }

    const directMatch = layers.find(subLayer => subLayer?.value === selectedWaveForecast);
    if (directMatch) {
      return directMatch;
    }

    for (const key of PRIORITY_VARIABLES) {
      const match = layers.find(subLayer => subLayer?.value?.toLowerCase().includes(key));
      if (match) {
        return match;
      }
    }

    return layers[0] || baseLayer;
  }, [ALL_LAYERS, WAVE_FORECAST_LAYERS, selectedWaveForecast]);

  const inundationLegendBands = useMemo(() => {
    if (inundationRenderMode === 'continuous') {
      return buildContinuousLegendConfig({
        colorRange: {
          min: selectedLegendLayer?.rasterMinDepth ?? selectedLegendLayer?.colorRange?.min ?? 0.05,
          max: selectedLegendLayer?.rasterMaxDepth ?? selectedLegendLayer?.colorRange?.max ?? 3.0,
        },
        colormapFn: getColormap('turbo'),
        units: 'm',
      });
    }
    return buildInundationLegendBands({
      categories: inundationThresholds.lastValidCategories,
      minVisibleDepth: inundationThresholds.minVisibleDepth,
      colorscalerange: selectedLegendLayer?.colorscalerange,
      rasterMinDepth: selectedLegendLayer?.rasterMinDepth,
      rasterMaxDepth: selectedLegendLayer?.rasterMaxDepth,
    });
  }, [inundationThresholds.lastValidCategories, inundationThresholds.minVisibleDepth, selectedLegendLayer, inundationRenderMode]);

  const activeOverlayRange = useMemo(() => {
    if (!overlayStats || overlayStats.layerId !== selectedWaveForecast) return null;
    const min = Number(overlayStats.colorMin);
    const max = Number(overlayStats.colorMax);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return null;
    return { min, max, units: overlayStats.units };
  }, [overlayStats, selectedWaveForecast]);

  // Dynamic marine legend configuration - RESPONDS TO ACTUAL DATA
  const getLegendConfig = (variable, layerData) => {
    const varLower = variable.toLowerCase();

    // Inundation must always reflect the live, user-editable threshold profile —
    // layerData.colorBreaks below is just the seeded config default, and checking
    // it first (as the generic branch does) permanently shadowed edited thresholds.
    if (varLower.includes('inun') || varLower.includes('hmax') || varLower.includes('h_max')) {
      return {
        units: 'm',
        ...inundationLegendBands,
      };
    }

    // Parse dynamic ranges from layer data
    const colorRange = layerData ? parseLegendColorRange(layerData.colorscalerange) : null;
    const dynamicMax = layerData?.activeBeaufortMax;

    // Any layer that has colorBreaks configured uses buildBreakLegendConfig so the
    // legend colormap always matches the map renderer — single source of truth.
    if (layerData?.colorBreaks?.length > 1) {
      return buildBreakLegendConfig({
        colorBreaks: layerData.colorBreaks,
        colorLabels: layerData.colorLabels,
        colorRange: { min: layerData.colorRange?.min ?? 0, max: layerData.colorRange?.max ?? 5 },
        units: layerData.units ?? '',
        colormapFn: getColormap(layerData.colormap),
      });
    }

    // ── per-variable fallbacks for layers without colorBreaks ──────────────────
    if (varLower.includes('hs')) {
      const minVal = activeOverlayRange?.min ?? colorRange?.min ?? 0;
      const maxVal = activeOverlayRange?.max ?? (Number.isFinite(dynamicMax) ? dynamicMax : (colorRange?.max ?? 4));
      const ticks = Array.from({length: 5}, (_, i) =>
        Number((minVal + (maxVal - minVal) * i / 4).toFixed(1))
      );
      return {
        gradient: X_SST_GRADIENT,
        min: minVal,
        max: maxVal,
        units: activeOverlayRange?.units ?? 'm',
        ticks,
      };
    }

    if (varLower.includes('tm02') || varLower.includes('tpeak')) {
      // Wave period (mean/peak) - continuous gradient sampled from the layer's
      // own colormap so the legend always matches what UgridOverlay renders.
      return buildContinuousLegendConfig({
        colorRange: { min: layerData?.colorRange?.min ?? 0, max: layerData?.colorRange?.max ?? 20 },
        colormapFn: getColormap(layerData?.colormap),
        units: 's',
      });
    }

    if (varLower.includes('dirm')) {
      // Wave direction - Static compass (doesn't change with data)
      return {
        gradient: 'conic-gradient(from 0deg, transparent)',
        min: 0,
        max: 360,
        units: '°',
        ticks: [0, 90, 180, 270, 360]
      };
    }

    return null;
  };

  // Function to get fancy icons for different variable types
  const getVariableIcon = (layer) => {
    const value = layer.value?.toLowerCase() || '';
    const label = layer.label?.toLowerCase() || '';
    
    if (value.includes('hs') || label.includes('wave height')) {
      return <FancyIcon icon={Waves} animationType="wave" size={14} color="#00bcd4" style={{ marginRight: '8px' }} />;
    }
    if (value.includes('tm02') || (label.includes('mean') && label.includes('period'))) {
      return <FancyIcon icon={Timer} animationType="pulse" size={14} color="#ff9800" style={{ marginRight: '8px' }} />;
    }
    if (value.includes('tpeak') || (label.includes('peak') && label.includes('period'))) {
      return <FancyIcon icon={Triangle} animationType="bounce" size={14} color="#4caf50" style={{ marginRight: '8px' }} />;
    }
    if (value.includes('dirm') || label.includes('direction')) {
      return <FancyIcon icon={Navigation} animationType="spin" size={14} color="#9c27b0" style={{ marginRight: '8px' }} />;
    }
    if (value.includes('inun') || label.includes('inundation')) {
      return <FancyIcon icon={CloudRain} animationType="shimmer" size={14} color="#2196f3" style={{ marginRight: '8px' }} />;
    }
    if (value.includes('wind') || label.includes('wind')) {
      return <FancyIcon icon={Wind} animationType="wave" size={14} color="#795548" style={{ marginRight: '8px' }} />;
    }
    if (value.includes('suitability') || label.includes('suitability')) {
      return <FancyIcon icon={Navigation} animationType="pulse" size={14} color="#2A9D8F" style={{ marginRight: '8px' }} />;
    }

    // Default icon for unknown variables
    return <FancyIcon icon={Activity} animationType="pulse" size={14} color="#607d8b" style={{ marginRight: '8px' }} />;
  };

  const getVariableColor = (layer) => {
    const value = layer.value?.toLowerCase() || '';
    const label = layer.label?.toLowerCase() || '';
    if (value.includes('hs') || label.includes('wave height')) return '#00bcd4';
    if (value.includes('tm02') || (label.includes('mean') && label.includes('period'))) return '#00d4ff';
    if (value.includes('tpeak') || (label.includes('peak') && label.includes('period'))) return '#00d4ff';
    if (value.includes('dirm') || label.includes('direction')) return '#9c27b0';
    if (value.includes('inun') || label.includes('inundation')) return '#2196f3';
    if (value.includes('wind') || label.includes('wind')) return '#795548';
    return '#00d4ff';
  };

  const handleVariableChange = (layerValue) => {
    setSelectedWaveForecast(layerValue);
    setActiveLayers(prev => ({ ...prev, waveForecast: true }));

    const nextLayer = ALL_LAYERS.find((layer) => layer.value === layerValue);
    if (isRasterSourceLayer(nextLayer)) {
      setSelectedIslandId('rarotonga');
      zoomToRarotonga();
      return;
    }

    // Reset range-window mode when leaving the inundation layer so the shared
    // rangeWindow state doesn't disable the time slider on wave layers.
    if (rangeWindow?.mode && rangeWindow.mode !== 'single') {
      setRangeWindow({ mode: 'single' });
    }

    zoomToLayerBounds(layerValue, { force: true });
  };

  // Impacts tab = inundation layer + its controls + impact numbers; Forecast
  // tab = everything else. Switching tabs switches the map layer with it,
  // remembering the last non-inundation layer to come back to.
  const handleRightPanelTabChange = (tab) => {
    if (tab === rightPanelTab) return;
    if (tab === 'impacts') {
      if (!isRasterInundation) lastForecastLayerRef.current = selectedWaveForecast;
      setRightPanelTab('impacts');
      if (inundationLayer && !isRasterInundation) handleVariableChange(inundationLayer.value);
      return;
    }
    setRightPanelTab('forecast');
    if (isRasterInundation) {
      const fallback = forecastTabLayers.find((l) => l.value === lastForecastLayerRef.current) || forecastTabLayers[0];
      if (fallback) handleVariableChange(fallback.value);
    }
  };

  const handlePlayToggle = () => {
    setIsPlaying(!isPlaying);
  };

  const handleSliderChange = (value) => {
    setSliderIndex(parseInt(value));
  };

  const handlePreviousTimestamp = () => {
    setSliderIndex(prev => Math.max(prev - 1, minIndex));
  };

  const handleNextTimestamp = () => {
    setSliderIndex(prev => Math.min(prev + 1, totalSteps));
  };

  const inundationControlGroups = (
    <>
        <ControlGroup
            icon={<FancyIcon icon={SlidersHorizontal} animationType="pulse" color="#90caf9" />}
            title="Dynamic Inundation Visualization"
            ariaLabel="Inundation threshold configuration"
          >
            <div className="inundation-threshold-trigger">
              <button
                type="button"
                className={`inundation-threshold-trigger__btn${inundationThresholds.isDirty ? ' inundation-threshold-trigger__btn--dirty' : ''}`}
                onClick={() => setShowThresholdEditor(true)}
                title="Customise depth bands and severity labels"
              >
                <SlidersHorizontal size={14} />
                Edit Thresholds
                {inundationThresholds.isDirty && (
                  <span className="inundation-threshold-trigger__badge" title="Unsaved changes">●</span>
                )}
              </button>
              <span className="inundation-threshold-trigger__count">
                {`${inundationThresholds.categories.length} bands`}
              </span>
            </div>
            <div className="inundation-threshold-trigger__hint">
              Refine depth bands and severity descriptions as observed event data comes in. Changes apply live to the map popup and legend.
            </div>
          </ControlGroup>

        {rangeWindow !== undefined && (
          <ControlGroup
            icon={<FancyIcon icon={BarChart2} animationType="pulse" color="#38bdf8" />}
            title="Inundation Window"
            ariaLabel="Inundation time window mode"
          >
            <InundationWindowControl
              rangeWindow={rangeWindow}
              setRangeWindow={setRangeWindow}
              availableTimestamps={capTime?.availableTimestamps}
              disabled={capTime?.loading}
              currentTime={currentSliderDate}
              timeDisplayZone={timeDisplayZone}
            />
          </ControlGroup>
        )}
    </>
  );

  const forecastTimeGroup = showTimelineInPanel ? (
<ControlGroup
            icon={<FancyIcon icon={FastForward} animationType="bounce" color="#ff9800" />}
            title={UI_CONFIG.SECTIONS.FORECAST_TIME.title}
            ariaLabel={UI_CONFIG.SECTIONS.FORECAST_TIME.ariaLabel}
          >
            <ForecastTimeline
              inline
              sliderIndex={sliderIndex}
              totalSteps={totalSteps}
              minIndex={minIndex}
              currentSliderDate={currentSliderDate}
              capTime={capTime}
              isPlaying={isPlaying}
              playSpeedMs={playSpeedMs}
              timeDisplayZone={timeDisplayZone}
              disabled={selectedLayer?.isStatic || (isRasterInundation && rangeWindow?.mode && rangeWindow.mode !== 'single')}
              onTimeIndexChange={handleSliderChange}
              onPlayPause={handlePlayToggle}
              onPrevious={handlePreviousTimestamp}
              onNext={handleNextTimestamp}
              onSpeedChange={setPlaySpeedMs}
              onTimezoneChange={setTimeDisplayZone}
              showInPanel={showTimelineInPanel}
              onTogglePanel={() => setShowTimelineInPanel(v => !v)}
            />
          </ControlGroup>
  ) : null;

  return (
    <div className="forecast-app">
      <div className="main-container">
        <div className="map-section">
          <div ref={mapRef} id="map" className="forecast-map"></div>

          <BasemapSwitcher
            mapInstance={mapInstance}
            setBasemap={onBasemapChange ?? setBasemap}
            activeId={activeBasemapId}
            position="top-left"
          />

          {/* Enhanced Professional Compass Rose */}
          <CompassRose 
            position="top-right" 
            size={90} 
            responsive={true}
            mapRotation={0} 
          />
          
          {activeLayers?.riskPoints !== false && (() => {
            const riskLegendInfoText = "Colors show forecast maximum total water level against each point's Minor/Moderate thresholds. Zoomed out, one marker per island represents its highest-risk point — zoom in for every point.";
            return (
              <div className="marine-legend marine-legend--left" style={{ minWidth: 150, left: 20, right: 'auto' }}>
                <div className="marine-legend-title">
                  Coastal Risk
                  <span className="marine-legend-info" aria-label={riskLegendInfoText}>
                    ⓘ
                    <span className="marine-legend-info__tooltip">{riskLegendInfoText}</span>
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.5rem' }}>
                  {[0, 1, 2].map((level) => (
                    <div key={level} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: '#e0f7ff' }}>
                      <span style={{
                        display: 'inline-block', width: 12, height: 12, borderRadius: '50%',
                        background: RISK_COLORS[level], border: '1.5px solid rgba(255,255,255,0.3)', flexShrink: 0,
                      }} />
                      {RISK_LABELS[level]}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {isSuitabilityLayer && (
            <div className="marine-legend" style={{ minWidth: 140 }}>
              <div className="marine-legend-title">Vessel Suitability</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.5rem' }}>
                {[
                  { color: '#2A9D8F', label: 'Suitable' },
                  { color: '#F4A261', label: 'Caution' },
                  { color: '#E63946', label: 'Warning / Not recommended' },
                ].map(({ color, label }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: '#e0f7ff' }}>
                    <span style={{ width: 14, height: 14, borderRadius: '50%', background: color, flexShrink: 0, border: '1.5px solid rgba(255,255,255,0.3)' }} />
                    {label}
                  </div>
                ))}
                {suitabilityMode !== 'custom' && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.25)', marginTop: '0.35rem', paddingTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: '#e0f7ff' }}>
                      <Anchor size={16} aria-hidden="true" /> Landing site / harbour
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: '#e0f7ff' }}>
                      <Fish size={16} aria-hidden="true" /> Fishing ground
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#b8d2db', lineHeight: 1.35 }}>Colored icons are named advisory locations; small circles are sampled reef points.</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {!isSuitabilityLayer && selectedLegendLayer && (
            <div className="marine-legend">
              {(() => {
                const legendConfig = getLegendConfig(selectedLegendLayer.variable ?? selectedLegendLayer.value, selectedLegendLayer);
                if (!legendConfig) return null;
                const range = legendConfig.max - legendConfig.min;
                const toPos = (val) => range > 0 ? ((legendConfig.max - val) / range) * 100 : 0;

                const legendInfoText = [
                  selectedLegendLayer.legendNote,
                  selectedLegendLayer.showDirectionArrows ? selectedLegendLayer.arrowLegendLabel : null,
                ].filter(Boolean).join(' ');

                return (
                  <>
                    <div className="marine-legend-title">
                      {selectedLegendLayer.label}
                      {legendInfoText && (
                        <span className="marine-legend-info" aria-label={legendInfoText}>
                          ⓘ
                          <span className="marine-legend-info__tooltip">{legendInfoText}</span>
                        </span>
                      )}
                    </div>
                    {selectedLegendLayer.contours?.levels?.length > 0 && (
                      <button
                        className={`marine-legend-toggle${contoursEnabled ? ' marine-legend-toggle--active' : ''}`}
                        onClick={() => {
                          const next = !contoursEnabled;
                          setContoursEnabled(next);
                          setShowContours?.(next);
                        }}
                      >
                        {contoursEnabled ? 'Contours on' : 'Contours off'}
                      </button>
                    )}
                    <div className="marine-legend-content">

                      {/* Gradient bar — with threshold boundary hairlines overlaid when available */}
                      <div className="marine-legend-gradient-wrap">
                        <div
                          className="marine-legend-gradient"
                          style={{ background: legendConfig.gradient }}
                        />
                        {legendConfig.gradientMarkers?.map((cat) => (
                          <div
                            key={`marker-${cat.id}`}
                            className="marine-legend-band-marker"
                            style={{
                              top: `${toPos(cat.thresholdM)}%`,
                              borderTopColor: cat.color,
                            }}
                            title={`${cat.thresholdM.toFixed(2)} m — ${cat.label}`}
                          />
                        ))}
                      </div>

                      {/* Tick scale */}
                      <div className="marine-legend-scale">
                        {legendConfig.ticks.map((tick) => {
                          const band = legendConfig.tickBands?.[tick];
                          return (
                            <div
                              key={`tick-${tick}`}
                              className={`marine-legend-tick${band ? ' marine-legend-tick--labeled' : ''}`}
                              style={{ top: `${toPos(tick)}%`, transform: 'translateY(-50%)', left: '0px' }}
                            >
                              {/* Colored swatch — always visible when a band matches this tick */}
                              {band && (
                                <span
                                  className="marine-legend-tick__swatch"
                                  style={{ background: band.color }}
                                />
                              )}
                              <span className="marine-legend-tick__value">{tick}{legendConfig.units}</span>

                              {/* Full label + description tooltip on hover */}
                              {band && (
                                <span className="marine-legend-tick__severity">
                                  <strong>{band.label}</strong>
                                  {band.description && (
                                    <em>{band.description}</em>
                                  )}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* Bottom timeline overlay — hidden while pinned to the side panel */}
          {!showTimelineInPanel && (
            <ForecastTimeline
              sliderIndex={sliderIndex}
              totalSteps={totalSteps}
              minIndex={minIndex}
              currentSliderDate={currentSliderDate}
              capTime={capTime}
              isPlaying={isPlaying}
              playSpeedMs={playSpeedMs}
              timeDisplayZone={timeDisplayZone}
              disabled={selectedLayer?.isStatic || (isRasterInundation && rangeWindow?.mode && rangeWindow.mode !== 'single')}
              onTimeIndexChange={handleSliderChange}
              onPlayPause={handlePlayToggle}
              onPrevious={handlePreviousTimestamp}
              onNext={handleNextTimestamp}
              onSpeedChange={setPlaySpeedMs}
              onTimezoneChange={setTimeDisplayZone}
              showInPanel={showTimelineInPanel}
              onTogglePanel={() => setShowTimelineInPanel(v => !v)}
            />
          )}
        </div>

        <div className="controls-panel">
          {isDesktopPanel && (
            <div className="right-panel-tabs" role="tablist" aria-label="Right panel view">
              <button
                type="button"
                role="tab"
                id="right-panel-tab-forecast"
                aria-controls="right-panel-panel-forecast"
                aria-selected={rightPanelTab === 'forecast'}
                className={`right-panel-tab${rightPanelTab === 'forecast' ? ' right-panel-tab--active' : ''}`}
                onClick={() => handleRightPanelTabChange('forecast')}
              >
                Forecast
              </button>
              <button
                type="button"
                role="tab"
                id="right-panel-tab-impacts"
                aria-controls="right-panel-panel-impacts"
                aria-selected={rightPanelTab === 'impacts'}
                className={`right-panel-tab${rightPanelTab === 'impacts' ? ' right-panel-tab--active' : ''}`}
                onClick={() => handleRightPanelTabChange('impacts')}
              >
                Inundation &amp; Impacts
                {impactModelStatus && (
                  <span
                    className="right-panel-tab__dot"
                    title={MODEL_STATUS[impactModelStatus]?.label}
                    style={{ background: MODEL_STATUS[impactModelStatus]?.color }}
                  />
                )}
              </button>
            </div>
          )}

          {isDesktopPanel && rightPanelTab === 'impacts' && (
            <div
              className="forecast-controls"
              id="right-panel-panel-impacts"
              role="tabpanel"
              aria-labelledby="right-panel-tab-impacts"
            >
              {inundationControlGroups}
              <ControlGroup
                icon={<FancyIcon icon={DollarSign} animationType="pulse" color="#E63946" />}
                title="Flood Impacts"
                ariaLabel="RiskScape flood impact assessment for the inundation forecast"
              >
                <ImpactTabPanel
                  data={impactData}
                  assets={impactAssets}
                  onRetry={onRetryImpact}
                  onWindowSelect={onImpactWindowSelect}
                  onScenarioChange={onImpactScenarioChange}
                  initialScenario={impactInitialScenario}
                  onSelectAsset={onSelectImpactAsset}
                  onExpand={onShowImpact}
                  timeDisplayZone={timeDisplayZone}
                />
              </ControlGroup>
              {forecastTimeGroup}
              <ControlGroup
                icon={<FancyIcon icon={Settings} animationType="spin" color="#9c27b0" />}
                title={UI_CONFIG.SECTIONS.DISPLAY_OPTIONS.title}
                ariaLabel={UI_CONFIG.SECTIONS.DISPLAY_OPTIONS.ariaLabel}
              >
                <OpacityControl
                  opacity={opacity}
                  onOpacityChange={setOpacity}
                  formatPercent={UI_CONFIG.FORMATS.opacityPercent}
                  ariaLabel={UI_CONFIG.ARIA_LABELS.overlayOpacity}
                />
              </ControlGroup>
            </div>
          )}

          {(!isDesktopPanel || rightPanelTab === 'forecast') && (
          <div
            className="forecast-controls"
            id={isDesktopPanel ? 'right-panel-panel-forecast' : undefined}
            role={isDesktopPanel ? 'tabpanel' : undefined}
            aria-labelledby={isDesktopPanel ? 'right-panel-tab-forecast' : undefined}
          >
        <ControlGroup
          icon={<FancyIcon icon={Activity} animationType="shimmer" color="#00bcd4" />}
          title={UI_CONFIG.SECTIONS.FORECAST_VARIABLES.title}
          ariaLabel={UI_CONFIG.SECTIONS.FORECAST_VARIABLES.ariaLabel}
        >
          <VariableButtons
            layers={forecastTabLayers}
            selectedValue={selectedWaveForecast}
            onVariableChange={handleVariableChange}
            labelMap={UI_CONFIG.VARIABLE_LABELS}
            ariaLabel={UI_CONFIG.ARIA_LABELS.variableButton}
            getVariableIcon={getVariableIcon}
            getVariableColor={getVariableColor}
          />
          {/* Live condition summary — answers the question before the user asks it */}
          {activeOverlayRange && (
            <div style={{
              marginTop: '0.35rem',
              padding: '0.4rem 0.65rem',
              background: 'rgba(0, 212, 255, 0.07)',
              border: '1px solid rgba(0, 212, 255, 0.2)',
              borderRadius: '6px',
              fontSize: '0.8rem',
              color: '#e0f7ff',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.5rem',
            }}>
              <span style={{ opacity: 0.65, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                {selectedLegendLayer?.label ?? 'Current'}
              </span>
              <span style={{ fontWeight: 700, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                {activeOverlayRange.min.toFixed(1)}–{activeOverlayRange.max.toFixed(1)}{' '}
                <span style={{ fontWeight: 400, opacity: 0.7 }}>{activeOverlayRange.units}</span>
              </span>
            </div>
          )}
        </ControlGroup>

        {isSuitabilityLayer && (
          <ControlGroup
            icon={<FancyIcon icon={Navigation} animationType="pulse" color="#2A9D8F" />}
            title="Vessel Class"
            ariaLabel="Vessel class for suitability layer"
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {VESSEL_CLASS_OPTIONS.map((vc) => (
                <button
                  key={vc.value}
                  type="button"
                  onClick={() => setVesselClass?.(vc.value)}
                  style={{
                    background: vesselClass === vc.value ? 'rgba(42,157,143,0.25)' : 'rgba(255,255,255,0.05)',
                    border: `1.5px solid ${vesselClass === vc.value ? '#2A9D8F' : 'rgba(255,255,255,0.12)'}`,
                    borderRadius: 6,
                    color: vesselClass === vc.value ? '#2A9D8F' : '#b0c4d8',
                    padding: '0.35rem 0.6rem',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    fontWeight: vesselClass === vc.value ? 600 : 400,
                    transition: 'all 0.15s',
                  }}
                >
                  <div>{vc.label}</div>
                  <div style={{ fontSize: '0.7rem', opacity: 0.6, marginTop: 1 }}>{vc.examples}</div>
                </button>
              ))}
            </div>
          </ControlGroup>
        )}

        {/* Route Forecast rides the Vessel Class chosen just above, so it lives
            with the suitability layer instead of on every layer. */}
        {isSuitabilityLayer && (
          <ControlGroup
            icon={<FancyIcon icon={Route} animationType="pulse" color="#38bdf8" />}
            title="Route Forecast"
            ariaLabel="Vessel route suitability forecast"
          >
            <CookIslandsRouteControls
              routePoints={routePoints}
              routePickMode={routePickMode}
              setRoutePickMode={setRoutePickMode}
              routeSpeedKt={routeSpeedKt}
              setRouteSpeedKt={setRouteSpeedKt}
              routeDepartureTime={routeDepartureTime}
              setRouteDepartureTime={setRouteDepartureTime}
              routeForecastLoading={routeForecastLoading}
              routeForecastError={routeForecastError}
              maxDepartureTime={forecastEndTime}
              minDepartureTime={forecastStartTime}
              timeDisplayZone={timeDisplayZone}
              onRunRouteForecast={onRunRouteForecast}
              onClearRoute={onClearRoute}
              onUndoRoutePoint={onUndoRoutePoint}
            />
          </ControlGroup>
        )}

        {isSuitabilityLayer && (
          <ControlGroup
            icon={<FancyIcon icon={SlidersHorizontal} animationType="pulse" color="#F4A261" />}
            title="Hazard Thresholds"
            ariaLabel="Suitability classification basis"
          >
            <div
              className="map-display-option__segmented"
              role="radiogroup"
              aria-label="Suitability classification basis"
            >
              <button
                type="button"
                className={`map-display-option__btn${!isCustomEnvelope ? ' map-display-option__btn--active' : ''}`}
                role="radio"
                aria-checked={!isCustomEnvelope}
                onClick={() => setSuitabilityMode?.('preset')}
              >
                Vessel preset
              </button>
              <button
                type="button"
                className={`map-display-option__btn${isCustomEnvelope ? ' map-display-option__btn--active' : ''}`}
                role="radio"
                aria-checked={isCustomEnvelope}
                onClick={() => setSuitabilityMode?.('custom')}
              >
                Custom envelope
              </button>
            </div>

            <div style={{ fontSize: '0.72rem', color: '#8fa8c2', marginTop: '0.5rem', lineHeight: 1.35 }}>
              {isCustomEnvelope
                ? `User-defined estimate for ${VESSEL_CLASS_OPTIONS.find((v) => v.value === vesselClass)?.label ?? 'this vessel'}. Applies to the map only.`
                : 'Uses the configured wind/wave thresholds for the selected vessel class.'}
            </div>

            {!isCustomEnvelope ? (
              <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <div style={{ fontSize: '0.78rem', color: '#b0c4d8' }}>
                  Caution — Wind {formatWind(effectiveEnvelope.cautionWindKt)} · Wave {formatWave(effectiveEnvelope.cautionWaveHeightM)}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#b0c4d8' }}>
                  Warning — Wind {formatWind(effectiveEnvelope.maxWindKt)} · Wave {formatWave(effectiveEnvelope.maxWaveHeightM)}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <EnvelopeRangeSlider
                  label="Wind"
                  unit="kt"
                  min={0}
                  max={windSliderMax}
                  step={1}
                  cautionValue={effectiveEnvelope.cautionWindKt}
                  avoidValue={effectiveEnvelope.maxWindKt}
                  onCautionChange={(v) => updateCustomEnvelope('cautionWindKt', v)}
                  onAvoidChange={(v) => updateCustomEnvelope('maxWindKt', v)}
                  formatValue={formatWind}
                />
                <EnvelopeRangeSlider
                  label="Wave"
                  unit="m"
                  min={0}
                  max={waveSliderMax}
                  step={0.1}
                  cautionValue={effectiveEnvelope.cautionWaveHeightM}
                  avoidValue={effectiveEnvelope.maxWaveHeightM}
                  onCautionChange={(v) => updateCustomEnvelope('cautionWaveHeightM', v)}
                  onAvoidChange={(v) => updateCustomEnvelope('maxWaveHeightM', v)}
                  formatValue={formatWave}
                />
                <div className="envelope-actions">
                  <div className="envelope-actions__buttons">
                    <button
                      type="button"
                      className="envelope-reset-btn"
                      disabled={!customEnvelopeChanged}
                      onClick={resetCustomEnvelope}
                      title="Restore this vessel's preset wind/wave thresholds"
                    >
                      <RotateCcw size={13} />
                      Restore defaults
                    </button>
                    <button
                      type="button"
                      className="envelope-save-btn"
                      disabled={!customEnvelopeIsDirty}
                      onClick={saveCustomEnvelope}
                      title="Save these ranges for this vessel in this browser"
                    >
                      <Save size={13} />
                      Save ranges
                    </button>
                  </div>
                  <span
                    className={`envelope-actions__status${customEnvelopeSaveError ? ' envelope-actions__status--error' : ''}`}
                    role={customEnvelopeSaveError ? 'alert' : 'status'}
                  >
                    {customEnvelopeSaveError
                      || (customEnvelopeIsDirty
                        ? (customEnvelopeFromShare
                          ? 'Ranges from a shared link, not saved. Saving replaces your own ranges for this vessel.'
                          : 'Unsaved changes.')
                        : customEnvelope
                          ? 'Saved for this vessel in this browser.'
                          : 'Using the vessel preset.')}
                  </span>
                </div>
              </div>
            )}
          </ControlGroup>
        )}

        {/* Below 1024px there is no Impacts tab, so the inundation controls stay
            here, grouped under the layer picker. On desktop they live in the
            Impacts tab instead. */}
        {!isDesktopPanel && isRasterInundation && inundationControlGroups}

        {forecastTimeGroup}

        {/* ── Global tools below: apply regardless of which layer is selected ── */}

        <ControlGroup
          icon={<FancyIcon icon={AlertTriangle} animationType="pulse" color="#f39c12" />}
          title="Coastal Risk"
          ariaLabel="Coastal flood risk points"
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.78rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={activeLayers?.riskPoints !== false}
              onChange={(e) => setActiveLayers?.(prev => ({ ...prev, riskPoints: e.target.checked }))}
            />
            Show coastal risk points
          </label>
        </ControlGroup>

        {/* Desktop (>=1024px) shows impacts inline under the Inundation
            controls (see "Flood Impacts" above) whenever the inundation layer
            is selected. Below 1024px there's no side column for that, so this
            keeps the click-to-open-bottom-sheet control. */}
        {!isDesktopPanel && (
          <ControlGroup
            icon={<FancyIcon icon={DollarSign} animationType="pulse" color="#E63946" />}
            title="Impact Assessment"
            ariaLabel="RiskScape flood impact assessment"
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.68rem', color: '#8fa8c2' }}>
                Estimated economic damage and exposed buildings from the latest forecast, modeled by RiskScape.
              </span>
              <button type="button" className="map-display-option__btn" onClick={onShowImpact}>
                View impact assessment
              </button>
            </div>
          </ControlGroup>
        )}

        <ControlGroup
          icon={<FancyIcon icon={MapPin} animationType="pulse" color="#4caf50" />}
          title={UI_CONFIG.SECTIONS.ISLAND_NAVIGATION.title}
          ariaLabel={UI_CONFIG.SECTIONS.ISLAND_NAVIGATION.ariaLabel}
        >
          <IslandZoomControl
            islands={ISLAND_ZOOM_TARGETS}
            selectedIsland={selectedIslandId}
            onIslandChange={(id) => {
              setSelectedIslandId(id);
              zoomToIsland(id);
            }}
          />
        </ControlGroup>

        <ControlGroup
          icon={<FancyIcon icon={Settings} animationType="spin" color="#9c27b0" />}
          title={UI_CONFIG.SECTIONS.DISPLAY_OPTIONS.title}
          ariaLabel={UI_CONFIG.SECTIONS.DISPLAY_OPTIONS.ariaLabel}
        >
          <OpacityControl
            opacity={opacity}
            onOpacityChange={setOpacity}
            formatPercent={UI_CONFIG.FORMATS.opacityPercent}
            ariaLabel={UI_CONFIG.ARIA_LABELS.overlayOpacity}
          />

          {/* Terrain toggle — moved to the advanced-features branch, disabled
              here on main. Restore by uncommenting this block
              (terrainEnabled/setTerrainEnabled/terrainAvailable props are
              still threaded through above, untouched, so re-enabling is just
              removing this comment).

          <div className="map-display-option">
            <div className="map-display-option__label">Terrain</div>
            <div className="map-display-option__segmented" role="radiogroup" aria-label="Terrain display mode">
              <button
                type="button"
                className={`map-display-option__btn${!terrainEnabled ? ' map-display-option__btn--active' : ''}`}
                role="radio"
                aria-checked={!terrainEnabled}
                onClick={() => setTerrainEnabled?.(false)}
              >
                Off
              </button>
              <button
                type="button"
                className={`map-display-option__btn${terrainEnabled ? ' map-display-option__btn--active' : ''}`}
                role="radio"
                aria-checked={terrainEnabled}
                disabled={!terrainAvailable}
                onClick={() => terrainAvailable && setTerrainEnabled?.(true)}
                title={terrainAvailable ? 'Enable 3D terrain relief' : 'Terrain DEM not configured'}
              >
                On
              </button>
            </div>
            <div className="map-display-option__hint">
              {terrainAvailable
                ? isRasterInundation
                  ? '3D terrain shows land relief. Inundation colours still represent modelled flood depth.'
                  : '3D terrain adds topographic shading to the basemap.'
                : 'Terrain DEM not configured — set REACT_APP_RAROTONGA_DEM_TILES to enable.'}
            </div>
          </div>
          */}

          {/* Flood display (2D depth bands / Experimental 3D depth) — moved to
              the advanced-features branch, disabled here on main. Restore by
              uncommenting this block (floodDisplayMode/setFloodDisplayMode,
              flood3dElevScale/setFlood3dElevScale, flood3DAvailable,
              flood3DConfig, and terrainEnabled props are still threaded
              through above, untouched, so re-enabling is just removing this
              comment).

          {isRasterInundation && (
            <div className="map-display-option">
              <div className="map-display-option__label">Flood display</div>
              <div className="map-display-option__segmented" role="radiogroup" aria-label="Flood display mode">
                <button
                  type="button"
                  className={`map-display-option__btn${floodDisplayMode !== '3d' ? ' map-display-option__btn--active' : ''}`}
                  role="radio"
                  aria-checked={floodDisplayMode !== '3d'}
                  onClick={() => setFloodDisplayMode?.('2d')}
                >
                  2D depth bands
                </button>
                <button
                  type="button"
                  className={`map-display-option__btn${floodDisplayMode === '3d' ? ' map-display-option__btn--active' : ''}`}
                  role="radio"
                  aria-checked={floodDisplayMode === '3d'}
                  disabled={!flood3DAvailable}
                  onClick={() => flood3DAvailable && setFloodDisplayMode?.('3d')}
                  title={flood3DAvailable ? 'Enable experimental 3D flood depth' : flood3DConfig?.unavailableReason}
                >
                  Experimental 3D depth
                </button>
              </div>
              <div className="map-display-option__hint">
                {floodDisplayMode === '3d'
                  ? `Column height is exaggerated ${flood3dElevScale}× for readability. Hover a column to see exact depth. Colour also shows depth.`
                  : 'Switch to 3D to see flood depth as extruded columns. Hover for exact depth.'}
              </div>
              {floodDisplayMode === '3d' && (
                <div className="opacity-control" style={{ marginTop: '0.5rem' }}>
                  <label htmlFor="elev-scale-slider">
                    Height exaggeration: <span>{flood3dElevScale}×</span>
                  </label>
                  <input
                    id="elev-scale-slider"
                    type="range"
                    className="opacity-slider"
                    min={1}
                    max={10}
                    step={1}
                    value={flood3dElevScale}
                    onChange={(e) => setFlood3dElevScale?.(Number(e.target.value))}
                    aria-label="Column height exaggeration factor"
                  />
                </div>
              )}
              {floodDisplayMode === '3d' && terrainEnabled && (
                <div style={{
                  marginTop: '0.5rem',
                  padding: '6px 9px',
                  background: 'rgba(255, 152, 0, 0.12)',
                  border: '1px solid rgba(255, 152, 0, 0.4)',
                  borderRadius: '5px',
                  fontSize: '0.8rem',
                  color: '#ffb74d',
                  lineHeight: 1.4,
                }}>
                  Terrain + 3D active: columns on higher ground appear taller even at the same flood depth. Use colour to compare depth across the map.
                </div>
              )}
            </div>
          )}
          */}
        </ControlGroup>

        <ControlGroup
          icon={<FancyIcon icon={Info} animationType="pulse" color="#2196f3" />}
          title={UI_CONFIG.SECTIONS.DATA_INFO.title}
          ariaLabel={UI_CONFIG.SECTIONS.DATA_INFO.ariaLabel}
        >
          <DataInfo
            source={UI_CONFIG.DATA_SOURCE.source}
            model={UI_CONFIG.DATA_SOURCE.model}
            resolution={UI_CONFIG.DATA_SOURCE.resolution}
            updateFrequency={UI_CONFIG.DATA_SOURCE.updateFrequency}
            coverage={UI_CONFIG.DATA_SOURCE.coverage}
          />
        </ControlGroup>
          </div>
          )}
        </div>

      </div>

      <InundationThresholdEditor
        isOpen={showThresholdEditor}
        onClose={() => setShowThresholdEditor(false)}
        categories={inundationThresholds.categories}
        paletteId={inundationThresholds.paletteId}
        minVisibleDepth={inundationThresholds.minVisibleDepth}
        validationErrors={inundationThresholds.validationErrors}
        isDirty={inundationThresholds.isDirty}
        savedAt={inundationThresholds.savedAt}
        timeDisplayZone={timeDisplayZone}
        saveError={inundationThresholds.saveError}
        canUndo={inundationThresholds.canUndo}
        canRedo={inundationThresholds.canRedo}
        updateRow={inundationThresholds.updateRow}
        addRow={inundationThresholds.addRow}
        removeRow={inundationThresholds.removeRow}
        moveRow={inundationThresholds.moveRow}
        updateMinVisibleDepth={inundationThresholds.updateMinVisibleDepth}
        undo={inundationThresholds.undo}
        redo={inundationThresholds.redo}
        applyPalette={inundationThresholds.applyPalette}
        save={inundationThresholds.save}
        resetToDefaults={inundationThresholds.resetToDefaults}
        exportJson={inundationThresholds.exportJson}
        importJson={inundationThresholds.importJson}
        renderMode={inundationRenderMode}
        setRenderMode={setInundationRenderMode}
      />
    </div>
  );
};

export default ForecastApp;
