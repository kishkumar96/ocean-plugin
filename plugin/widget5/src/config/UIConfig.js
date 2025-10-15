/**
 * UI Configuration for ForecastApp
 * Centralizes copy, labels, icons, and metadata for consistency across widgets
 */

export const UI_CONFIG = {
  // Section headers and icons
  sections: {
    forecastTime: {
      icon: '⏰',
      title: 'Forecast Time',
      ariaLabel: 'Forecast time controls'
    },
    displayOptions: {
      icon: '🎨',
      title: 'Display Options',
      ariaLabel: 'Display and visualization options'
    },
    dataInfo: {
      icon: 'ℹ️',
      title: 'Data Info',
      ariaLabel: 'Data source and model information'
    }
  },

  // Control labels and accessibility text
  controls: {
    timeSlider: {
      label: 'Forecast Time',
      ariaLabel: 'Select forecast time',
      title: 'Drag to change forecast time'
    },
    opacitySlider: {
      label: 'Overlay Opacity',
      ariaLabel: 'Adjust overlay opacity',
      title: 'Drag to adjust overlay transparency'
    },
    playButton: {
      play: {
        text: '▶️ Play',
        ariaLabel: 'Start animation',
        title: 'Start time series animation'
      },
      pause: {
        text: '⏸️ Pause',
        ariaLabel: 'Pause animation',
        title: 'Pause time series animation'
      }
    }
  },

  // Layer label mappings for display
  layerLabels: {
    'Significant Wave Height': 'Wave Height',
    'Wave Direction (arrow)': 'Wave Direction',
    'Peak Wave Period': 'Wave Period',
    'Mean Wave Period': 'Mean Period',
    'Zero-crossing Period': 'Zero Period',
    'Mean Wave Direction': 'Mean Dir',
    'Peak Wave Direction': 'Peak Dir',
    'Wave Direction': 'Wave Dir',
    'Inundation Depth': 'Inundation'
  },

  // Time format strings
  timeFormats: {
    currentTime: 'Current Time: +{hours} hours',
    validTime: 'Valid: {timestamp}',
    forecastLength: 'Forecast Length: {total} hours'
  },

  // Data source metadata
  dataInfo: {
    source: 'Pacific Community (SPC)',
    model: 'SCHISM + WaveWatch III',
    resolution: 'Unstructured Mesh',
    update: '4x Daily',
    coverage: 'Cook Islands'
  },

  // Footer and branding
  footer: {
    copyright: '© 2025 Cook Islands Marine Forecast'
  }
};

/**
 * Get shortened label for a layer
 * @param {string} fullLabel - Full layer label
 * @returns {string} Shortened label or original if no mapping exists
 */
export const getShortLabel = (fullLabel) => {
  return UI_CONFIG.layerLabels[fullLabel] || fullLabel;
};

/**
 * Format time-related strings with interpolation
 * @param {string} template - Template string key from timeFormats
 * @param {Object} values - Values to interpolate
 * @returns {string} Formatted string
 */
export const formatTimeString = (template, values) => {
  const templateStr = UI_CONFIG.timeFormats[template];
  if (!templateStr) return template;
  
  return templateStr.replace(/{(\w+)}/g, (match, key) => {
    return values[key] !== undefined ? values[key] : match;
  });
};

/**
 * Get section configuration
 * @param {string} sectionKey - Section key from UI_CONFIG.sections
 * @returns {Object} Section configuration object
 */
export const getSectionConfig = (sectionKey) => {
  return UI_CONFIG.sections[sectionKey] || {};
};

/**
 * Get control configuration
 * @param {string} controlKey - Control key from UI_CONFIG.controls
 * @returns {Object} Control configuration object
 */
export const getControlConfig = (controlKey) => {
  return UI_CONFIG.controls[controlKey] || {};
};