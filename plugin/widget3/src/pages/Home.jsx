import React, { useState, useEffect } from 'react';
import SearchComponent from '../components/searchComponent';
import RealtimeComponent from '../components/realtimeComponent';
import '../components/Monitor.css';

// Themed Home page toggling between selection screen and realtime dashboard
export default function Home() {
  const [selectedStations, setSelectedStations] = useState([]);
  const [buoyOptions, setBuoyOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dashboardGenerated, setDashboardGenerated] = useState(false);
  const [sharedCountryMap, setSharedCountryMap] = useState({});
  const [initialLiveMode, setInitialLiveMode] = useState(false);

  // Listen for share link restoration
  useEffect(() => {
    const handler = (e) => {
      const { s, c, lm } = e.detail || {};
      if (Array.isArray(s) && s.length) {
        setSelectedStations(prev => prev.length ? prev : s.slice(0,8));
        if (c && typeof c === 'object') {
          const up = Object.fromEntries(Object.entries(c).map(([k,v]) => [k, (v||'').toUpperCase()]));
          setSharedCountryMap(up);
        }
        if (lm === 1) setInitialLiveMode(true);
        setDashboardGenerated(true);
      }
    };
    window.addEventListener('restore-shared-stations', handler);

    // Direct URL parse (so we don't rely on realtime component mounting first)
    try {
      const url = new URL(window.location.href);
      const enc = url.searchParams.get('rtd');
      if (enc && selectedStations.length === 0) {
        const json = JSON.parse(atob(decodeURIComponent(enc)));
        if (Array.isArray(json.s) && json.s.length) {
          setSelectedStations(json.s.slice(0,8));
          if (json.c && typeof json.c === 'object') {
            const up = Object.fromEntries(Object.entries(json.c).map(([k,v]) => [k, (v||'').toUpperCase()]));
            setSharedCountryMap(up);
          }
          if (json.lm === 1) setInitialLiveMode(true);
          setDashboardGenerated(true);
        }
      }
    } catch { /* ignore */ }
    return () => window.removeEventListener('restore-shared-stations', handler);
  }, [selectedStations.length]);

  return (
    <div className="monitoring-container" style={{
      background: 'var(--color-background)',
      color: 'var(--color-text)',
      height: 'calc(100vh - 58px)', // small reduction to prevent rounding overflow causing scrollbar
      display: 'flex',
      flexDirection: 'column',
      transition: 'background .3s,color .3s',
      overflow: 'hidden'
    }}>
      {!dashboardGenerated ? (
        <SearchComponent
          selectedStations={selectedStations}
          setSelectedStations={setSelectedStations}
          buoyOptions={buoyOptions}
          setBuoyOptions={setBuoyOptions}
          loading={loading}
          setLoading={setLoading}
          error={error}
          setError={setError}
          setDashboardGenerated={setDashboardGenerated}
        />
      ) : (
        <RealtimeComponent
          selectedStations={selectedStations}
          setDashboardGenerated={setDashboardGenerated}
          buoyOptions={buoyOptions}
          sharedCountryMap={sharedCountryMap}
          initialLiveMode={initialLiveMode}
        />
      )}
    </div>
  );
}
