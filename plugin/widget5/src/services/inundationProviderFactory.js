import FastApiInundationProvider from './FastApiInundationProvider';
import ZarrInundationProvider from './ZarrInundationProvider';

const DEFAULT_PROVIDER = 'fastapi';

// Runtime override set by the provider selector UI. null means "use env var".
let _runtimeProviderId = null;

/**
 * Switch the active provider at runtime.
 * @param {string|null} id  'fastapi' | 'zarr' | null (revert to env var)
 */
export function setRuntimeProvider(id) {
  _runtimeProviderId = id || null;
}

/**
 * Returns the currently active provider id (runtime override → env var → default).
 * @returns {'fastapi' | 'zarr'}
 */
export function getRuntimeProviderId() {
  return _runtimeProviderId
    || process.env.REACT_APP_INUNDATION_PROVIDER
    || DEFAULT_PROVIDER;
}

/**
 * Creates an inundation provider based on env config (or runtime override).
 *
 * Env vars:
 *   REACT_APP_INUNDATION_PROVIDER         — 'fastapi' (default) or 'zarr'
 *   REACT_APP_INUNDATION_ZARR_BASE_URL    — S3/HTTP base URL for Zarr store
 *   REACT_APP_INUNDATION_ZARR_DATASET     — Zarr dataset path (e.g. 'sfincs_h_forecast.zarr')
 *   REACT_APP_INUNDATION_ZARR_48H_DATASET — 48h max Zarr dataset path (optional)
 *
 * @param {string} [apiBase] FastAPI base URL (used for the fastapi provider)
 * @param {string} [overrideId] Force a specific provider ('fastapi' or 'zarr')
 * @returns {import('./InundationProvider').default}
 */
export function createInundationProvider(apiBase, overrideId) {
  const id = overrideId || getRuntimeProviderId();

  if (id === 'zarr') {
    const baseUrl = process.env.REACT_APP_INUNDATION_ZARR_BASE_URL || '';
    const dataset = process.env.REACT_APP_INUNDATION_ZARR_DATASET || 'sfincs_h_forecast.zarr';
    const dataset48h = process.env.REACT_APP_INUNDATION_ZARR_48H_DATASET || null;
    return new ZarrInundationProvider({ baseUrl, dataset, dataset48h });
  }

  return new FastApiInundationProvider(apiBase);
}

/** @deprecated use getRuntimeProviderId */
export function getDefaultProviderId() {
  return getRuntimeProviderId();
}
