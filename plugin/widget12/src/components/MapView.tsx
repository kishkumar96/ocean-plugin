"use client";

import { useEffect, useRef } from "react";
import type { Map as MaplibreMap, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { referenceSources, referenceStyleLayers } from "@/lib/referenceLayers";

// Single base map: SPC's OpenStreetMap tiles (via the Ocean Portal tile proxy,
// which adds CORS headers the tile server itself lacks). Reference overlays
// (EEZ, coastline, names) sit at the top; data layers go below them.
// Built in the browser because the overlays go through our own tile proxy.
const SPC_OSM_TILES =
  "https://oceanportal.spc.int/api/proxy-tile?url=" +
  // {z}/{x}/{y} stay unencoded so MapLibre can fill them in.
  "https%3A%2F%2Fspc-osm.spc.int%2Ftile%2F{z}%2F{x}%2F{y}.png";

const basemapStyle = (origin: string): StyleSpecification => ({
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [SPC_OSM_TILES],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
    // Previous base map (OpenTopoMap):
    // opentopo: {
    //   type: "raster",
    //   tiles: [
    //     "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    //     "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
    //     "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
    //   ],
    //   tileSize: 256,
    //   maxzoom: 17,
    //   attribution:
    //     'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM &mdash; Style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    // },
    ...referenceSources(origin),
  },
  layers: [
    { id: "osm", type: "raster", source: "osm" },
    // { id: "opentopo", type: "raster", source: "opentopo" },
    ...referenceStyleLayers,
  ],
});

type Props = {
  onLoad?: (map: MaplibreMap) => void;
};

export default function MapView({ onLoad }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: MaplibreMap | undefined;
    let cancelled = false;

    // MapLibre v5 (not v6): deck.gl's interleaved mode, used for the Zarr
    // layers, relies on map internals that v6 changed.
    import("maplibre-gl").then(({ Map, NavigationControl, ScaleControl }) => {
      if (cancelled || !containerRef.current) return;
      map = new Map({
        container: containerRef.current,
        style: basemapStyle(window.location.origin),
        center: [170, -10], // Pacific
        zoom: 2,
      });
      map.addControl(new NavigationControl(), "top-right");
      map.addControl(new ScaleControl(), "bottom-right");
      map.on("load", () => onLoad?.(map!));
    });

    return () => {
      cancelled = true;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}
