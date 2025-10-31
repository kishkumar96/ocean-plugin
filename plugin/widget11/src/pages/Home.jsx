import React, { useEffect, useMemo, useState } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import addWMSTileLayer from "./addWMSTileLayer";
import BottomOffCanvas from "./BottomOffCanvas";
import { useForecast } from "../hooks/useForecast";
import ForecastApp from "../components/ForecastApp";
import ModernHeader from "../components/ModernHeader";
import WorldClassVisualization from "../utils/WorldClassVisualization";
import LegendCleanup from "../components/LegendCleanup";
import TuvaluConfig from "../config/TuvaluConfig";
import InundationMarkers from "../components/InundationMarkers";
import ForecastImagePopup from "../components/ForecastImagePopup";
import IslandSelector from "../components/IslandSelector";
import IslandComparisonDashboard from "../components/IslandComparisonDashboard";
import logger from "../utils/logger";

// Initialize world-class visualization system
const worldClassViz = new WorldClassVisualization();

// World-class legend URL generator
const getWorldClassLegendUrl = (variable, range, unit) => {
  return worldClassViz.getWorldClassLegendUrl(variable, range, unit);
};

const variableConfigMap = {
  hs: (maxHeight) => worldClassViz.getAdaptiveWaveHeightConfig(maxHeight, "tropical"),
  tm02: () => worldClassViz.getAdaptiveWavePeriodConfig(20.0, "tuvalu"),
  tpeak: () => ({
    style: "default-scalar/psu-magma",
    // Use full range starting from zero for peak wave period visualization
    colorscalerange: "0,13.68",
    numcolorbands: 200,
    belowmincolor: "transparent",
    abovemaxcolor: "extend"
  }),
  inun: () => ({
    style: "default-scalar/seq-Blues",
    colorscalerange: "-0.05,1.63",
    numcolorbands: 220,
    belowmincolor: "transparent",
    abovemaxcolor: "extend"
  }),
  dirm: () => ({ style: "black-arrow", colorscalerange: "" }),
};

// Get adaptive WMS configuration based on variable type and conditions
const getWorldClassConfig = (variable, maxHeight = 6.0) => {
  for (const key in variableConfigMap) {
    if (variable.includes(key)) {
      return variableConfigMap[key](maxHeight);
    }
  }
  // Default fallback
  return worldClassViz.getAdaptiveWaveHeightConfig();
};

const widgetContainerStyle = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "100vw",
  height: "calc(100dvh - 0px)",
  zIndex: 9999,
};

// Set default map center to Tuvalu - covering all 9 atolls
const southWest = L.latLng(-10.8, 176.0);
const northEast = L.latLng(-5.6, 180.0);
const bounds = L.latLngBounds(southWest, northEast);



