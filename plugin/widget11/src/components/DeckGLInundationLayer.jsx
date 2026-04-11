/**
 * DeckGLInundationLayer
 *
 * GPU-accelerated rendering of inundation forecast points using deck.gl
 * ScatterplotLayer.  Replaces the batched Leaflet marker approach in
 * InundationPointsService, allowing thousands of points to be rendered in a
 * single WebGL draw call.
 *
 * Risk-level colours match InundationPointsService.riskLevels exactly:
 *   low      → #2196F3 (blue)
 *   moderate → #FF9800 (orange)
 *   high     → #F44336 (red)
 *
 * Popup on click is delegated back to the Leaflet map so we avoid duplicating
 * popup logic.  The component only handles GPU rendering.
 */

import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { MapView } from '@deck.gl/core';

// Risk colours as RGBA (match InundationPointsService)
const RISK_COLORS = {
  low:      [33,  150, 243, 220],  // #2196F3
  moderate: [255, 152,   0, 220],  // #FF9800
  high:     [244,  67,  54, 220],  // #F44336
};
const FALLBACK_COLOR = RISK_COLORS.low;

function getRiskColor(point) {
  const level = (
    point.coastal_inundation_hazard_level ||
    point.hazard_level ||
    point.risk_level ||
    ''
  ).toLowerCase();

  if (level.includes('high') || level.includes('severe') || level.includes('extreme')) {
    return RISK_COLORS.high;
  }
  if (level.includes('moderate') || level.includes('medium')) {
    return RISK_COLORS.moderate;
  }

  // Numeric fallback
  const numVal = point.max_inundation ?? point.inundation;
  if (typeof numVal === 'number') {
    if (numVal > 0.8)  return RISK_COLORS.high;
    if (numVal > 0.4)  return RISK_COLORS.moderate;
  }

  return FALLBACK_COLOR;
}

export default function DeckGLInundationLayer({ mapInstance, pointsData, isVisible }) {
  const [viewState, setViewState] = useState({
    longitude: 178.5,
    latitude:  -8.5,
    zoom:      9,
    pitch:     0,
    bearing:   0,
  });

  const deckRef = useRef(null);

  // ---- Sync deck.gl viewport with Leaflet ----
  useEffect(() => {
    const map = mapInstance?.current;
    if (!map) return;

    const sync = () => {
      const c = map.getCenter();
      setViewState({
        longitude: c.lng,
        latitude:  c.lat,
        zoom:      map.getZoom(),
        pitch:     0,
        bearing:   0,
      });
    };

    map.on('moveend', sync);
    map.on('zoomend', sync);
    sync();

    return () => {
      map.off('moveend', sync);
      map.off('zoomend', sync);
    };
  }, [mapInstance]);

  // ---- Route Leaflet clicks through deck.gl hit-testing ----
  useEffect(() => {
    const map = mapInstance?.current;
    if (!map) return;

    const handleClick = (e) => {
      if (!deckRef.current || !isVisible) return;
      const cp   = map.latLngToContainerPoint(e.latlng);
      const info = deckRef.current.pickObject({ x: cp.x, y: cp.y, radius: 8 });
      if (!info?.object) return;

      const pt  = info.object;
      const lat = parseFloat(pt.latitude);
      const lng = parseFloat(pt.longitude);
      if (isNaN(lat) || isNaN(lng)) return;

      const hazardLevel = pt.coastal_inundation_hazard_level || pt.hazard_level || pt.risk_level;
      const numVal      = pt.max_inundation ?? pt.inundation;
      let locationName  = pt.station_name || pt.location || pt.name;
      if (locationName && locationName.toLowerCase() === 'unknown') locationName = null;
      locationName = locationName || 'Inundation Forecast Point';

      let popupHtml = `<div style="font-family:sans-serif;max-width:300px">
        <strong>${locationName}</strong>`;
      if (hazardLevel) {
        const color = getRiskColor(pt);
        const hex   = `#${color.slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('')}`;
        popupHtml  += `<br/>Risk: <span style="color:${hex};font-weight:bold">${hazardLevel}</span>`;
      }
      if (typeof numVal === 'number') {
        popupHtml += `<br/>Max inundation: ${numVal.toFixed(2)} m`;
      }
      popupHtml += '</div>';

      L.popup()
        .setLatLng([lat, lng])
        .setContent(popupHtml)
        .openOn(map);
    };

    map.on('click', handleClick);
    return () => map.off('click', handleClick);
  }, [mapInstance, isVisible]);

  if (!isVisible || !Array.isArray(pointsData) || pointsData.length === 0) return null;

  const layer = new ScatterplotLayer({
    id: 'inundation-points',
    data: pointsData,
    getPosition: (d) => {
      const lat = parseFloat(d.latitude);
      const lng = parseFloat(d.longitude);
      return [isNaN(lng) ? 0 : lng, isNaN(lat) ? 0 : lat];
    },
    getRadius: 800,
    radiusUnits: 'meters',
    radiusMinPixels: 4,
    radiusMaxPixels: 14,
    getFillColor: getRiskColor,
    getLineColor: [255, 255, 255, 180],
    lineWidthMinPixels: 1,
    stroked: true,
    filled: true,
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 0, 150],
  });

  return (
    <DeckGL
      ref={deckRef}
      viewState={viewState}
      views={new MapView({ repeat: false })}
      controller={false}
      layers={[layer]}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}
