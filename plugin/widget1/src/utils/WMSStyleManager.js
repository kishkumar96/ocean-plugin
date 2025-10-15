/**
 * WMSStyleManager - Advanced WMS Layer Styling and Management
 * 
 * Dynamic layer styling, performance optimization, and cache management
 * specifically designed for marine forecast WMS services and SPC Ocean Portal integration.
 */

import WorldClassVisualization from './WorldClassVisualization';

// WMS service configurations for different providers
const WMS_PROVIDERS = {
  spcOcean: {
    name: 'SPC Ocean Portal',
    baseUrl: 'https://ocean-wms.spc.int/ncWMS2/wms',
    version: '1.3.0',
    format: 'image/png',
    transparent: true,
    crs: 'EPSG:4326',
    attribution: 'SPC Ocean Portal - Marine Forecasting',
    capabilities: null,
    lastCapabilitiesUpdate: null
  },
  
  thredds: {
    name: 'THREDDS Data Server',
    baseUrl: 'https://ocean-thredds.spc.int/thredds/wms',
    version: '1.3.0',
    format: 'image/png',
    transparent: true,
    crs: 'EPSG:4326',
    attribution: 'SPC THREDDS Server',
    capabilities: null,
    lastCapabilitiesUpdate: null
  }
};

// Style templates for different marine variables
const STYLE_TEMPLATES = {
  // Wave height styles
  waveHeight: {
    'default-scalar/jet': {
      name: 'Jet (Blue-Red)',
      description: 'Standard blue to red progression',
      colorRange: { min: 0, max: 8 },
      numColorBands: 254,
      opacity: 0.7
    },
    'default-scalar/rainbow': {
      name: 'Rainbow Spectrum',
      description: 'Full rainbow color spectrum',
      colorRange: { min: 0, max: 8 },
      numColorBands: 254,
      opacity: 0.7
    },
    'default-scalar/occam': {
      name: 'Ocean Blue',
      description: 'Marine-focused blue tones',
      colorRange: { min: 0, max: 8 },
      numColorBands: 254,
      opacity: 0.8
    }
  },
  
  // Wave period styles
  wavePeriod: {
    'default-scalar/rainbow': {
      name: 'Period Rainbow',
      description: 'Spectral colors for period data',
      colorRange: { min: 2, max: 20 },
      numColorBands: 254,
      opacity: 0.7
    },
    'default-scalar/alg2': {
      name: 'Algorithm 2',
      description: 'Enhanced period visualization',
      colorRange: { min: 2, max: 20 },
      numColorBands: 254,
      opacity: 0.7
    }
  },
  
  // Wave direction styles
  waveDirection: {
    'default-scalar/occam': {
      name: 'Directional Occam',
      description: 'Circular color mapping for directions',
      colorRange: { min: 0, max: 360 },
      numColorBands: 254,
      opacity: 0.6,
      circular: true
    }
  },
  
  // Inundation styles
  inundation: {
    'default-scalar/alg2': {
      name: 'Inundation Alert',
      description: 'Progressive alert colors',
      colorRange: { min: 0, max: 3 },
      numColorBands: 254,
      opacity: 0.8
    }
  }
};

// Performance optimization settings (for future use)
// const PERFORMANCE_CONFIG = {
//   tileSize: 256,
//   maxZoom: 18,
//   minZoom: 4,
//   updateThreshold: 500, // ms
//   cacheSize: 100,
//   compressionLevel: 'medium',
//   prefetchTiles: true,
//   adaptiveQuality: true
// };

export class WMSStyleManager {
  constructor(options = {}) {
    this.options = {
      defaultProvider: 'spcOcean',
      cacheEnabled: true,
      performanceMode: 'balanced', // 'performance', 'balanced', 'quality'
      debugMode: false,
      ...options
    };
    
    // Initialize services
    this.visualization = new WorldClassVisualization();
    
    // Cache management
    this.styleCache = new Map();
    this.capabilitiesCache = new Map();
    this.urlCache = new Map();
    
    // Performance tracking
    this.performanceMetrics = {
      requestCount: 0,
      cacheHits: 0,
      averageResponseTime: 0,
      lastRequestTime: null
    };
    
    // Active layers tracking
    this.activeLayers = new Map();
  }

