/**
 * Marine Variable Definitions and Configuration - NIUE
 * Centralized configuration for marine forecast parameters
 */

// ✅ Marine Forecast Configuration - NIUE SPECIFIC
export const MARINE_CONFIG = {
  // Model warm-up period configuration
  WARMUP_DAYS: 0,           // Skip first N days of model spin-up (0 = disabled, keep all data)
  ENABLE_WARMUP_SKIP: false, // Toggle warm-up skip feature (disabled)
  
  // First timestep configuration
  SKIP_FIRST_TIMESTEP: false,  // Keep all timesteps for Niue (including 0-hour analysis)
  
  // Slider initialization configuration
  DEFAULT_SLIDER_INDEX: 0,  // Start at index 0 for Niue
  
  // Time dimension configuration
  DEFAULT_STEP_HOURS: 1,    // Niue uses hourly timesteps
  
  // WMS configuration
  DEFAULT_WMS_VERSION: '1.3.0',
  DEFAULT_FORMAT: 'image/png',
  DEFAULT_TRANSPARENCY: true,
  
  // Display configuration
  SHOW_WARMUP_NOTICE: false, // No warm-up notice needed
};

// Marine variable definitions for Niue - matching existing layer structure
export const MARINE_VARIABLES = {
  'hs': {
    key: 'hs',
    label: 'Significant Wave Height',
    description: 'The average height of the highest third of waves',
    defaultRange: { min: 0, max: 4 }, // Niue-specific range
    colorScheme: 'jet',  // Jet scheme for consistency with existing Niue setup
    decimalPlaces: 1,
    units: 'm',
    category: 'wave',
    wmoCodes: ['height_of_wind_waves', 'significant_height_of_wind_and_swell_waves']
  },
  'tm02': {
    key: 'tm02', 
    label: 'Mean Wave Period',
    description: 'Mean zero-crossing period of waves',
    defaultRange: { min: 0, max: 20 },
    colorScheme: 'jet',  // Jet scheme for consistency
    decimalPlaces: 0,
    units: 's',
    category: 'wave',
    wmoCodes: ['mean_period_of_wind_waves']
  },
  'tpeak': {
    key: 'tpeak',
    label: 'Peak Wave Period', 
    description: 'Wave period corresponding to the most energetic waves',
    defaultRange: { min: 0, max: 20 },
    colorScheme: 'jet',  // Jet scheme for consistency
    decimalPlaces: 0,
    units: 's',
    category: 'wave',
    wmoCodes: ['peak_period_of_wind_waves']
  },
  'dirm': {
    key: 'dirm',
    label: 'Mean Wave Direction',
    description: 'Direction from which waves are coming',
    defaultRange: { min: 0, max: 360 },
    colorScheme: 'dir',
    decimalPlaces: 0,
    units: '°',
    category: 'direction',
    wmoCodes: ['direction_of_wind_waves']
  },
  'ws': {
    key: 'ws',
    label: 'Wind Speed',
    description: '10-meter wind speed',
    defaultRange: { min: 0, max: 25 },
    colorScheme: 'jet',
    decimalPlaces: 1,
    units: 'm/s',
    category: 'wind',
    wmoCodes: ['wind_speed']
  },
  'wd': {
    key: 'wd',
    label: 'Wind Direction',
    description: 'Direction from which wind is blowing',
    defaultRange: { min: 0, max: 360 },
    colorScheme: 'dir',
    decimalPlaces: 0,
    units: '°',
    category: 'direction',
    wmoCodes: ['wind_from_direction']
  },
  'inundation': {
    key: 'inundation',
    label: 'Inundation Depth',
    description: 'Coastal inundation depth from wave action',
    defaultRange: { min: 0, max: 2 },
    colorScheme: 'Blues',
    decimalPlaces: 2,
    units: 'm',
    category: 'coastal',
    wmoCodes: ['sea_surface_height_above_sea_level']
  }
};

// Niue-specific layer configurations matching existing structure
export const NIUE_LAYERS = [
  {
    label: "Significant Wave Height + Dir",
    value: "composite_hs_dirm",
    id: 100,
    composite: true,
    legendUrl: "https://ocean-plotter.spc.int/plotter/GetLegendGraphic?layer_map=40&mode=standard&min_color=0&max_color=4&step=1&color=jet&unit=m",
    layers: [
      {
        layer: "niue/hs",
        url: "https://gem-ncwms-hpc.spc.int/ncWMS/wms",
        styles: "default-scalar/jet",
        time: null,
        opacity: 0.7,
        attribution: "SPC Ocean Portal"
      },
      {
        layer: "niue/dirm", 
        url: "https://gem-ncwms-hpc.spc.int/ncWMS/wms",
        styles: "prettyvec/rainbow",
        time: null,
        opacity: 0.8,
        attribution: "SPC Ocean Portal"
      }
    ]
  },
  {
    label: "Mean Wave Period",
    value: "tm02",
    id: 2,
    layer: "niue/tm02",
    url: "https://gem-ncwms-hpc.spc.int/ncWMS/wms",
    styles: "default-scalar/jet",
    legendUrl: "https://ocean-plotter.spc.int/plotter/GetLegendGraphic?layer_map=41&mode=standard&min_color=0&max_color=20&step=2&color=jet&unit=s",
    time: null,
    opacity: 0.7,
    attribution: "SPC Ocean Portal"
  },
  {
    label: "Peak Wave Period",
    value: "tpeak",
    id: 3,
    layer: "niue/tpeak",
    url: "https://gem-ncwms-hpc.spc.int/ncWMS/wms",
    styles: "default-scalar/jet",
    legendUrl: "https://ocean-plotter.spc.int/plotter/GetLegendGraphic?layer_map=42&mode=standard&min_color=0&max_color=20&step=2&color=jet&unit=s",
    time: null,
    opacity: 0.7,
    attribution: "SPC Ocean Portal"
  },
  {
    label: "Inundation Depth",
    value: "inundation",
    id: 4,
    layer: "niue_inun/Band1",
    url: "https://gem-ncwms-hpc.spc.int/ncWMS/wms",
    styles: "default-scalar/seq-Blues",
    legendUrl: "https://gem-ncwms-hpc.spc.int/ncWMS/wms?REQUEST=GetLegendGraphic&LAYER=niue_inun/Band1&PALETTE=seq-Blues&COLORBARONLY=true&WIDTH=60&HEIGHT=320&COLORSCALERANGE=0,2&NUMCOLORBANDS=220&VERTICAL=true&TRANSPARENT=true",
    time: null,
    opacity: 0.8,
    attribution: "SPC Ocean Portal"
  }
];

export default MARINE_CONFIG;