/**
 * EnhancedForecastApp - Modern Niue Marine Forecast Application
 * 
 * Integrates all Phase 2-4 components into a cohesive marine forecast system
 * with modern React patterns, hooks, and professional UI components.
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Import modern components from Phase 2-3
import ModernHeader from '../components/ModernHeader';
import { 
  ControlGroup, 
  VariableButtons, 
  TimeControl, 
  OpacityControl, 
  DataInfo,
  LegendToggle,
  LoadingIndicator 
} from '../components/UIComponents';
import FancyIcon from '../components/FancyIcon';
import CompassRose from '../components/CompassRose';
import ProfessionalLegend from '../components/ProfessionalLegend';

// Import hooks from Phase 4
import { 
  useMapInteraction, 
  useUIState, 
  useForecast, 
  useWindowSize 
} from '../hooks';

// Import utilities from Phase 4
import { WorldClassVisualization } from '../utils';

// Import configurations
import { NIUE_CONFIG } from '../config/NiueConfig';

// Fix Leaflet default markers
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Niue marine forecast layers
const MARINE_LAYERS = {
  composite_hs_dirm: {
    label: 'Wave Height + Direction',
    value: 'composite_hs_dirm',
    type: 'waveHeight',
    layer: 'composite_hs_dirm', 
    url: 'https://gemthreddshpc.spc.int/thredds/wms/POP/model/country/spc/forecast/hourly/NIU/ForecastNiue_latest.nc',
    styles: 'default-scalar/jet',
    units: 'm',
    colorRange: [0, 8],
    composite: true,
    priority: 1
  },
  hs: {
    label: 'Significant Wave Height',
    value: 'hs',
    type: 'waveHeight',
    layer: 'hs',
    url: 'https://gemthreddshpc.spc.int/thredds/wms/POP/model/country/spc/forecast/hourly/NIU/ForecastNiue_latest.nc',
    styles: 'default-scalar/jet',
    units: 'm',
    colorRange: [0, 6],
    priority: 2
  },
  tm02: {
    label: 'Mean Wave Period',
    value: 'tm02',
    type: 'wavePeriod',
    layer: 'tm02',
    url: 'https://gemthreddshpc.spc.int/thredds/wms/POP/model/country/spc/forecast/hourly/NIU/ForecastNiue_latest.nc',
    styles: 'default-scalar/rainbow',
    units: 's',
    colorRange: [2, 20],
    priority: 3
  },
  tpeak: {
    label: 'Peak Wave Period',
    value: 'tpeak',
    type: 'wavePeriod',
    layer: 'tpeak',
    url: 'https://gemthreddshpc.spc.int/thredds/wms/POP/model/country/spc/forecast/hourly/NIU/ForecastNiue_latest.nc',
    styles: 'default-scalar/rainbow',
    units: 's',
    colorRange: [4, 25],
    priority: 4
  },
  dirm: {
    label: 'Wave Direction',
    value: 'dirm',
    type: 'waveDirection',
    layer: 'dirm',
    url: 'https://gemthreddshpc.spc.int/thredds/wms/POP/model/country/spc/forecast/hourly/NIU/ForecastNiue_latest.nc',
    styles: 'default-scalar/occam',
    units: '°',
    colorRange: [0, 360],
    priority: 5
  }
};

const EnhancedForecastApp = () => {
  // Map reference
  const mapRef = useRef(null);
  
  // State for UI interactions
  const [currentLayer, setCurrentLayer] = useState('composite_hs_dirm');
  const [layerOpacity, setLayerOpacity] = useState(0.7);
  const [showLegend, setShowLegend] = useState(true);
  const [bottomCanvasData, setBottomCanvasData] = useState(null);
  const [showBottomCanvas, setShowBottomCanvas] = useState(false);
  
  // Initialize hooks
  const windowSize = useWindowSize();
  const uiState = useUIState({
    layerSettings: {
      selectedLayer: currentLayer,
      opacity: layerOpacity
    }
  });
  
  const forecast = useForecast({
    refreshInterval: 10 * 60 * 1000, // 10 minutes
    debugMode: process.env.NODE_ENV === 'development'
  });
  
  const mapInteraction = useMapInteraction({
    mapInstance: mapRef,
    currentSliderDate: forecast.selectedTime,
    selectedLayer: MARINE_LAYERS[currentLayer],
    layerOpacity,
    setBottomCanvasData,
    setShowBottomCanvas,
    debugMode: process.env.NODE_ENV === 'development'
  });

  // Initialize utilities
  const [visualization] = useState(() => new WorldClassVisualization({
    defaultPalette: 'waveHeight',
    canvasSize: windowSize.isMobile ? { width: 300, height: 50 } : { width: 400, height: 60 }
  }));

  // Handle layer changes
  const handleLayerChange = useCallback((layerValue) => {
    setCurrentLayer(layerValue);
    uiState.setSelectedLayer(layerValue);
    
    const layerConfig = MARINE_LAYERS[layerValue];
    if (layerConfig && mapInteraction.mapReady) {
      mapInteraction.addWMSLayer(layerConfig);
    }
  }, [uiState, mapInteraction]);

  // Handle opacity changes
  const handleOpacityChange = useCallback((opacity) => {
    setLayerOpacity(opacity);
    uiState.setLayerOpacity(opacity);
    mapInteraction.updateLayerOpacity(opacity);
  }, [uiState, mapInteraction]);

  // Handle time changes
  const handleTimeChange = useCallback((time) => {
    forecast.setSelectedTime(time);
  }, [forecast]);

  // Initialize map and layers
  useEffect(() => {
    if (mapInteraction.mapReady && currentLayer) {
      const layerConfig = MARINE_LAYERS[currentLayer];
      mapInteraction.addWMSLayer(layerConfig);
    }
  }, [mapInteraction.mapReady, currentLayer, mapInteraction]);

  // Update forecast layer when selection changes
  useEffect(() => {
    if (currentLayer) {
      forecast.setSelectedLayer(currentLayer);
    }
  }, [currentLayer, forecast]);

  // Handle bottom canvas close
  const handleCanvasClose = useCallback(() => {
    setShowBottomCanvas(false);
    mapInteraction.hideCanvas();
  }, [mapInteraction]);

  // Get responsive classes
  const responsiveClasses = uiState.getResponsiveClasses();

  return (
    <div className={responsiveClasses.container}>
      {/* Modern Header */}
      <ModernHeader 
        config={NIUE_CONFIG}
        compact={uiState.compactMode}
        onToggleTheme={uiState.toggleTheme}
        onToggleCompact={uiState.toggleCompactMode}
      />

      {/* Main Map Container */}
      <div className="map-container">
        <MapContainer
          ref={mapRef}
          center={NIUE_CONFIG.coordinates}
          zoom={12}
          zoomControl={false}
          attributionControl={false}
          maxBounds={[
            [-19.2, -169.9], // Southwest
            [-18.8, -169.6]  // Northeast  
          ]}
          maxBoundsViscosity={1.0}
          style={{ 
            height: '100vh', 
            width: '100%',
            position: 'relative',
            zIndex: 1 
          }}
        >
          {/* Base Tile Layer */}
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            subdomains="abcd"
            maxZoom={19}
          />
        </MapContainer>

        {/* Compass Rose */}
        {uiState.display.showCompass && (
          <CompassRose
            position="top-right"
            theme={uiState.theme}
            size={windowSize.isMobile ? 'small' : 'medium'}
          />
        )}

        {/* Professional Legend */}
        {showLegend && (
          <ProfessionalLegend
            layer={MARINE_LAYERS[currentLayer]}
            isVisible={showLegend}
            onToggle={() => setShowLegend(!showLegend)}
            position={windowSize.isMobile ? 'bottom-center' : 'bottom-right'}
            theme={uiState.theme}
            visualization={visualization}
          />
        )}
      </div>

      {/* Left Control Panel */}
      <div 
        className={responsiveClasses.leftPanel}
        style={{
          position: 'fixed',
          top: '80px',
          left: uiState.isLeftPanelOpen ? '20px' : '-420px',
          width: uiState.getResponsivePanelWidth('left'),
          height: 'calc(100vh - 100px)',
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(20px)',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.15)',
          zIndex: 1000,
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden'
        }}
      >
        <div className="panel-content" style={{ padding: '24px', height: '100%', overflowY: 'auto' }}>
          {/* Layer Selection */}
          <ControlGroup 
            title="Marine Variables"
            icon="Waves"
            isCollapsed={false}
            onToggle={() => {}}
          >
            <VariableButtons
              variables={Object.values(MARINE_LAYERS)}
              selectedVariable={currentLayer}
              onVariableChange={handleLayerChange}
              loading={forecast.loading}
            />
          </ControlGroup>

          {/* Time Control */}
          <ControlGroup
            title="Forecast Time"
            icon="Timer"
            isCollapsed={false}
            onToggle={() => {}}
          >
            <TimeControl
              availableTimes={forecast.availableTimes}
              selectedTime={forecast.selectedTime}
              onTimeChange={handleTimeChange}
              loading={forecast.loading}
              autoPlay={uiState.layerSettings.autoPlay}
              onAutoPlayToggle={(autoPlay) => 
                uiState.updateLayerSettings({ autoPlay })
              }
            />
          </ControlGroup>

          {/* Layer Opacity */}
          <ControlGroup
            title="Layer Opacity"
            icon="Navigation"
            isCollapsed={false}
            onToggle={() => {}}
          >
            <OpacityControl
              opacity={layerOpacity}
              onOpacityChange={handleOpacityChange}
              disabled={mapInteraction.isLoading}
            />
          </ControlGroup>

          {/* Data Information */}
          {forecast.currentForecast && (
            <ControlGroup
              title="Data Information"
              icon="CloudRain"
              isCollapsed={true}
              onToggle={() => {}}
            >
              <DataInfo
                layer={MARINE_LAYERS[currentLayer]}
                forecast={forecast.currentForecast}
                lastUpdated={forecast.currentForecast.metadata?.fetchTime}
              />
            </ControlGroup>
          )}
        </div>
      </div>

      {/* Panel Toggle Button */}
      <button
        onClick={uiState.toggleLeftPanel}
        className="panel-toggle"
        style={{
          position: 'fixed',
          top: '50%',
          left: uiState.isLeftPanelOpen ? 
            `${uiState.getResponsivePanelWidth('left') + 40}px` : '20px',
          transform: 'translateY(-50%)',
          zIndex: 1001,
          background: 'rgba(6, 182, 212, 0.9)',
          border: 'none',
          borderRadius: '50%',
          width: '48px',
          height: '48px',
          color: 'white',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(10px)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: '0 8px 24px rgba(6, 182, 212, 0.3)'
        }}
        title={uiState.isLeftPanelOpen ? 'Hide Controls' : 'Show Controls'}
      >
        <FancyIcon 
          icon={uiState.isLeftPanelOpen ? "ChevronLeft" : "ChevronRight"}
          size="24"
          animation="none"
        />
      </button>

      {/* Legend Toggle */}
      <LegendToggle
        isVisible={showLegend}
        onToggle={() => setShowLegend(!showLegend)}
        position="bottom-left"
      />

      {/* Loading Indicator */}
      {(forecast.loading || mapInteraction.isLoading) && (
        <LoadingIndicator
          message={
            forecast.loading ? 'Loading forecast data...' : 
            mapInteraction.isLoading ? 'Processing map data...' : 
            'Loading...'
          }
          position="top-center"
        />
      )}

      {/* Bottom Data Canvas */}
      {showBottomCanvas && bottomCanvasData && (
        <div 
          className={responsiveClasses.bottomCanvas}
          style={{
            position: 'fixed',
            bottom: '0',
            left: '0',
            right: '0',
            height: '200px',
            background: 'rgba(255, 255, 255, 0.98)',
            backdropFilter: 'blur(20px)',
            borderTop: '1px solid rgba(0, 0, 0, 0.1)',
            zIndex: 999,
            padding: '20px',
            transform: showBottomCanvas ? 'translateY(0)' : 'translateY(100%)',
            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
        >
          <div className="canvas-header" style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '16px'
          }}>
            <h3 style={{ 
              margin: 0, 
              color: NIUE_CONFIG.colors.primary,
              fontFamily: '"SF Mono", Consolas, monospace',
              fontSize: '18px'
            }}>
              Marine Data Point
            </h3>
            <button
              onClick={handleCanvasClose}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '8px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <FancyIcon icon="X" size="20" />
            </button>
          </div>
          
          <div className="canvas-content">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
              <div>
                <strong>Coordinates:</strong><br />
                {bottomCanvasData.coordinates ? 
                  `${bottomCanvasData.coordinates.lat.toFixed(4)}, ${bottomCanvasData.coordinates.lng.toFixed(4)}` : 
                  'Unknown'
                }
              </div>
              <div>
                <strong>Layer:</strong><br />
                {bottomCanvasData.layer || 'Unknown'}
              </div>
              <div>
                <strong>Value:</strong><br />
                {bottomCanvasData.value} {bottomCanvasData.units || ''}
              </div>
              <div>
                <strong>Location:</strong><br />
                {bottomCanvasData.location || 'Niue Waters'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Display */}
      {forecast.error && (
        <div style={{
          position: 'fixed',
          top: '100px',
          right: '20px',
          background: 'rgba(220, 38, 38, 0.95)',
          color: 'white',
          padding: '16px',
          borderRadius: '12px',
          zIndex: 1002,
          maxWidth: '300px',
          backdropFilter: 'blur(10px)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <FancyIcon icon="AlertTriangle" size="20" />
            <strong>Forecast Error</strong>
          </div>
          <p style={{ margin: 0, fontSize: '14px' }}>
            {forecast.error.message}
          </p>
          {forecast.error.canRetry && (
            <button
              onClick={forecast.retry}
              style={{
                marginTop: '12px',
                background: 'rgba(255, 255, 255, 0.2)',
                border: 'none',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default EnhancedForecastApp;