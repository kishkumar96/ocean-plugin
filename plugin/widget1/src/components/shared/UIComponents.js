/**
 * Shared UI Components for Niue Marine Forecast Application
 * 
 * Reusable components with consistent styling and accessibility
 * to maintain uniformity across widgets.
 */

import React from 'react';
import { 
  Waves, 
  Wind, 
  Navigation, 
  Activity, 
  Timer, 
  Triangle, 
  CloudRain,
  Play,
  Pause,
  Info
} from 'lucide-react';

/**
 * Control Group Container with consistent header styling
 */
export const ControlGroup = ({ 
  icon, 
  title, 
  ariaLabel, 
  children, 
  className = '' 
}) => (
  <div className={`control-group ${className}`} role="group" aria-label={ariaLabel}>
    <h3>
      {typeof icon === 'string' ? icon : icon}
      {title}
    </h3>
    {children}
  </div>
);

/**
 * Variable Selection Buttons with Lucide React Icons
 */
export const VariableButtons = ({ 
  layers, 
  selectedValue, 
  onVariableChange, 
  labelMap = {},
  ariaLabel = "Select forecast variable",
  getVariableIcon = null
}) => {
  const getShortLabel = (label) => labelMap[label] || label;
  
  // Default icon mapping for Niue marine variables
  const getDefaultIcon = (layer) => {
    const layerName = layer.value?.toLowerCase() || '';
    const layerLabel = layer.label?.toLowerCase() || '';
    
    // Inundation layers
    if (layerName.includes('inun') || layerLabel.includes('inundation')) {
      return <CloudRain size={18} />;
    }
    
    // Wave height layers
    if (layerName.includes('hs') || layerLabel.includes('wave height') || layerName.includes('composite')) {
      return <Waves size={18} />;
    }
    
    // Mean wave period (tm02)
    if (layerName.includes('tm02') || (layerLabel.includes('mean') && layerLabel.includes('period'))) {
      return <Timer size={18} />;
    }
    
    // Peak wave period (tpeak)
    if (layerName.includes('tpeak') || (layerLabel.includes('peak') && layerLabel.includes('period'))) {
      return <Triangle size={18} />;
    }
    
    // Wave direction layers
    if (layerName.includes('dirm') || layerLabel.includes('direction')) {
      return <Navigation size={18} />;
    }
    
    // Wind layers
    if (layerName.includes('wind') || layerLabel.includes('wind')) {
      return <Wind size={18} />;
    }
    
    // Default to activity icon
    return <Activity size={18} />;
  };
  
  return (
    <div className="variable-buttons" role="radiogroup" aria-label={ariaLabel}>
      {layers.map((layer) => (
        <button
          type="button"
          key={layer.value}
          className={`var-btn ${selectedValue === layer.value ? 'active' : ''}`}
          onClick={() => onVariableChange(layer.value)}
          role="radio"
          aria-checked={selectedValue === layer.value}
          aria-label={`${getShortLabel(layer.label)} forecast variable`}
        >
          <span className="var-btn-icon">
            {getVariableIcon ? getVariableIcon(layer) : getDefaultIcon(layer)}
          </span>
          <span className="var-btn-label">
            {getShortLabel(layer.label)}
          </span>
        </button>
      ))}
    </div>
  );
};

/**
 * Time Control Section
 */
export const TimeControl = ({
  sliderIndex,
  totalSteps,
  currentSliderDate,
  isPlaying,
  capTime,
  onSliderChange,
  onPlayToggle,
  formatDateTime,
  stepHours = 1,
  minIndex = 0
}) => (
  <div className="time-control">
    <div className="forecast-info">
      <div>
        <span>Forecast Hour:</span> 
        <span>+{sliderIndex * stepHours}h</span>
      </div>
      <div>
        <span>Valid DateTime:</span> 
        <span>{formatDateTime ? formatDateTime(currentSliderDate) : 'Loading...'}</span>
      </div>
    </div>
    
    <div className="time-slider-container">
      <input
        title="Forecast Time"
        aria-label="Forecast Time"
        type="range"
        className="time-slider"
        min={minIndex}
        max={totalSteps}
        value={sliderIndex}
        onChange={(e) => onSliderChange(e.target.value)}
        disabled={capTime?.loading}
      />
      
      <div className="playback-controls">
        <button 
          type="button"
          className="play-btn"
          onClick={onPlayToggle}
          disabled={capTime?.loading}
          aria-label={isPlaying ? 'Pause forecast animation' : 'Play forecast animation'}
        >
          {isPlaying ? (
            <>
              <Pause size={16} />
              <span>Pause</span>
            </>
          ) : (
            <>
              <Play size={16} />
              <span>Play</span>
            </>
          )}
        </button>
      </div>
    </div>
    
    <div className="forecast-info">
      <div>
        <span>Forecast Length:</span> 
        <strong>{totalSteps + 1} hours</strong>
      </div>
    </div>
  </div>
);

