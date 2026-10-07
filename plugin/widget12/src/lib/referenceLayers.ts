import type { LayerSpecification, SourceSpecification } from "maplibre-gl";
import { BASE_PATH } from "@/lib/basePath";

// Reference overlays drawn above all data layers: Pacific Data Hub GeoServer
// TMS tiles, fetched through our same-origin tile proxy (src/app/api/tiles)
// which retries flaky upstream requests. Order here is bottom to top.
export type ReferenceLayer = { id: string; label: string; tiles: string };

const GEONODE_TMS =
  "https://geonode.pacificdata.org/geoserver/gwc/service/tms/1.0.0";

export const REFERENCE_LAYERS: ReferenceLayer[] = [
  {
    id: "ref-eez",
    label: "EEZ",
    tiles: `${GEONODE_TMS}/geonode:global_eez_200nm@EPSG:3857@pbf/{z}/{x}/{y}.png`,
  },
  {
    id: "ref-coastline",
    label: "Coastline",
    tiles: `${GEONODE_TMS}/geonode:pac_coastline@EPSG:3857@pbf/{z}/{x}/{y}.png`,
  },
  {
    id: "ref-names",
    label: "Place names",
    tiles: `${GEONODE_TMS}/geonode:pacific_names@EPSG:3857@pbf/{z}/{x}/{y}.png`,
  },
];

/** Data layers are inserted below this map layer so the overlays stay on top. */
export const DATA_BEFORE_ID = REFERENCE_LAYERS[0].id;

// The GeoWebCache gridset only covers the middle latitudes; tiles outside
// this band come back as text, so don't request them.
const COVERAGE_BOUNDS: [number, number, number, number] = [
  -180, -66.5, 180, 66.5,
];

/** Raster sources for the overlays, routed through the tile proxy at `origin`. */
export function referenceSources(
  origin: string,
): Record<string, SourceSpecification> {
  return Object.fromEntries(
    REFERENCE_LAYERS.map((l) => [
      l.id,
      {
        type: "raster",
        // Braces stay unencoded so MapLibre can fill in {z}/{x}/{y}.
        tiles: [`${origin}${BASE_PATH}/api/tiles?url=${l.tiles}`],
        tileSize: 256,
        // TMS scheme: flipped y ({-y} in the portal config).
        scheme: "tms",
        bounds: COVERAGE_BOUNDS,
      },
    ]),
  );
}

export const referenceStyleLayers: LayerSpecification[] = REFERENCE_LAYERS.map(
  (l) => ({ id: l.id, type: "raster", source: l.id }),
);
