/**
 * UI Configuration for Forecast Application
 * 
 * Centralized configuration for labels, icons, accessibility text,
 * and display options to maintain consistency across widgets.
 */

export const UI_CONFIG = {
  // Section headers with consistent iconography
  SECTIONS: {
    FORECAST_VARIABLES: {
      icon: '📊',
      title: 'Forecast Variables',
      ariaLabel: 'Forecast variable selection'
    },
    FORECAST_TIME: {
      icon: '⏰', 
      title: 'Forecast Time',
      ariaLabel: 'Time control and playback'
    },
    DISPLAY_OPTIONS: {
      icon: '🎨',
      title: 'Display Options', 
      ariaLabel: 'Display and opacity controls'
    },
    DATA_INFO: {
      icon: 'ℹ️',
      title: 'Data Info',
      ariaLabel: 'Data source and model information'
    }
  },

  // Variable label mappings for consistent display
  VARIABLE_LABELS: {
    ' Significant Wave Height + Direction': 'Wave Height + Direction', // Composite layer with automatic direction overlay
    'Mean Wave Period': 'Wave Period',
    'Peak Wave Period': 'Peak Period',
    'Wind U Component': 'Wind U',
    'Wind V Component': 'Wind V',
    'Inundation Depth': 'Inundation'
  },

  // Playback controls with accessibility
  PLAYBACK: {
    PLAY: {
      icon: '▶️',
      label: 'Play',
      ariaLabel: 'Play forecast animation'
    },
    PAUSE: {
      icon: '⏸️', 
      label: 'Pause',
      ariaLabel: 'Pause forecast animation'
    }
  },

  // Legend controls
  LEGEND: {
    SHOW: {
      label: 'Show Legend',
      ariaLabel: 'Show forecast legend'
    },
    HIDE: {
      label: 'Hide Legend', 
      ariaLabel: 'Hide forecast legend'
    }
  },

  // Data source information
  DATA_SOURCE: {
    source: 'Pacific Community (SPC)',
    model: 'SCHISM + WaveWatch III',
    resolution: 'Unstructured Mesh',
    updateFrequency: '4x Daily',
    coverage: 'Cook Islands'
  },

  // Footer information
  FOOTER: {
    copyright: '© 2025 Cook Islands Marine Forecast'
  },

  // Accessibility labels
  ARIA_LABELS: {
    forecastTime: 'Forecast Time',
    overlayOpacity: 'overlay-opacity',
    variableButton: 'Select forecast variable',
    timeSlider: 'Forecast time slider',
    opacitySlider: 'Overlay opacity slider'
  },

  // Format strings and templates
  FORMATS: {
    forecastHour: (hours) => `+${hours}h`,
    opacityPercent: (opacity) => `${Math.round(opacity * 100)}%`,
    forecastLength: (steps) => `${steps + 1} hours`
  }
};

export default UI_CONFIG;