  /**
   * Get WMS provider configuration
   */
  getProvider(providerId = this.options.defaultProvider) {
    return WMS_PROVIDERS[providerId];
  }

  /**
   * Get available style templates for a variable type
   */
  getStyleTemplates(variableType) {
    return STYLE_TEMPLATES[variableType] || {};
  }

  /**
   * Fetch WMS GetCapabilities for a provider
   */
  async fetchCapabilities(providerId, force = false) {
    const provider = this.getProvider(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);

    const cacheKey = `capabilities_${providerId}`;
    const cached = this.capabilitiesCache.get(cacheKey);
    
    // Return cached if recent and not forced
    if (!force && cached && this.isCacheValid(cached.timestamp, 30 * 60 * 1000)) {
      return cached.data;
    }

    try {
      const url = `${provider.baseUrl}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=${provider.version}`;
      const startTime = Date.now();
      
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const xmlText = await response.text();
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, 'text/xml');
      
      // Parse capabilities
      const capabilities = this.parseCapabilities(xml);
      
      // Cache results
      this.capabilitiesCache.set(cacheKey, {
        data: capabilities,
        timestamp: Date.now()
      });
      
      // Update performance metrics
      this.updatePerformanceMetrics(Date.now() - startTime);
      
      if (this.options.debugMode) {
        console.log(`🌊 Fetched capabilities for ${provider.name}:`, capabilities);
      }
      
      return capabilities;
      
    } catch (error) {
      console.error(`Failed to fetch capabilities for ${providerId}:`, error);
      throw error;
    }
  }

  /**
   * Parse WMS Capabilities XML
   */
  parseCapabilities(xml) {
    const layers = [];
    const layerElements = xml.getElementsByTagName('Layer');
    
    for (const layerElement of layerElements) {
      const nameElement = layerElement.getElementsByTagName('Name')[0];
      if (!nameElement) continue;
      
      const titleElement = layerElement.getElementsByTagName('Title')[0];
      const abstractElement = layerElement.getElementsByTagName('Abstract')[0];
      
      // Get supported styles
      const styles = [];
      const styleElements = layerElement.getElementsByTagName('Style');
      for (const styleElement of styleElements) {
        const styleName = styleElement.getElementsByTagName('Name')[0]?.textContent;
        const styleTitle = styleElement.getElementsByTagName('Title')[0]?.textContent;
        if (styleName) {
          styles.push({ name: styleName, title: styleTitle || styleName });
        }
      }
      
      // Get time dimension
      const timeDimensions = [];
      const dimensions = layerElement.getElementsByTagName('Dimension');
      for (const dim of dimensions) {
        if (dim.getAttribute('name') === 'time') {
          timeDimensions.push({
            name: 'time',
            units: dim.getAttribute('units'),
            default: dim.getAttribute('default'),
            values: dim.textContent.trim()
          });
        }
      }
      
      layers.push({
        name: nameElement.textContent,
        title: titleElement?.textContent || nameElement.textContent,
        abstract: abstractElement?.textContent || '',
        styles,
        timeDimensions,
        queryable: layerElement.getAttribute('queryable') === '1'
      });
    }
    
    return {
      version: xml.getElementsByTagName('WMS_Capabilities')[0]?.getAttribute('version'),
      layers,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Build optimized WMS URL with dynamic styling
   */
  buildWMSUrl(layerConfig, options = {}) {
    const {
      providerId = this.options.defaultProvider,
      style = 'default-scalar/jet',
      time = null,
      bbox = null,
      width = 512,
      height = 512,
      colorRange = null,
      quality = 'standard'
    } = options;

    const provider = this.getProvider(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);

    // Build cache key
    const cacheKey = `url_${JSON.stringify({ layerConfig, options })}`;
    const cached = this.urlCache.get(cacheKey);
    
    if (cached && this.isCacheValid(cached.timestamp, 5 * 60 * 1000)) {
      return cached.url;
    }

    // Base parameters
    const params = new URLSearchParams({
      SERVICE: 'WMS',
      VERSION: provider.version,
      REQUEST: 'GetMap',
      LAYERS: layerConfig.layer,
      STYLES: this.optimizeStyle(style, layerConfig.type, quality),
      CRS: provider.crs,
      FORMAT: this.getOptimalFormat(quality),
      TRANSPARENT: provider.transparent.toString(),
      WIDTH: this.getOptimalDimension(width, quality).toString(),
      HEIGHT: this.getOptimalDimension(height, quality).toString()
    });

    // Add BBOX if provided
    if (bbox) {
      params.set('BBOX', Array.isArray(bbox) ? bbox.join(',') : bbox);
    }

    // Add time if provided
    if (time) {
      params.set('TIME', time instanceof Date ? time.toISOString() : time);
    }

    // Add color range if provided
    if (colorRange) {
      params.set('COLORSCALERANGE', `${colorRange.min},${colorRange.max}`);
    }

    // Add performance optimizations
    if (this.options.performanceMode === 'performance') {
      params.set('NUMCOLORBANDS', '128'); // Reduce color bands for performance
    }

    const url = `${provider.baseUrl}?${params}`;
    
    // Cache the URL
    this.urlCache.set(cacheKey, {
      url,
      timestamp: Date.now()
    });

    return url;
  }

  /**
   * Optimize style based on performance mode and quality
   */
  optimizeStyle(style, variableType, quality) {
    // In performance mode, use simpler styles
    if (this.options.performanceMode === 'performance') {
      const templates = this.getStyleTemplates(variableType);
      const availableStyles = Object.keys(templates);
      
      // Prefer occam or jet for performance
      if (availableStyles.includes('default-scalar/occam')) {
        return 'default-scalar/occam';
      }
      if (availableStyles.includes('default-scalar/jet')) {
        return 'default-scalar/jet';
      }
    }
    
    return style;
  }

  /**
   * Get optimal image format based on quality setting
   */
  getOptimalFormat(quality) {
    switch (quality) {
      case 'high':
        return 'image/png';
      case 'standard':
        return 'image/png';
      case 'low':
        return 'image/jpeg';
      default:
        return 'image/png';
    }
  }

  /**
   * Get optimal tile dimensions based on quality and performance
   */
  getOptimalDimension(requested, quality) {
    const maxDimensions = {
      high: 1024,
      standard: 512,
      low: 256
    };
    
    const max = maxDimensions[quality] || 512;
    return Math.min(requested, max);
  }

  /**
   * Create enhanced legend with custom styling
   */
  createEnhancedLegend(layerConfig, styleConfig = {}) {
    const {
      orientation = 'horizontal',
      size = { width: 400, height: 60 },
      showTitle = true,
      showLabels = true,
      customDomain = null
    } = styleConfig;

    // Determine palette based on layer type
    let paletteId = 'jet'; // Default
    
    if (layerConfig.type) {
      switch (layerConfig.type) {
        case 'waveHeight':
        case 'hs':
        case 'composite_hs_dirm':
          paletteId = 'waveHeight';
          break;
        case 'wavePeriod':
        case 'tm02':
        case 'tpeak':
          paletteId = 'wavePeriod';
          break;
        case 'waveDirection':
        case 'dirm':
          paletteId = 'waveDirection';
          break;
        case 'inundation':
          paletteId = 'inundation';
          break;
        default:
          paletteId = 'jet';
          break;
      }
    }

    const options = {
      canvasSize: size,
      showTitle,
      showLabels,
      domain: customDomain,
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderColor: 'rgba(0, 0, 0, 0.2)'
    };

    if (orientation === 'horizontal') {
      return this.visualization.createHorizontalLegend(paletteId, options);
    } else {
      return this.visualization.createVerticalLegend(paletteId, options);
    }
  }

  /**
   * Get GetFeatureInfo URL for point queries
   */
  buildFeatureInfoUrl(layerConfig, point, mapBounds, mapSize, options = {}) {
    const {
      providerId = this.options.defaultProvider,
      infoFormat = 'application/json',
      featureCount = 1
    } = options;

    const provider = this.getProvider(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);

    const params = new URLSearchParams({
      SERVICE: 'WMS',
      VERSION: provider.version,
      REQUEST: 'GetFeatureInfo',
      LAYERS: layerConfig.layer,
      QUERY_LAYERS: layerConfig.layer,
      INFO_FORMAT: infoFormat,
      FEATURE_COUNT: featureCount.toString(),
      CRS: provider.crs,
      BBOX: Array.isArray(mapBounds) ? mapBounds.join(',') : mapBounds,
      WIDTH: mapSize.width.toString(),
      HEIGHT: mapSize.height.toString(),
      I: Math.round(point.x).toString(),
      J: Math.round(point.y).toString()
    });

    // Add time if available in layer config
    if (layerConfig.time) {
      params.set('TIME', layerConfig.time instanceof Date ? 
        layerConfig.time.toISOString() : layerConfig.time);
    }

    return `${provider.baseUrl}?${params}`;
  }

  /**
   * Preload and cache commonly used styles
   */
  async preloadStyles(layerConfigs) {
    const promises = layerConfigs.map(async config => {
      try {
        // Build URLs for common style combinations
        const commonStyles = ['default-scalar/jet', 'default-scalar/rainbow', 'default-scalar/occam'];
        
        for (const style of commonStyles) {
          const url = this.buildWMSUrl(config, { style });
          
          // Pre-cache the URL construction
          this.styleCache.set(`${config.layer}_${style}`, {
            url,
            timestamp: Date.now(),
            preloaded: true
          });
        }
        
      } catch (error) {
        if (this.options.debugMode) {
          console.warn(`Failed to preload styles for ${config.layer}:`, error);
        }
      }
    });

    await Promise.allSettled(promises);
    
    if (this.options.debugMode) {
      console.log(`🎨 Preloaded styles for ${layerConfigs.length} layers`);
    }
  }

  /**
   * Update performance metrics
   */
  updatePerformanceMetrics(responseTime) {
    this.performanceMetrics.requestCount++;
    this.performanceMetrics.lastRequestTime = Date.now();
    
    // Calculate moving average
    const count = this.performanceMetrics.requestCount;
    const current = this.performanceMetrics.averageResponseTime;
    this.performanceMetrics.averageResponseTime = 
      ((current * (count - 1)) + responseTime) / count;
  }

  /**
   * Check if cached item is still valid
   */
  isCacheValid(timestamp, maxAge) {
    return (Date.now() - timestamp) < maxAge;
  }

  /**
   * Clear expired cache entries
   */
  cleanupCache() {
    const maxAge = 30 * 60 * 1000; // 30 minutes
    
    // Cleanup style cache
    for (const [key, entry] of this.styleCache.entries()) {
      if (!this.isCacheValid(entry.timestamp, maxAge)) {
        this.styleCache.delete(key);
      }
    }
    
    // Cleanup capabilities cache
    for (const [key, entry] of this.capabilitiesCache.entries()) {
      if (!this.isCacheValid(entry.timestamp, maxAge)) {
        this.capabilitiesCache.delete(key);
      }
    }
    
    // Cleanup URL cache
    for (const [key, entry] of this.urlCache.entries()) {
      if (!this.isCacheValid(entry.timestamp, 5 * 60 * 1000)) {
        this.urlCache.delete(key);
      }
    }
  }

  /**
   * Get comprehensive performance and cache statistics
   */
  getStatistics() {
    return {
      performance: { ...this.performanceMetrics },
      cache: {
        styleCache: this.styleCache.size,
        capabilitiesCache: this.capabilitiesCache.size,
        urlCache: this.urlCache.size,
        activeLayers: this.activeLayers.size
      },
      config: {
        performanceMode: this.options.performanceMode,
        cacheEnabled: this.options.cacheEnabled,
        defaultProvider: this.options.defaultProvider
      }
    };
  }

  /**
   * Clear all caches
   */
  clearAllCaches() {
    this.styleCache.clear();
    this.capabilitiesCache.clear();
    this.urlCache.clear();
    this.visualization.clearCache();
  }
}

export default WMSStyleManager;