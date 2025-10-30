/**
 * Inundation Service
 * 
 * Fetches and processes inundation point data for Tuvalu atolls
 * Data source: THREDDS server JSON endpoint
 */

import TuvaluConfig from '../config/TuvaluConfig';
import logger from '../utils/logger';

/**
 * Risk level thresholds (in meters)
 */
const RISK_THRESHOLDS = {
  LOW: 0.3,      // < 0.3m - Low risk (green)
  MODERATE: 0.6, // 0.3-0.6m - Moderate risk (yellow)
  HIGH: 1.0,     // 0.6-1.0m - High risk (orange)
  EXTREME: 1.0   // > 1.0m - Extreme risk (red)
};

/**
 * Get marker color based on inundation depth
 * @param {number} depth - Inundation depth in meters
 * @returns {string} - Color hex code
 */
export const getInundationColor = (depth) => {
  if (depth < RISK_THRESHOLDS.LOW) {
    return '#28a745'; // Green - Low risk
  } else if (depth < RISK_THRESHOLDS.MODERATE) {
    return '#ffc107'; // Yellow - Moderate risk
  } else if (depth < RISK_THRESHOLDS.HIGH) {
    return '#fd7e14'; // Orange - High risk
  } else {
    return '#dc3545'; // Red - Extreme risk
  }
};

/**
 * Get risk level label
 * @param {number} depth - Inundation depth in meters
 * @returns {string} - Risk level label
 */
export const getRiskLevel = (depth) => {
  if (depth < RISK_THRESHOLDS.LOW) {
    return 'Low Risk';
  } else if (depth < RISK_THRESHOLDS.MODERATE) {
    return 'Moderate Risk';
  } else if (depth < RISK_THRESHOLDS.HIGH) {
    return 'High Risk';
  } else {
    return 'Extreme Risk';
  }
};

/**
 * Fetch inundation data from THREDDS server with retry logic
 * @param {number} retries - Number of retry attempts
 * @returns {Promise<Array>} - Array of inundation points
 */
export const fetchInundationData = async (retries = 3) => {
  let lastError;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.network('GET', TuvaluConfig.INUNDATION_DATA_URL, 'pending', { attempt });
      
      const response = await fetch(TuvaluConfig.INUNDATION_DATA_URL, {
        headers: {
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      logger.network('GET', TuvaluConfig.INUNDATION_DATA_URL, response.status, { 
        dataSize: JSON.stringify(data).length 
      });
      
      const processed = processInundationData(data);
      logger.inundation(`Loaded ${processed.length} inundation points`);
      
      return processed;
    } catch (error) {
      lastError = error;
      logger.warn('INUNDATION', `Fetch attempt ${attempt} failed: ${error.message}`);
      
      if (attempt < retries) {
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        logger.info('INUNDATION', `Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  logger.error('INUNDATION', 'Failed to fetch inundation data after all retries', lastError);
  throw new Error(`Failed to fetch inundation data: ${lastError?.message || 'Unknown error'}`);
};

/**
 * Process raw inundation data
 * @param {Object} rawData - Raw data from THREDDS
 * @returns {Array} - Processed inundation points
 */
const processInundationData = (rawData) => {
  try {
    logger.debug('INUNDATION', 'Processing raw inundation data', { 
      type: typeof rawData,
      isArray: Array.isArray(rawData) 
    });
    
    // Handle different possible data structures
    let points = [];
    
    if (Array.isArray(rawData)) {
      points = rawData;
    } else if (rawData.points) {
      points = rawData.points;
    } else if (rawData.data) {
      points = rawData.data;
    } else if (rawData.features) {
      // GeoJSON format
      points = rawData.features.map(feature => ({
        lat: feature.geometry.coordinates[1],
        lon: feature.geometry.coordinates[0],
        depth: feature.properties.depth || feature.properties.inundation || 0,
        location: feature.properties.location || feature.properties.name || 'Unknown',
        timestamp: feature.properties.timestamp || feature.properties.time,
        ...feature.properties
      }));
    }
    
    // Validate and enhance each point
    const processed = points.map((point, index) => ({
      id: point.id || `inun-${index}`,
      lat: parseFloat(point.lat || point.latitude || point.y),
      lon: parseFloat(point.lon || point.longitude || point.x),
      depth: parseFloat(point.depth || point.inundation || point.value || 0),
      location: point.location || point.name || point.atoll || `Point ${index + 1}`,
      timestamp: point.timestamp || point.time || new Date().toISOString(),
      color: getInundationColor(parseFloat(point.depth || point.inundation || point.value || 0)),
      riskLevel: getRiskLevel(parseFloat(point.depth || point.inundation || point.value || 0)),
      // Store original point for additional data
      rawData: point
    })).filter(point => !isNaN(point.lat) && !isNaN(point.lon));
    
    logger.info('INUNDATION', `Processed ${processed.length} valid inundation points`);
    return processed;
    
  } catch (error) {
    logger.error('INUNDATION', 'Error processing inundation data', error);
    return [];
  }
};

/**
 * Get inundation points for a specific atoll
 * @param {Array} allPoints - All inundation points
 * @param {string} atollName - Name of the atoll
 * @returns {Array} - Filtered points for the atoll
 */
export const getPointsForAtoll = (allPoints, atollName) => {
  return allPoints.filter(point => 
    point.location.toLowerCase().includes(atollName.toLowerCase()) ||
    point.atoll?.toLowerCase() === atollName.toLowerCase()
  );
};

/**
 * Get inundation statistics
 * @param {Array} points - Inundation points
 * @returns {Object} - Statistics object
 */
export const getInundationStats = (points) => {
  if (!points || points.length === 0) {
    return {
      total: 0,
      lowRisk: 0,
      moderateRisk: 0,
      highRisk: 0,
      extremeRisk: 0,
      maxDepth: 0,
      avgDepth: 0
    };
  }
  
  const depths = points.map(p => p.depth);
  const maxDepth = Math.max(...depths);
  const avgDepth = depths.reduce((a, b) => a + b, 0) / depths.length;
  
  return {
    total: points.length,
    lowRisk: points.filter(p => p.depth < RISK_THRESHOLDS.LOW).length,
    moderateRisk: points.filter(p => p.depth >= RISK_THRESHOLDS.LOW && p.depth < RISK_THRESHOLDS.MODERATE).length,
    highRisk: points.filter(p => p.depth >= RISK_THRESHOLDS.MODERATE && p.depth < RISK_THRESHOLDS.HIGH).length,
    extremeRisk: points.filter(p => p.depth >= RISK_THRESHOLDS.HIGH).length,
    maxDepth: maxDepth.toFixed(2),
    avgDepth: avgDepth.toFixed(2)
  };
};

const InundationServiceExport = {
  fetchInundationData,
  getInundationColor,
  getRiskLevel,
  getPointsForAtoll,
  getInundationStats,
  RISK_THRESHOLDS
};

export default InundationServiceExport;
