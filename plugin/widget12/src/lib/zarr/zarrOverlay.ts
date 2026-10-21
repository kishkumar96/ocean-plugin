/* eslint-disable @typescript-eslint/no-explicit-any */
// Renders a rectilinear lat/lon Zarr variable as a deck.gl bitmap over MapLibre.

import { MapboxOverlay } from "@deck.gl/mapbox";
import { BitmapLayer, IconLayer } from "@deck.gl/layers";
import type { Map as MaplibreMap } from "maplibre-gl";
import FetchStore from "@zarrita/storage/fetch";
import { get as zarritaGet, open as openZarrita } from "zarrita";
import { getColormap, type RGB } from "./colormaps";

export type PointTimeseries = {
  lon: number;
  lat: number;
  timeLabels: string[];
  variables: {
    name: string;
    units: string;
    values: number[];
    isDirection?: boolean;
  }[];
};

// ========== Constants ==========
const MAX_MERCATOR_LAT = (Math.atan(Math.sinh(Math.PI)) * 180) / Math.PI;
const MAX_RENDER_DIMENSION = 2048;
// Memory/network budgets per layer, so light datasets (e.g. 1 MB/slice) cache
// and prefetch generously while heavy ones (e.g. 40 MB/slice) stay modest.
// Decoded slices kept in memory, and upcoming timesteps fetched ahead so
// playback doesn't wait on the network.
const CACHE_BUDGET_BYTES = 256e6;
const PREFETCH_BUDGET_BYTES = 48e6;
const MAX_CACHED_SLICES = 48;
const PREFETCH_AHEAD = 4;
const DTYPE_BYTES: Record<string, number> = {
  int8: 1,
  uint8: 1,
  bool: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  float32: 4,
  int64: 8,
  uint64: 8,
  float64: 8,
};
const BITMAP_TEXTURE_PARAMETERS = {
  minFilter: "nearest",
  magFilter: "nearest",
  mipmapFilter: "none",
  addressModeU: "clamp-to-edge",
  addressModeV: "clamp-to-edge",
} as const;
const DIRECTION_ARROW_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path d="M32 4 L50 24 H39 V60 H25 V24 H14 Z" fill="white"/></svg>',
)}`;

type DirectionMetadata = {
  standardName: string;
  longName: string;
  comment: string;
  units: string;
};

// ========== Helper functions ==========
function normalizeText(value: any) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
function buildDirectionMetadata(
  raw: Record<string, unknown> | null | undefined,
): DirectionMetadata {
  return {
    standardName: normalizeText(raw?.standard_name),
    longName: normalizeText(raw?.long_name),
    comment: normalizeText(raw?.comment),
    units: normalizeText(raw?.units),
  };
}
function normalizeWaveDirectionForIcon(
  rawAngle: number,
  metadata: DirectionMetadata,
  offset = 0,
) {
  let direction = ((rawAngle % 360) + 360) % 360;

  const isFromDirection =
    metadata.standardName.includes("from_direction") ||
    metadata.longName.includes("from direction") ||
    metadata.comment.includes("from direction");

  if (isFromDirection) {
    direction = (direction + 180) % 360;
  }

  const isClockwiseFromNorth =
    metadata.comment.includes("clockwise from due north") ||
    metadata.comment.includes("north=0") ||
    metadata.units.includes("degree");

  const iconAngle = isClockwiseFromNorth ? -direction : direction;
  return (((iconAngle + offset) % 360) + 360) % 360;
}
function looksLikeTime(name: string, node: any) {
  const normalizedName = normalizeText(name);
  const units = normalizeText(node?.attributes?.units);
  const longName = normalizeText(node?.attributes?.long_name);
  const standardName = normalizeText(node?.attributes?.standard_name);
  return (
    normalizedName === "time" ||
    normalizedName === "valid_time" ||
    standardName === "time" ||
    longName.includes("time") ||
    units.includes("since")
  );
}
function inferTimeDimensionName(dimensionNames: string[], metadata: any) {
  return (
    dimensionNames.find((dim) => looksLikeTime(dim, metadata?.[dim])) ?? null
  );
}
function buildSliceSelection(
  dimensionNames: string[],
  latName: string,
  lonName: string,
  timeDimName: string | null,
  timeIndex: number,
  depthDimName: string | null = null,
  depthIndex = 0,
) {
  return dimensionNames.map((dim) => {
    if (dim === latName || dim === lonName) return null;
    if (timeDimName && dim === timeDimName) return timeIndex;
    if (depthDimName && dim === depthDimName) return depthIndex;
    return 0;
  });
}

const DEPTH_DIMENSION_NAMES = [
  "depth",
  "z",
  "zlev",
  "lev",
  "level",
  "height",
  "altitude",
];

function inferDepthDimensionName(
  dimensionNames: string[],
  latName: string,
  lonName: string,
  timeDimName: string | null,
) {
  // A depth axis is any non-horizontal, non-time dimension. Prefer well-known
  // names, then fall back to the first leftover dimension.
  const candidates = dimensionNames.filter(
    (dim) => dim !== latName && dim !== lonName && dim !== timeDimName,
  );
  const named = candidates.find((dim) =>
    DEPTH_DIMENSION_NAMES.includes(normalizeText(dim)),
  );
  return named ?? candidates[0] ?? null;
}
function clampLatitudeToMercator(latitude: number) {
  return Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, latitude));
}
function latToMercatorY(latitude: number) {
  const radians = (clampLatitudeToMercator(latitude) * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}
function mercatorYToLat(y: number) {
  return (Math.atan(Math.sinh(y)) * 180) / Math.PI;
}
function interpolateFinite(a: number, b: number, t: number) {
  const aFin = Number.isFinite(a);
  const bFin = Number.isFinite(b);
  if (aFin && bFin) return a + (b - a) * t;
  if (aFin) return a;
  if (bFin) return b;
  return NaN;
}
function computeEdges(values: ArrayLike<number>) {
  if (!values || values.length < 2) return null;
  const edges = new Float64Array(values.length + 1);
  edges[0] = values[0] - (values[1] - values[0]) / 2;
  for (let i = 1; i < values.length; i++)
    edges[i] = (values[i - 1] + values[i]) / 2;
  edges[values.length] =
    values[values.length - 1] +
    (values[values.length - 1] - values[values.length - 2]) / 2;
  return edges;
}
function computeRepresentativeStep(values: number[], axisName: string) {
  for (let i = 1; i < values.length; i++) {
    const step = values[i] - values[i - 1];
    if (Number.isFinite(step) && step !== 0) {
      return step;
    }
  }
  throw new Error(
    `Invalid coordinate step for ${axisName}: all adjacent values are identical.`,
  );
}
function assertFiniteNumber(name: string, value: number) {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${name}: ${String(value)}`);
  }
}
function assertFiniteNumberArray(name: string, values: number[]) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`Invalid ${name}: empty array`);
  }
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) {
      throw new Error(`Invalid ${name}[${i}]: ${String(values[i])}`);
    }
  }
}
function isFiniteBounds(
  bounds: any,
): bounds is {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
} {
  return (
    bounds &&
    Number.isFinite(bounds.lonMin) &&
    Number.isFinite(bounds.lonMax) &&
    Number.isFinite(bounds.latMin) &&
    Number.isFinite(bounds.latMax)
  );
}
function isNonDegenerateBounds(bounds: {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}) {
  return bounds.lonMin !== bounds.lonMax && bounds.latMin !== bounds.latMax;
}
function isArrayMetadata(node: any) {
  return node && (node.node_type === "array" || Array.isArray(node.shape));
}
/** Accept a list of names, or one saved as a string like "['time', 'lat', 'lon']". */
function asNameList(value: any): string[] | null {
  if (Array.isArray(value)) return value.length ? value : null;
  if (typeof value === "string") {
    const names = value.match(/[A-Za-z_][\w.-]*/g);
    return names?.length ? names : null;
  }
  return null;
}
function getDimensionNames(node: any, fallbackName: string | null = null) {
  return (
    asNameList(node?.dimension_names) ??
    asNameList(node?.attributes?._ARRAY_DIMENSIONS) ??
    (fallbackName ? [fallbackName] : [])
  );
}
function looksLikeLatitude(name: string, node: any) {
  const n = normalizeText(name);
  const u = normalizeText(node?.attributes?.units);
  const ln = normalizeText(node?.attributes?.long_name);
  const sn = normalizeText(node?.attributes?.standard_name);
  return (
    n === "lat" ||
    n === "latitude" ||
    u.includes("degrees_north") ||
    sn === "latitude" ||
    ln.includes("latitude")
  );
}
function looksLikeLongitude(name: string, node: any) {
  const n = normalizeText(name);
  const u = normalizeText(node?.attributes?.units);
  const ln = normalizeText(node?.attributes?.long_name);
  const sn = normalizeText(node?.attributes?.standard_name);
  return (
    n === "lon" ||
    n === "longitude" ||
    u.includes("degrees_east") ||
    sn === "longitude" ||
    ln.includes("longitude")
  );
}
function discoverCoordinateNames(metadata: any) {
  let latName: string | null = null,
    lonName: string | null = null;
  for (const [name, node] of Object.entries(metadata)) {
    if (!isArrayMetadata(node)) continue;
    if (!latName && looksLikeLatitude(name, node)) latName = name;
    if (!lonName && looksLikeLongitude(name, node)) lonName = name;
  }
  return { latName, lonName };
}
function buildSpatialAccessor(
  values: any,
  shape: number[],
  latAxis: number,
  lonAxis: number,
) {
  if (latAxis === 0 && lonAxis === 1) {
    const height = shape[0],
      width = shape[1];
    return {
      width,
      height,
      getValue: (x: number, y: number) => values[y * width + x],
    };
  }
  if (lonAxis === 0 && latAxis === 1) {
    const width = shape[0],
      height = shape[1];
    return {
      width,
      height,
      getValue: (x: number, y: number) => values[x * height + y],
    };
  }
  throw new Error("Expected exactly one latitude axis and one longitude axis.");
}
function getSplitLongitude(lonMin: number, lonMax: number) {
  const span = lonMax - lonMin;
  if (span < 359) return null;
  if (lonMin >= 0 && lonMax > 180) return 180;
  if (lonMin < 0 && lonMax <= 180) return 0;
  return lonMin + span / 2;
}
function wrapLongitudeNear(lon: number, ref: number) {
  let w = lon;
  while (w - ref <= -180) w += 360;
  while (w - ref > 180) w -= 360;
  return w;
}
function getWrappedBoundsVariants(bounds: any, refLon: number) {
  const mid = (bounds.lonMin + bounds.lonMax) / 2;
  const wrappedMid = wrapLongitudeNear(mid, refLon);
  const offset = wrappedMid - mid;
  return [offset - 360, offset, offset + 360].map((off) => ({
    lonMin: bounds.lonMin + off,
    lonMax: bounds.lonMax + off,
    latMin: bounds.latMin,
    latMax: bounds.latMax,
  }));
}
function buildInlineMetadataFromZarrV2(consolidated: any) {
  const inline: any = {};
  for (const [key, val] of Object.entries(consolidated ?? {})) {
    if (!key.includes("/")) continue;
    const [name, metaFile] = key.split("/");
    if (!name || !metaFile) continue;
    if (!inline[name]) inline[name] = {};
    const metadataValue = (val ?? {}) as any;
    if (metaFile === ".zarray") {
      inline[name] = {
        ...inline[name],
        ...(metadataValue && typeof metadataValue === "object"
          ? metadataValue
          : {}),
        node_type: "array",
        dimension_names:
          metadataValue?._ARRAY_DIMENSIONS ?? inline[name].dimension_names,
      };
    }
    if (metaFile === ".zattrs") {
      inline[name] = {
        ...inline[name],
        attributes: metadataValue,
        dimension_names:
          metadataValue?._ARRAY_DIMENSIONS ?? inline[name].dimension_names,
      };
    }
  }
  return inline;
}
function buildZarrUrl(datasetName: string, baseUrl?: string) {
  const DEFAULT_BASE = "https://s3.ap-southeast-2.wasabisys.com/spc-zarr-file/";
  const configured = (
    baseUrl ||
    process.env.NEXT_PUBLIC_ZARR_BASE_URL ||
    DEFAULT_BASE
  ).trim();

  const normalizedDataset =
    datasetName.replace(/^\/+/, "").replace(/\/+$/, "") + "/";

  const joinPath = (basePath: string) => {
    const baseNormalized = basePath.replace(/\/+$/, "") + "/";
    return `${baseNormalized}${normalizedDataset}`;
  };

  // Support local/public datasets served by Next.js under the current origin.
  // `new URL(relative, base)` requires an absolute base; so for relative bases
  // (like "/"), we join paths directly.
  if (configured.startsWith("/")) {
    const relative = joinPath(configured);
    if (typeof window !== "undefined" && window.location?.origin) {
      return new URL(relative, window.location.origin).toString();
    }
    return relative;
  }

  // If it's not an absolute URL (no scheme), treat it as site-root relative.
  // Examples: "zarr/", "./zarr/".
  const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(configured);
  if (!hasScheme && !configured.startsWith("//")) {
    const withoutDot = configured.replace(/^\.\/?/, "");
    const relative = joinPath(`/${withoutDot}`);
    if (typeof window !== "undefined" && window.location?.origin) {
      return new URL(relative, window.location.origin).toString();
    }
    return relative;
  }

  // Absolute (or protocol-relative) base URL.
  const absoluteBase = configured.startsWith("//")
    ? typeof window !== "undefined"
      ? `${window.location.protocol}${configured}`
      : `https:${configured}`
    : configured;

  return new URL(normalizedDataset, absoluteBase).toString();
}
async function openDatasetStore(datasetName: string, baseUrl?: string) {
  const store = new FetchStore(buildZarrUrl(datasetName, baseUrl));
  return { store, sourceLabel: "Zarr store" };
}
async function fetchRootMetadata(store: any) {
  const tried: string[] = [];

  const tryGet = async (key: string) => {
    tried.push(key);
    try {
      return await store.get(key);
    } catch {
      return null;
    }
  };

  // FetchStore (from @zarrita/storage) expects absolute paths (leading '/').
  // If we pass a relative key like "zarr.json" or ".zmetadata", the internal
  // resolver slices off the first character and we end up requesting
  // "arr.json" or "zmetadata".
  const zarrV3 = await tryGet("/zarr.json");
  if (zarrV3) {
    const meta = JSON.parse(new TextDecoder().decode(zarrV3));
    return {
      rootAttributes: meta?.attributes ?? {},
      inlineMetadata: meta?.consolidated_metadata?.metadata ?? {},
    };
  }

  const zarrV2 = (await tryGet("/.zmetadata")) ?? (await tryGet("/zmetadata"));
  if (zarrV2) {
    const meta = JSON.parse(new TextDecoder().decode(zarrV2));
    const consolidated = meta?.metadata ?? {};
    return {
      rootAttributes: consolidated[".zattrs"] ?? {},
      inlineMetadata: buildInlineMetadataFromZarrV2(consolidated),
    };
  }

  throw new Error(`Unable to read Zarr metadata. Tried: ${tried.join(", ")}`);
}
function nearestIndex(values: number[], target: number) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < values.length; i++) {
    const dist = Math.abs(values[i] - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}
function formatIsoDate(d: Date | null) {
  if (!d || isNaN(d.getTime())) return null;
  return d.toISOString().replace(".000Z", "Z");
}
/** Parse a CF/ISO timestamp as UTC when it carries no timezone. */
function parseUtc(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let s = value.trim().replace(" ", "T");
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += "Z";
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
const CF_UNIT_MS: Record<string, number> = {
  second: 1e3,
  seconds: 1e3,
  minute: 6e4,
  minutes: 6e4,
  hour: 3.6e6,
  hours: 3.6e6,
  day: 8.64e7,
  days: 8.64e7,
};
/**
 * ISO timestamps for each step of the time axis. Regular monthly or daily axes
 * are inferred from time_coverage_start/end, which avoids one request per time
 * chunk; otherwise the CF-encoded time coordinate is read and decoded.
 */
async function loadTimeValues(
  group: any,
  timeDim: string | null,
  timeCount: number,
  inlineMetadata: any,
  timeStart: Date | null,
  timeEnd: Date | null,
): Promise<string[]> {
  if (!timeDim || timeCount < 1) return [];

  if (timeStart && timeEnd) {
    const months =
      (timeEnd.getUTCFullYear() - timeStart.getUTCFullYear()) * 12 +
      (timeEnd.getUTCMonth() - timeStart.getUTCMonth()) +
      1;
    if (
      months === timeCount &&
      timeStart.getUTCDate() === timeEnd.getUTCDate()
    ) {
      return Array.from({ length: timeCount }, (_, i) =>
        formatIsoDate(
          new Date(
            Date.UTC(
              timeStart.getUTCFullYear(),
              timeStart.getUTCMonth() + i,
              timeStart.getUTCDate(),
            ),
          ),
        )!,
      );
    }
    const days =
      Math.round((timeEnd.getTime() - timeStart.getTime()) / 8.64e7) + 1;
    if (days === timeCount) {
      return Array.from({ length: timeCount }, (_, i) =>
        formatIsoDate(new Date(timeStart.getTime() + i * 8.64e7))!,
      );
    }
  }

  const units = String(inlineMetadata?.[timeDim]?.attributes?.units ?? "");
  const match = units.match(/^\s*(\w+)\s+since\s+(.+)$/i);
  const unitMs = match ? CF_UNIT_MS[match[1].toLowerCase()] : undefined;
  const origin = match ? parseUtc(match[2]) : null;
  if (!unitMs || !origin) return [];

  const timeArr = await openZarrita(group.resolve(timeDim), { kind: "array" });
  const raw = await zarritaGet(timeArr);
  return Array.from(raw.data as ArrayLike<number>, (v) =>
    formatIsoDate(new Date(origin.getTime() + Number(v) * unitMs))!,
  );
}
function buildTimeLabel(dataset: any, idx: number) {
  if (!dataset?.hasTime)
    return (
      dataset?.timeCoverageStartLabel ??
      dataset?.fallbackTimeLabel ??
      "Single time slice"
    );
  if (dataset.timeLabels?.[idx]) return dataset.timeLabels[idx];
  if (dataset.timeCount > 1 && dataset.timeStart && dataset.timeEnd) {
    const ratio = idx / Math.max(1, dataset.timeCount - 1);
    const ts =
      dataset.timeStart.getTime() +
      ratio * (dataset.timeEnd.getTime() - dataset.timeStart.getTime());
    const label = formatIsoDate(new Date(ts));
    if (label) return label;
  }
  return `Timestep ${idx + 1}`;
}

/** How many slices to cache and prefetch, from one slice's decoded size. */
function sliceBudgets(
  variable: any,
  dimNames: string[],
  timeDim: string | null,
) {
  const elementBytes = DTYPE_BYTES[String(variable.dtype)] ?? 8;
  const sliceBytes =
    elementBytes *
    dimNames.reduce(
      (n: number, dim: string, i: number) =>
        dim === timeDim ? n : n * Number(variable.shape?.[i] ?? 1),
      1,
    );
  return {
    maxCachedSlices: Math.max(
      2,
      Math.min(MAX_CACHED_SLICES, Math.floor(CACHE_BUDGET_BYTES / sliceBytes)),
    ),
    prefetchAhead: Math.max(
      1,
      Math.min(PREFETCH_AHEAD, Math.floor(PREFETCH_BUDGET_BYTES / sliceBytes)),
    ),
  };
}

/**
 * Mask of the region where min <= v <= max: 2 on its boundary (in range with
 * an out-of-range 4-neighbour; NaN neighbours such as land don't count, so
 * coastlines aren't outlined), 1 elsewhere inside, 0 outside, NaN for no data.
 * The edge is the higher value so dilated sampling keeps the outline.
 */
function zoneEdges(
  values: Float32Array,
  width: number,
  height: number,
  zone: { min: number; max: number },
) {
  const inside = (v: number) => v >= zone.min && v <= zone.max;
  const out = new Float32Array(values.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const v = values[i];
      if (!Number.isFinite(v)) {
        out[i] = NaN;
        continue;
      }
      if (!inside(v)) continue;
      out[i] = 1;
      const neighbours = [
        x > 0 ? values[i - 1] : NaN,
        x < width - 1 ? values[i + 1] : NaN,
        y > 0 ? values[i - width] : NaN,
        y < height - 1 ? values[i + width] : NaN,
      ];
      if (neighbours.some((n) => Number.isFinite(n) && !inside(n))) out[i] = 2;
    }
  }
  return out;
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
}

// ========== Shared deck.gl overlay ==========
// deck.gl supports a single interleaved MapboxOverlay per map, so every
// ZarrOverlay on a map contributes its layers to one shared overlay. Interleaved
// layers are drawn inside MapLibre's layer stack, which lets them sit below
// map layers such as reference overlays (via `beforeId`).
class DeckLayerHub {
  private overlay = new MapboxOverlay({ interleaved: true, layers: [] });
  private groups = new Map<string, { layers: any[]; order: number }>();
  refs = 0;

  constructor(private map: MaplibreMap) {
    map.addControl(this.overlay);
  }

  /**
   * Replace one owner's layers. Higher `order` draws on top; within the same
   * order, an owner that becomes visible again draws above the others.
   */
  set(owner: string, layers: any[], order = 0) {
    if (layers.length) {
      if (!this.groups.has(owner)) this.groups.set(owner, { layers, order });
      else this.groups.get(owner)!.layers = layers;
    } else {
      this.groups.delete(owner);
    }
    const sorted = [...this.groups.values()].sort((a, b) => a.order - b.order); // stable
    this.overlay.setProps({ layers: sorted.flatMap((g) => g.layers) });
  }

  destroy() {
    this.map.removeControl(this.overlay);
  }
}

const hubs = new WeakMap<MaplibreMap, DeckLayerHub>();

function acquireHub(map: MaplibreMap) {
  let hub = hubs.get(map);
  if (!hub) {
    hub = new DeckLayerHub(map);
    hubs.set(map, hub);
  }
  hub.refs++;
  return hub;
}

function releaseHub(map: MaplibreMap, owner: string) {
  const hub = hubs.get(map);
  if (!hub) return;
  hub.set(owner, []);
  if (--hub.refs <= 0) {
    hub.destroy();
    hubs.delete(map);
  }
}

// ========== Main ZarrOverlay class ==========
export interface ZarrLayerConfig {
  id: string;
  name: string;
  datasetName: string;
  zarrBaseUrl?: string;
  heightVariable: string;
  directionVariable?: string;
  colorRange?: { min: number; max: number };
  colormap?: string;
  showRaster?: boolean;
  showArrows?: boolean;
  /** Zoom to the data extent on first render (default true). */
  autoFit?: boolean;
  /** Draw below this MapLibre layer id (e.g. so reference overlays stay on top). */
  beforeId?: string;
  /**
   * Discrete colour bins with uneven edges (e.g. -200, -100, …, 100, 200):
   * colors[0] is below bounds[0], colors[i] is [bounds[i-1], bounds[i]), and
   * the last colour is at/above the last bound. Overrides colormap.
   */
  levels?: { bounds: number[]; colors: string[] };
  /** Map colours on a log10 scale between colorRange.min and max (both > 0). */
  logScale?: boolean;
  /**
   * Categorical data: colour for each integer value (index 0 = value 0).
   * Values outside the list, and null/"transparent" entries, are not drawn;
   * overrides colormap/colorRange.
   */
  categoryColors?: (string | null)[];
  /** Opacity of drawn pixels, 0–1 (default ≈0.82). */
  opacity?: number;
  /** Categorical only: widen features by this many grid cells (thin masks/lines). */
  dilate?: number;
  /** Stacking among Zarr layers: higher draws on top (default 0). */
  drawOrder?: number;
  /**
   * Outline the region where the variable is within [min, max] (e.g. a
   * species' temperature range). Pair with categoryColors: [null, colour].
   */
  zone?: {
    min: number;
    max: number;
    /** Dashed hatch filling the range (the edge stays a solid line). */
    hatch?: "diagonal" | "antidiagonal" | "horizontal" | "vertical";
  };
}

export class ZarrOverlay {
  private map: MaplibreMap;
  private hub: DeckLayerHub;
  private bitmapLayers: any[] = [];
  private directionLayers: any[] = [];
  private config: ZarrLayerConfig;
  private dataset: any = null;
  private canvasRefs: Record<string, HTMLCanvasElement> = {};
  private didAutoFitToData = false;
  private renderRequestId = 0;
  private renderTimeout: ReturnType<typeof setTimeout> | null = null;
  private renderInFlight = false;
  private renderQueued = false;
  private loadingDelayTimeout: ReturnType<typeof setTimeout> | null = null;
  private loadingVisible = false;
  // LRU cache of fetched slices keyed by "time:depth" (Map keeps insertion order).
  private sliceCache = new Map<
    string,
    Promise<{ result: any; dirResult: any | null }>
  >();
  // Alternates between two canvases so each frame hands deck.gl a different
  // image object (it only re-uploads the texture when the reference changes).
  private frameParity = 0;
  private cachedStats: { min: number; max: number; units: string } | null =
    null;
  private timeIndex = 0;
  private depthIndex = 0;
  private playInterval: ReturnType<typeof setInterval> | null = null;
  private mounted = true;
  private visible = true;

  private readonly handleMapViewChange = () => {
    if (!this.mounted) {
      return;
    }

    if (this.renderTimeout) {
      clearTimeout(this.renderTimeout);
    }

    this.renderTimeout = setTimeout(() => {
      this.renderTimeout = null;
      this.requestRender();
    }, 120);
  };

  private setLoadingVisible(nextVisible: boolean) {
    if (this.loadingVisible === nextVisible) {
      return;
    }

    this.loadingVisible = nextVisible;
    this.onLoadingChange?.(nextVisible);
  }

  private requestRender() {
    if (!this.mounted || !this.visible) {
      return;
    }

    if (this.renderInFlight) {
      this.renderQueued = true;
      return;
    }

    void this.render();
  }

  // UI callbacks
  public onTimeChange?: (label: string, idx: number, max: number) => void;
  public onStatsChange?: (min: number, max: number, units: string) => void;
  public onLoadingChange?: (loading: boolean) => void;
  public onErrorChange?: (error: string | null) => void;
  // Fires after the dataset loads with the depth levels (empty when the dataset
  // has no vertical dimension), so the UI can show/hide a depth slider.
  public onDepthChange?: (levels: number[], idx: number, units: string) => void;
  // Fires after the dataset loads with an ISO timestamp for each time step.
  public onTimesLoaded?: (times: string[]) => void;

  constructor(
    map: MaplibreMap,
    config: ZarrLayerConfig,
    options: { visible?: boolean } = {},
  ) {
    this.map = map;
    this.config = config;
    this.didAutoFitToData = config.autoFit === false;
    this.visible = options.visible ?? true;

    this.hub = acquireHub(map);

    // Match the sample behavior: re-render on view changes (debounced).
    this.map.on("zoomend", this.handleMapViewChange);
    this.map.on("moveend", this.handleMapViewChange);
    this.map.on("resize", this.handleMapViewChange);

    this.initialize();
  }

  private async initialize() {
    try {
      this.onLoadingChange?.(true);
      await this.ensureDatasetLoaded();
      this.requestRender();
    } catch (err) {
      this.onErrorChange?.(err instanceof Error ? err.message : String(err));
    } finally {
      this.onLoadingChange?.(false);
    }
  }

  private ensureCanvas(
    key: string,
    width: number,
    height: number,
  ): HTMLCanvasElement {
    if (!this.canvasRefs[key]) {
      const canvas = document.createElement("canvas");
      canvas.style.position = "fixed";
      canvas.style.top = "-10000px";
      canvas.style.left = "-10000px";
      canvas.style.pointerEvents = "none";
      canvas.setAttribute("aria-hidden", "true");
      this.canvasRefs[key] = canvas;
    }
    const canvas = this.canvasRefs[key];
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return canvas;
  }

  // Direction arrows are listed after the bitmaps so they render above them.
  private updateBitmapLayers(layers: any[]) {
    this.bitmapLayers = layers;
    this.hub.set(
      this.config.id,
      [...this.bitmapLayers, ...this.directionLayers],
      this.config.drawOrder ?? 0,
    );
  }

  private updateDirectionLayers(layers: any[]) {
    this.directionLayers = layers;
    this.hub.set(
      this.config.id,
      [...this.bitmapLayers, ...this.directionLayers],
      this.config.drawOrder ?? 0,
    );
  }

  private createBitmapLayer(id: string, image: HTMLCanvasElement, bounds: any) {
    if (!isFiniteBounds(bounds) || !isNonDegenerateBounds(bounds)) {
      // Avoid feeding Deck.gl invalid bounds which can trigger
      // "Illegal attribute generated for positions".
      return null;
    }
    return new BitmapLayer({
      id,
      image,
      bounds: [
        bounds.lonMin,
        clampLatitudeToMercator(bounds.latMin),
        bounds.lonMax,
        clampLatitudeToMercator(bounds.latMax),
      ],
      opacity: 1,
      parameters: { depthTest: false } as any,
      textureParameters: BITMAP_TEXTURE_PARAMETERS,
      beforeId: this.config.beforeId,
    });
  }

  private createDirectionLayer(id: string, data: any[], zoom: number) {
    return new IconLayer({
      id,
      data,
      billboard: true,
      sizeUnits: "pixels",
      sizeMinPixels: 24, // Larger for better visibility
      sizeMaxPixels: 48, // Larger max
      getPosition: (item: any) => item.position,
      getIcon: () => ({
        url: DIRECTION_ARROW_ICON,
        width: 64,
        height: 64,
        anchorX: 32,
        anchorY: 32,
        mask: true,
      }),
      getSize: () => Math.max(24, Math.min(48, 14 + zoom * 2.2)), // Scales with zoom
      getAngle: (item: any) => item.angle,
      getColor: () => [0, 0, 0, 255],
      parameters: { depthTest: false } as any,
      beforeId: this.config.beforeId,
      alphaCutoff: 0.01,
      pickable: false,
      textureParameters: {
        minFilter: "linear",
        magFilter: "linear",
        mipmapFilter: "none",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      },
    });
  }

  private async ensureDatasetLoaded() {
    if (this.dataset) return this.dataset;

    const { store, sourceLabel } = await openDatasetStore(
      this.config.datasetName,
      this.config.zarrBaseUrl,
    );
    const { rootAttributes, inlineMetadata } = await fetchRootMetadata(store);
    const { latName, lonName } = discoverCoordinateNames(inlineMetadata);
    if (!latName || !lonName)
      throw new Error("Could not detect lat/lon coordinates.");

    const varMeta = inlineMetadata[this.config.heightVariable];
    const dirMeta = this.config.directionVariable
      ? inlineMetadata[this.config.directionVariable]
      : null;
    if (!varMeta)
      throw new Error(`Missing variable ${this.config.heightVariable}`);
    if (this.config.directionVariable && !dirMeta)
      throw new Error(`Missing variable ${this.config.directionVariable}`);

    const dimNames = getDimensionNames(varMeta, this.config.heightVariable);
    const dirDimNames = dirMeta
      ? getDimensionNames(dirMeta, this.config.directionVariable!)
      : [];
    const timeDim = inferTimeDimensionName(dimNames, inlineMetadata);
    const dirTimeDim = inferTimeDimensionName(dirDimNames, inlineMetadata);

    const spatialDims = dimNames.filter(
      (d: string) => d === latName || d === lonName,
    );
    const dirSpatialDims = dirDimNames.filter(
      (d: string) => d === latName || d === lonName,
    );
    const latAxis = spatialDims.indexOf(latName);
    const lonAxis = spatialDims.indexOf(lonName);
    const dirLatAxis = dirSpatialDims.indexOf(latName);
    const dirLonAxis = dirSpatialDims.indexOf(lonName);
    if (latAxis < 0 || lonAxis < 0 || spatialDims.length !== 2)
      throw new Error("Only rectilinear lat/lon rasters supported.");
    if (
      this.config.directionVariable &&
      (dirLatAxis < 0 || dirLonAxis < 0 || dirSpatialDims.length !== 2)
    )
      throw new Error("Direction variable must be rectilinear lat/lon.");

    const depthDim = inferDepthDimensionName(
      dimNames,
      latName,
      lonName,
      timeDim,
    );

    const group = await openZarrita(store, { kind: "group" });
    const [variable, directionVar, latArr, lonArr] = await Promise.all([
      openZarrita(group.resolve(this.config.heightVariable), { kind: "array" }),
      this.config.directionVariable
        ? openZarrita(group.resolve(this.config.directionVariable), {
            kind: "array",
          })
        : null,
      openZarrita(group.resolve(latName), { kind: "array" }),
      openZarrita(group.resolve(lonName), { kind: "array" }),
    ]);
    const [latRaw, lonRaw] = await Promise.all([
      zarritaGet(latArr),
      zarritaGet(lonArr),
    ]);

    // Depth axis: read the coordinate values (for slider labels) when present.
    const depthDimIndex = depthDim ? dimNames.indexOf(depthDim) : -1;
    const depthCount =
      depthDimIndex >= 0 ? Number(variable.shape?.[depthDimIndex] ?? 1) : 1;
    let depthValues: number[] = [];
    let depthUnits = "";
    if (depthDim && depthCount > 1) {
      try {
        const depthArr = await openZarrita(group.resolve(depthDim), {
          kind: "array",
        });
        const depthRaw = await zarritaGet(depthArr);
        depthValues = Array.from(depthRaw.data as ArrayLike<number>, Number);
        depthUnits = normalizeText(inlineMetadata[depthDim]?.attributes?.units);
      } catch {
        depthValues = Array.from({ length: depthCount }, (_, i) => i);
      }
    }
    const latValues = Array.from(latRaw.data as ArrayLike<number>, Number);
    const lonValues = Array.from(lonRaw.data as ArrayLike<number>, Number);

    // Deck.gl BitmapLayer bounds must be finite; validate coordinate vectors early.
    assertFiniteNumberArray(`coordinate ${latName}`, latValues);
    assertFiniteNumberArray(`coordinate ${lonName}`, lonValues);
    if (latValues.length < 2 || lonValues.length < 2) {
      throw new Error(
        `Coordinate arrays must have length >= 2 (lat=${latValues.length}, lon=${lonValues.length}).`,
      );
    }

    const latStep = computeRepresentativeStep(latValues, latName);
    const lonStep = computeRepresentativeStep(lonValues, lonName);
    assertFiniteNumber("latitude step", latStep);
    assertFiniteNumber("longitude step", lonStep);
    if (latStep === 0 || lonStep === 0) {
      throw new Error(
        `Invalid coordinate step (latStep=${latStep}, lonStep=${lonStep}).`,
      );
    }
    const latEdges = computeEdges(latValues);
    const lonEdges = computeEdges(lonValues);
    const lonMin = lonEdges
      ? Math.min(lonEdges[0], lonEdges[lonEdges.length - 1])
      : Math.min(lonValues[0], lonValues[lonValues.length - 1]);
    const lonMax = lonEdges
      ? Math.max(lonEdges[0], lonEdges[lonEdges.length - 1])
      : Math.max(lonValues[0], lonValues[lonValues.length - 1]);
    const splitLon = getSplitLongitude(lonMin, lonMax);
    const splitIdx =
      splitLon === null
        ? -1
        : lonValues.findIndex((v: number) => v >= splitLon);
    const firstVisible = latValues.findIndex(
      (v: number) => v >= -MAX_MERCATOR_LAT,
    );
    const lastVisibleFromEnd = [...latValues]
      .reverse()
      .findIndex((v: number) => v <= MAX_MERCATOR_LAT);
    const visibleRowStart = firstVisible === -1 ? 0 : firstVisible;
    const visibleRowEnd =
      lastVisibleFromEnd === -1
        ? latValues.length - 1
        : latValues.length - 1 - lastVisibleFromEnd;

    const safeStart = Math.max(
      0,
      Math.min(latValues.length - 1, visibleRowStart),
    );
    const safeEnd = Math.max(
      safeStart,
      Math.min(latValues.length - 1, visibleRowEnd),
    );
    const latMin = latEdges
      ? Math.min(latEdges[safeStart], latEdges[safeEnd + 1])
      : Math.min(latValues[0], latValues[latValues.length - 1]);
    const latMax = latEdges
      ? Math.max(latEdges[safeStart], latEdges[safeEnd + 1])
      : Math.max(latValues[0], latValues[latValues.length - 1]);

    assertFiniteNumber("latMin", latMin);
    assertFiniteNumber("latMax", latMax);
    assertFiniteNumber("lonMin", lonMin);
    assertFiniteNumber("lonMax", lonMax);
    const safeSplit =
      splitIdx > 0 && splitIdx < lonValues.length ? splitIdx : null;
    const timeDimIndex = timeDim ? dimNames.indexOf(timeDim) : -1;
    const timeCount =
      timeDimIndex >= 0 ? Number(variable.shape?.[timeDimIndex] ?? 1) : 1;
    const timeStartRaw =
      rootAttributes?.time_coverage_start ?? group.attrs?.time_coverage_start;
    const timeEndRaw =
      rootAttributes?.time_coverage_end ?? group.attrs?.time_coverage_end;
    const timeStart = parseUtc(timeStartRaw);
    const timeEnd = parseUtc(timeEndRaw);
    const timeLabels = await loadTimeValues(
      group,
      timeDim,
      timeCount,
      inlineMetadata,
      timeStart,
      timeEnd,
    );

    this.dataset = {
      variableName: this.config.heightVariable,
      directionVariableName: this.config.directionVariable,
      variableLongName:
        varMeta?.attributes?.long_name ?? this.config.heightVariable,
      directionLongName:
        dirMeta?.attributes?.long_name ?? this.config.directionVariable,
      directionMetadata: buildDirectionMetadata(dirMeta?.attributes),
      variableUnits: varMeta?.attributes?.units ?? "",
      datasetTitle: rootAttributes?.title ?? this.config.datasetName,
      sourceLabel,
      latName,
      lonName,
      dimensionNames: dimNames,
      directionDimensionNames: dirDimNames,
      timeDimensionName: timeDim,
      directionTimeDimensionName: dirTimeDim,
      depthDimensionName: depthDim,
      depthCount,
      depthValues,
      depthUnits,
      hasDepth: Boolean(depthDim && depthCount > 1),
      timeCount,
      hasTime: Boolean(timeDim && timeCount > 1),
      timeStart,
      timeEnd,
      timeLabels,
      timeCoverageStartLabel: formatIsoDate(timeStart),
      fallbackTimeLabel:
        formatIsoDate(parseUtc(group.attrs?.time_coverage_start)) ??
        "Single time slice",
      latAxisInResult: latAxis,
      lonAxisInResult: lonAxis,
      variable,
      directionVariable: directionVar,
      directionLatAxisInResult: dirLatAxis,
      directionLonAxisInResult: dirLonAxis,
      latValues,
      lonValues,
      latEdges,
      lonEdges,
      latAscending: latValues[0] < latValues[latValues.length - 1],
      latStep,
      lonStep,
      splitIndex: safeSplit,
      splitLongitude: splitLon,
      visibleRowStart: safeStart,
      visibleRowEnd: safeEnd,
      scaleFactor: Number(variable.attrs?.scale_factor ?? 1),
      addOffset: Number(variable.attrs?.add_offset ?? 0),
      missingValue:
        variable.attrs?._FillValue !== undefined &&
        variable.attrs?._FillValue !== null
          ? Number(variable.attrs._FillValue)
          : typeof (variable as any).fillValue === "number"
            ? (variable as any).fillValue
            : null,
      directionScaleFactor: directionVar
        ? Number(directionVar.attrs?.scale_factor ?? 1)
        : 1,
      directionAddOffset: directionVar
        ? Number(directionVar.attrs?.add_offset ?? 0)
        : 0,
      directionMissingValue:
        directionVar &&
        directionVar.attrs?._FillValue !== undefined &&
        directionVar.attrs?._FillValue !== null
          ? Number(directionVar.attrs._FillValue)
          : null,
      ...sliceBudgets(variable, dimNames, timeDim),
      bounds: { latMin, latMax, lonMin, lonMax },
      lowerBounds:
        safeSplit !== null
          ? {
              lonMin: lonEdges ? lonEdges[0] : lonMin,
              lonMax: lonEdges ? lonEdges[safeSplit] : splitLon,
              latMin,
              latMax,
            }
          : null,
      upperBounds:
        safeSplit !== null
          ? {
              lonMin: lonEdges ? lonEdges[safeSplit] : splitLon,
              lonMax: lonEdges ? lonEdges[lonEdges.length - 1] : lonMax,
              latMin,
              latMax,
            }
          : null,
    };

    this.onTimesLoaded?.(
      timeLabels.length === timeCount
        ? timeLabels
        : Array.from({ length: timeCount }, (_, i) =>
            buildTimeLabel(this.dataset, i),
          ),
    );
    this.onTimeChange?.(
      buildTimeLabel(this.dataset, 0),
      0,
      this.dataset.timeCount - 1,
    );
    if (this.dataset.hasDepth) {
      this.depthIndex = Math.min(this.depthIndex, this.dataset.depthCount - 1);
      this.onDepthChange?.(
        this.dataset.depthValues,
        this.depthIndex,
        this.dataset.depthUnits,
      );
    } else {
      this.onDepthChange?.([], 0, "");
    }
    return this.dataset;
  }

  /** Fetch one time/depth slice (and its direction slice), memoised in an LRU cache. */
  private getSlice(dataset: any, timeIndex: number, depthIndex: number) {
    const key = `${timeIndex}:${depthIndex}`;
    const cached = this.sliceCache.get(key);
    if (cached) {
      // Refresh recency.
      this.sliceCache.delete(key);
      this.sliceCache.set(key, cached);
      return cached;
    }

    const selection = buildSliceSelection(
      dataset.dimensionNames,
      dataset.latName,
      dataset.lonName,
      dataset.timeDimensionName,
      timeIndex,
      dataset.depthDimensionName,
      depthIndex,
    );
    const dirSelection = dataset.directionVariable
      ? buildSliceSelection(
          dataset.directionDimensionNames,
          dataset.latName,
          dataset.lonName,
          dataset.directionTimeDimensionName,
          timeIndex,
          dataset.depthDimensionName,
          depthIndex,
        )
      : null;
    const promise = Promise.all([
      zarritaGet(dataset.variable, selection),
      dirSelection
        ? zarritaGet(dataset.directionVariable, dirSelection)
        : Promise.resolve(null),
    ]).then(([result, dirResult]) => ({ result, dirResult }));

    // Don't cache failures; a later render can retry.
    promise.catch(() => this.sliceCache.delete(key));
    this.sliceCache.set(key, promise);
    while (this.sliceCache.size > dataset.maxCachedSlices) {
      this.sliceCache.delete(this.sliceCache.keys().next().value!);
    }
    return promise;
  }

  private async render() {
    if (!this.mounted) return;

    this.renderInFlight = true;
    const requestId = ++this.renderRequestId;

    if (this.loadingDelayTimeout) {
      clearTimeout(this.loadingDelayTimeout);
      this.loadingDelayTimeout = null;
    }

    // Avoid flicker during fast frames: only show loading if a frame is slow.
    this.loadingDelayTimeout = setTimeout(() => {
      this.loadingDelayTimeout = null;
      if (this.mounted && requestId === this.renderRequestId) {
        this.setLoadingVisible(true);
      }
    }, 140);

    this.onErrorChange?.(null);

    try {
      const dataset = await this.ensureDatasetLoaded();
      const activeTime = dataset.hasTime
        ? Math.min(this.timeIndex, dataset.timeCount - 1)
        : 0;
      const activeDepth = dataset.hasDepth
        ? Math.min(this.depthIndex, dataset.depthCount - 1)
        : 0;
      const { result, dirResult } = await this.getSlice(
        dataset,
        activeTime,
        activeDepth,
      );

      // Fetch the next few timesteps in the background so playback is smooth.
      if (dataset.hasTime && dataset.timeCount > 1) {
        for (let k = 1; k <= dataset.prefetchAhead; k++) {
          void this.getSlice(
            dataset,
            (activeTime + k) % dataset.timeCount,
            activeDepth,
          ).catch(() => {});
        }
      }
      const parity = (this.frameParity = 1 - this.frameParity);
      const accessor = buildSpatialAccessor(
        result.data,
        result.shape,
        dataset.latAxisInResult,
        dataset.lonAxisInResult,
      );
      let dirAccessor = null;
      if (dirResult && dataset.directionVariable) {
        try {
          dirAccessor = buildSpatialAccessor(
            dirResult.data,
            dirResult.shape,
            dataset.directionLatAxisInResult,
            dataset.directionLonAxisInResult,
          );
        } catch {
          console.warn(
            "Could not build direction accessor with detected axes, trying swapped axes",
          );
          const swappedLatAxis = dataset.directionLonAxisInResult;
          const swappedLonAxis = dataset.directionLatAxisInResult;
          dirAccessor = buildSpatialAccessor(
            dirResult.data,
            dirResult.shape,
            swappedLatAxis,
            swappedLonAxis,
          );
        }
      }
      const { width, height, getValue } = accessor;
      let decoded = new Float32Array(width * height);
      const shouldComputeStats = !this.config.colorRange && !this.cachedStats;
      let minVal = Infinity,
        maxVal = -Infinity;

      // Track the bounding box of finite pixels so we can auto-zoom sparse datasets
      // (many chunks may be missing because they were never written when all-fill).
      let dataMinX = Infinity;
      let dataMaxX = -Infinity;
      let dataMinY = Infinity;
      let dataMaxY = -Infinity;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const raw = getValue(x, y);
          const idx = y * width + x;
          if (
            !Number.isFinite(raw) ||
            (dataset.missingValue !== null && raw === dataset.missingValue)
          ) {
            decoded[idx] = NaN;
            continue;
          }
          const val = raw * dataset.scaleFactor + dataset.addOffset;
          decoded[idx] = val;

          if (!this.didAutoFitToData) {
            if (x < dataMinX) dataMinX = x;
            if (x > dataMaxX) dataMaxX = x;
            if (y < dataMinY) dataMinY = y;
            if (y > dataMaxY) dataMaxY = y;
          }

          if (shouldComputeStats) {
            if (val < minVal) minVal = val;
            if (val > maxVal) maxVal = val;
          }
        }
      }

      // Zone outline: replace the values with a 0/1 mask of the cells on the
      // edge of [zone.min, zone.max] (drawn via categoryColors [null, colour]).
      if (this.config.zone) {
        decoded = zoneEdges(decoded, width, height, this.config.zone);
      }

      // Auto-fit map once per layer so sparse local datasets become visible.
      if (
        !this.didAutoFitToData &&
        Number.isFinite(dataMinX) &&
        dataMaxX >= dataMinX &&
        dataMaxY >= dataMinY
      ) {
        try {
          const x0 = Math.max(0, Math.min(width - 1, Math.floor(dataMinX)));
          const x1 = Math.max(0, Math.min(width - 1, Math.ceil(dataMaxX)));
          const y0 = Math.max(0, Math.min(height - 1, Math.floor(dataMinY)));
          const y1 = Math.max(0, Math.min(height - 1, Math.ceil(dataMaxY)));

          const lon0 = dataset.lonEdges
            ? dataset.lonEdges[x0]
            : dataset.lonValues[x0];
          const lon1 = dataset.lonEdges
            ? dataset.lonEdges[x1 + 1]
            : dataset.lonValues[x1];
          const lat0 = dataset.latEdges
            ? dataset.latEdges[y0]
            : dataset.latValues[y0];
          const lat1 = dataset.latEdges
            ? dataset.latEdges[y1 + 1]
            : dataset.latValues[y1];

          const lonMin = Math.min(lon0, lon1);
          const lonMax = Math.max(lon0, lon1);
          const latMin = Math.min(lat0, lat1);
          const latMax = Math.max(lat0, lat1);

          if (
            Number.isFinite(lonMin) &&
            Number.isFinite(lonMax) &&
            Number.isFinite(latMin) &&
            Number.isFinite(latMax) &&
            lonMin !== lonMax &&
            latMin !== latMax
          ) {
            this.didAutoFitToData = true;
            this.map.fitBounds(
              [
                [lonMin, clampLatitudeToMercator(latMin)],
                [lonMax, clampLatitudeToMercator(latMax)],
              ] as any,
              { padding: 40, animate: true, maxZoom: 12 },
            );
          }
        } catch {
          // Ignore auto-fit failures; rendering can still proceed.
        }
      }

      if (
        shouldComputeStats &&
        Number.isFinite(minVal) &&
        Number.isFinite(maxVal)
      ) {
        this.cachedStats = {
          min: minVal,
          max: maxVal,
          units: dataset.variableUnits,
        };
        // Only report stats once to avoid per-timestep UI churn.
        this.onStatsChange?.(minVal, maxVal, dataset.variableUnits);
      }

      const range =
        this.config.colorRange ??
        (this.cachedStats
          ? { min: this.cachedStats.min, max: this.cachedStats.max }
          : { min: 0, max: 1 });
      const rangeSpan = range.max - range.min || 1;
      const colormap = getColormap(this.config.colormap);
      // null / "transparent" entries leave that value undrawn (e.g. 0 in a mask).
      const categoryColors =
        this.config.categoryColors?.map((c) =>
          !c || c === "transparent" ? null : hexToRgb(c),
        ) ?? null;
      const alpha = Math.round(
        Math.min(1, Math.max(0, this.config.opacity ?? 210 / 255)) * 255,
      );
      // Log scale: position by log10 between the (positive) range ends.
      const logMin = Math.log10(Math.max(range.min, 1e-12));
      const logSpan = Math.log10(Math.max(range.max, 1e-12)) - logMin || 1;
      // Zone fill: dashed hatch lines in canvas pixels (spacing 7px, dashes
      // 6px on / 6px off); the edge (2) is solid. Colour = categoryColors[1].
      const zone = this.config.zone;
      const mod = (a: number, b: number) => ((a % b) + b) % b;
      const hatchOn = (col: number, row: number) => {
        switch (zone?.hatch) {
          case "diagonal":
            return (
              mod(col + row, 7) < 2 && mod(Math.floor((col - row) / 6), 2) === 0
            );
          case "antidiagonal":
            return (
              mod(col - row, 7) < 2 && mod(Math.floor((col + row) / 6), 2) === 0
            );
          case "horizontal":
            return mod(row, 7) < 2 && mod(Math.floor(col / 6), 2) === 0;
          case "vertical":
            return mod(col, 7) < 2 && mod(Math.floor(row / 6), 2) === 0;
          default:
            return false;
        }
      };
      const levelBounds = this.config.levels?.bounds ?? null;
      const levelColors = this.config.levels?.colors.map(hexToRgb) ?? null;
      const colorFor = (val: number, col = 0, row = 0): RGB | null => {
        if (!Number.isFinite(val)) return null;
        if (zone && categoryColors) {
          if (val >= 2) return categoryColors[1] ?? null;
          if (val >= 1 && hatchOn(col, row)) return categoryColors[1] ?? null;
          return null;
        }
        if (categoryColors) return categoryColors[Math.round(val)] ?? null;
        if (levelColors && levelBounds) {
          let i = 0;
          while (i < levelBounds.length && val >= levelBounds[i]) i++;
          return levelColors[i] ?? null;
        }
        const t = this.config.logScale
          ? (Math.log10(Math.max(val, 1e-12)) - logMin) / logSpan
          : (val - range.min) / rangeSpan;
        return colormap(Math.min(1, Math.max(0, t)));
      };

      const zoom = this.map.getZoom();
      const splitIdx = dataset.splitIndex;
      const visibleHeight = dataset.visibleRowEnd - dataset.visibleRowStart + 1;
      const lowerWidth = splitIdx === null ? width : splitIdx;
      const upperWidth = splitIdx === null ? 0 : width - splitIdx;
      const fullWidth = width;
      const requestedScale = Math.min(
        8,
        Math.max(1, 2 ** Math.max(0, zoom - 1.5)),
      );
      const safeScale = Math.min(
        requestedScale,
        MAX_RENDER_DIMENSION / Math.max(1, fullWidth),
        MAX_RENDER_DIMENSION / Math.max(1, lowerWidth),
        MAX_RENDER_DIMENSION / Math.max(1, upperWidth || 1),
        MAX_RENDER_DIMENSION / Math.max(1, visibleHeight),
      );
      // Upsample small grids for smoother rasters; downsample grids wider than
      // MAX_RENDER_DIMENSION so very fine data (e.g. 0.05°) stays fast to draw.
      const renderScale = safeScale;
      const targetFullWidth = Math.max(1, Math.round(fullWidth * renderScale));
      const targetLowerWidth = Math.max(
        1,
        Math.round(lowerWidth * renderScale),
      );
      const targetUpperWidth = Math.max(
        1,
        Math.round(upperWidth * renderScale),
      );
      const targetHeight = Math.max(1, Math.round(visibleHeight * renderScale));
      const mercTop = latToMercatorY(dataset.bounds.latMax);
      const mercBottom = latToMercatorY(dataset.bounds.latMin);
      const latOrigin = dataset.latValues[0];
      const latStep = Number(
        dataset.latStep ?? dataset.latValues[1] - dataset.latValues[0],
      );
      if (!Number.isFinite(latStep) || latStep === 0) {
        throw new Error("Invalid latitude step for resampling.");
      }

      const getInterpolated = (x: number, y: number) => {
        const x0 = Math.floor(x),
          y0 = Math.floor(y),
          x1 = x0 + 1,
          y1 = y0 + 1;
        if (x0 < 0 || x1 >= width || y0 < 0 || y1 >= height) {
          const nx = Math.round(x),
            ny = Math.round(y);
          if (nx >= 0 && nx < width && ny >= 0 && ny < height)
            return decoded[ny * width + nx];
          return NaN;
        }
        const fx = x - x0,
          fy = y - y0;
        const v00 = decoded[y0 * width + x0],
          v10 = decoded[y0 * width + x1],
          v01 = decoded[y1 * width + x0],
          v11 = decoded[y1 * width + x1];
        if (
          !Number.isFinite(v00) ||
          !Number.isFinite(v10) ||
          !Number.isFinite(v01) ||
          !Number.isFinite(v11)
        ) {
          const nx = Math.round(x),
            ny = Math.round(y);
          if (nx >= 0 && nx < width && ny >= 0 && ny < height)
            return decoded[ny * width + nx];
          return NaN;
        }
        const top = interpolateFinite(v00, v10, fx);
        const bottom = interpolateFinite(v01, v11, fx);
        return interpolateFinite(top, bottom, fy);
      };

      const getNearest = (x: number, y: number) => {
        const nx = Math.round(x),
          ny = Math.round(y);
        return nx >= 0 && nx < width && ny >= 0 && ny < height
          ? decoded[ny * width + nx]
          : NaN;
      };
      // Dilated nearest: the largest value within `dilate` cells, so thin
      // features (e.g. 1-cell contour masks) stay visible when zoomed out.
      const dilate = Math.max(0, Math.round(this.config.dilate ?? 0));
      const getNearestDilated = (x: number, y: number) => {
        const nx = Math.round(x),
          ny = Math.round(y);
        let best = NaN;
        for (let dy = -dilate; dy <= dilate; dy++) {
          const yy = ny + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -dilate; dx <= dilate; dx++) {
            const xx = nx + dx;
            if (xx < 0 || xx >= width) continue;
            const v = decoded[yy * width + xx];
            if (Number.isFinite(v) && !(v <= best)) best = v;
          }
        }
        return best;
      };
      const sample = categoryColors
        ? dilate
          ? getNearestDilated
          : getNearest
        : getInterpolated;

      const centerLng = this.map.getCenter()?.lng ?? 0;
      const mapBounds = this.map.getBounds();
      const rawWest = mapBounds.getWest();
      const rawEast = mapBounds.getEast();
      const viewCoversWorld =
        rawEast - rawWest >= 359.5 ||
        (rawWest <= -179.999 && rawEast >= 179.999);
      const viewWest = viewCoversWorld
        ? -Infinity
        : wrapLongitudeNear(rawWest, centerLng);
      const viewEast = viewCoversWorld
        ? Infinity
        : wrapLongitudeNear(rawEast, centerLng);
      const viewSouth = Math.max(-MAX_MERCATOR_LAT, mapBounds.getSouth());
      const viewNorth = Math.min(MAX_MERCATOR_LAT, mapBounds.getNorth());

      const isLongitudeVisible = (shiftedLongitude: number) => {
        if (viewCoversWorld) {
          return true;
        }

        // When wrapping longitudes near the current center, it is possible for the
        // visible interval to cross the dateline in wrapped space (viewWest > viewEast).
        // In that case, the visible set is the union: [viewWest, +∞) ∪ (-∞, viewEast].
        if (viewWest <= viewEast) {
          return shiftedLongitude >= viewWest && shiftedLongitude <= viewEast;
        }

        return shiftedLongitude >= viewWest || shiftedLongitude <= viewEast;
      };

      // ========== ARROW GENERATION ==========
      const arrowPoints: any[] = [];
      if (dirAccessor && dataset.directionVariable) {
        const container = this.map.getContainer();
        const targetArrowColumns = Math.max(
          6,
          Math.round(container.clientWidth / 80),
        );
        const targetArrowRows = Math.max(
          4,
          Math.round(container.clientHeight / 80),
        );
        let visibleRowCount = 0;
        for (let r = dataset.visibleRowStart; r <= dataset.visibleRowEnd; r++) {
          const lat = dataset.latValues[r];
          if (lat >= viewSouth && lat <= viewNorth) visibleRowCount++;
        }
        let visibleColumnCount = 0;
        if (viewCoversWorld) {
          visibleColumnCount = width;
        } else {
          for (let c = 0; c < width; c++) {
            const shiftedLon = wrapLongitudeNear(
              dataset.lonValues[c],
              centerLng,
            );
            if (isLongitudeVisible(shiftedLon)) visibleColumnCount++;
          }
        }
        const rowStride = Math.max(
          1,
          Math.ceil(Math.max(1, visibleRowCount) / targetArrowRows),
        );
        const colStride = Math.max(
          1,
          Math.ceil(Math.max(1, visibleColumnCount) / targetArrowColumns),
        );
        for (
          let r = dataset.visibleRowStart;
          r <= dataset.visibleRowEnd;
          r += rowStride
        ) {
          const lat = dataset.latValues[r];
          if (lat < viewSouth || lat > viewNorth) continue;
          for (let c = 0; c < width; c += colStride) {
            const shiftedLon = wrapLongitudeNear(
              dataset.lonValues[c],
              centerLng,
            );
            if (!isLongitudeVisible(shiftedLon)) continue;
            const val = decoded[r * width + c];
            if (!Number.isFinite(val)) continue;
            let dirVal = dirAccessor.getValue(c, r);
            if (
              !Number.isFinite(dirVal) ||
              (dataset.directionMissingValue !== null &&
                dirVal === dataset.directionMissingValue)
            )
              continue;
            dirVal =
              dirVal * dataset.directionScaleFactor +
              dataset.directionAddOffset;
            arrowPoints.push({
              position: [shiftedLon, lat],
              angle: normalizeWaveDirectionForIcon(
                dirVal,
                dataset.directionMetadata,
              ),
            });
          }
        }
      }

      const showRaster = this.config.showRaster !== false;
      const showArrows =
        this.config.showArrows !== false &&
        Boolean(this.config.directionVariable);

      // Render bitmaps
      let bitmapLayers: any[] = [];
      if (
        showRaster &&
        splitIdx !== null &&
        dataset.lowerBounds &&
        dataset.upperBounds
      ) {
        const lowerCanvas = this.ensureCanvas(
          `lower-${parity}`,
          targetLowerWidth,
          targetHeight,
        );
        const upperCanvas = this.ensureCanvas(
          `upper-${parity}`,
          targetUpperWidth,
          targetHeight,
        );
        const lowerCtx = lowerCanvas.getContext("2d")!;
        const upperCtx = upperCanvas.getContext("2d")!;
        const lowerImg = lowerCtx.createImageData(
          targetLowerWidth,
          targetHeight,
        );
        const upperImg = upperCtx.createImageData(
          targetUpperWidth,
          targetHeight,
        );
        for (let row = 0; row < targetHeight; row++) {
          const t = (row + 0.5) / targetHeight;
          const mercY = mercTop + (mercBottom - mercTop) * t;
          const lat = mercatorYToLat(mercY);
          const srcY = dataset.latAscending
            ? (lat - latOrigin) / latStep
            : (latOrigin - lat) / -latStep;
          if (srcY < dataset.visibleRowStart || srcY > dataset.visibleRowEnd)
            continue;
          const lowerOff = row * targetLowerWidth * 4;
          const upperOff = row * targetUpperWidth * 4;
          for (let col = 0; col < targetLowerWidth; col++) {
            const srcX = ((col + 0.5) / targetLowerWidth) * lowerWidth - 0.5;
            const px = lowerOff + col * 4;
            const rgb = colorFor(sample(srcX, srcY), col, row);
            if (!rgb) {
              lowerImg.data[px + 3] = 0;
              continue;
            }
            lowerImg.data[px] = rgb[0];
            lowerImg.data[px + 1] = rgb[1];
            lowerImg.data[px + 2] = rgb[2];
            lowerImg.data[px + 3] = alpha;
          }
          for (let col = 0; col < targetUpperWidth; col++) {
            const srcX =
              splitIdx + ((col + 0.5) / targetUpperWidth) * upperWidth - 0.5;
            const px = upperOff + col * 4;
            const rgb = colorFor(sample(srcX, srcY), col, row);
            if (!rgb) {
              upperImg.data[px + 3] = 0;
              continue;
            }
            upperImg.data[px] = rgb[0];
            upperImg.data[px + 1] = rgb[1];
            upperImg.data[px + 2] = rgb[2];
            upperImg.data[px + 3] = alpha;
          }
        }
        lowerCtx.putImageData(lowerImg, 0, 0);
        upperCtx.putImageData(upperImg, 0, 0);
        if (!this.mounted || requestId !== this.renderRequestId) return;
        const lowerBoundsVar = getWrappedBoundsVariants(
          dataset.lowerBounds,
          centerLng,
        );
        const upperBoundsVar = getWrappedBoundsVariants(
          dataset.upperBounds,
          centerLng,
        );
        bitmapLayers = lowerBoundsVar
          .flatMap((b, i) => [
            this.createBitmapLayer(
              `${this.config.id}-lower-${i}`,
              lowerCanvas,
              b,
            ),
            this.createBitmapLayer(
              `${this.config.id}-upper-${i}`,
              upperCanvas,
              upperBoundsVar[i],
            ),
          ])
          .filter(Boolean);
      } else if (showRaster) {
        const fullCanvas = this.ensureCanvas(
          `full-${parity}`,
          targetFullWidth,
          targetHeight,
        );
        const fullCtx = fullCanvas.getContext("2d")!;
        const fullImg = fullCtx.createImageData(targetFullWidth, targetHeight);
        for (let row = 0; row < targetHeight; row++) {
          const t = (row + 0.5) / targetHeight;
          const mercY = mercTop + (mercBottom - mercTop) * t;
          const lat = mercatorYToLat(mercY);
          const srcY = dataset.latAscending
            ? (lat - latOrigin) / latStep
            : (latOrigin - lat) / -latStep;
          if (srcY < dataset.visibleRowStart || srcY > dataset.visibleRowEnd)
            continue;
          const rowOff = row * targetFullWidth * 4;
          for (let col = 0; col < targetFullWidth; col++) {
            const srcX = ((col + 0.5) / targetFullWidth) * fullWidth - 0.5;
            const px = rowOff + col * 4;
            const rgb = colorFor(sample(srcX, srcY), col, row);
            if (!rgb) {
              fullImg.data[px + 3] = 0;
              continue;
            }
            fullImg.data[px] = rgb[0];
            fullImg.data[px + 1] = rgb[1];
            fullImg.data[px + 2] = rgb[2];
            fullImg.data[px + 3] = alpha;
          }
        }
        fullCtx.putImageData(fullImg, 0, 0);
        if (!this.mounted || requestId !== this.renderRequestId) return;
        const boundsVar = getWrappedBoundsVariants(dataset.bounds, centerLng);
        bitmapLayers = boundsVar
          .map((b, i) =>
            this.createBitmapLayer(
              `${this.config.id}-full-${i}`,
              fullCanvas,
              b,
            ),
          )
          .filter(Boolean);
      }

      if (
        !this.mounted ||
        requestId !== this.renderRequestId ||
        !this.visible
      ) {
        return;
      }

      this.updateBitmapLayers(bitmapLayers);
      this.updateDirectionLayers(
        showArrows && arrowPoints.length > 0
          ? [
              this.createDirectionLayer(
                `${this.config.id}-dir`,
                arrowPoints,
                zoom,
              ),
            ]
          : [],
      );

      this.onTimeChange?.(
        buildTimeLabel(dataset, activeTime),
        activeTime,
        dataset.timeCount - 1,
      );
    } catch (err) {
      this.onErrorChange?.(err instanceof Error ? err.message : String(err));
    } finally {
      if (this.loadingDelayTimeout) {
        clearTimeout(this.loadingDelayTimeout);
        this.loadingDelayTimeout = null;
      }

      // Only clear loading for the latest request.
      if (requestId === this.renderRequestId) {
        this.setLoadingVisible(false);
      }

      this.renderInFlight = false;
      if (this.renderQueued) {
        this.renderQueued = false;
        this.requestRender();
      }
    }
  }

  // Reads the full time series of the layer's variable(s) at a clicked point.
  // Returns null when the point falls outside the dataset's spatial coverage.
  public async getTimeseriesAtPoint(
    lng: number,
    lat: number,
  ): Promise<PointTimeseries | null> {
    const dataset = await this.ensureDatasetLoaded();

    const latValues: number[] = dataset.latValues;
    const lonValues: number[] = dataset.lonValues;

    // Reject clicks clearly outside the latitude band.
    const latStep = Math.abs(dataset.latStep);
    const latLo =
      Math.min(latValues[0], latValues[latValues.length - 1]) - latStep;
    const latHi =
      Math.max(latValues[0], latValues[latValues.length - 1]) + latStep;
    if (lat < latLo || lat > latHi) return null;

    // Longitude may be stored as 0..360 or -180..180; pick the wrapped variant
    // that lands inside the dataset's longitude span.
    const lonStep = Math.abs(dataset.lonStep);
    const lonLo =
      Math.min(lonValues[0], lonValues[lonValues.length - 1]) - lonStep;
    const lonHi =
      Math.max(lonValues[0], lonValues[lonValues.length - 1]) + lonStep;
    const lonCandidate = [lng, lng + 360, lng - 360].find(
      (v) => v >= lonLo && v <= lonHi,
    );
    if (lonCandidate === undefined) return null;

    const latIdx = nearestIndex(latValues, lat);
    const lonIdx = nearestIndex(lonValues, lonCandidate);

    const buildPointSelection = (
      dimNames: string[],
      timeDimName: string | null,
    ) =>
      dimNames.map((dim) => {
        if (dim === timeDimName) return null; // full time axis
        if (dim === dataset.latName) return latIdx;
        if (dim === dataset.lonName) return lonIdx;
        if (dim === dataset.depthDimensionName) return this.depthIndex;
        return 0;
      });

    const heightSelection = buildPointSelection(
      dataset.dimensionNames,
      dataset.timeDimensionName,
    );
    const dirSelection = dataset.directionVariable
      ? buildPointSelection(
          dataset.directionDimensionNames,
          dataset.directionTimeDimensionName,
        )
      : null;

    const [heightResult, dirResult] = await Promise.all([
      zarritaGet(dataset.variable, heightSelection),
      dirSelection
        ? zarritaGet(dataset.directionVariable, dirSelection)
        : Promise.resolve(null),
    ]);

    const decode = (
      raw: number,
      scale: number,
      offset: number,
      missing: number | null,
    ) => {
      if (!Number.isFinite(raw) || (missing !== null && raw === missing))
        return NaN;
      return raw * scale + offset;
    };

    const heightValues = Array.from(
      heightResult.data as ArrayLike<number>,
      (raw) =>
        decode(
          Number(raw),
          dataset.scaleFactor,
          dataset.addOffset,
          dataset.missingValue,
        ),
    );

    const timeLabels = heightValues.map((_, i) => buildTimeLabel(dataset, i));

    const variables: PointTimeseries["variables"] = [
      {
        name: dataset.variableLongName || dataset.variableName,
        units: dataset.variableUnits || "",
        values: heightValues,
      },
    ];

    if (dirResult && dataset.directionVariable) {
      const dirValues = Array.from(
        (dirResult as any).data as ArrayLike<number>,
        (raw) =>
          decode(
            Number(raw),
            dataset.directionScaleFactor,
            dataset.directionAddOffset,
            dataset.directionMissingValue,
          ),
      );
      variables.push({
        name: dataset.directionLongName || dataset.directionVariableName,
        units: dataset.directionMetadata?.units || "degree",
        values: dirValues,
        isDirection: true,
      });
    }

    return {
      lon: lonValues[lonIdx],
      lat: latValues[latIdx],
      timeLabels,
      variables,
    };
  }

  // Public methods
  public setTimeIndex(index: number) {
    this.timeIndex = Math.max(
      0,
      Math.min(index, this.dataset?.timeCount - 1 || 0),
    );
    this.requestRender();
  }

  public getTimeCount() {
    return this.dataset?.timeCount ?? 1;
  }

  /** Show or hide the overlay without discarding the loaded dataset. */
  public setVisible(visible: boolean) {
    if (this.visible === visible) return;
    this.visible = visible;
    if (visible) {
      this.requestRender();
    } else {
      this.updateBitmapLayers([]);
      this.updateDirectionLayers([]);
    }
  }

  public setDepthIndex(index: number) {
    const maxDepth = (this.dataset?.depthCount ?? 1) - 1;
    const next = Math.max(0, Math.min(index, maxDepth < 0 ? 0 : maxDepth));
    if (next === this.depthIndex) return;
    this.depthIndex = next;
    // Slices are cached per depth; only the auto-computed colour range is stale.
    this.cachedStats = null;
    this.requestRender();
  }

  public startPlayback(intervalMs = 700) {
    if (this.playInterval) clearInterval(this.playInterval);
    this.playInterval = setInterval(() => {
      const max = this.getTimeCount() - 1;
      const next = this.timeIndex >= max ? 0 : this.timeIndex + 1;
      this.setTimeIndex(next);
    }, intervalMs);
  }

  public stopPlayback() {
    if (this.playInterval) {
      clearInterval(this.playInterval);
      this.playInterval = null;
    }
  }

  public destroy() {
    this.mounted = false;
    this.stopPlayback();
    if (this.renderTimeout) clearTimeout(this.renderTimeout);

    if (this.loadingDelayTimeout) {
      clearTimeout(this.loadingDelayTimeout);
      this.loadingDelayTimeout = null;
    }

    this.map.off("zoomend", this.handleMapViewChange);
    this.map.off("moveend", this.handleMapViewChange);
    this.map.off("resize", this.handleMapViewChange);

    this.sliceCache.clear();
    releaseHub(this.map, this.config.id);
  }
}
