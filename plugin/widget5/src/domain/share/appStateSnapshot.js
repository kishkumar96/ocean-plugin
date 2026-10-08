import { sanitizeEnvelope } from '../suitability/customEnvelopeProfiles';

export const APP_SHARE_STATE_VERSION = 1;
export const APP_SHARE_HASH_KEY = 'view';

const VALID_BASEMAPS = new Set(['satellite', 'street', 'dark']);
const VALID_RANGE_MODES = new Set(['single', 'rolling-48h', 'custom']);
const VALID_RENDER_MODES = new Set(['continuous', 'bands']);
const VALID_SUITABILITY_MODES = new Set(['preset', 'custom']);
const VALID_VESSEL_CLASSES = new Set([
  'traditional_craft',
  'very_small_motorised_craft',
  'small_craft',
  'larger_vessels',
]);
const VALID_FLOOD_MODES = new Set(['2d', '3d']);
const VALID_TIME_ZONES = new Set(['Pacific/Rarotonga', 'UTC']);

function finiteNumber(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function validDateString(value) {
  if (typeof value !== 'string' || !value || Number.isNaN(new Date(value).getTime())) return null;
  return new Date(value).toISOString();
}

function normalizeMap(map) {
  if (!map || typeof map !== 'object') return null;
  const center = Array.isArray(map.center) && map.center.length === 2
    ? [finiteNumber(map.center[0], -180, 180), finiteNumber(map.center[1], -90, 90)]
    : null;
  const bounds = Array.isArray(map.bounds) && map.bounds.length === 4
    ? [
        finiteNumber(map.bounds[0], -180, 180),
        finiteNumber(map.bounds[1], -90, 90),
        finiteNumber(map.bounds[2], -180, 180),
        finiteNumber(map.bounds[3], -90, 90),
      ]
    : null;

  const normalized = {
    center: center?.every((value) => value !== null) ? center : undefined,
    bounds: bounds?.every((value) => value !== null) && bounds[0] < bounds[2] && bounds[1] < bounds[3]
      ? bounds
      : undefined,
    zoom: finiteNumber(map.zoom, 0, 24) ?? undefined,
    bearing: finiteNumber(map.bearing, -360, 360) ?? 0,
    pitch: finiteNumber(map.pitch, 0, 60) ?? 0,
    basemap: VALID_BASEMAPS.has(map.basemap) ? map.basemap : 'satellite',
  };
  return normalized.center || normalized.bounds ? normalized : null;
}

function normalizeRangeWindow(rangeWindow) {
  const mode = VALID_RANGE_MODES.has(rangeWindow?.mode) ? rangeWindow.mode : 'single';
  if (mode !== 'custom') return { mode };

  const startTime = validDateString(rangeWindow.startTime);
  const endTime = validDateString(rangeWindow.endTime);
  if (!startTime || !endTime || startTime >= endTime) return { mode: 'single' };
  return { mode, startTime, endTime };
}

function normalizeRoute(route) {
  if (!route || typeof route !== 'object') return null;
  const points = Array.isArray(route.points)
    ? route.points.slice(0, 50).map((point) => ({
        lon: finiteNumber(point?.lon, -180, 180),
        lat: finiteNumber(point?.lat, -90, 90),
      })).filter((point) => point.lon !== null && point.lat !== null)
    : [];
  const speedKt = finiteNumber(route.speedKt, 1, 100) ?? 8;
  const departureTime = typeof route.departureTime === 'string'
    && route.departureTime.length <= 32
    && !Number.isNaN(new Date(route.departureTime).getTime())
    ? route.departureTime
    : null;
  return { points, speedKt, departureTime: departureTime ?? undefined };
}

export function normalizeAppShareState(input) {
  if (!input || typeof input !== 'object') return null;
  if (input.version !== undefined && Number(input.version) !== APP_SHARE_STATE_VERSION) return null;

  const map = normalizeMap(input.map);
  const layer = typeof input.forecast?.layer === 'string' && input.forecast.layer.length <= 100
    ? input.forecast.layer
    : null;
  if (!map || !layer) return null;

  const opacity = finiteNumber(input.forecast?.opacity, 0, 1);
  const vesselClass = VALID_VESSEL_CLASSES.has(input.filters?.vesselClass)
    ? input.filters.vesselClass
    : 'traditional_craft';
  // Same validator the localStorage loader uses, scoped to the vessel the
  // link actually selects; an unusable envelope degrades to that preset.
  const customEnvelope = sanitizeEnvelope(vesselClass, input.filters?.customEnvelope);
  const impactScenario = typeof input.filters?.impactScenario === 'string'
    && input.filters.impactScenario.length <= 100
    ? input.filters.impactScenario
    : null;

  return {
    version: APP_SHARE_STATE_VERSION,
    map,
    forecast: {
      layer,
      time: validDateString(input.forecast?.time) ?? undefined,
      opacity: opacity ?? 1,
      rangeWindow: normalizeRangeWindow(input.forecast?.rangeWindow),
    },
    filters: {
      riskPoints: input.filters?.riskPoints !== false,
      inundationRenderMode: VALID_RENDER_MODES.has(input.filters?.inundationRenderMode)
        ? input.filters.inundationRenderMode
        : 'continuous',
      vesselClass,
      suitabilityMode: VALID_SUITABILITY_MODES.has(input.filters?.suitabilityMode)
        ? input.filters.suitabilityMode
        : 'preset',
      customEnvelope: customEnvelope ?? undefined,
      terrainEnabled: input.filters?.terrainEnabled === true,
      floodDisplayMode: VALID_FLOOD_MODES.has(input.filters?.floodDisplayMode)
        ? input.filters.floodDisplayMode
        : '2d',
      flood3dElevScale: finiteNumber(input.filters?.flood3dElevScale, 1, 50) ?? 6,
      impactScenario: impactScenario ?? undefined,
    },
    route: normalizeRoute(input.route),
    preferences: {
      timeDisplayZone: VALID_TIME_ZONES.has(input.preferences?.timeDisplayZone)
        ? input.preferences.timeDisplayZone
        : 'Pacific/Rarotonga',
      playSpeedMs: finiteNumber(input.preferences?.playSpeedMs, 100, 10000) ?? 700,
    },
  };
}

function encodeUtf8(value) {
  const binary = encodeURIComponent(value).replace(/%([0-9A-F]{2})/g, (_, hex) => (
    String.fromCharCode(parseInt(hex, 16))
  ));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeUtf8(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const encoded = Array.from(binary, (char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join('');
  return decodeURIComponent(encoded);
}

export function encodeAppShareState(state) {
  const normalized = normalizeAppShareState(state);
  if (!normalized) throw new Error('Application state is not shareable.');
  return encodeUtf8(JSON.stringify(normalized));
}

export function decodeAppShareState(encoded) {
  try {
    if (typeof encoded !== 'string' || !encoded || encoded.length > 12000) return null;
    return normalizeAppShareState(JSON.parse(decodeUtf8(encoded)));
  } catch {
    return null;
  }
}

export function readAppShareState(hash = window.location.hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  return decodeAppShareState(params.get(APP_SHARE_HASH_KEY));
}

export function createAppShareUrl(state, currentUrl = window.location.href) {
  const url = new URL(currentUrl);
  url.searchParams.delete('token');
  url.searchParams.delete('access_token');
  url.searchParams.delete('auth_token');
  url.hash = new URLSearchParams({ [APP_SHARE_HASH_KEY]: encodeAppShareState(state) }).toString();
  return url.toString();
}
