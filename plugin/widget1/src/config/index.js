/**
 * Configuration Index - Niue Marine Forecast System
 * 
 * Centralized exports for all configuration modules
 */

// Main configurations
export { default as UI_CONFIG } from './uiConfig.js';
export { default as MARINE_CONFIG, MARINE_VARIABLES, NIUE_LAYERS } from './marineVariables.js';
export { default as NIUE_CONFIG } from './niueConfig.js';

// Selective exports for convenience
export {
  country,
  coordinates, 
  timezone,
  theme,
  map,
  forecast,
  thresholds
} from './niueConfig.js';