function TuvaluForecast() {
  // State for inundation marker clicks and forecast image popup
  const [selectedInundationPoint, setSelectedInundationPoint] = useState(null);
  const [showForecastPopup, setShowForecastPopup] = useState(false);
  
  // Multi-island state
  const [selectedIsland, setSelectedIsland] = useState(null);
  const [comparisonIslands, setComparisonIslands] = useState([]);
  const [showComparison, setShowComparison] = useState(false);
  const [inundationData, setInundationData] = useState([]);

  // World-class composite layer configuration for Tuvalu
  // NOTE: Using THREDDS server directly as Tuvalu data is not on ncWMS
  const WAVE_FORECAST_LAYERS = useMemo(() => {
    // THREDDS uses different layer names: Hs, Tp, Tm, Dir
    const mainDomainLayers = [
      // 🌊 Significant Wave Height + Direction Composite
      {
        label: "Tuvalu Wave Height + Direction",
        value: "tuvalu_composite_hs_dir",
        id: 1,
        composite: true,
        description: "Significant wave height with direction arrows for Tuvalu",
        layers: [
          {
            value: "Hs", // THREDDS layer name for significant wave height
            ...getWorldClassConfig('hs', 6.0),
            wmsUrl: TuvaluConfig.WMS_BASE_URL,
            id: 1001,
            legendUrl: getWorldClassLegendUrl('hs', '0,6', 'm'),
            zIndex: 1,
            style: "default-scalar/psu-viridis",
            colorscalerange: "0,6",
            numcolorbands: 256,
          },
          {
            value: "Dir", // THREDDS layer name for wave direction
            style: "black-arrow",
            colorscalerange: "",
            wmsUrl: TuvaluConfig.WMS_BASE_URL,
            id: 1002,
            zIndex: 2,
            opacity: 0.9,
            description: "Wave direction arrows"
          }
        ]
      },
      {
        label: "Tuvalu Mean Wave Period",
        value: "Tm", // THREDDS layer name for mean period
        ...getWorldClassConfig('tm02'),
        id: 4,
        wmsUrl: TuvaluConfig.WMS_BASE_URL,
        legendUrl: getWorldClassLegendUrl('tm02', '0,20', 's'),
        description: "Mean wave period across Tuvalu region"
      },
      {
        label: "Tuvalu Peak Wave Period",
        value: "Tp", // THREDDS layer name for peak period
        ...getWorldClassConfig('tpeak'),
        id: 5,
        wmsUrl: TuvaluConfig.WMS_BASE_URL,
        legendUrl: getWorldClassLegendUrl('tpeak', '0,13.68', 's'),
        description: "Peak wave period across Tuvalu region"
      }
    ];
    
    // Note: Individual atoll layers would need separate NetCDF files
    // For now, using main domain only
    
    return mainDomainLayers;
  }, []);

  // No static inundation layers for Tuvalu (will use dynamic markers instead)
  const STATIC_LAYERS = useMemo(() => {
    return [];
  }, []);
  
  // Combined layers for components that need all layers
  const ALL_LAYERS = useMemo(() => {
    return [...WAVE_FORECAST_LAYERS, ...STATIC_LAYERS];
  }, [WAVE_FORECAST_LAYERS, STATIC_LAYERS]);

  const tuvaluConfig = useMemo(() => ({
    WAVE_FORECAST_LAYERS,
    STATIC_LAYERS,
    ALL_LAYERS,
    WAVE_BUOYS: [], // No buoys for Tuvalu
    bounds,
    addWMSTileLayer,
  }), [WAVE_FORECAST_LAYERS, STATIC_LAYERS, ALL_LAYERS]);
  
  const {
    showBottomCanvas, setShowBottomCanvas,
    bottomCanvasData, setBottomCanvasData,
    activeLayers, setActiveLayers,
    selectedWaveForecast, setSelectedWaveForecast,
    capTime,
    sliderIndex, setSliderIndex,
    isPlaying, setIsPlaying,
    wmsOpacity, setWmsOpacity,
    dynamicLayers,
    isUpdatingVisualization,
    mapRef,
    totalSteps,
    currentSliderDate,
    mapInstance,
    minIndex,
  } = useForecast(tuvaluConfig);

  // Debug: Track state changes
  useEffect(() => {
    logger.debug('HOME', 'BottomCanvas state changed', { 
      show: showBottomCanvas, 
      hasData: !!bottomCanvasData 
    });
  }, [showBottomCanvas, bottomCanvasData]);

  // Handle inundation marker clicks
  const handleInundationMarkerClick = (point) => {
    logger.island(point.location, 'Inundation marker clicked', point);
    setSelectedInundationPoint(point);
    setShowForecastPopup(true);
  };

  // Handle island selection
  const handleIslandChange = (island) => {
    logger.island(island.name, 'Island selected');
    setSelectedIsland(island);
    
    // Optionally zoom to island - check if mapInstance is a valid Leaflet map
    const map = mapInstance?.current;
    if (map && typeof map.setView === 'function') {
      try {
        map.setView([island.lat, island.lon], 10);
      } catch (error) {
        logger.error('MAP', 'Failed to set view for island', { island: island.name, error });
      }
    } else {
      logger.debug('MAP', 'Map instance not ready for setView', { 
        hasMapInstance: !!map,
        mapInstanceType: typeof map
      });
    }
  };

  // Handle comparison mode
  const handleComparisonChange = (islands) => {
    logger.info('COMPARISON', `Comparison updated: ${islands.length} islands`, islands);
    setComparisonIslands(islands);
    setShowComparison(islands.length > 0);
  };

  // Make function available globally for popup button clicks
  useEffect(() => {
    window.showForecastImage = (pointIdOrName) => {
      const point =
        inundationData.find(p => p.id === pointIdOrName) ||
        inundationData.find(p => p.location === pointIdOrName) ||
        window.__inundationPointCache?.[pointIdOrName] ||
        { location: pointIdOrName };
      
      logger.forecast(`Show forecast image triggered for ${point.location}`, point);
      setSelectedInundationPoint(point);
      setShowForecastPopup(true);
    };

    return () => {
      delete window.showForecastImage;
    };
  }, [inundationData]);

  return (
    <div style={widgetContainerStyle}>
      <ModernHeader />
      
      {/* World-Class Multi-Island Controls */}
      <div style={{
        position: 'absolute',
        top: '80px',
        left: '20px',
        zIndex: 1000,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        padding: '15px',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        maxWidth: '400px'
      }}>
        <IslandSelector 
          onIslandChange={handleIslandChange}
          onComparisonChange={handleComparisonChange}
          currentIsland={selectedIsland?.name}
        />
      </div>
      
      {/* Multi-Island Comparison Dashboard */}
      {showComparison && (
        <div style={{
          position: 'absolute',
          top: '80px',
          right: '20px',
          zIndex: 999,
          maxWidth: '800px',
          maxHeight: 'calc(100vh - 100px)',
          overflow: 'auto'
        }}>
          <IslandComparisonDashboard 
            comparisonIslands={comparisonIslands}
            inundationData={inundationData}
          />
        </div>
      )}
      
      {/* Inundation Markers Layer */}
      <InundationMarkers 
        mapInstance={mapInstance}
        onMarkerClick={handleInundationMarkerClick}
        onDataLoaded={setInundationData}
      />
      
      <ForecastApp
        WAVE_FORECAST_LAYERS={dynamicLayers}
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
        currentSliderDate={currentSliderDate}
        capTime={capTime}
        activeLayers={activeLayers}
        setActiveLayers={setActiveLayers}
        mapRef={mapRef}
        mapInstance={mapInstance}
        setBottomCanvasData={setBottomCanvasData}
        setShowBottomCanvas={setShowBottomCanvas}
        isUpdatingVisualization={isUpdatingVisualization}
        minIndex={minIndex}

      />

      <LegendCleanup 
        selectedWaveForecast={selectedWaveForecast}
        WAVE_FORECAST_LAYERS={ALL_LAYERS}
      />
      
      <BottomOffCanvas
        show={showBottomCanvas}
        onHide={() => {
          setShowBottomCanvas(false);
          // Remove any active markers when canvas is hidden
          if (mapInstance?.current) {
            mapInstance.current.eachLayer((layer) => {
              const isCircleMarker = layer instanceof L.CircleMarker && layer.options?.color === '#ff6b35';
              const isPinMarker = layer instanceof L.Marker && layer.options?.title === 'data-source-pin';
              if (isCircleMarker || isPinMarker) {
                mapInstance.current.removeLayer(layer);
              }
            });
          }
        }}
        data={bottomCanvasData}
      />

      {/* Forecast Image Popup Modal */}
      <ForecastImagePopup
        show={showForecastPopup}
        onHide={() => setShowForecastPopup(false)}
        location={selectedInundationPoint?.location}
        inundationPoint={selectedInundationPoint}
      />
    </div>
  );
}

export default TuvaluForecast;
