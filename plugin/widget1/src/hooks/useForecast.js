/**
 * Custom hook for forecast data management - Niue Marine Edition
 * 
 * Handles data fetching optimization, caching strategy, and error handling
 * for Niue's marine forecast system with SPC Ocean Portal integration.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

// Cache configuration
const CACHE_CONFIG = {
  maxAge: 30 * 60 * 1000, // 30 minutes in milliseconds
  maxEntries: 50,
  cleanupInterval: 5 * 60 * 1000 // 5 minutes cleanup interval
};

// Default forecast configuration for Niue waters
const DEFAULT_FORECAST_CONFIG = {
  baseUrl: 'https://ocean-forecast.spc.int',
  wmsBaseUrl: 'https://ocean-wms.spc.int/ncWMS2/wms',
  region: 'niue',
  timezone: 'Pacific/Niue',
  refreshInterval: 10 * 60 * 1000, // 10 minutes
  retryAttempts: 3,
  retryDelay: 1000 // 1 second
};

// Available marine layers for Niue
const NIUE_MARINE_LAYERS = {
  composite_hs_dirm: {
    label: 'Wave Height',
    description: 'Significant wave height composite',
    units: 'm',
    colorRange: [0, 8],
    defaultStyle: 'default-scalar/jet',
    layer: 'composite_hs_dirm',
    priority: 1
  },
  hs: {
    label: 'Significant Wave Height', 
    description: 'Wind wave significant height',
    units: 'm',
    colorRange: [0, 6],
    defaultStyle: 'default-scalar/jet',
    layer: 'hs',
    priority: 2
  },
  tm02: {
    label: 'Mean Wave Period',
    description: 'Mean zero-crossing wave period',
    units: 's',
    colorRange: [2, 20],
    defaultStyle: 'default-scalar/rainbow',
    layer: 'tm02',
    priority: 3
  },
  tpeak: {
    label: 'Peak Wave Period',
    description: 'Wave period at spectral peak',
    units: 's', 
    colorRange: [4, 25],
    defaultStyle: 'default-scalar/rainbow',
    layer: 'tpeak',
    priority: 4
  },
  dirm: {
    label: 'Wave Direction',
    description: 'Mean wave direction',
    units: '°',
    colorRange: [0, 360],
    defaultStyle: 'default-scalar/occam',
    layer: 'dirm',
    priority: 5
  },
  inundation: {
    label: 'Coastal Inundation',
    description: 'Predicted coastal inundation levels',
    units: 'm',
    colorRange: [0, 3],
    defaultStyle: 'default-scalar/alg2',
    layer: 'inundation',
    priority: 6
  }
};

export const useForecast = (config = {}) => {
  // Merge with defaults
  const forecastConfig = useMemo(() => ({
    ...DEFAULT_FORECAST_CONFIG,
    ...config
  }), [config]);

  // State management
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentForecast, setCurrentForecast] = useState(null);
  const [availableTimes, setAvailableTimes] = useState([]);
  const [selectedTime, setSelectedTime] = useState(null);
  const [selectedLayer, setSelectedLayer] = useState('composite_hs_dirm');
  
  // Cache and refs
  const cacheRef = useRef(new Map());
  const abortControllerRef = useRef(null);
  const refreshTimeoutRef = useRef(null);
  const lastFetchRef = useRef(null);

  // Cache management utilities
  const getCacheKey = useCallback((layer, timestamp) => {
    return `${layer}_${timestamp?.toISOString() || 'latest'}`;
  }, []);

  const isValidCacheEntry = useCallback((entry) => {
    if (!entry) return false;
    const now = Date.now();
    return (now - entry.timestamp) < CACHE_CONFIG.maxAge;
  }, []);

  const cleanupCache = useCallback(() => {
    const now = Date.now();
    const cache = cacheRef.current;
    
    for (const [key, entry] of cache.entries()) {
      if ((now - entry.timestamp) > CACHE_CONFIG.maxAge) {
        cache.delete(key);
      }
    }
    
    // Limit cache size
    if (cache.size > CACHE_CONFIG.maxEntries) {
      const sortedEntries = Array.from(cache.entries())
        .sort(([,a], [,b]) => a.timestamp - b.timestamp);
      
      const toDelete = sortedEntries.slice(0, cache.size - CACHE_CONFIG.maxEntries);
      toDelete.forEach(([key]) => cache.delete(key));
    }
  }, []);

  // Set up cache cleanup interval
  useEffect(() => {
    const interval = setInterval(cleanupCache, CACHE_CONFIG.cleanupInterval);
    return () => clearInterval(interval);
  }, [cleanupCache]);

  // Fetch available forecast times
  const fetchAvailableTimes = useCallback(async (layer = selectedLayer) => {
    try {
      const layerConfig = NIUE_MARINE_LAYERS[layer];
      if (!layerConfig) throw new Error(`Unknown layer: ${layer}`);

      const url = `${forecastConfig.wmsBaseUrl}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0`;
      const response = await fetch(url);
      const xmlText = await response.text();
      
      // Parse XML to extract time dimensions
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, 'text/xml');
      
      // Find the layer and its time dimension
      const layers = xml.getElementsByTagName('Layer');
      let timeValues = [];
      
      for (const layerElement of layers) {
        const nameElement = layerElement.getElementsByTagName('Name')[0];
        if (nameElement && nameElement.textContent === layerConfig.layer) {
          const dimensions = layerElement.getElementsByTagName('Dimension');
          for (const dim of dimensions) {
            if (dim.getAttribute('name') === 'time') {
              const timeString = dim.textContent.trim();
              if (timeString.includes('/')) {
                // Parse time range (start/end/interval)
                const [start, end, interval] = timeString.split('/');
                timeValues = generateTimeRange(start, end, interval);
              } else {
                // Parse comma-separated times
                timeValues = timeString.split(',').map(t => new Date(t.trim()));
              }
              break;
            }
          }
          break;
        }
      }

      // Filter for Niue timezone and recent times
      const now = new Date();
      const validTimes = timeValues
        .filter(time => time <= now) // Only past/current times
        .sort((a, b) => b - a) // Latest first
        .slice(0, 48); // Last 48 timesteps

      setAvailableTimes(validTimes);
      
      // Set default to latest time
      if (validTimes.length > 0 && !selectedTime) {
        setSelectedTime(validTimes[0]);
      }

      return validTimes;
    } catch (error) {
      console.error('Failed to fetch available times:', error);
      throw error;
    }
  }, [forecastConfig.wmsBaseUrl, selectedLayer, selectedTime]);

  // Generate time range from ISO interval
  const generateTimeRange = (start, end, interval) => {
    const times = [];
    const startTime = new Date(start);
    const endTime = new Date(end);
    
    // Parse interval (e.g., PT3H = 3 hours)
    const intervalMatch = interval.match(/PT(\d+)H/);
    const intervalHours = intervalMatch ? parseInt(intervalMatch[1]) : 1;
    
    let current = new Date(startTime);
    while (current <= endTime) {
      times.push(new Date(current));
      current.setHours(current.getHours() + intervalHours);
    }
    
    return times;
  };

  // Fetch forecast data with caching and error handling
  const fetchForecastData = useCallback(async (layer, timestamp, options = {}) => {
    const { force = false, retryCount = 0 } = options;
    
    // Check cache first
    const cacheKey = getCacheKey(layer, timestamp);
    const cached = cacheRef.current.get(cacheKey);
    
    if (!force && isValidCacheEntry(cached)) {
      return cached.data;
    }

    // Cancel any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    abortControllerRef.current = new AbortController();
    setLoading(true);
    setError(null);

    try {
      const layerConfig = NIUE_MARINE_LAYERS[layer];
      if (!layerConfig) throw new Error(`Unknown layer: ${layer}`);

      // Build WMS parameters for Niue region
      const params = new URLSearchParams({
        SERVICE: 'WMS',
        VERSION: '1.3.0',
        REQUEST: 'GetMap',
        LAYERS: layerConfig.layer,
        STYLES: layerConfig.defaultStyle,
        CRS: 'EPSG:4326',
        BBOX: '-169.95,-19.15,-169.65,-18.95', // Niue bounding box
        WIDTH: '512',
        HEIGHT: '512',
        FORMAT: 'image/png',
        TRANSPARENT: 'true',
        TIME: timestamp ? timestamp.toISOString() : undefined
      });

      const url = `${forecastConfig.wmsBaseUrl}?${params}`;
      
      const response = await fetch(url, {
        signal: abortControllerRef.current.signal,
        headers: {
          'Accept': 'image/png,image/*,*/*',
          'Cache-Control': 'no-cache'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Create blob URL for image
      const blob = await response.blob();
      const imageUrl = URL.createObjectURL(blob);
      
      const forecastData = {
        layer,
        timestamp,
        imageUrl,
        layerConfig,
        bounds: [[-19.15, -169.95], [-18.95, -169.65]], // [SW, NE] corners
        metadata: {
          region: 'niue',
          units: layerConfig.units,
          colorRange: layerConfig.colorRange,
          fetchTime: new Date(),
          source: 'SPC Ocean Portal'
        }
      };

      // Cache the result
      cacheRef.current.set(cacheKey, {
        data: forecastData,
        timestamp: Date.now()
      });

      lastFetchRef.current = Date.now();
      setCurrentForecast(forecastData);
      
      return forecastData;

    } catch (error) {
      if (error.name === 'AbortError') {
        return null; // Request was cancelled
      }

      console.error('Forecast fetch failed:', error);
      
      // Retry logic
      if (retryCount < forecastConfig.retryAttempts) {
        await new Promise(resolve => 
          setTimeout(resolve, forecastConfig.retryDelay * (retryCount + 1))
        );
        return fetchForecastData(layer, timestamp, { 
          ...options, 
          retryCount: retryCount + 1 
        });
      }
      
      setError({
        message: error.message,
        layer,
        timestamp,
        retryCount,
        canRetry: true
      });
      
      throw error;
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  }, [forecastConfig, getCacheKey, isValidCacheEntry]);

  // Auto-refresh functionality
  const startAutoRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    
    refreshTimeoutRef.current = setTimeout(async () => {
      if (selectedLayer && selectedTime) {
        try {
          await fetchForecastData(selectedLayer, selectedTime, { force: true });
          await fetchAvailableTimes(selectedLayer);
        } catch (error) {
          console.warn('Auto-refresh failed:', error);
        }
      }
      startAutoRefresh(); // Schedule next refresh
    }, forecastConfig.refreshInterval);
  }, [fetchForecastData, fetchAvailableTimes, selectedLayer, selectedTime, forecastConfig.refreshInterval]);

  // Initialize and handle layer/time changes
  useEffect(() => {
    if (selectedLayer && selectedTime) {
      fetchForecastData(selectedLayer, selectedTime);
    }
  }, [selectedLayer, selectedTime, fetchForecastData]);

  // Initialize available times when layer changes
  useEffect(() => {
    if (selectedLayer) {
      fetchAvailableTimes(selectedLayer);
    }
  }, [selectedLayer, fetchAvailableTimes]);

  // Start auto-refresh
  useEffect(() => {
    startAutoRefresh();
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, [startAutoRefresh]);

  // Cleanup on unmount
  useEffect(() => {
    const currentCache = cacheRef.current;
    
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      
      // Cleanup blob URLs to prevent memory leaks
      currentCache.forEach(entry => {
        if (entry.data?.imageUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(entry.data.imageUrl);
        }
      });
    };
  }, []);

  // Public API
  return {
    // State
    loading,
    error,
    currentForecast,
    availableTimes,
    selectedTime,
    selectedLayer,
    
    // Layer information
    availableLayers: NIUE_MARINE_LAYERS,
    getLayerConfig: (layer) => NIUE_MARINE_LAYERS[layer],
    
    // Actions
    setSelectedLayer,
    setSelectedTime,
    fetchForecastData,
    fetchAvailableTimes,
    
    // Utilities
    refreshData: () => fetchForecastData(selectedLayer, selectedTime, { force: true }),
    clearError: () => setError(null),
    clearCache: () => {
      cacheRef.current.clear();
      cleanupCache();
    },
    
    // Cache stats
    getCacheStats: () => ({
      size: cacheRef.current.size,
      maxSize: CACHE_CONFIG.maxEntries,
      maxAge: CACHE_CONFIG.maxAge,
      lastFetch: lastFetchRef.current
    }),
    
    // Retry failed requests
    retry: () => {
      if (error && error.canRetry) {
        setError(null);
        return fetchForecastData(selectedLayer, selectedTime);
      }
    }
  };
};

export default useForecast;