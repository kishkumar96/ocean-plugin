import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Container, Button, Form, Spinner, Badge, Card, Row, Col } from 'react-bootstrap';
import { FaWaveSquare, FaArrowLeft } from 'react-icons/fa';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, LineElement, PointElement, LinearScale, TimeScale, Tooltip, Legend, Filler, CategoryScale } from 'chart.js';
import 'chartjs-adapter-date-fns';
import Lottie from 'lottie-react';
import animationData from './live.json';
import './Dashboard.css';
ChartJS.register(LineElement, PointElement, LinearScale, TimeScale, Tooltip, Legend, Filler, CategoryScale);

const fixedColors = [
    'rgb(255, 87, 51)', 'rgb(153, 102, 255)', 'rgb(255, 206, 86)',
    'rgb(54, 162, 235)', 'rgb(255, 99, 132)', 'rgb(75, 192, 192)'
];
// Dynamic flag loader now uses country_short fetched in searchComponent; fallback handled via onError

export default function RealtimeComponent({ selectedStations, setDashboardGenerated, buoyOptions, sharedCountryMap = {}, initialLiveMode = false }) {
    const [stationData, setStationData] = useState({});
    const [chartData, setChartData] = useState({});
    const isLoadingChartsRef = useRef(false);
    const [dataLimit, setDataLimit] = useState(1000); // default limit per requirement
    const [liveMode, setLiveMode] = useState(false);
    // Station currently expanded in overlay (double-click)
    const [expandedStationId, setExpandedStationId] = useState(null);
    const appliedInitialLiveModeRef = useRef(false);
    const [shareStatus, setShareStatus] = useState('');
    // themeKey increments when body class (light/dark) changes so charts fully re-render with new colors
    const [themeKey, setThemeKey] = useState(0);
    const refreshIntervalRef = useRef(null);
    const REFRESH_INTERVAL = 1800000;
    const controlsRef = useRef(null);

    const getStationDetails = useCallback(id => {
        const found = buoyOptions.find(b=>b.spotter_id===id);
        if (found) {
            if (!found.country_short) {
                const cs = sharedCountryMap[id];
                if (cs) return { ...found, country_short: (cs||'').toUpperCase() };
            }
            return found;
        }
        // fallback minimal object using sharedCountryMap for flag if available
    const cs = sharedCountryMap[id];
    if (cs) return { spotter_id: id, country_short: (cs||'').toUpperCase(), label: id, is_active: true };
        return {};
    }, [buoyOptions, sharedCountryMap]);

    // Station metadata now comes from buoyOptions prop only; no fetch needed
    const fetchStationData = useCallback(() => {
        const map = {};
        selectedStations.forEach(id => {
            let details = buoyOptions.find(b => b.spotter_id === id);
            if (details) {
                if (!details.country_short && sharedCountryMap[id]) {
                    details = { ...details, country_short: (sharedCountryMap[id]||'').toUpperCase() };
                }
                map[id] = details;
            } else if (sharedCountryMap[id]) {
                map[id] = { spotter_id: id, country_short: (sharedCountryMap[id]||'').toUpperCase(), label: id, is_active: true };
            }
        });
        setStationData(map);
    }, [selectedStations, buoyOptions, sharedCountryMap]);

    // New generic fetch for insitu station timeseries using station_id from API
    const fetchInsituData = useCallback(async (stationId, limit, reason = '') => {
        try {
            const url = `https://ocean-obs-api.spc.int/insitu/get_data/station/${stationId}?limit=${limit}`;
            // console.log(`[fetchInsituData] Fetching station ${stationId} with limit ${limit}. Reason: ${reason}`);
            
            // Create AbortController for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes timeout
            
            const res = await fetch(url, { 
                headers: { Accept: 'application/json' },
                signal: controller.signal 
            });
            
            clearTimeout(timeoutId);
            
            // Handle 404 error - station not found
            if (res.status === 404) {
                return { data: [], data_labels: '', isEmpty: true, notFound: true };
            }
            
            if (!res.ok) return null;
            const data = await res.json();
            
            // Check if response contains "Active station not found" error
            if (data && data.detail && data.detail === "Active station not found") {
                return { data: [], data_labels: '', isEmpty: true, stationNotFound: true };
            }
            
                         // Handle the response structure - data can be directly in response or nested
             let actualData, dataLabels;
             if (data.data !== undefined) {
                 // Case 1: data is nested (existing structure)
                 actualData = data.data;
                 dataLabels = data.data_labels;
             } else if (Array.isArray(data)) {
                 // Case 2: response is directly an array
                 actualData = data;
                 dataLabels = '';
             } else {
                 // Case 3: data is at top level (your current response structure)
                 actualData = data.data || [];
                 dataLabels = data.data_labels || '';
             }
             
                          // Check if data array is empty (this handles the case where data: [] is returned)
             if (!actualData || actualData.length === 0) {
                 return { data: [], data_labels: dataLabels || '', isEmpty: true };
             }
            
            // Return normalized structure
            return { data: actualData, data_labels: dataLabels };
        } catch (err) {
            if (err.name === 'AbortError') {
                console.error(`[fetchInsituData] Request timeout for station ${stationId} after 5 minutes`);
                return { data: [], data_labels: '', isTimeout: true };
            }
            // console.error(`[fetchInsituData] Error fetching station ${stationId}:`, err);
            return null;
        }
    }, []);

    const initializeChartData = useCallback(async () => {
        if (isLoadingChartsRef.current) return;
        isLoadingChartsRef.current = true;
        if (!selectedStations.length) { isLoadingChartsRef.current = false; return; }
        const newChartData = {};
        
        // Clear existing chart data immediately to show loading state
        setChartData({});
        
                 await Promise.all(selectedStations.map(async spotterId => {
             const station = getStationDetails(spotterId);
             const stationId = station.spotter_id; // use station_id instead of numeric id
             if (!stationId) {
                 // Handle case where station has no station ID
                 const metaBase = stationData[spotterId] || {};
                 if (!metaBase.country_short && sharedCountryMap[spotterId]) {
                     metaBase.country_short = (sharedCountryMap[spotterId]||'').toUpperCase();
                 }
                 newChartData[spotterId] = {
                     labels: [],
                     datasets: [],
                     lastUpdated: new Date().toISOString(),
                     meta: metaBase,
                     noData: true,
                     isEmpty: true
                 };
                 return;
             }
             
             const data = await fetchInsituData(stationId, dataLimit, `initializeChartData - Live: ${liveMode}`);
             
             // Create base chart data structure for all cases
             const metaBase = stationData[spotterId] || {};
             if (!metaBase.country_short && sharedCountryMap[spotterId]) {
                 metaBase.country_short = (sharedCountryMap[spotterId]||'').toUpperCase();
             }
             
             // Handle timeout or empty data cases
             if (!data) {
                 newChartData[spotterId] = {
                     labels: [],
                     datasets: [],
                     lastUpdated: new Date().toISOString(),
                     meta: metaBase,
                     noData: true,
                     isEmpty: true
                 };
                 return;
             }
             
             const { data: rows = [], data_labels, isEmpty, isTimeout, stationNotFound, notFound } = data;
             
             if (isEmpty || isTimeout || stationNotFound || notFound || !rows.length || !data_labels) {
                 newChartData[spotterId] = {
                     labels: [],
                     datasets: [],
                     lastUpdated: new Date().toISOString(),
                     meta: metaBase,
                     isEmpty: isEmpty || !rows.length,
                     isTimeout: isTimeout,
                     stationNotFound: stationNotFound,
                     notFound: notFound,
                     noData: true
                 };
                 return;
             }

            // data_labels example: "sea_level,time" or could include multiple variables
            const labelsArr = data_labels.split(',').map(s => s.trim()).filter(Boolean);
            // Ensure time label is identified
            const timeKey = labelsArr.find(l => l.toLowerCase() === 'time') || 'time';
            const yKeys = labelsArr.filter(l => l.toLowerCase() !== 'time');
            // Build traces dynamically
            const times = rows.map(entry => {
                const time = entry[timeKey];
                // If time is ISO string, strip seconds and always append 'Z'
                if (typeof time === 'string') {
                    // Match "T12:34:56", "T12:34:56.789", "T12:34", etc.
                    // Remove seconds, keep "T12:34", and add 'Z' at the end
                    const match = time.match(/^(.+T\d{2}:\d{2})/);
                    const base = match ? match[1] : time;
                    return base + 'Z';
                }
                // If time is a Date object, format as "YYYY-MM-DDTHH:MMZ"
                const date = new Date(time);
                return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}Z`;
            });
            // Using Date objects directly for Chart.js time scale
            const datasets = yKeys.map((k, idx) => ({
                key: k,
                label: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                values: rows.map(r => {
                    const val = r[k];
                    if (val === -999) return null; // -999 as null
                    return val;
                }),
                axis: idx === 0 ? 'y1' : idx === 1 ? 'y2' : 'y3'
            }));
            
            newChartData[spotterId] = {
                labels: times.map(t => new Date(t)),
                datasets,
                lastUpdated: new Date().toISOString(),
                meta: metaBase,
                noData: false
            };
        }));
        setChartData(newChartData);
        isLoadingChartsRef.current = false;
    }, [selectedStations, dataLimit, fetchInsituData, getStationDetails, stationData, sharedCountryMap, liveMode]);

    useEffect(() => { fetchStationData(); }, [fetchStationData]);
    useEffect(() => { initializeChartData(); }, [initializeChartData]);
    // Watch for theme (body class) changes to trigger chart rerender
    useEffect(() => {
        if (typeof MutationObserver === 'undefined') return;
        const body = document.body;
        if (!body) return;
        let lastClass = body.className;
        const obs = new MutationObserver(muts => {
            for (const m of muts) {
                if (m.type === 'attributes' && m.attributeName === 'class') {
                    if (body.className !== lastClass) {
                        lastClass = body.className;
                        setThemeKey(k => k + 1); // force remount of Plot components
                    }
                }
            }
        });
        obs.observe(body, { attributes: true });
        return () => obs.disconnect();
    }, []);
    useEffect(() => {
        if (!liveMode) { if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current); return; }
        refreshIntervalRef.current = setInterval(() => initializeChartData(), REFRESH_INTERVAL);
        return () => { if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current); };
    }, [liveMode, initializeChartData]);

    const toggleLiveMode = () => setLiveMode(m=>!m);
    const handleBack = () => setDashboardGenerated(false);
    const handleLimitChange = e => { 
        const v = parseInt(e.target.value); 
        if (!isNaN(v)) {
            const newLimit = Math.min(1000, Math.max(1, v));
            setDataLimit(newLimit);
            // Data will be automatically re-fetched due to dependency on dataLimit in initializeChartData
        }
    };

    // Handle double click to expand a station chart
    const handleExpand = id => {
        setExpandedStationId(id);
    };
    const handleCloseExpand = useCallback(() => setExpandedStationId(null), []);

    // Close on ESC
    useEffect(() => {
        if (!expandedStationId) return;
        const onKey = e => { if (e.key === 'Escape') handleCloseExpand(); };
        window.addEventListener('keydown', onKey);
        // prevent background scroll
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
    }, [expandedStationId, handleCloseExpand]);

    // Build shareable URL encoding selected station ids & data limit
    const buildShareURL = () => {
        try {
            const countryMap = {};
            selectedStations.forEach(id => {
                const st = getStationDetails(id);
                if (st?.country_short) countryMap[id] = st.country_short;
            });
            const payload = { s: selectedStations, l: dataLimit, c: countryMap, lm: liveMode ? 1 : 0 };
            const encoded = encodeURIComponent(btoa(JSON.stringify(payload)));
            const url = new URL(window.location.href);
            url.searchParams.set('rtd', encoded);
            return url.toString();
        } catch { return window.location.href; }
    };

    const handleShare = async () => {
        const link = buildShareURL();
        try {
            await navigator.clipboard.writeText(link);
            setShareStatus('Copied');
        } catch {
            window.prompt('Copy share URL', link);
            setShareStatus('Ready');
        }
        setTimeout(()=> setShareStatus(''), 2500);
    };

    // Parse share param if present (handled primarily in Home to set selectedStations, but we add safety here if loaded directly)
    useEffect(()=> {
        if (selectedStations.length) return; // don't override existing
        try {
            const url = new URL(window.location.href);
            const enc = url.searchParams.get('rtd');
            if (!enc) return;
            const json = JSON.parse(atob(decodeURIComponent(enc)));
            if (Array.isArray(json.s) && json.s.length) {
                // Fire a custom event including country map so parent can store
                window.dispatchEvent(new CustomEvent('restore-shared-stations', { detail: json }));
            }
            if (json.l && !isNaN(json.l)) setDataLimit(json.l);
        } catch {/* ignore */}
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Apply initial live mode once if coming from share
    useEffect(() => {
        if (!appliedInitialLiveModeRef.current) {
            if (initialLiveMode) setLiveMode(true);
            appliedInitialLiveModeRef.current = true;
        }
    }, [initialLiveMode]);

    const renderLiveModeIndicator = () => {
        const station = selectedStations.length ? getStationDetails(selectedStations[0]) : null;
        const active = station?.is_active;
        return (
            <div className="d-flex align-items-center">
                <Form.Check type="switch" id="live-mode" checked={liveMode} disabled={!active} onChange={toggleLiveMode} className="me-2" style={{transform:'scale(1.2)', opacity: active?1:.6}} />
                {liveMode && active ? (
                    <>
                        <Lottie animationData={animationData} style={{width:30,height:30,marginRight:5}} loop />
                        <span className="text-success">Live Mode</span>
                    </>
                ) : (
                    <span style={{color: active?'#6c757d':'#dc3545'}}>{active?'Live Mode (Inactive)':'Live Mode Disabled (Station Inactive)'}</span>
                )}
            </div>
        );
    };

    const renderChart = id => {
    const d = chartData[id];
        if (!d) return <div className="d-flex justify-content-center align-items-center h-100"><Spinner animation="border" size="sm" className="me-2"/>Loading...</div>;
        
        // Check for timeout case
        if (d.isTimeout) {
            let chartBg = '#1f242b', textColor = '#f1f5f9';
            if (typeof window !== 'undefined' && document?.body) {
                const rs = getComputedStyle(document.body);
                chartBg = (rs.getPropertyValue('--color-chart-bg') || chartBg).trim();
                textColor = (rs.getPropertyValue('--color-text') || textColor).trim();
            }
            return <div className="d-flex flex-column align-items-center justify-content-center w-100" style={{position:'relative',width:'100%',height:'100%'}}>
                <div style={{width:'100%',height:'100%',background:chartBg,borderRadius:4,display:'flex',position:'relative'}}></div>
                <div style={{color:textColor,position:'absolute',top:'50%',transform:'translateY(-50%)',fontSize:'1.05rem',fontWeight:500,textAlign:'center'}}>
                    <div>Request timeout (5 minutes exceeded)</div>
                    <div style={{fontSize:'0.9rem',marginTop:'8px',opacity:0.8}}>Please try again later</div>
                </div>
            </div>;
        }
        
        // If no data, empty data array, station not found, or 404 error, show empty graph with message
        if (d.noData || d.isEmpty || d.stationNotFound || d.notFound || !d.labels?.length || !d.datasets?.length || d.datasets.every(ds => !ds.values?.length || ds.values.every(v => v == null))) {
            // Show an empty line graph with a message
            let chartBg = '#1f242b', gridColor = '#4b5563', textColor = '#f1f5f9';
            if (typeof window !== 'undefined' && document?.body) {
                const rs = getComputedStyle(document.body);
                chartBg = (rs.getPropertyValue('--color-chart-bg') || chartBg).trim();
                gridColor = (rs.getPropertyValue('--color-chart-grid') || gridColor).trim();
                textColor = (rs.getPropertyValue('--color-text') || textColor).trim();
            }
            const data = {
                labels: [],
                datasets: [{
                    label: 'No Data',
                    data: [],
                    borderColor: '#aaa',
                    tension: 0.3,
                }]
            };
            const options = {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: {
                    x: { type: 'time', title: { display: true, text: 'Time (UTC)', color: textColor }, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } } },
                    y: { title: { display: true, text: 'No Data', color: textColor }, grid: { color: gridColor }, ticks: { color: textColor } }
                }
            };
            return <div className="d-flex flex-column align-items-center justify-content-center w-100" style={{position:'relative',width:'100%',height:'100%'}}>
                <div style={{width:'100%',height:'100%',background:chartBg,borderRadius:4,display:'flex',position:'relative'}}>
                    <Line key={`empty-${id}-${themeKey}`} data={data} options={options} style={{width:'100%',height:'100%'}} />
                </div>
                <div style={{color:textColor,position:'absolute',top:'50%',transform:'translateY(-50%)',fontSize:'1.05rem',fontWeight:500}}>No data available for this station</div>
            </div>;
        }
        // ...existing code...
    let chartBg = '#1f242b', gridColor = '#4b5563', textColor = '#f1f5f9';
        if (typeof window !== 'undefined' && document?.body) {
            const rs = getComputedStyle(document.body);
            chartBg = (rs.getPropertyValue('--color-chart-bg') || chartBg).trim();
            gridColor = (rs.getPropertyValue('--color-chart-grid') || gridColor).trim();
            textColor = (rs.getPropertyValue('--color-text') || textColor).trim();
        }
        // Build Chart.js datasets (single Y axis primary + optional second using plugin approach simplified)
        const data = {
            labels: d.labels,
            datasets: d.datasets.map((ds,i)=> ({
                label: ds.label,
                data: d.labels.map((time, idx) => ({ x: time, y: ds.values[idx] })),
                borderColor: fixedColors[i%fixedColors.length],
                backgroundColor: fixedColors[i%fixedColors.length] + '33',
                tension: 0.3,
                pointRadius: 0,
                pointHitRadius: 6,
                pointHoverRadius: 4,
                yAxisID: i === 0 ? 'y' : (i === 1 ? 'y1' : 'y2')
            }))
        };
    const options = {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'nearest', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { color: textColor, boxWidth: 18, boxHeight: 12, padding: 10 } },
                tooltip: { enabled: true }
            },
            layout: { 
                padding: { 
                    bottom: selectedStations.length === 1 ? 30 : 15,
                    top: 10,
                    left: 10,
                    right: 10
                } 
            },
            elements: { point: { radius: 0 } },
            scales: {
                x: { 
                    type: 'time',
                    time: { 
                        tooltipFormat: "yyyy-MM-dd HH:mm:ss", 
                        displayFormats: { 
                            minute: 'yyyy-MM-dd HH:mm', 
                            hour: 'yyyy-MM-dd HH:mm', 
                            day: 'yyyy-MM-dd HH:mm', 
                            month: 'yyyy-MM-dd'
                        }
                    },
                    adapters: { date: { zone: 'utc' } },
                    title: { display: true, text: 'Time (UTC)', color: textColor },
                    ticks: { 
                        color: textColor, 
                        maxRotation: 45, 
                        minRotation: 45, 
                        font: { size: selectedStations.length === 1 ? 12 : 10 }, 
                        callback: (val, idx, ticks) => {
                            const v = ticks[idx].value; // epoch ms
                            try { 
                                const date = new Date(v);
                                return date.toISOString().replace('T', ' ').replace('.000Z', 'Z');
                            } catch { 
                                return ''; 
                            }
                        } 
                    },
                    grid: { color: gridColor }
                },
                y: { type: 'linear', display: true, position: 'left', title: { display: true, text: d.datasets[0]?.label || 'Value', color: textColor }, ticks: { color: textColor }, grid: { color: gridColor } },
                y1: d.datasets[1] ? { type: 'linear', display: true, position: 'right', title: { display: true, text: d.datasets[1].label, color: textColor }, ticks: { color: textColor }, grid: { drawOnChartArea: false } } : undefined,
                y2: d.datasets[2] ? { type: 'linear', display: true, position: 'right', title: { display: true, text: d.datasets[2].label, color: textColor }, ticks: { color: textColor }, grid: { drawOnChartArea: false } } : undefined
            }
        };
    return <div style={{width:'100%',height:'100%',background:chartBg,borderRadius:4,position:'relative',minHeight:0}}>
            <Line key={`line-${id}-${themeKey}`} data={data} options={options} style={{width:'100%',height:'100%'}} />
        </div>;
    };

    const renderFlag = shortCode => {
        // Only use short_name (already uppercased in searchComponent). If absent, show fallback immediately.
        const code = (shortCode || '').trim();
        if (!code) {
            return (
                <img
                    src={process.env.PUBLIC_URL + '/COSPPaC_white_crop2.png'}
                    alt="NO FLAG"
                    style={{width:80,height:45,objectFit:'contain',marginRight:10,backgroundColor:'transparent',filter:'invert(61%) sepia(32%) saturate(748%) hue-rotate(176deg) brightness(103%) contrast(96%)'}}
                />
            );
        }
        return (
            <img
                src={process.env.PUBLIC_URL + `/flags/${code}.png`}
                alt={code}
                onError={e => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = process.env.PUBLIC_URL + '/COSPPaC_white_crop2.png';
                    e.currentTarget.style.objectFit = 'contain';
                    e.currentTarget.style.filter = 'invert(61%) sepia(32%) saturate(748%) hue-rotate(176deg) brightness(103%) contrast(96%)';
                }}
                style={{width:80,height:45,objectFit:'cover',marginRight:10,backgroundColor:'transparent'}}
                title={code}
            />
        );
    };

    return (
    <div className="dashboard-view d-flex flex-column" style={{height:'calc(100vh - 56px)',overflow:'hidden',background:'var(--color-background)',color:'var(--color-text)'}}>
            {/* Inline styles for overlay (could be moved to Dashboard.css) */}
            <style>{`
                .rtm-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.66); backdrop-filter: blur(6px); z-index: 1050; display: flex; align-items: center; justify-content: center; padding: 2rem; animation: rtmFade .25s ease; }
                @keyframes rtmFade { from { opacity: 0;} to { opacity: 1;} }
                .rtm-overlay-card { width: min(1400px, 95vw); height: min(85vh, 900px); background: var(--color-surface); color: var(--color-text); border-radius: 18px; box-shadow: 0 10px 40px -5px rgba(0,0,0,.55), 0 0 0 1px var(--color-border,#334155); display:flex; flex-direction:column; position:relative; animation: rtmPop .35s cubic-bezier(.34,1.56,.64,1); overflow:hidden; }
                @keyframes rtmPop { 0% { transform: scale(.92) translateY(12px); opacity:0;} 100% { transform: scale(1) translateY(0); opacity:1;} }
                .rtm-overlay-header { padding: .85rem 1.1rem; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--color-border,#334155); background: linear-gradient(135deg,var(--color-surface) 0%, rgba(255,255,255,0.02) 100%); }
                .rtm-overlay-title { font-weight:600; font-size:1rem; letter-spacing:.5px; display:flex; align-items:center; gap:.5rem; }
                .rtm-overlay-close { background: transparent; border: 1px solid var(--color-border,#475569); color: var(--color-text); width: 34px; height: 34px; border-radius: 8px; font-size: 1.25rem; line-height: 1; cursor:pointer; display:flex; align-items:center; justify-content:center; transition: all .18s ease; }
                .rtm-overlay-close:hover { background: var(--color-chart-bg,#1e293b); transform: rotate(90deg); }
                .rtm-overlay-body { flex:1; padding: .75rem .9rem 1rem; display:flex; }
                .rtm-overlay-body > div { flex:1; }
                .rtm-overlay-footer { padding: .4rem .9rem .65rem; border-top:1px solid var(--color-border,#334155); font-size:.7rem; text-align:right; opacity:.65; }
                @media (max-width: 900px) { .rtm-overlay-card { height: 90vh; width: 100vw; border-radius:14px; padding:0; } .rtm-overlay { padding: .75rem; } }
            `}</style>
            <div ref={controlsRef} className="dashboard-controls" style={{padding:'0.5rem 1rem',background:'var(--color-surface)',borderBottom:'1px solid var(--color-border, #dee2e6)',flexShrink:0}}>
                <div className="d-flex align-items-center gap-3">
                    <Button
                        variant="secondary"
                        onClick={handleBack}
                        className="btn-back-selection"
                        style={{border:'none'}}
                    >
                        <span className="icon-wrap"><FaArrowLeft size={12} style={{marginTop:-1}}/></span>
                        <span style={{position:'relative',top:1}}>Back to Selection</span>
                    </Button>
                    {renderLiveModeIndicator()}
                    <div className="data-limit-control d-flex align-items-center">
                        <span style={{fontSize:'0.875rem',marginRight:8}}>Data Points:</span>
                        <Form.Control type="number" value={dataLimit} onChange={handleLimitChange} min="1" max="1000" style={{width:70,height:30,fontSize:'0.875rem',padding:'0.25rem 0.5rem'}} />
                        <Button variant="outline-primary" size="sm" style={{marginLeft:10}} onClick={handleShare}>Share</Button>
                        {shareStatus && <span style={{marginLeft:6,fontSize:12}}>{shareStatus}</span>}
                    </div>
                </div>
            </div>
            <Container fluid className="dashboard-grid" style={{flex:1,overflow:'hidden',padding:'0 6px'}}>
                <Row className="g-0" style={{height:'100%',flexWrap:'wrap'}}>
                    {selectedStations.map((id, index) => {
                        const st = getStationDetails(id);
                        const active = st.is_active;
                        const code = st.country_short || '';
                        const n = selectedStations.length;
                        
                                                 // More sophisticated column logic based on total count and row position
                         let colClass;
                         if (n === 1) {
                             colClass = "col-12";
                         } else if (n === 2) {
                             colClass = "col-6";
                         } else if (n === 3) {
                             // 2 on top (col-6), 1 on bottom (col-8 centered)
                             colClass = index < 2 ? "col-6" : "col-8";
                         } else if (n === 4) {
                             colClass = "col-6"; // 2x2 grid
                         } else if (n === 5) {
                             // 3 on top (col-4), 2 on bottom (col-6)
                             colClass = index < 3 ? "col-4" : "col-6";
                         } else if (n === 6) {
                             colClass = "col-4"; // 3x2 grid
                         } else if (n === 7) {
                             // 4 on top (col-3), 3 on bottom (col-4)
                             colClass = index < 4 ? "col-3" : "col-4";
                         } else if (n === 8) {
                             colClass = "col-3"; // 4x2 grid
                         }
                        
                                                 return (
                             <Col key={id} className={colClass} style={{
                                 padding:'3px',
                                 height: n <= 2 ? '100%' : '50%',
                                 marginLeft: n === 3 && index === 2 ? 'auto' : undefined,
                                 marginRight: n === 3 && index === 2 ? 'auto' : undefined
                             }}>
                                <Card style={{background:'var(--color-surface)',color:'var(--color-text)',border:'1px solid var(--color-border,#e2e8f0)',height:'100%',display:'flex',flexDirection:'column'}}>
                                    <Card.Header className="d-flex justify-content-between align-items-center" style={{background:'var(--color-surface)',borderBottom:'1px solid var(--color-border,#e2e8f0)',padding:'0.5rem 0.75rem',flexShrink:0}}>
                                        <div className="d-flex align-items-center">
                                            {renderFlag(code)}
                                            <div>
                                                <FaWaveSquare className="me-2" />
                                                <strong>{st.label}</strong>
                                                <div className="small" style={{color:'var(--color-text)'}}>Last update: {new Date(chartData[id]?.lastUpdated || st.latest_date).toLocaleString()}</div>
                                            </div>
                                        </div>
                                        <Badge bg={active? 'success':'danger'}>{active?'Active':'Inactive'}</Badge>
                                    </Card.Header>
                                    <Card.Body className="d-flex flex-column p-0" style={{background:'var(--color-surface)',flex:1,overflow:'hidden',minHeight:0}}>
                                        <div className="chart-container" onDoubleClick={() => handleExpand(id)} style={{flex:1,width:'100%',height:'100%',overflow:'hidden',minHeight:0}} title="Double-click to expand">{renderChart(id)}</div>
                                   {/* ^^ ,cursor:'zoom-in' */}
                                    </Card.Body>
                                </Card>
                            </Col>
                        );
                    })}
                </Row>
            </Container>
            {expandedStationId && (
                <div className="rtm-overlay" onClick={e => { if (e.target.classList.contains('rtm-overlay')) handleCloseExpand(); }}>
                    <div className="rtm-overlay-card">
                        <div className="rtm-overlay-header">
                            <div className="rtm-overlay-title">
                                {getStationDetails(expandedStationId)?.label || expandedStationId}
                            </div>
                            <button type="button" className="rtm-overlay-close" onClick={handleCloseExpand} aria-label="Close expanded chart">×</button>
                        </div>
                        <div className="rtm-overlay-body">
                            {renderChart(expandedStationId)}
                        </div>
                        <div className="rtm-overlay-footer">
                            <small>Double-click charts to expand. Press Esc or click outside to close.</small>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
