import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export default function RealtimeSearchMap({ buoyOptions = [], selectedStations = [], setSelectedStations, maxSelection = 8 }) {
  const mapRef = useRef(null);
  const groupRef = useRef(null);
  
  // Normalize longitude to [-180, 180]
  const normalizeLongitude = (lon) => {
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    return lon;
  };

  // Initialize map once
  useEffect(() => {
    if (mapRef.current) return; // already initialized
  const map = L.map('realtime-search-map', { 
    center: [-15, 170], 
    zoom: 3, 
    worldCopyJump: false, 
    attributionControl: false, 
    doubleClickZoom: false
  });
    mapRef.current = map;

    const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
    const labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { 
      maxZoom: 19,
      pane: 'overlayPane'
    });
    
    // Create satellite with labels as a layer group
    const satelliteWithLabels = L.layerGroup([satellite, labels]);
    
    satelliteWithLabels.addTo(map); // default satellite with labels

    L.control.layers({ 'Satellite': satelliteWithLabels, 'OpenStreetMap': street }, null, { position: 'topright', collapsed: true }).addTo(map);

    const footer = L.control({ position: 'bottomright' });
    footer.onAdd = () => {
      const div = L.DomUtil.create('div', 'custom-map-footer');
      div.style.background = '#9d9f9f';
      div.style.color = '#000000';
      div.style.padding = '4px 8px';
      div.style.fontSize = '11px';
      div.style.borderRadius = '4px';
      div.style.whiteSpace = 'nowrap';
      div.style.margin = '0 0 2px 0';
      div.innerHTML = '<a href="https://www.spc.int/" target="_blank" rel="noopener" style="color:#2563eb;text-decoration:none;">SPC</a> | &copy; Pacific Community SPC | &copy; Pacific Community SPC';
      return div;
    };
    footer.addTo(map);

    groupRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      groupRef.current = null;
    };
  }, []);

  // Update markers when data or selection changes
  useEffect(() => {
    if (!mapRef.current || !groupRef.current) return;
    const group = groupRef.current;
    group.clearLayers();

    const typeColors = {
      'Wave Buoy': '#66cf6dff',
      'DART Buoy': '#4354b7ff',
      'Tide Gauge': '#fe7e0f'
    };

    buoyOptions.forEach(b => {
      const [rawLng, lat] = b.coordinates || [];
      if (typeof rawLng === 'number' && typeof lat === 'number') {
        const normalizedLon = normalizeLongitude(rawLng);
        const isSelected = selectedStations.includes(b.spotter_id);
        const baseColor = typeColors[b.type_value] || '#2563eb';
        
        // Create marker at normalized position
        const createMarker = (longitude) => {
          const marker = L.circleMarker([lat, longitude], {
            radius: isSelected ? 10 : 6,
            color: isSelected ? '#ffffff' : baseColor,
            weight: isSelected ? 3 : 2,
            fillOpacity: isSelected ? 1 : 0.75,
            fillColor: baseColor
          }).bindPopup(`<strong>${b.label}</strong><br/>${b.type_value || ''}${isSelected ? '<br/><em>Selected</em>' : ''}`)
            .addTo(group);

          // Click toggles selection (better for touch devices)
          if (setSelectedStations) {
            marker.on('click', () => {
              setSelectedStations(prev => {
                const currentlySelected = prev.includes(b.spotter_id);
                if (currentlySelected) {
                  return prev.filter(id => id !== b.spotter_id);
                }
                if (prev.length >= maxSelection) {
                  marker.setStyle({ color: '#ff0044', weight: 4 });
                  setTimeout(() => marker.setStyle({ color: '#ffffff', weight: 3 }), 600);
                  return prev; // no change
                }
                return [...prev, b.spotter_id];
              });
            });
          }
          return marker;
        };
        
        // Create primary marker
        createMarker(normalizedLon);
        
        // Create duplicate marker on opposite side of dateline for points near IDL
        if (Math.abs(normalizedLon) > 150) {
          const duplicateLon = normalizedLon > 0 ? normalizedLon - 360 : normalizedLon + 360;
          createMarker(duplicateLon);
        }
      }
    });
  }, [buoyOptions, selectedStations, setSelectedStations, maxSelection]);

  return <div id="realtime-search-map" style={{ height: '100%', width: '100%' }} />;
}