/**
 * Opacity Control
 */
export const OpacityControl = ({ 
  opacity, 
  onOpacityChange,
  formatPercent,
  ariaLabel = "overlay-opacity"
}) => (
  <div className="opacity-control">
    <label className="opacity-label">
      <span>Overlay Opacity:</span> 
      <span className="opacity-value">
        {formatPercent ? formatPercent(opacity) : `${Math.round(opacity * 100)}%`}
      </span>
    </label>
    <input
      aria-label={ariaLabel}
      title={ariaLabel}
      type="range"
      className="opacity-slider"
      min="0"
      max="100"
      value={Math.round(opacity * 100)}
      onChange={(e) => onOpacityChange(e.target.value / 100)}
    />
  </div>
);

/**
 * Data Information Display - Niue Specific
 */
export const DataInfo = ({ 
  source = "Pacific Community (SPC)", 
  model = "SCHISM + WaveWatch III", 
  resolution = "Unstructured Mesh", 
  updateFrequency = "4x Daily", 
  coverage = "Niue Waters"
}) => (
  <div className="data-info">
    <div className="data-info-header">
      <Info size={16} />
      <span>Data Information</span>
    </div>
    <div className="data-info-grid">
      <div className="data-info-item">
        <strong>Source:</strong> 
        <span>{source}</span>
      </div>
      <div className="data-info-item">
        <strong>Model:</strong> 
        <span>{model}</span>
      </div>
      <div className="data-info-item">
        <strong>Resolution:</strong> 
        <span>{resolution}</span>
      </div>
      <div className="data-info-item">
        <strong>Update:</strong> 
        <span>{updateFrequency}</span>
      </div>
      <div className="data-info-item">
        <strong>Coverage:</strong> 
        <span>{coverage}</span>
      </div>
    </div>
  </div>
);

/**
 * Legend Toggle Control
 */
export const LegendToggle = ({
  showLegend,
  onToggleLegend,
  disabled = false
}) => (
  <div className="legend-toggle">
    <button
      type="button"
      className={`legend-btn ${showLegend ? 'active' : ''}`}
      onClick={onToggleLegend}
      disabled={disabled}
      aria-label={showLegend ? 'Hide legend' : 'Show legend'}
    >
      <Info size={16} />
      <span>{showLegend ? 'Hide Legend' : 'Show Legend'}</span>
    </button>
  </div>
);

/**
 * Loading Indicator
 */
export const LoadingIndicator = ({ 
  message = "Loading forecast data...",
  size = "medium"
}) => (
  <div className={`loading-indicator ${size}`}>
    <div className="loading-spinner" />
    <span className="loading-message">{message}</span>
  </div>
);

// Icon mapping for external use
export const NIUE_ICON_MAP = {
  'wave_height': Waves,
  'hs': Waves,
  'composite_hs_dirm': Waves,
  'wave_period': Timer,
  'tm02': Timer,
  'peak_period': Triangle,
  'tpeak': Triangle,
  'wave_direction': Navigation,
  'dirm': Navigation,
  'inundation': CloudRain,
  'wind_speed': Wind,
  'wind_direction': Wind,
  'ws': Wind,
  'wd': Wind
};

// Utility function to get icon by variable name
export const getVariableIcon = (variableName, size = 18) => {
  const iconName = variableName?.toLowerCase() || '';
  
  // Try exact match first
  if (NIUE_ICON_MAP[iconName]) {
    const IconComponent = NIUE_ICON_MAP[iconName];
    return <IconComponent size={size} />;
  }
  
  // Try partial matches
  for (const [key, IconComponent] of Object.entries(NIUE_ICON_MAP)) {
    if (iconName.includes(key)) {
      return <IconComponent size={size} />;
    }
  }
  
  // Default to Activity icon
  return <Activity size={size} />;
};

const UIComponents = {
  ControlGroup,
  VariableButtons,
  TimeControl,
  OpacityControl,
  DataInfo,
  LegendToggle,
  LoadingIndicator,
  getVariableIcon,
  NIUE_ICON_MAP
};

export default UIComponents;