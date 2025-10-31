/**
 * Inundation Service
 * 
 * Fetches and processes inundation point data for Tuvalu atolls
 * Data source: THREDDS server JSON endpoint
 */

import TuvaluConfig from '../config/TuvaluConfig';
import logger from '../utils/logger';

/**
 * Risk thresholds (depth in meters) and presentation config
 * Colors are aligned with stakeholder request (blue → orange → red)
 */
const RISK_DEPTH_THRESHOLDS = {
  LOW: 0.3,    // < 0.3 m = low
  MEDIUM: 0.6  // 0.3-0.6 m = medium, >0.6 m = high
};

export const RISK_LEVEL_CONFIG = {
  LOW: {
    label: 'Low Risk',
    color: '#1e88e5' // Blue
  },
  MEDIUM: {
    label: 'Medium Risk',
    color: '#fb8c00' // Orange
  },
  HIGH: {
    label: 'High Risk',
    color: '#d32f2f' // Red
  }
};

/**
 * Normalise various risk descriptors into LOW/MEDIUM/HIGH buckets
 * @param {string|number} value - risk text or numeric indicator
 * @returns {('LOW'|'MEDIUM'|'HIGH'|null)}
 */
const normalizeRiskDescriptor = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < RISK_DEPTH_THRESHOLDS.LOW) return 'LOW';
    if (value < RISK_DEPTH_THRESHOLDS.MEDIUM) return 'MEDIUM';
    return 'HIGH';
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;

  if (normalized.includes('low') || normalized.includes('minor')) return 'LOW';
  if (
    normalized.includes('med') ||
    normalized.includes('moderate') ||
    normalized.includes('medium') ||
    normalized.includes('watch') ||
    normalized.includes('warn')
  ) {
    return 'MEDIUM';
  }
  if (
    normalized.includes('high') ||
    normalized.includes('severe') ||
    normalized.includes('extreme') ||
    normalized.includes('major') ||
    normalized.includes('red')
  ) {
    return 'HIGH';
  }

  return null;
};

/**
 * Resolve the risk bucket using an explicit descriptor when present,
 * otherwise fall back to the inundation depth.
 */
const deriveRiskKey = (depth, explicitRisk) => {
  const fromExplicit = normalizeRiskDescriptor(explicitRisk);
  if (fromExplicit) return fromExplicit;

  if (Number.isFinite(depth)) {
    if (depth < RISK_DEPTH_THRESHOLDS.LOW) return 'LOW';
    if (depth < RISK_DEPTH_THRESHOLDS.MEDIUM) return 'MEDIUM';
    return 'HIGH';
  }

  return 'LOW';
};

/**
 * Build a THREDDS-accessible image URL from a raw value, typically coming
 * from `primary_image_url`.
 * @param {string} rawUrl
 * @returns {{ url: string, fileName: string }|null}
 */
const buildForecastImageReference = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  const parts = trimmed.split('/');
  const fileName = parts.pop() || parts.pop();
  if (!fileName) return null;

  return {
    fileName,
    url: `https://gemthreddshpc.spc.int/thredds/fileServer/POP/model/country/spc/forecast/hourly/TUV/${fileName}`
  };
};

/**
 * Get marker color based on inundation depth
 * @param {number} depth - Inundation depth in meters
 * @param {string|number} explicitRisk - Optional risk descriptor from API
 * @returns {string} - Color hex code
 */
export const getInundationColor = (depth, explicitRisk) => {
  const riskKey = deriveRiskKey(depth, explicitRisk);
  return RISK_LEVEL_CONFIG[riskKey]?.color || RISK_LEVEL_CONFIG.LOW.color;
};

/**
 * Get risk level label
 * @param {number} depth - Inundation depth in meters
 * @param {string|number} explicitRisk - Optional risk descriptor from API
 * @returns {string} - Risk level label
 */
export const getRiskLevel = (depth, explicitRisk) => {
  const riskKey = deriveRiskKey(depth, explicitRisk);
  return RISK_LEVEL_CONFIG[riskKey]?.label || RISK_LEVEL_CONFIG.LOW.label;
};

/**
 * Fetch inundation data from THREDDS server with retry logic
 * Returns empty array if data is unavailable (expected scenario)
 * @param {number} retries - Number of retry attempts
 * @returns {Promise<Array>} - Array of inundation points (empty if unavailable)
 */
export const fetchInundationData = async (retries = 2) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.network('GET', TuvaluConfig.INUNDATION_DATA_URL, 'pending', { attempt });
      
      const response = await fetch(TuvaluConfig.INUNDATION_DATA_URL, {
        headers: {
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(8000) // 8 second timeout
      });
      
      if (!response.ok) {
        // 404 or other errors mean no data is currently available
        if (response.status === 404) {
          logger.info('INUNDATION', 'No inundation forecast data currently available (404)');
          return [];
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      logger.network('GET', TuvaluConfig.INUNDATION_DATA_URL, response.status, { 
        dataSize: JSON.stringify(data).length 
      });
      
      const processed = processInundationData(data);
      
      if (processed.length === 0) {
        logger.info('INUNDATION', 'Inundation data endpoint returned no points');
      } else {
        logger.inundation(`Loaded ${processed.length} inundation points`);
      }
      
      return processed;
    } catch (error) {
      // For timeout or network errors, this is expected - just log debug info
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        logger.debug('INUNDATION', `Fetch timeout on attempt ${attempt}`);
      } else {
        logger.debug('INUNDATION', `Fetch attempt ${attempt} failed: ${error.message}`);
      }
      
      if (attempt < retries) {
        // Shorter backoff for expected failures
        const delay = 1000 * attempt;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // Return empty array instead of throwing - no data is an expected state
  logger.info('INUNDATION', 'Inundation data not available, will retry on next load');
  return [];
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
    const processed = points.map((point, index) => {
      const depth = parseFloat(point.depth ?? point.inundation ?? point.value ?? 0);
      const explicitRisk =
        point.risk_category ||
        point.risk ||
        point.riskLevel ||
        point.risk_level ||
        point.alert_level ||
        point.alertLevel;

      const riskKey = deriveRiskKey(depth, explicitRisk);
      const riskConfig = RISK_LEVEL_CONFIG[riskKey] || RISK_LEVEL_CONFIG.LOW;

      const imageRef = buildForecastImageReference(
        point.primary_image_url ||
        point.primaryImageUrl ||
        point.primary_image ||
        point.image_url ||
        point.imageUrl
      );

      return {
        id: point.id || `inun-${index}`,
        lat: parseFloat(point.lat ?? point.latitude ?? point.y),
        lon: parseFloat(point.lon ?? point.longitude ?? point.x),
        depth,
        location: point.location || point.name || point.atoll || `Point ${index + 1}`,
        timestamp: point.timestamp || point.time || new Date().toISOString(),
        color: riskConfig.color,
        riskLevel: riskConfig.label,
        riskKey,
        imageFileName: imageRef?.fileName || null,
        imageUrl: imageRef?.url || null,
        // Preserve raw payload for downstream analytics
        rawData: point
      };
    }).filter(point => !isNaN(point.lat) && !isNaN(point.lon));
    
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
    lowRisk: points.filter(p => p.riskKey === 'LOW').length,
    moderateRisk: points.filter(p => p.riskKey === 'MEDIUM').length,
    highRisk: points.filter(p => p.riskKey === 'HIGH').length,
    extremeRisk: 0,
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
  RISK_LEVEL_CONFIG
};

export default InundationServiceExport;
