/**
 * Custom hook for handling map interactions - Niue Marine Edition
 * 
 * Manages map state, layer control, and user interactions
 * specifically optimized for Niue's marine forecast system.
 */

import { useEffect, useCallback, useRef, useState } from 'react';
import L from 'leaflet';

export const useMapInteraction = ({
  mapInstance,
  currentSliderDate,
  selectedLayer,
  layerOpacity = 0.7,
  setBottomCanvasData,
  setShowBottomCanvas,
  debugMode = false
}) => {
  // State management
  const [isLoading, setIsLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [currentMarker, setCurrentMarker] = useState(null);
  const [mapCenter, setMapCenter] = useState([-19.0544, -169.8672]); // Niue coordinates
  const [mapZoom, setMapZoom] = useState(12);

  // Refs for stable service instances
  const servicesRef = useRef({
    activeLayer: null,
    wmsLayers: new Map(),
    clickMarker: null,
    interactionEnabled: true
  });

  // Initialize map when instance is ready
  useEffect(() => {
    const map = mapInstance?.current;
    if (!map) return;

    // Set up Niue-specific map configuration
    const setupNiueMap = () => {
      // Set Niue bounds and initial view
      const niueBounds = [
        [-19.2, -169.9], // Southwest
        [-18.8, -169.6]  // Northeast
      ];

      map.setMaxBounds(niueBounds);
      map.setView(mapCenter, mapZoom);
      setMapReady(true);

      if (debugMode) {
        console.log('🗺️ Niue marine map initialized');
      }
    };

    // Initialize map after a brief delay to ensure Leaflet is ready
    const timeoutId = setTimeout(setupNiueMap, 100);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [mapInstance, mapCenter, mapZoom, debugMode]);

  // Get units for layer type
  const getUnitsForLayer = useCallback((layerValue) => {
    const unitsMap = {
      'hs': 'm',
      'composite_hs_dirm': 'm',
      'tm02': 's',
      'tpeak': 's',
      'dirm': '°',
      'inundation': 'm'
    };
    return unitsMap[layerValue] || '';
  }, []);

  // Layer management functions
  const addWMSLayer = useCallback((layerConfig) => {
    const map = mapInstance?.current;
    if (!map || !layerConfig) return null;

    try {
      // Remove existing layer if present
      if (servicesRef.current.activeLayer) {
        map.removeLayer(servicesRef.current.activeLayer);
      }

      // Create new WMS layer for Niue marine data
      const wmsLayer = L.tileLayer.wms(layerConfig.url, {
        layers: layerConfig.layer,
        format: 'image/png',
        transparent: true,
        opacity: layerOpacity,
        styles: layerConfig.styles || 'default-scalar/jet',
        time: currentSliderDate ? currentSliderDate.toISOString() : undefined,
        attribution: layerConfig.attribution || 'SPC Ocean Portal - Niue Waters',
        // Niue-specific WMS parameters
        crs: L.CRS.EPSG4326,
        uppercase: true,
        version: '1.3.0'
      });

      // Add to map and track
      wmsLayer.addTo(map);
      servicesRef.current.activeLayer = wmsLayer;
      servicesRef.current.wmsLayers.set(layerConfig.value, wmsLayer);

      if (debugMode) {
        console.log('🌊 Added Niue marine layer:', layerConfig.label);
      }

      return wmsLayer;
    } catch (error) {
      console.error('Failed to add WMS layer:', error);
      return null;
    }
  }, [mapInstance, layerOpacity, currentSliderDate, debugMode]);

  // Update layer time when slider changes
  useEffect(() => {
    const activeLayer = servicesRef.current.activeLayer;
    if (activeLayer && currentSliderDate) {
      const newUrl = activeLayer._url.replace(
        /time=[^&]*/,
        `time=${currentSliderDate.toISOString()}`
      );
      activeLayer.setUrl(newUrl);

      if (debugMode) {
        console.log('⏰ Updated Niue layer time:', currentSliderDate.toISOString());
      }
    }
  }, [currentSliderDate, debugMode]);

  // Fetch marine data at specific point
  const fetchMarineDataAtPoint = useCallback(async (latlng, layer) => {
    try {
      // Construct GetFeatureInfo request for Niue marine data
      const map = mapInstance?.current;
      if (!map) throw new Error('Map not available');

      const bounds = map.getBounds();
      const size = map.getSize();
      const point = map.latLngToContainerPoint(latlng);

      const params = new URLSearchParams({
        SERVICE: 'WMS',
        VERSION: '1.3.0',
        REQUEST: 'GetFeatureInfo',
        LAYERS: layer.layer,
        QUERY_LAYERS: layer.layer,
        INFO_FORMAT: 'application/json',
        FEATURE_COUNT: '1',
        CRS: 'EPSG:4326',
        BBOX: `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`,
        WIDTH: size.x,
        HEIGHT: size.y,
        I: Math.round(point.x),
        J: Math.round(point.y),
        TIME: currentSliderDate ? currentSliderDate.toISOString() : undefined
      });

      const response = await fetch(`${layer.url}?${params}`);
      const data = await response.json();

      // Process Niue marine data
      const processedData = {
        coordinates: latlng,
        layer: layer.label,
        value: data.features?.[0]?.properties?.value || 'No data',
        units: getUnitsForLayer(layer.value),
        timestamp: currentSliderDate?.toISOString(),
        location: 'Niue Waters',
        status: 'success',
        rawData: data
      };

      if (setBottomCanvasData) {
        setBottomCanvasData(processedData);
      }
      if (setShowBottomCanvas) {
        setShowBottomCanvas(true);
      }

      if (debugMode) {
        console.log('🎯 Niue marine data fetched:', processedData);
      }

    } catch (error) {
      throw new Error(`Failed to fetch Niue marine data: ${error.message}`);
    }
  }, [mapInstance, currentSliderDate, setBottomCanvasData, setShowBottomCanvas, debugMode, getUnitsForLayer]);

  // Handle map clicks for Niue marine data
  const handleMapClick = useCallback(async (clickEvent) => {
    const map = mapInstance?.current;
    if (!map || !servicesRef.current.interactionEnabled) return;

    setIsLoading(true);

    try {
      const { latlng } = clickEvent;
      
      // Remove existing marker
      if (currentMarker) {
        map.removeLayer(currentMarker);
      }

      // Add new marker with Niue marine styling
      const marker = L.marker(latlng, {
        icon: L.divIcon({
          className: 'niue-marine-marker',
          html: `
            <div style="
              background: linear-gradient(135deg, #06b6d4, #0ea5e9);
              border: 2px solid #ffffff;
              border-radius: 50%;
              width: 20px;
              height: 20px;
              box-shadow: 0 4px 12px rgba(6, 182, 212, 0.4);
              display: flex;
              align-items: center;
              justify-content: center;
            ">
              <span style="color: white; font-size: 10px; font-weight: bold;">📍</span>
            </div>
          `,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        })
      });

      marker.addTo(map);
      setCurrentMarker(marker);

      // Fetch marine data for clicked location
      if (selectedLayer && servicesRef.current.activeLayer) {
        await fetchMarineDataAtPoint(latlng, selectedLayer);
      } else {
        // Show basic location info for Niue waters
        const locationData = {
          coordinates: latlng,
          location: 'Niue Waters',
          timezone: 'Pacific/Niue',
          depth: 'Unknown',
          status: 'success'
        };

        if (setBottomCanvasData) {
          setBottomCanvasData(locationData);
        }
        if (setShowBottomCanvas) {
          setShowBottomCanvas(true);
        }
      }

    } catch (error) {
      console.error('Niue map click handling failed:', error);
      
      if (setBottomCanvasData) {
        setBottomCanvasData({
          error: 'Failed to fetch Niue marine data',
          status: 'error'
        });
      }
      if (setShowBottomCanvas) {
        setShowBottomCanvas(true);
      }
    } finally {
      setIsLoading(false);
    }
  }, [mapInstance, currentMarker, selectedLayer, setBottomCanvasData, setShowBottomCanvas, fetchMarineDataAtPoint]);

  // Set up map click listener
  useEffect(() => {
    const map = mapInstance?.current;
    if (!map || !mapReady) return;

    map.on('click', handleMapClick);

    return () => {
      map.off('click', handleMapClick);
    };
  }, [mapInstance, mapReady, handleMapClick]);

  // Track map movement for Niue bounds
  useEffect(() => {
    const map = mapInstance?.current;
    if (!map) return;

    const handleMoveEnd = () => {
      setMapCenter([map.getCenter().lat, map.getCenter().lng]);
      setMapZoom(map.getZoom());
    };

    map.on('moveend', handleMoveEnd);
    map.on('zoomend', handleMoveEnd);

    return () => {
      map.off('moveend', handleMoveEnd);
      map.off('zoomend', handleMoveEnd);
    };
  }, [mapInstance]);

  // Public API
  return {
    // State
    isLoading,
    mapReady,
    mapCenter,
    mapZoom,
    
    // Layer management
    addWMSLayer,
    
    // Interaction control
    enableInteraction: () => {
      servicesRef.current.interactionEnabled = true;
    },
    disableInteraction: () => {
      servicesRef.current.interactionEnabled = false;
    },
    
    // Marker management
    removeMarker: () => {
      if (currentMarker && mapInstance?.current) {
        mapInstance.current.removeLayer(currentMarker);
        setCurrentMarker(null);
      }
    },
    
    // Canvas control
    hideCanvas: () => {
      if (setShowBottomCanvas) {
        setShowBottomCanvas(false);
      }
      if (currentMarker && mapInstance?.current) {
        mapInstance.current.removeLayer(currentMarker);
        setCurrentMarker(null);
      }
    },
    
    // Layer control
    updateLayerOpacity: (opacity) => {
      if (servicesRef.current.activeLayer) {
        servicesRef.current.activeLayer.setOpacity(opacity);
      }
    },
    
    // Debug control
    setDebugMode: (enabled) => {
      // Update debug mode reference
      servicesRef.current.debugMode = enabled;
    }
  };
};

export default useMapInteraction;