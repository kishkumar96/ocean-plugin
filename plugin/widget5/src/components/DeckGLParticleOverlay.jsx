/**
 * DeckGLParticleOverlay
 *
 * Renders an animated wave-flow particle field using WebGL via deck.gl.
 * The overlay sits absolutely on top of the Leaflet WMS map and keeps its
 * viewport synchronised with Leaflet's map state (pan / zoom).
 *
 * Particles drift in the dominant Cook-Islands swell direction (from SW,
 * moving toward NE) and fade out as they age, giving the classic Windy-style
 * flow appearance without requiring a separate GL map instance.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { MapView } from '@deck.gl/core';

// Cook Islands dominant swell: waves coming FROM ~210° (SW) moving TOWARD ~30° (NE)
// Direction in which particles travel (degrees clockwise from North):
const FLOW_DIRECTION_DEG = 30;
const FLOW_DIRECTION_RAD = (FLOW_DIRECTION_DEG * Math.PI) / 180;

// Unit flow vector in geographic space (positive lon = east, positive lat = north)
const FLOW_DX = Math.sin(FLOW_DIRECTION_RAD);  // eastward component
const FLOW_DY = Math.cos(FLOW_DIRECTION_RAD);  // northward component

// Base speed in degrees per animation frame (~60 fps)
const BASE_SPEED = 0.00045;

// Maximum particle age (frames) before respawn
const MAX_AGE = 140;

const PARTICLE_COUNT = 700;

// Particle fill colour: deep-ocean blue with variable alpha based on age
const PARTICLE_COLOR_BASE = [60, 160, 255];

function createParticle(bounds) {
  const { west, east, south, north } = bounds;
  return {
    position: [
      west + Math.random() * (east - west),
      south + Math.random() * (north - south),
    ],
    age: Math.floor(Math.random() * MAX_AGE),
    speed: BASE_SPEED * (0.6 + Math.random() * 0.8),
  };
}

function initParticles(bounds) {
  return Array.from({ length: PARTICLE_COUNT }, () => createParticle(bounds));
}

export default function DeckGLParticleOverlay({ mapInstance, isActive = true }) {
  const [viewState, setViewState] = useState({
    longitude: -159.75,
    latitude: -21.25,
    zoom: 12,
    pitch: 0,
    bearing: 0,
  });

  const boundsRef  = useRef({ west: -160.6, east: -158.9, south: -22.0, north: -20.4 });
  const animRef    = useRef(null);
  const [particles, setParticles] = useState(() => initParticles(boundsRef.current));

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

    map.on('moveend', sync);
    map.on('zoomend', sync);
    sync();

    return () => {
      map.off('moveend', sync);
      map.off('zoomend', sync);
    };
  }, [mapInstance]);

  // ---- Animation loop ----
  const tick = useCallback(() => {
    const bounds = boundsRef.current;
    setParticles(prev =>
      prev.map(p => {
        const [lon, lat] = p.position;
        const newLon = lon + FLOW_DX * p.speed;
        const newLat = lat + FLOW_DY * p.speed;
        const newAge = p.age + 1;

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
    if (!isActive) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }
    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [isActive, tick]);

  if (!isActive) return null;

  const layer = new ScatterplotLayer({
    id: 'wave-particle-overlay',
    data: particles,
    getPosition: (d) => d.position,
    getRadius: 1800,
    radiusUnits: 'meters',
    radiusMinPixels: 1.5,
    radiusMaxPixels: 4,
    getFillColor: (d) => {
      const alpha = Math.round(220 * (1 - d.age / MAX_AGE));
      return [...PARTICLE_COLOR_BASE, alpha];
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
