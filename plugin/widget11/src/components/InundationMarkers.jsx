/**
 * Inundation Markers Component
 * 
 * Displays inundation points on the map with risk-based colors
 * Supports clickable markers that show forecast images
 */

import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import L from 'leaflet';
import { fetchInundationData } from '../services/InundationService';
import logger from '../utils/logger';

// Create custom marker icon with dynamic color
const createInundationIcon = (color, depth) => {
  return L.divIcon({
    className: 'inundation-marker',
    html: `
      <div style="
        width: 24px;
        height: 24px;
        background-color: ${color};
        border: 2px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: bold;
        color: white;
        text-shadow: 0 1px 2px rgba(0,0,0,0.5);
      ">
        ${depth >= 1.0 ? '!' : ''}
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  });
};

/**
 * InundationMarkers Component
 * @param {Object} mapInstance - Leaflet map ref (use mapInstance.current to access map)
 * @param {Function} onMarkerClick - Callback when marker is clicked
 */
const InundationMarkers = ({ mapInstance, onMarkerClick, onDataLoaded }) => {
  const [markers, setMarkers] = useState([]);
  const [inundationPoints, setInundationPoints] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasShownNoDataMessage, setHasShownNoDataMessage] = useState(false);

  // Fetch inundation data on component mount
  useEffect(() => {
    const loadInundationData = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const data = await fetchInundationData();
        setInundationPoints(data);
        if (onDataLoaded) {
          onDataLoaded(data);
        }
        if (data.length > 0) {
          logger.inundation(`Loaded ${data.length} inundation points for map display`);
        }
      } catch (err) {
        // This shouldn't happen now since fetchInundationData returns [] on error
        // But keeping error handling for safety
        logger.debug('INUNDATION', 'Failed to load inundation data', err);
        setError(err.message);
        setInundationPoints([]); // Set to empty array on error
      } finally {
        setIsLoading(false);
      }
    };

    loadInundationData();
  }, []);

  // Add markers to map when data is loaded
  useEffect(() => {
    // Get the actual map instance from the ref
    const map = mapInstance?.current;
    
    if (!map || !inundationPoints.length) {
      return;
    }

    // Clear existing markers
    markers.forEach(marker => {
      if (marker && marker.remove) {
        marker.remove();
      }
    });

    // Create new markers
    const newMarkers = inundationPoints.map(point => {
      const icon = createInundationIcon(point.color, point.depth);
      const popupPointId = JSON.stringify(point.id);
      
      const marker = L.marker([point.lat, point.lon], { icon })
        .bindPopup(`
          <div style="min-width: 200px;">
            <h4 style="margin: 0 0 8px 0; color: ${point.color};">
              ${point.location}
            </h4>
            <p style="margin: 4px 0;">
              <strong>Inundation Depth:</strong> ${point.depth.toFixed(2)} m
            </p>
            <p style="margin: 4px 0;">
              <strong>Risk Level:</strong> 
              <span style="color: ${point.color}; font-weight: bold;">
                ${point.riskLevel}
              </span>
            </p>
            ${point.timestamp ? `
              <p style="margin: 4px 0; font-size: 0.85em; color: #666;">
                <strong>Time:</strong> ${new Date(point.timestamp).toLocaleString()}
              </p>
            ` : ''}
            ${point.imageUrl ? `
              <p style="margin: 4px 0; font-size: 0.85em; color: #666;">
                <strong>Forecast Image:</strong> ${point.imageFileName}
              </p>
            ` : ''}
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #ddd;">
              <button 
                onclick="window.showForecastImage && window.showForecastImage(${popupPointId})"
                style="
                  width: 100%;
                  padding: 6px 12px;
                  background-color: #007bff;
                  color: white;
                  border: none;
                  border-radius: 4px;
                  cursor: pointer;
                  font-size: 0.9em;
                "
              >
                View Forecast Images
              </button>
            </div>
          </div>
        `)
        .on('click', () => {
          if (onMarkerClick) {
            onMarkerClick(point);
          }
        })
        .addTo(map);

      return marker;
    });

    setMarkers(newMarkers);

    // Cleanup function
    return () => {
      newMarkers.forEach(marker => {
        if (marker && marker.remove) {
          marker.remove();
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapInstance, inundationPoints, onMarkerClick]);

  // Cache inundation points globally for popup button callbacks
  useEffect(() => {
    if (inundationPoints.length > 0) {
      window.__inundationPointCache = inundationPoints.reduce((acc, point) => {
        acc[point.id] = point;
        return acc;
      }, {});
    } else if (window.__inundationPointCache) {
      delete window.__inundationPointCache;
    }

    return () => {
      if (window.__inundationPointCache) {
        delete window.__inundationPointCache;
      }
    };
  }, [inundationPoints]);

  // Add loading indicator to map if needed
  useEffect(() => {
    const map = mapInstance?.current;
    
    if (!map) return;

    if (isLoading) {
      logger.debug('INUNDATION', 'Loading inundation markers...');
    } else if (error) {
      logger.error('INUNDATION', 'Error displaying markers', { error });
    } else if (inundationPoints.length > 0) {
      logger.info('INUNDATION', `${inundationPoints.length} markers displayed on map`);
    } else if (!hasShownNoDataMessage) {
      // Show user-friendly info message only once
      logger.info('INUNDATION', 'No inundation data currently available. Data will appear when forecast is available.');
      setHasShownNoDataMessage(true);
    }
  }, [isLoading, error, inundationPoints, mapInstance, hasShownNoDataMessage]);

  return null; // This component doesn't render anything directly
};

InundationMarkers.propTypes = {
  mapInstance: PropTypes.object,
  onMarkerClick: PropTypes.func,
  onDataLoaded: PropTypes.func
};

export default InundationMarkers;
