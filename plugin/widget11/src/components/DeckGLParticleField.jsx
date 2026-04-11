/**
 * DeckGLParticleField
 *
 * GPU-accelerated animated particle field for wave direction visualisation.
 * Replaces the Canvas 2D WaveParticleField that was never fully activated.
 *
 * Accepts an optional `vectorField` (same format as WaveDirectionDataService output:
 * { u: Float32Array, v: Float32Array, bounds, width, height }) and uses it to
 * steer particles.  When no field is available particles use a default NNE flow
 * typical of Pacific swell patterns around Tuvalu.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { MapView } from '@deck.gl/core';

const PARTICLE_COUNT = 1500;
const MAX_AGE        = 100;

// Default flow direction when no real vector field is available
// Tuvalu dominant swell comes from E–SE (~120°) and moves toward W–NW (~300°)
const DEFAULT_FLOW_DEG = 300;
const DEFAULT_FLOW_RAD = (DEFAULT_FLOW_DEG * Math.PI) / 180;
const DEFAULT_DX       = Math.sin(DEFAULT_FLOW_RAD);  // longitude delta
const DEFAULT_DY       = Math.cos(DEFAULT_FLOW_RAD);  // latitude  delta
const BASE_SPEED       = 0.00030;

// Bilinear interpolation helper (same algorithm as WaveParticleField._getVelocity)
function bilinearInterp(field, fx, fy) {
  const { u, v, width: fw, height: fh } = field;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, fw - 1);
  const y1 = Math.min(y0 + 1, fh - 1);
  const wx = fx - x0;
  const wy = fy - y0;

  const idx00 = y0 * fw + x0, idx10 = y0 * fw + x1;
  const idx01 = y1 * fw + x0, idx11 = y1 * fw + x1;

  const interpVal = (arr) =>
    (1 - wx) * (1 - wy) * (arr[idx00] || 0) +
    wx        * (1 - wy) * (arr[idx10] || 0) +
    (1 - wx)  * wy       * (arr[idx01] || 0) +
    wx        * wy       * (arr[idx11] || 0);

  return { u: interpVal(u), v: interpVal(v) };
}

function createParticle(bounds) {
  const { west, east, south, north } = bounds;
  return {
    position: [
      west  + Math.random() * (east  - west),
      south + Math.random() * (north - south),
    ],
    age:   Math.floor(Math.random() * MAX_AGE),
    speed: BASE_SPEED * (0.5 + Math.random()),
  };
}

function initParticles(bounds) {
  return Array.from({ length: PARTICLE_COUNT }, () => createParticle(bounds));
}

// Particle colour: cyan-blue, fading as particle ages
const COLOR_BASE = [80, 200, 240];

export default function DeckGLParticleField({ mapInstance, vectorField = null, showParticles = true }) {
  const [viewState, setViewState] = useState({
    longitude: 178.5,
    latitude:  -8.5,
    zoom:      9,
    pitch:     0,
    bearing:   0,
  });

  const boundsRef   = useRef({ west: 176, east: 180, south: -10.8, north: -5.6 });
  const animRef     = useRef(null);
  const fieldRef    = useRef(null);

  const [particles, setParticles] = useState(() => initParticles(boundsRef.current));

  // Keep vector field reference up to date without triggering reinit
  useEffect(() => {
    fieldRef.current = vectorField;
  }, [vectorField]);

  // ---- Sync deck.gl viewport with Leaflet ----
  useEffect(() => {
    const map = mapInstance?.current;
    if (!map) return;

    const sync = () => {
      const c = map.getCenter();
      const b = map.getBounds();
      boundsRef.current = {
        west:  b.getWest(),
        east:  b.getEast(),
        south: b.getSouth(),
        north: b.getNorth(),
      };
      setViewState({
        longitude: c.lng,
        latitude:  c.lat,
        zoom:      map.getZoom(),
        pitch:     0,
        bearing:   0,
      });
    };

    // Reinitialise particles when map moves so they fill the new view
    const onMoveEnd = () => {
      sync();
      setParticles(initParticles(boundsRef.current));
    };

    map.on('zoomend',  onMoveEnd);
    map.on('moveend',  onMoveEnd);
    sync();

    return () => {
      map.off('zoomend',  onMoveEnd);
      map.off('moveend',  onMoveEnd);
    };
  }, [mapInstance]);

  // ---- Animation loop ----
  const tick = useCallback(() => {
    const bounds = boundsRef.current;
    const field  = fieldRef.current;
    const geoScale = 0.0012; // Convert vector-field units to degrees per frame

    setParticles(prev =>
      prev.map(p => {
        const [lon, lat] = p.position;
        const newAge = p.age + 1;

        let dlon, dlat;

        if (field && field.u && field.v && field.width && field.height) {
          // Map geographic position to vector-field grid coordinates
          const fx = ((lon - bounds.west)  / (bounds.east  - bounds.west))  * (field.width  - 1);
          const fy = ((lat - bounds.south) / (bounds.north - bounds.south)) * (field.height - 1);
          const { u, v } = bilinearInterp(field, Math.max(0, Math.min(field.width  - 1, fx)),
                                                 Math.max(0, Math.min(field.height - 1, fy)));
          // v is positive-south in screen space, invert for latitude
          dlon = u * geoScale * p.speed / BASE_SPEED;
          dlat = -v * geoScale * p.speed / BASE_SPEED;
        } else {
          dlon = DEFAULT_DX * p.speed;
          dlat = DEFAULT_DY * p.speed;
        }

        const newLon = lon + dlon;
        const newLat = lat + dlat;

        if (
          newAge > MAX_AGE ||
          newLon < bounds.west  || newLon > bounds.east ||
          newLat < bounds.south || newLat > bounds.north
        ) {
          return createParticle(bounds);
        }

        return { ...p, position: [newLon, newLat], age: newAge };
      })
    );

    animRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (!showParticles) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }
    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [showParticles, tick]);

  if (!showParticles) return null;

  const layer = new ScatterplotLayer({
    id: 'wave-particle-field',
    data: particles,
    getPosition: (d) => d.position,
    getRadius: 1500,
    radiusUnits: 'meters',
    radiusMinPixels: 1,
    radiusMaxPixels: 3,
    getFillColor: (d) => {
      const t     = d.age / MAX_AGE;
      const alpha = Math.round(200 * (1 - t));
      return [...COLOR_BASE, alpha];
    },
    updateTriggers: {
      getFillColor: particles,
    },
  });

  return (
    <DeckGL
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
