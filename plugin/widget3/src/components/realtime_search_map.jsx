import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { MapView } from '@deck.gl/core';

// GPU colour palette keyed by station type (RGBA 0-255)
const TYPE_COLORS = {
  'Wave Buoy':  [102, 207, 109, 220],
  'DART Buoy':  [67,  84,  183, 220],
  'Tide Gauge': [254, 126,  15, 220],
};
const DEFAULT_COLOR  = [37, 99, 235, 220];
const SELECTED_FILL  = [255, 255, 255, 255];

// Normalize longitude to [-180, 180]
const normalizeLon = (lon) => {
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return lon;
};

export default function RealtimeSearchMap({
  buoyOptions = [],
  selectedStations = [],
  setSelectedStations,
  maxSelection = 8,
}) {
  const mapDivRef  = useRef(null);   // Leaflet DOM target
  const leafletRef = useRef(null);   // Leaflet map instance
  const deckRef    = useRef(null);   // deck.gl Deck instance (via forwardRef)

  const [viewState, setViewState] = useState({
    longitude: 170,
    latitude: -15,
    zoom: 3,
    pitch: 0,
    bearing: 0,
  });

  // ---------- Leaflet basemap (tiles + controls) ----------
  useEffect(() => {
    if (leafletRef.current) return;

    const map = L.map(mapDivRef.current, {
      center: [-15, 170],
      zoom: 3,
      worldCopyJump: false,
      attributionControl: false,
      doubleClickZoom: false,
    });
    leafletRef.current = map;

    const street    = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
    const labels    = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, pane: 'overlayPane',
    });
    const satWithLabels = L.layerGroup([satellite, labels]);
    satWithLabels.addTo(map);
    L.control.layers({ 'Satellite': satWithLabels, 'OpenStreetMap': street }, null, {
      position: 'topright', collapsed: true,
    }).addTo(map);

    const footer = L.control({ position: 'bottomright' });
    footer.onAdd = () => {
      const div = L.DomUtil.create('div', 'custom-map-footer');
      div.style.cssText = 'background:#9d9f9f;color:#000;padding:4px 8px;font-size:11px;border-radius:4px;white-space:nowrap;margin:0 0 2px 0';
      div.innerHTML = '<a href="https://www.spc.int/" target="_blank" rel="noopener" style="color:#2563eb;text-decoration:none;">SPC</a> | &copy; Pacific Community SPC';
      return div;
    };
    footer.addTo(map);

    // Sync deck.gl viewport whenever Leaflet moves
    const syncViewport = () => {
      const c = map.getCenter();
      setViewState({ longitude: c.lng, latitude: c.lat, zoom: map.getZoom(), pitch: 0, bearing: 0 });
    };
    map.on('moveend', syncViewport);
    map.on('zoomend', syncViewport);

    // Route map clicks through deck.gl hit-testing
    map.on('click', (e) => {
      if (!deckRef.current || !setSelectedStations) return;
      const cp   = map.latLngToContainerPoint(e.latlng);
      const info = deckRef.current.pickObject({ x: cp.x, y: cp.y, radius: 10 });
      if (!info?.object) return;
      const b = info.object;
      setSelectedStations(prev => {
        if (prev.includes(b.spotter_id)) return prev.filter(id => id !== b.spotter_id);
        if (prev.length >= maxSelection) return prev;
        return [...prev, b.spotter_id];
      });
    });

    // Update cursor on hover
    map.on('mousemove', (e) => {
      if (!deckRef.current) return;
      const cp   = map.latLngToContainerPoint(e.latlng);
      const info = deckRef.current.pickObject({ x: cp.x, y: cp.y, radius: 5 });
      map.getContainer().style.cursor = info ? 'pointer' : '';
    });

    return () => {
      map.remove();
      leafletRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- deck.gl GPU layer ----------
  const scatterLayer = new ScatterplotLayer({
    id: 'buoy-layer',
    data: buoyOptions,
    getPosition: (d) => {
      const [lng, lat] = d.coordinates || [0, 0];
      return [normalizeLon(lng), lat];
    },
    getRadius: (d) => selectedStations.includes(d.spotter_id) ? 30000 : 18000,
    radiusUnits: 'meters',
    radiusMinPixels: 5,
    radiusMaxPixels: 20,
    getFillColor: (d) =>
      selectedStations.includes(d.spotter_id)
        ? SELECTED_FILL
        : (TYPE_COLORS[d.type_value] || DEFAULT_COLOR),
    getLineColor: (d) =>
      selectedStations.includes(d.spotter_id)
        ? (TYPE_COLORS[d.type_value] || DEFAULT_COLOR)
        : [255, 255, 255, 150],
    lineWidthMinPixels: 2,
    stroked: true,
    filled: true,
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 230, 0, 120],
    updateTriggers: {
      getRadius:     [selectedStations],
      getFillColor:  [selectedStations],
      getLineColor:  [selectedStations],
    },
  });

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {/* Leaflet basemap */}
      <div ref={mapDivRef} style={{ height: '100%', width: '100%' }} />

      {/* deck.gl GPU overlay — pointer-events:none so Leaflet keeps pan/zoom */}
      <DeckGL
        ref={deckRef}
        viewState={viewState}
        views={new MapView({ repeat: true })}
        controller={false}
        layers={[scatterLayer]}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      />
    </div>
  );
}
