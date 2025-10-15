/**
 * Niue-Specific Configuration Constants
 * 
 * Country-specific settings and parameters for Niue marine forecast system
 */

// Niue geographic and administrative configuration
export const NIUE_CONFIG = {
  // Country identification
  country: 'NIU',
  countryCode: 'NU',
  displayName: 'Niue',
  fullName: 'Niue Island',
  
  // Geographic coordinates (Alofi, capital)
  coordinates: {
    lat: -19.0544,
    lng: -169.8672,
    bounds: {
      north: -18.8,
      south: -19.2,
      east: -169.6,
      west: -169.9
    }
  },
  
  // Time zone configuration
  timezone: 'Pacific/Niue',
  utcOffset: -11, // UTC-11
  
  // Marine forecast domain
  domain: {
    name: 'Niue Waters',
    extent: {
      minLat: -19.2,
      maxLat: -18.8,
      minLon: -169.9,
      maxLon: -169.6
    },
    gridResolution: '500m', // High resolution for small island
    modelDomain: 'Pacific Community Regional'
  },
  
  // Language and locale
  locale: {
    primary: 'en-NU',
    secondary: 'niu', // Niuean language
    dateFormat: 'DD/MM/YYYY',
    timeFormat: 'HH:mm'
  },
  
  // Administrative information
  administration: {
    authority: 'Government of Niue',
    department: 'Department of Environment',
    contact: 'environment@mail.gov.nu',
    website: 'https://www.gov.nu'
  },
  
  // Data sources and endpoints
  dataSources: {
    primary: {
      name: 'Pacific Community (SPC)',
      url: 'https://gem-ncwms-hpc.spc.int/ncWMS/wms',
      type: 'WMS',
      version: '1.3.0'
    },
    backup: {
      name: 'SPC Ocean Portal',
      url: 'https://ocean-plotter.spc.int',
      type: 'WMS'
    }
  },
  
  // UI theme colors (marine-inspired palette for Niue)
  theme: {
    primary: '#1e40af',      // Ocean blue
    secondary: '#0ea5e9',    // Lighter blue
    accent: '#06b6d4',       // Cyan
    marine: '#0c4a6e',       // Deep marine
    coral: '#f97316',        // Coral orange (Niue's coral reefs)
    success: '#059669',      // Ocean green
    warning: '#d97706',      // Sunset orange
    error: '#dc2626',        // Alert red
    neutral: '#64748b'       // Neutral grey
  },
  
  // Map configuration
  map: {
    defaultZoom: 12,
    minZoom: 10,
    maxZoom: 16,
    center: [-19.0544, -169.8672],
    attribution: '© Niue Department of Environment & SPC',
    baseLayers: {
      satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      street: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
    }
  },
  
  // Forecast configuration
  forecast: {
    updateFrequency: '6 hours',
    forecastHours: 72,      // 3 days
    timestepHours: 1,       // Hourly data
    variables: ['hs', 'dirm', 'tm02', 'tpeak', 'inundation'],
    priority: 'coastal_safety' // Focus on coastal inundation
  },
  
  // Emergency thresholds (Niue-specific)
  thresholds: {
    waveHeight: {
      advisory: 2.0,    // 2m significant wave height
      warning: 3.0,     // 3m significant wave height
      emergency: 4.0    // 4m+ extreme conditions
    },
    inundation: {
      minor: 0.1,       // 10cm inundation
      moderate: 0.5,    // 50cm inundation  
      major: 1.0        // 1m+ severe inundation
    },
    windSpeed: {
      advisory: 15,     // 15 m/s
      warning: 25,      // 25 m/s (gale force)
      emergency: 35     // 35+ m/s (hurricane force)
    }
  },
  
  // Cultural considerations
  cultural: {
    traditionalKnowledge: true,
    communityFishing: true,
    touristSafety: true,
    subsistenceFishing: true
  },
  
  // Contact and support
  support: {
    emergency: '911',
    marine: '+683 4032',
    tourism: '+683 4224',
    email: 'marine.forecast@gov.nu'
  }
};

// Export individual components for selective imports
export const {
  country,
  coordinates,
  timezone,
  theme,
  map,
  forecast,
  thresholds
} = NIUE_CONFIG;

export default NIUE_CONFIG;