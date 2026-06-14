// SuitabilityPDFExporter.js
// Generates a vessel suitability advisory PDF from the current widget state.
//
// Pages produced:
//   1. Executive advisory — backend-rendered overall map + vessel status cards
//   2. Location advisory table + next safe windows + 72h sparkline bars
//   3. Four-vessel comparison — real rendered PNG maps from zarr-api
//   4. Forecast timeline — selected vessel at 6 daily timesteps
//   5. Forecast trend chart — multi-vessel warning % over 72 h
//   6. Methodology & transparency — model, thresholds, data sources, limitations
//
// Map images for Pages 3 & 4 come from:
//   GET /niue/suitability/operational-map/{vessel}/{time_index}
// Honest dissolved polygons — no smoothing, no clipping, all classes visible.
//
// Dependencies: jspdf (dynamic import), html2canvas (dynamic import fallback)

const VESSEL_CLASSES = [
  { code: 'traditional_craft',          label: 'Traditional',    short: 'Trad.', initials: 'TRAD' },
  { code: 'very_small_motorised_craft', label: 'Very Small Motor', short: 'VSM',   initials: 'VSM'  },
  { code: 'small_craft',                label: 'Small Craft',    short: 'SC',    initials: 'SC'   },
  { code: 'larger_vessels',             label: 'Larger Vessels', short: 'LV',    initials: 'LV'   },
];

// Unified palette — matches the operational-map backend exactly.
const HAZARD = {
  suitable: '#2A9D8F',
  caution:  '#F4A261',
  avoid:    '#E76F51',
};

const HAZARD_META = {
  0: { label: 'Suitable', key: 'suitable', light: [220, 243, 240], text: [25,   94,  89]  },
  1: { label: 'Caution',  key: 'caution',  light: [255, 249, 196], text: [150,  95,  10]  },  // more yellow vs avoid
  2: { label: 'Avoid',    key: 'avoid',    light: [255, 215, 210], text: [185,  35,  35]  },  // more red vs caution
};

const PAGE_BG   = [248, 249, 250];
const HEADER_BG = [30,  58,  138];
const TEXT_LT   = [255, 255, 255];
const TEXT_MD   = [66,  66,  66];
const TEXT_DK   = [33,  33,  33];
const GRID_CLR  = [224, 224, 224];

// ── Helpers ───────────────────────────────────────────────────────────────────

function setFill(doc, rgb)   { doc.setFillColor(...rgb); }
function setDraw(doc, rgb)   { doc.setDrawColor(...rgb); }
function setFont(doc, rgb, size, style = 'normal') {
  doc.setTextColor(...rgb);
  doc.setFontSize(size);
  doc.setFont('helvetica', style);
}

function rect(doc, x, y, w, h, fill, draw, lw = 0.1) {
  setFill(doc, fill);
  if (draw) { setDraw(doc, draw); doc.setLineWidth(lw); }
  doc.rect(x, y, w, h, draw ? 'FD' : 'F');
}

function hexToRgb(hex) {
  const raw = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(raw.slice(i, i + 2), 16));
}

function hazardColor(h) {
  const key = HAZARD_META[h]?.key ?? HAZARD_META[0].key;
  return hexToRgb(HAZARD[key]);
}
function hazardLight(h) { return HAZARD_META[h]?.light   ?? HAZARD_META[0].light; }
function hazardText(h)  { return HAZARD_META[h]?.text    ?? HAZARD_META[0].text;  }
function hazardLabel(h) { return HAZARD_META[h]?.label   ?? 'Unknown'; }

function drawFailurePanel(doc, x, y, w, h, title, detail = '') {
  rect(doc, x, y, w, h, [255, 248, 235], hazardColor(1), 0.45);
  setFont(doc, hazardColor(2), Math.min(8, Math.max(5.5, h * 0.15)), 'bold');
  doc.text(`⚠ ${title}`, x + w / 2, y + h * 0.45, { align: 'center' });
  if (detail) {
    setFont(doc, hazardText(1), Math.min(6.5, Math.max(4.5, h * 0.11)));
    doc.text(detail, x + w / 2, y + h * 0.62, { align: 'center' });
  }
}

function drawVesselFallbackIcon(doc, x, y, vc, size = 9) {
  const initials = vc?.initials ?? 'VES';
  rect(doc, x, y, size, size, [238, 244, 246], [150, 165, 175], 0.25);
  setFont(doc, TEXT_DK, initials.length > 3 ? 4.2 : 5.2, 'bold');
  doc.text(initials, x + size / 2, y + size * 0.62, { align: 'center' });
}

// SVG colour per hazard class: green=suitable, yellow=caution, red=avoid
const HAZARD_ICON_COLOR = { 0: 'green', 1: 'yellow', 2: 'red' };

async function loadVesselSvgIcon(vesselCode, hazardClass) {
  const color = HAZARD_ICON_COLOR[hazardClass] ?? 'green';
  const base  = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  const src   = `${base}/vessels/${vesselCode}_${color}.svg`;
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const svgText = await res.text();
    const blob    = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const objUrl  = URL.createObjectURL(blob);
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        // Rasterise at 2× SVG natural size for crisp print output
        const canvas = document.createElement('canvas');
        canvas.width  = 576;   // 2 × 288
        canvas.height = 192;   // 2 × 96
        canvas.getContext('2d').drawImage(img, 0, 0, 576, 192);
        URL.revokeObjectURL(objUrl);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => { URL.revokeObjectURL(objUrl); resolve(null); };
      img.src = objUrl;
    });
  } catch { return null; }
}

function formatUtcTiny(dateLike) {
  const d   = new Date(dateLike);
  const dd  = String(d.getUTCDate()).padStart(2, '0');
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const hh  = String(d.getUTCHours()).padStart(2, '0');
  const mm  = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd} ${mon} ${hh}:${mm} UTC`;
}

// Niue local date label: UTC-11, so display the local calendar day at a given UTC time.
function formatDayLocal(dateLike) {
  const d = new Date(new Date(dateLike).getTime() - 11 * 3600 * 1000);
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${DAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2,'0')} ${MONS[d.getUTCMonth()]}`;
}

function domainHazard(warn, caution) {
  if (warn >= 20) return 2;              // significant Avoid coverage warrants AVOID advisory
  if (warn > 0 || caution > 0) return 1; // any hazard → advisory flag
  return 0;
}

function outlookDurationHours(timeSeriesData = []) {
  if (!timeSeriesData.length) return null;
  const first = new Date(timeSeriesData[0]?.time).getTime();
  const last = new Date(timeSeriesData[timeSeriesData.length - 1]?.time).getTime();
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return null;
  return Math.round((last - first) / 36e5);
}

function outlookLabel(timeSeriesData = []) {
  const hours = outlookDurationHours(timeSeriesData);
  if (!hours) return 'forecast';
  if (hours >= 70 && hours <= 74) return '72-hour';
  if (hours < 48) return `${hours}-hour`;
  return `${Math.round(hours / 24)}-day`;
}

// Infer model output interval from the first two timestep strings.
function inferStepHours(timestepsList = []) {
  if (timestepsList.length < 2) return 1;
  const t0 = new Date(timestepsList[0]).getTime();
  const t1 = new Date(timestepsList[1]).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return 1;
  return (t1 - t0) / 3_600_000;
}

function formatRunId(runId) {
  if (!runId) return null;
  // 8-digit YYYYMMDDHH compact format → "2024-01-05 12:00 UTC"
  const m = String(runId).match(/^(\d{4})(\d{2})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:00 UTC`;
  // ISO 8601 string (e.g. "2024-01-05T12:00:00") — first timestep from tsMeta
  const dt = new Date(runId);
  if (!isNaN(dt.getTime())) return dt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  return null;
}

function vesselOutlookSentence(vc, vessels, timeSeriesData = []) {
  const current = vessels?.[vc.code] ?? {};
  const warnNow    = current.warning_percent  ?? 0;
  const cautionNow = current.caution_percent ?? 0;
  const avoidRounded = Math.round(warnNow);

  if (warnNow >= 99.5) return 'Do not depart. All modelled waters are Avoid now.';
  if (warnNow >= 80)   return `Do not depart. Avoid conditions dominate most waters (${avoidRounded}% Avoid).`;
  if (warnNow >= 50)   return `Avoid departure unless operating under formal safety controls (${avoidRounded}% Avoid).`;
  if (warnNow >= 20)   return `Significant Avoid areas present; avoid exposed waters (${avoidRounded}% Avoid).`;
  if (warnNow >= 0.5) return `Isolated Avoid areas present; monitor route carefully (${avoidRounded}% Avoid).`;
  if (cautionNow >= 50) return `Operate with caution; marginal conditions widespread (${Math.round(cautionNow)}% Caution).`;
  if (cautionNow >= 10) return `Suitable conditions with ${Math.round(cautionNow)}% Caution areas — check specific route before departure.`;
  if (cautionNow > 0) return 'Conditions largely Suitable — minor caution areas present in parts of the domain.';
  return 'Conditions are fully Suitable across all modelled waters.';
}

function vesselOutlookMarkers(vc, timeSeriesData = []) {
  if (!timeSeriesData.length) return [];

  const avoidAt = step => step.vessels?.[vc.code]?.warning_percent ?? 0;
  const markers = [];
  const pushMarker = (index, label, color) => {
    const safeIndex = Math.max(0, Math.min(timeSeriesData.length - 1, index));
    const existing = markers.find(m => m.index === safeIndex);
    if (existing) {
      if (!existing.label.includes(label)) existing.label += ` / ${label}`;
      return;
    }
    markers.push({ index: safeIndex, label, color });
  };

  const values = timeSeriesData.map(avoidAt);
  const peakIndex = values.reduce((best, value, index) => value > values[best] ? index : best, 0);
  const bestIndex = values.reduce((best, value, index) => value < values[best] ? index : best, 0);
  const afterPeak = values.slice(peakIndex + 1);

  pushMarker(0, 'Now', TEXT_DK);
  pushMarker(peakIndex, 'Peak Avoid', hazardColor(2));
  pushMarker(bestIndex, 'Best Window', hazardColor(0));

  if (afterPeak.length) {
    const recoveryOffset = afterPeak.reduce((best, value, index) => value < afterPeak[best] ? index : best, 0);
    const recoveryIndex = peakIndex + 1 + recoveryOffset;
    if (values[recoveryIndex] < values[peakIndex]) {
      pushMarker(recoveryIndex, 'Recovery', hazardColor(1));
    }
  }

  return markers.sort((a, b) => a.index - b.index);
}

function drawOutlookMarkers(doc, x, y, w, h, vc, timeSeriesData = [], { labelGap = 5.0, labelFontSize = 4.5 } = {}) {
  const markers = vesselOutlookMarkers(vc, timeSeriesData);
  const n = timeSeriesData.length;
  if (!markers.length || n < 1) return;

  // Pass 1 — draw lines and dots, clipped to strip bounds so they never
  // enter the sentence-text area above the strip.
  markers.forEach((marker) => {
    const mx = x + (n === 1 ? 0.5 : marker.index / (n - 1)) * w;
    const isNow = marker.label === 'Now' || marker.label.startsWith('Now /');
    setDraw(doc, marker.color);
    doc.setLineWidth(isNow ? 0.65 : 0.35);
    doc.line(mx, y, mx, y + h);
    setFill(doc, marker.color);
    doc.circle(mx, y + h / 2, isNow ? 0.85 : 0.60, 'F');
  });

  // Pass 2 — text labels below the strip only.
  // "Now" carries no information as a label (the line is enough); strip it.
  // Compound labels beginning with "Now / " have the prefix removed.
  const LABEL_Y = y + h + labelGap;
  const occupied = [];
  markers.forEach((marker) => {
    const rawLabel = marker.label === 'Now'          ? null
                   : marker.label.startsWith('Now / ') ? marker.label.slice(6)
                   : marker.label;
    if (!rawLabel) return;

    const mx = x + (n === 1 ? 0.5 : marker.index / (n - 1)) * w;
    const labelW = Math.min(28, Math.max(12, rawLabel.length * 2.2));
    let labelX = Math.max(x + labelW / 2, Math.min(x + w - labelW / 2, mx));

    for (const prev of occupied) {
      const minGap = (labelW + prev.w) / 2 + 4.0;
      if (Math.abs(labelX - prev.x) < minGap) {
        const nudgedRight = prev.x + minGap;
        labelX = nudgedRight > x + w - labelW / 2 ? prev.x - minGap : nudgedRight;
      }
    }
    labelX = Math.max(x + labelW / 2, Math.min(x + w - labelW / 2, labelX));
    occupied.push({ x: labelX, w: labelW });

    setFont(doc, marker.color, labelFontSize, 'bold');
    doc.text(rawLabel, labelX, LABEL_Y, { align: 'center' });
  });
}

function drawOutlookStrip(doc, x, y, w, h, vc, timeSeriesData = [], markerOptions = {}) {
  const n = timeSeriesData.length;
  rect(doc, x, y, w, h, [22, 27, 34]);
  setDraw(doc, GRID_CLR);
  doc.setLineWidth(0.15);
  doc.rect(x, y, w, h, 'S');

  if (n === 0) return;

  const barW = w / n;
  timeSeriesData.forEach((step, idx) => {
    const vd = step.vessels?.[vc.code] ?? {};
    const avoid = Math.max(0, Math.min(1, (vd.warning_percent ?? 0) / 100));
    const caution = Math.max(0, Math.min(1, ((vd.warning_percent ?? 0) + (vd.caution_percent ?? 0)) / 100));
    const bx = x + idx * barW;

    // Suitable base — teal, matching maps and legend
    setFill(doc, hazardColor(0));
    doc.rect(bx, y, Math.max(0.15, barW), h, 'F');
    if (caution > 0) {
      // Caution overlay — amber, matching maps and legend
      setFill(doc, hazardColor(1));
      const ch = h * caution;
      doc.rect(bx, y + h - ch, Math.max(0.15, barW), ch, 'F');
    }
    if (avoid > 0) {
      // Avoid overlay — coral, matching maps and legend
      setFill(doc, hazardColor(2));
      const ah = h * avoid;
      doc.rect(bx, y + h - ah, Math.max(0.15, barW), ah, 'F');
    }
  });

  drawOutlookMarkers(doc, x, y, w, h, vc, timeSeriesData, markerOptions);
}

// Shared map legend — three coloured squares with labels, centred on cx.
function drawSharedLegend(doc, cx, y) {
  const ITEMS = [
    { color: hazardColor(0), label: 'Suitable' },
    { color: hazardColor(1), label: 'Caution'  },
    { color: hazardColor(2), label: 'Avoid'    },
  ];
  const SQ = 2.8;
  const ITEM_W = 22;
  const totalW = ITEMS.length * ITEM_W;
  const x0 = cx - totalW / 2;
  ITEMS.forEach((item, i) => {
    const ix = x0 + i * ITEM_W;
    setFill(doc, item.color);
    doc.rect(ix, y - SQ / 2, SQ, SQ, 'F');
    setFont(doc, TEXT_MD, 6);
    doc.text(item.label, ix + SQ + 1.5, y + 0.8);
  });
}

// ── Fetch data ────────────────────────────────────────────────────────────────

const DEFAULT_SUITABILITY_BASE_URL = process.env.REACT_APP_SUITABILITY_BASE_URL || '/suitability';

function getLocalhostSuitabilityFallback() {
  if (typeof window === 'undefined') return null;

  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  return isLocalhost ? 'http://localhost:8000' : null;
}

function joinApiUrl(baseUrl, path) {
  return `${String(baseUrl || '').replace(/\/$/, '')}${path}`;
}

async function fetchJsonEndpoint(path, baseUrl, label) {
  const url = joinApiUrl(baseUrl, path);
  const res = await fetch(url);
  const contentType = res.headers.get('content-type') || '';
  const body = await res.text();

  if (!res.ok) {
    throw new Error(`${label} failed at ${url}: HTTP ${res.status}`);
  }

  if (!contentType.includes('application/json')) {
    const looksLikeHtml = body.trimStart().startsWith('<');
    throw new Error(
      `${label} returned ${looksLikeHtml ? 'HTML' : contentType || 'non-JSON'} from ${url}. ` +
      `Check suitabilityBaseUrl / reverse proxy routing.`
    );
  }

  return JSON.parse(body);
}

async function resolveSuitabilityApi(baseUrl) {
  const candidates = [];
  const addCandidate = (candidate) => {
    if (!candidates.includes(candidate)) candidates.push(candidate);
  };

  if (baseUrl) addCandidate(baseUrl);
  addCandidate(DEFAULT_SUITABILITY_BASE_URL);
  const localhostFallback = getLocalhostSuitabilityFallback();
  if (localhostFallback) addCandidate(localhostFallback);
  addCandidate('');

  const errors = [];
  for (const candidate of candidates) {
    try {
      const timesteps = await fetchJsonEndpoint(
        '/niue/suitability/timesteps',
        candidate,
        'Suitability timesteps'
      );
      return { baseUrl: candidate, timesteps };
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(`Unable to reach suitability API. Tried: ${candidates.join(', ')}. ${errors.join(' | ')}`);
}

async function fetchSummary(timeIndex, baseUrl) {
  return fetchJsonEndpoint(
    `/niue/suitability/summary/${timeIndex}`,
    baseUrl,
    `Suitability summary t${timeIndex}`
  );
}



// ── Capture map ───────────────────────────────────────────────────────────────

async function captureMap(mapElement) {
  const h2c = await import('html2canvas');
  const canvas = await h2c.default(mapElement, {
    useCORS:         true,
    allowTaint:      true,
    backgroundColor: '#0a1628',
    scale:           1.5,
    logging:         false,
    ignoreElements:  el => el.classList?.contains('leaflet-control'),
  });
  return canvas.toDataURL('image/jpeg', 0.88);
}

// ── Page 1 — Executive advisory ───────────────────────────────────────────────

async function drawPage1(doc, { mapDataUrl, summary, validTime, runId, selectedVessel = 'small_craft', timeSeriesData = [], vesselIcons = {} }) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  rect(doc, 0, 0, W, H, PAGE_BG);

  // ── Header ────────────────────────────────────────────────────────────────
  const HDR_H = 18;
  rect(doc, 0, 0, W, HDR_H, HEADER_BG);

  setFont(doc, TEXT_LT, 14, 'bold');
  doc.text('NIUE COASTAL WATERS', 5, HDR_H * 0.55);
  setFont(doc, TEXT_LT, 8.5);
  doc.text('MARINE VESSEL SUITABILITY ADVISORY', 5, HDR_H * 0.85);

  const validStr = validTime ? formatUtcTiny(validTime) : '—';
  setFont(doc, TEXT_LT, 8);
  doc.text(`Valid: ${validStr}`, W - 5, HDR_H * 0.55, { align: 'right' });
  setFont(doc, TEXT_LT, 7.5);
  const issuedStr1 = formatRunId(runId);
  doc.text(
    issuedStr1 ? `Issued: ${issuedStr1}  ·  SWAN  |  Page 1` : 'SWAN  |  Page 1',
    W - 5, HDR_H * 0.85, { align: 'right' }
  );

  // ── Selected vessel badge (centre of header) ──────────────────────────────
  const vessels   = summary?.vessels ?? {};
  const vcKeys    = VESSEL_CLASSES.map(v => v.code);
  const overallHaz = Math.max(
    ...vcKeys.map(vc => domainHazard(vessels[vc]?.warning_percent ?? 0, vessels[vc]?.caution_percent ?? 0))
  );
  const vesselVc    = VESSEL_CLASSES.find(vc => vc.code === selectedVessel);
  const vesselLabel = vesselVc?.label ?? selectedVessel.replaceAll('_', ' ');
  const selectedData = vessels[selectedVessel] ?? {};
  const selectedHaz  = domainHazard(selectedData.warning_percent ?? 0, selectedData.caution_percent ?? 0);

  const badgeW = 60, badgeX = W / 2 - badgeW / 2;
  setFill(doc, hazardColor(selectedHaz));
  doc.roundedRect(badgeX, 1.5, badgeW, HDR_H - 3, 1.5, 1.5, 'F');
  setFont(doc, [255, 255, 255], 8, 'bold');
  doc.text(
    `${vesselLabel.toUpperCase()} — ${hazardLabel(selectedHaz).toUpperCase()}`,
    W / 2, HDR_H * 0.68, { align: 'center' }
  );

  // ── Summary sentence strip ────────────────────────────────────────────────
  // Light hazard-tinted band: one sentence describing the selected vessel outlook.
  const SUM_H = 10;
  const SUM_Y = HDR_H;
  rect(doc, 0, SUM_Y, W, SUM_H, hazardLight(selectedHaz));
  const selectedAvoid   = Math.round(selectedData.warning_percent   ?? 0);
  const selectedCaution = Math.round(selectedData.caution_percent   ?? 0);
  const page1Finding = (() => {
    if (!summary || !vesselVc) {
      return !summary
        ? 'Forecast summary unavailable — vessel percentages and drivers could not be loaded.'
        : 'Suitability data unavailable for selected vessel.';
    }
    if (selectedAvoid >= 20)   return `${vesselLabel} faces ${selectedAvoid}% Avoid waters — check conditions before departure.`;
    if (selectedCaution >= 20) return `${vesselLabel} is mostly operable, but ${selectedCaution}% of waters require caution.`;
    if (selectedCaution > 0) {
      return overallHaz > selectedHaz
        ? `${vesselLabel} suitable with minor caution zones — smaller vessel classes face greater restrictions.`
        : `${vesselLabel} has mostly Suitable conditions — ${selectedCaution}% of waters are Caution.`;
    }
    return overallHaz > selectedHaz
      ? `All modelled waters are Suitable for ${vesselLabel} — restrictions apply for smaller vessel classes.`
      : `All modelled waters are Suitable for ${vesselLabel} — safe conditions for departure.`;
  })();
  const summaryText = page1Finding;
  setFont(doc, summary ? hazardText(selectedHaz) : hazardColor(2), 8, 'bold');
  doc.text(summaryText, W / 2, SUM_Y + SUM_H * 0.64, { align: 'center' });

  // ── Layout constants ──────────────────────────────────────────────────────
  const COND_H   = 11;
  const FOOT_H   = 6;
  const MAP_Y    = SUM_Y + SUM_H + 1.5;
  const MAP_W    = W * 0.60;
  const PAGE_BTM = H - COND_H - FOOT_H - 1;   // hard bottom limit for map + cards
  const MAP_H    = PAGE_BTM - MAP_Y;            // total right+left height band
  const IMG_H    = MAP_H - 6;                   // 6 mm reserved for caption + legend
  const CARD_X0  = MAP_W + 4;
  const CARD_W   = W - CARD_X0 - 3;
  const CARD_GAP = 2.5;
  const FLEET_H  = 8;                           // reserved for secondary fleet note
  // CARD_H is clamped so all 4 cards + 3 gaps + fleet note always fit within MAP_H
  const CARD_H   = Math.min(38, Math.max(18, (MAP_H - FLEET_H - CARD_GAP * 3) / 4));
  const BAR_H    = Math.max(5, CARD_H * 0.21);  // thick status bar height

  // ── Map ───────────────────────────────────────────────────────────────────
  if (mapDataUrl) {
    setDraw(doc, [200, 200, 200]);
    doc.setLineWidth(0.5);
    doc.rect(2.5, MAP_Y - 0.5, MAP_W - 3, IMG_H + 1, 'S');
    const mapFormat = mapDataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
    doc.addImage(mapDataUrl, mapFormat, 3, MAP_Y, MAP_W - 4, IMG_H, 'p1_advisory_map', 'FAST');
  } else {
    drawFailurePanel(
      doc,
      3,
      MAP_Y,
      MAP_W - 4,
      IMG_H,
      'Map data unavailable for this panel',
      'Map unavailable - data could not be loaded'
    );
  }
  // Caption and shared legend below map image
  setFont(doc, TEXT_MD, 6, 'italic');
  doc.text(`${vesselLabel} — current conditions`, 5, MAP_Y + IMG_H + 3);
  drawSharedLegend(doc, MAP_W / 2, MAP_Y + IMG_H + 4.5);

  // ── Vessel data cards (right column) ─────────────────────────────────────
  // Each card: vessel name + Avoid% | HAZARD label + Caution% | thick status bar
  for (let ci = 0; ci < VESSEL_CLASSES.length; ci++) {
    const vc    = VESSEL_CLASSES[ci];
    const vdata = vessels[vc.code] ?? {};
    const warn  = vdata.warning_percent  ?? 0;
    const caut  = vdata.caution_percent  ?? 0;
    const haz   = domainHazard(warn, caut);
    const cy    = MAP_Y + ci * (CARD_H + CARD_GAP);

    // Layout assertion: skip card if it would overflow the bottom limit
    if (cy + CARD_H > PAGE_BTM + 0.5) break;

    // Card background — white with full-saturation hazard accent bar on left edge
    setFill(doc, [255, 255, 255]);
    setDraw(doc, hazardColor(haz));
    doc.setLineWidth(0.6);
    doc.roundedRect(CARD_X0, cy, CARD_W, CARD_H, 2, 2, 'FD');
    setFill(doc, hazardColor(haz));
    doc.rect(CARD_X0, cy + 1, 3.5, CARD_H - 2, 'F');

    // Vessel icon — SVG rasterised at hazard colour; fallback to initials box
    const ICON_W = 11;   // mm — kept small so it accents, not dominates
    const ICON_H = 4.0;  // mm
    const ICON_X = CARD_X0 + 6;
    const ICON_Y = cy + 1.5;
    const icon   = vesselIcons[vc.code];
    if (icon) {
      doc.addImage(icon, 'PNG', ICON_X, ICON_Y, ICON_W, ICON_H, 'vessel_icon_' + vc.code, 'FAST');
    } else {
      drawVesselFallbackIcon(doc, ICON_X, ICON_Y, vc, ICON_H);
    }
    const LABEL_X = ICON_X + ICON_W + 3;   // text column starts just right of icon

    // Row 1: vessel name (left) + Avoid % (right)
    const row1Y = cy + CARD_H * 0.24;
    setFont(doc, hazardText(haz), 8.5, 'bold');
    doc.text(vc.label, LABEL_X, row1Y);
    setFont(doc, hazardColor(haz), 8, 'bold');
    doc.text(`${Math.round(warn)}% Avoid`, CARD_X0 + CARD_W - 3.5, row1Y, { align: 'right' });

    // Row 2: HAZARD status (left, large) + Caution % (right, muted)
    const row2Y = cy + CARD_H * 0.50;
    setFont(doc, hazardColor(haz), 10, 'bold');
    doc.text(hazardLabel(haz).toUpperCase(), LABEL_X, row2Y);
    setFont(doc, TEXT_MD, 7);
    doc.text(`${Math.round(caut)}% Caution`, CARD_X0 + CARD_W - 3.5, row2Y, { align: 'right' });

    // Thick status bar at bottom of card
    // Layout: [Avoid (coral)] [Caution (amber)] [Suitable (teal)] — left to right
    const barY     = cy + CARD_H - BAR_H - 1;
    const barX     = CARD_X0 + 2;
    const barW     = CARD_W - 4;
    const warnFrac = Math.min(1, warn / 100);
    const cautFrac = Math.min(1 - warnFrac, caut / 100);

    setFill(doc, hazardColor(0));  // teal base (suitable)
    doc.roundedRect(barX, barY, barW, BAR_H, 1.5, 1.5, 'F');
    if (warnFrac + cautFrac > 0) {
      setFill(doc, hazardColor(1));  // amber: caution + avoid zone
      doc.roundedRect(barX, barY, barW * (warnFrac + cautFrac), BAR_H, 1.5, 1.5, 'F');
    }
    if (warnFrac > 0) {
      setFill(doc, hazardColor(2));  // coral: avoid zone
      doc.roundedRect(barX, barY, barW * warnFrac, BAR_H, 1.5, 1.5, 'F');
    }
  }

  // Fleet advisory note (secondary): only shown when fleet status is worse than selected vessel
  if (overallHaz > selectedHaz) {
    const noteY = MAP_Y + 4 * (CARD_H + CARD_GAP) + 1;
    if (noteY + FLEET_H - 1 <= PAGE_BTM) {
      setFill(doc, hazardLight(overallHaz));
      setDraw(doc, hazardColor(overallHaz));
      doc.setLineWidth(0.4);
      doc.roundedRect(CARD_X0, noteY, CARD_W, FLEET_H - 1, 1.5, 1.5, 'FD');
      setFont(doc, hazardText(overallHaz), 6.5, 'bold');
      doc.text(
        `Fleet advisory: ${hazardLabel(overallHaz).toUpperCase()} for most sensitive vessel classes`,
        CARD_X0 + CARD_W / 2, noteY + (FLEET_H - 1) * 0.62, { align: 'center' }
      );
    }
  }

  // ── Conditions bar ────────────────────────────────────────────────────────
  const COND_Y = PAGE_BTM + 1;
  rect(doc, 2.5, COND_Y, W - 5, COND_H, HEADER_BG);

  const maxWind  = Math.max(...vcKeys.map(vc => vessels[vc]?.max_wind_kt ?? 0));
  const waveVals = vcKeys.map(vc => vessels[vc]?.max_wave_height_m).filter(v => Number.isFinite(v) && v > 0);
  const maxWave  = waveVals.length ? Math.max(...waveVals) : 0;
  const hazardedKeys = vcKeys.filter(vc =>
    domainHazard(vessels[vc]?.warning_percent ?? 0, vessels[vc]?.caution_percent ?? 0) > 0
  );
  const drivers = hazardedKeys.map(vc => vessels[vc]?.main_driver ?? 'none');
  const mainDriver = drivers.length
    ? drivers.sort((a, b) => drivers.filter(d => d === b).length - drivers.filter(d => d === a).length)[0]
    : 'none';
  const driverLabel = { none: 'None', wind: 'Wind', waves: 'Waves', wind_and_waves: 'Wind + Waves' }[mainDriver] ?? mainDriver;

  // Fleet advisory badge — right side of bar
  const badgeLabel = `Fleet: ${hazardLabel(overallHaz).toUpperCase()}`;
  const fleetBadgeW = 30;
  setFill(doc, hazardColor(overallHaz));
  doc.roundedRect(W - fleetBadgeW - 5, COND_Y + 1.5, fleetBadgeW, COND_H - 3, 1.5, 1.5, 'F');
  setFont(doc, [255, 255, 255], 7, 'bold');
  doc.text(badgeLabel, W - 5 - fleetBadgeW / 2, COND_Y + COND_H * 0.55, { align: 'center' });
  setFont(doc, [220, 232, 248], 5.5);
  doc.text(hazardLabel(overallHaz) === 'Suitable' ? 'All classes' : 'most sensitive class', W - 5 - fleetBadgeW / 2, COND_Y + COND_H * 0.82, { align: 'center' });

  // Conditions — two-line layout: values + driver
  setFont(doc, TEXT_LT, 8.5, 'bold');
  doc.text(
    `Wind up to ${maxWind.toFixed(0)} kt   ·   Seas up to ${maxWave.toFixed(1)} m`,
    (W - fleetBadgeW - 5) / 2 + 2.5, COND_Y + COND_H * 0.40, { align: 'center' }
  );
  setFont(doc, [180, 200, 235], 6.5);
  doc.text(
    `Primary driver: ${driverLabel}`,
    (W - fleetBadgeW - 5) / 2 + 2.5, COND_Y + COND_H * 0.80, { align: 'center' }
  );

  // ── Footer ────────────────────────────────────────────────────────────────
  setFont(doc, TEXT_MD, 5.5, 'italic');
  doc.text(
    'SWAN wave model guidance — mesh resolution may not capture all local sea state variability. Use alongside official warnings.',
    W / 2, H - 2.5, { align: 'center' }
  );
}

// ── Page 2 — Location table + next windows + sparkline bar chart ───────────

async function drawPage2(doc, { summary, validTime, runId, timeSeriesData, vesselIcons = {} }) {
  doc.addPage();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  rect(doc, 0, 0, W, H, PAGE_BG);

  const HDR_H = 18;
  rect(doc, 0, 0, W, HDR_H, HEADER_BG);

  setFont(doc, TEXT_LT, 14, 'bold');
  doc.text('LOCATION / VESSEL OUTLOOK', 5, HDR_H * 0.55);
  setFont(doc, TEXT_LT, 8.5);
  doc.text(`${outlookLabel(timeSeriesData)} vessel suitability outlook for Niue coastal waters`, 5, HDR_H * 0.85);

  const validStr = validTime ? new Date(validTime).toUTCString().replace('GMT','UTC') : '-';
  setFont(doc, TEXT_LT, 8);
  doc.text(`Valid: ${validStr}`, W - 5, HDR_H * 0.55, { align: 'right' });
  setFont(doc, TEXT_LT, 7.5);
  const issuedStr2 = formatRunId(runId);
  doc.text(
    issuedStr2 ? `Issued: ${issuedStr2}  ·  SWAN  |  Page 2` : 'SWAN  |  Page 2',
    W - 5, HDR_H * 0.85, { align: 'right' }
  );

  const vessels = summary?.vessels ?? {};
  const overallHaz = Math.max(
    ...VESSEL_CLASSES.map(vc => domainHazard(
      vessels[vc.code]?.warning_percent ?? 0,
      vessels[vc.code]?.caution_percent ?? 0,
    ))
  );

  const MSG_Y = HDR_H + 7;
  const p2Headline = (() => {
    if (!summary) return 'Forecast summary unavailable - outlook rows may be incomplete.';
    const avoid0 = vessels[VESSEL_CLASSES[0].code]?.warning_percent ?? 0;  // Traditional
    const avoid3 = vessels[VESSEL_CLASSES[3].code]?.warning_percent ?? 0;  // Larger Vessels
    const suit3  = vessels[VESSEL_CLASSES[3].code]?.suitable_percent ?? 0;
    if (overallHaz === 0) return 'Conditions are suitable across all vessel classes — safe operating window currently open.';
    if (avoid0 >= 50 && suit3 >= 50) return 'High risk for small traditional vessels; larger vessels retain mostly suitable windows.';
    if (avoid0 >= 50 && avoid3 >= 50) return 'Elevated risk across all vessel classes — exercise caution; smaller vessels should avoid departure.';
    if (overallHaz === 1) return 'Cautionary conditions across the fleet — monitor forecasts closely before departure.';
    if (avoid0 >= 10 && suit3 >= 80) return 'Traditional craft face current Avoid conditions — conditions improve significantly for larger vessel classes.';
    return 'Smaller vessels should avoid most waters during high-risk periods; larger vessels retain more suitable windows.';
  })();
  setFont(doc, summary ? hazardColor(overallHaz) : hazardColor(2), 9.5, 'bold');
  doc.text(p2Headline, W / 2, MSG_Y, { align: 'center' });

  const ROW_X = 6.5;
  const ROW_W = W - 13;
  const ROW_H = 36;
  const GAP = 2.5;
  const STRIP_Y_OFFSET = 18;
  const STRIP_H = 10.5;
  const MARKER_LABEL_GAP = 3.0;
  let y = MSG_Y + 9;

  VESSEL_CLASSES.forEach((vc) => {
    const vd = vessels[vc.code] ?? {};
    const warn = vd.warning_percent ?? 0;
    const caution = vd.caution_percent ?? 0;
    const suitable = vd.suitable_percent ?? 0;
    const haz = domainHazard(warn, caution);

    rect(doc, ROW_X, y, ROW_W, ROW_H, [245, 245, 245], GRID_CLR, 0.25);
    setFill(doc, hazardColor(haz));
    doc.roundedRect(ROW_X + 2.5, y + 3.5, 26, 9.5, 2, 2, 'F');
    setFont(doc, [255,255,255], 7.5, 'bold');
    doc.text(hazardLabel(haz).toUpperCase(), ROW_X + 15.5, y + 9.5, { align: 'center' });

    const icon2 = vesselIcons[vc.code];
    if (icon2) {
      doc.addImage(icon2, 'PNG', ROW_X + 31, y + 2, 18, 6.5, 'vessel_icon_' + vc.code, 'FAST');
    } else {
      drawVesselFallbackIcon(doc, ROW_X + 31, y + 3.1, vc, 7.2);
    }
    const TEXT_LEFT_X = ROW_X + 51;
    const TEXT_RIGHT_X = ROW_X + ROW_W - 4;
    const CURRENT_Y = y + 7;

    setFont(doc, TEXT_DK, 9.2, 'bold');
    doc.text(vc.label, TEXT_LEFT_X, CURRENT_Y);

    const currentText = `${Math.round(suitable)}% Suitable. | ${Math.round(caution)}% Caution. | ${Math.round(warn)}% Avoid`;
    setFont(doc, hazardText(haz), 6.3, 'bold');
    doc.text(currentText, TEXT_RIGHT_X, CURRENT_Y, { align: 'right' });

    setFont(doc, TEXT_MD, 6.4);
    const sentence = vesselOutlookSentence(vc, vessels, timeSeriesData);
    const sentenceLines = doc.splitTextToSize(sentence, ROW_W - 62);
    doc.text(sentenceLines.slice(0, 2), TEXT_LEFT_X, y + 13);

    drawOutlookStrip(
      doc,
      ROW_X + 31,
      y + STRIP_Y_OFFSET,
      ROW_W - 37,
      STRIP_H,
      vc,
      timeSeriesData,
      { labelGap: MARKER_LABEL_GAP, labelFontSize: 3.8 }
    );
    // Y-axis % labels: strip top, midpoint, bottom.
    setFont(doc, [150, 150, 150], 4.0);
    doc.text('100%', ROW_X + 30.2, y + STRIP_Y_OFFSET + 0.4, { align: 'right' });
    doc.text( '50%', ROW_X + 30.2, y + STRIP_Y_OFFSET + STRIP_H / 2 + 0.3, { align: 'right' });
    doc.text(  '0%', ROW_X + 30.2, y + STRIP_Y_OFFSET + STRIP_H - 0.2, { align: 'right' });
    y += ROW_H + GAP;
  });

  if (timeSeriesData?.length >= 2) {
    const n2 = timeSeriesData.length;
    const STRIP_X = ROW_X + 31;
    const STRIP_W = ROW_W - 37;
    const t0ms = new Date(timeSeriesData[0].time).getTime();
    const t1ms = new Date(timeSeriesData[n2 - 1].time).getTime();
    const tRangeMs = t1ms - t0ms;
    const TICK_Y = H - 14.5;
    const MONS_S = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // First and last endpoint labels
    setFont(doc, TEXT_MD, 5.5);
    doc.text(formatUtcTiny(timeSeriesData[0].time), STRIP_X, TICK_Y + 3.8);
    doc.text(formatUtcTiny(timeSeriesData[n2 - 1].time), STRIP_X + STRIP_W, TICK_Y + 3.8, { align: 'right' });

    // Daily midnight UTC tick marks between endpoints
    const firstMidnight = new Date(t0ms);
    firstMidnight.setUTCHours(0, 0, 0, 0);
    firstMidnight.setUTCDate(firstMidnight.getUTCDate() + 1);
    for (let d = firstMidnight.getTime(); d < t1ms; d += 86400000) {
      const xPos = STRIP_X + (d - t0ms) / tRangeMs * STRIP_W;
      if (xPos > STRIP_X + 14 && xPos < STRIP_X + STRIP_W - 14) {
        setDraw(doc, GRID_CLR);
        doc.setLineWidth(0.2);
        doc.line(xPos, TICK_Y, xPos, TICK_Y + 1.5);
        const dayD = new Date(d);
        setFont(doc, TEXT_MD, 4.5);
        doc.text(`${dayD.getUTCDate()} ${MONS_S[dayD.getUTCMonth()]}`, xPos, TICK_Y + 5, { align: 'center' });
      }
    }
  }

  // Sparkline legend — colored squares + labels (plain multi-space text collapses in PDF renderers)
  const LEGEND_ITEMS_P2 = [
    { color: hazardColor(0), label: 'Suitable' },
    { color: hazardColor(1), label: 'Caution'  },
    { color: hazardColor(2), label: 'Avoid'    },
  ];
  const SQ_SIZE = 3, LEGEND_ITEM_W = 26;
  let legendLx = 6.5;
  LEGEND_ITEMS_P2.forEach(item => {
    setFill(doc, item.color);
    doc.roundedRect(legendLx, H - 10.5, SQ_SIZE, SQ_SIZE, 0.6, 0.6, 'F');
    setFont(doc, TEXT_MD, 6.5, 'italic');
    doc.text(item.label, legendLx + SQ_SIZE + 2, H - 8);
    legendLx += LEGEND_ITEM_W;
  });
  setFont(doc, TEXT_MD, 6.0, 'italic');
  doc.text('Y-axis / strip height = % of modelled sea area in each class', legendLx + 2, H - 8);
  setFont(doc, TEXT_MD, 5.5, 'italic');
  doc.text('SWAN wave model guidance — mesh resolution may not capture all local sea state variability. Use alongside official warnings.', W / 2, H - 2.5, { align: 'center' });
}

// ── Fetch rendered map PNG from zarr-api ─────────────────────────────────────
// Uses the operational-map endpoint: honest dissolved polygons, all classes visible,
// no smoothing, no clipping. Labels/legend are off by default so the PDF layout
// controls those elements itself.

async function fetchMapImage(
  vessel,
  timeIndex,
  baseUrl,
  {
    width = 900,
    height = 650,
    dpi = 150,
    showLabels = false,
    showLegend = false,
    showClassBoundaries = true,
    viewRadiusKm = 45,
    lonMin = null,
    latMin = null,
    lonMax = null,
    latMax = null,
  } = {}
) {
  const params = new URLSearchParams({
    width,
    height,
    dpi,
    show_labels: showLabels,
    show_legend: showLegend,
    show_class_boundaries: showClassBoundaries,
    view_radius_km: viewRadiusKm,
    dissolve_classes: true,
  });
  // Explicit bbox overrides view_radius_km — all four Page 4 panels share the same
  // extent so the island appears at an identical scale and position in every frame.
  if (lonMin != null) params.set('lon_min', lonMin);
  if (latMin != null) params.set('lat_min', latMin);
  if (lonMax != null) params.set('lon_max', lonMax);
  if (latMax != null) params.set('lat_max', latMax);
  const url = `${baseUrl}/niue/suitability/operational-map/${vessel}/${timeIndex}?${params}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ── Smart timestep selection ──────────────────────────────────────────────────

async function fetchBestComparisonTimestep(baseUrl, startTimeIndex = 0) {
  try {
    const params = new URLSearchParams({ start_time_index: startTimeIndex });
    const res = await fetch(`${baseUrl}/niue/suitability/best-comparison-timestep?${params}`);
    if (!res.ok) return null;
    return res.json();           // { time_index, valid_time, contrast_score, vessels }
  } catch { return null; }
}

// ── Page 3 — Four-vessel comparison ──────────────────────────────────────────

async function drawPage3(doc, { baseUrl, timeIndex = 0, runId = null, validTime = null, domainBbox = null }) {
  doc.addPage();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  rect(doc, 0, 0, W, H, PAGE_BG);

  // Fetch the best-contrast timestep first
  const best = await fetchBestComparisonTimestep(baseUrl, timeIndex);
  const comparisonUnavailable = !best;
  const compTimeIndex = best?.time_index ?? timeIndex;
  const vessels  = best?.vessels ?? {};
  const validStr = best?.valid_time
    ? new Date(best.valid_time).toUTCString().replace('GMT', 'UTC')
    : '-';

  // Header
  const HDR_H = 18;
  rect(doc, 0, 0, W, HDR_H, HEADER_BG);

  setFont(doc, TEXT_LT, 14, 'bold');
  doc.text('SAME OCEAN - DIFFERENT RISK', 5, HDR_H * 0.55);
  setFont(doc, TEXT_LT, 8.5);
  doc.text('Suitability varies significantly by vessel class under identical sea conditions', 5, HDR_H * 0.85);
  setFont(doc, TEXT_LT, 8);
  doc.text(`Valid: ${validStr}`, W - 5, HDR_H * 0.55, { align: 'right' });
  setFont(doc, TEXT_LT, 7.5);
  const issuedStr3 = formatRunId(runId);
  doc.text(
    issuedStr3 ? `Issued: ${issuedStr3}  ·  SWAN  |  Page 3` : 'SWAN  |  Page 3',
    W - 5, HDR_H * 0.85, { align: 'right' }
  );
  drawSharedLegend(doc, W - 42, HDR_H + 4);

  // Amber notice: this page's timestep is chosen for contrast, not the current advisory time
  setFill(doc, hazardLight(1));
  setDraw(doc, hazardColor(1));
  doc.setLineWidth(0.4);
  doc.roundedRect(5, HDR_H + 8, W - 10, 5.5, 1.5, 1.5, 'FD');
  setFont(doc, [160, 90, 30], 6, 'bold');
  doc.text(
    comparisonUnavailable
      ? 'Comparison timestep unavailable - using current advisory timestep as fallback.'
      : `Same forecast moment: ${validStr} — selected for maximum vessel-class contrast.`,
    W / 2, HDR_H + 10.9, { align: 'center' }
  );

  // 2×2 grid layout — hoisted before fetch so slotAspect can set image dimensions.
  const MAP_Y0  = HDR_H + 21;
  const COLS    = 2;
  const MAP_W   = (W - 6) / COLS;
  const MAP_H   = (H - MAP_Y0 - 14) / 2;  // 14mm footer clearance prevents pill/disclaimer overlap
  const PILL_H  = 4.8;

  // Request images at the PDF panel slot aspect (W:slot_h ≈ 2:1) so the backend fills
  // the frame exactly with no letterbox bands and jsPDF embeds without any stretch.
  const slotAspect = MAP_W / (MAP_H - PILL_H - 1);
  const p3ImgW = 1100;
  const p3ImgH = Math.round(p3ImgW / slotAspect);

  // Fetch all 4 vessel maps in parallel using the best-contrast timestep.
  const mapImages = await Promise.all(
    VESSEL_CLASSES.map(vc => fetchMapImage(vc.code, compTimeIndex, baseUrl, {
      width: p3ImgW, height: p3ImgH, dpi: 220,
      showLabels: false, showLegend: false, showClassBoundaries: true, viewRadiusKm: 70,
      ...(domainBbox || {}),
    }))
  );

  // Image fills the full slot — no centering offset needed.
  const panelImgW = MAP_W;
  const panelImgH = MAP_H - PILL_H - 1;
  const panelImgYOffset = 0;

  VESSEL_CLASSES.forEach((vc, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const mx  = 2 + col * (MAP_W + 2);
    const my  = MAP_Y0 + row * (MAP_H + 4);

    // Compute dominant state early so the interior header strip can use the correct hazard colour.
    const vd = vessels[vc.code] ?? {};
    const pills = [
      { pct: vd.suitable_percent ?? 0, bg: hazardLight(0), fg: hazardColor(0), lbl: 'Suitable' },
      { pct: vd.caution_percent  ?? 0, bg: hazardLight(1), fg: hazardColor(1), lbl: 'Caution'  },
      { pct: vd.warning_percent  ?? 0, bg: hazardLight(2), fg: hazardColor(2), lbl: 'Avoid'    },
    ];
    const dominant    = pills.reduce((a, b) => a.pct >= b.pct ? a : b);
    const dominantHaz = dominant.lbl === 'Avoid' ? 2 : dominant.lbl === 'Caution' ? 1 : 0;

    // Fill the full panel slot (including any vertical letterbox bands) with ocean colour.
    setFill(doc, [221, 239, 243]);   // PRESENTATION_OCEAN = #DDEFF3
    doc.rect(mx, my, MAP_W, MAP_H - PILL_H - 1, 'F');

    if (mapImages[idx]) {
      doc.addImage(mapImages[idx], 'PNG', mx, my + panelImgYOffset, panelImgW, panelImgH, 'p3_map_' + vc.code, 'FAST');
    } else {
      drawFailurePanel(
        doc,
        mx,
        my + panelImgYOffset,
        panelImgW,
        panelImgH,
        'Map data unavailable for this panel',
        'Map unavailable - data could not be loaded'
      );
    }

    // Interior hazard-coloured header strip overlaid on the map top edge.
    const P3_HDR_H = 11;
    setFill(doc, hazardColor(dominantHaz));
    doc.rect(mx, my, MAP_W, P3_HDR_H, 'F');
    setFont(doc, [255, 255, 255], 8.5, 'bold');
    doc.text(vc.label, mx + 3, my + 7.2);
    setFont(doc, [255, 255, 255], 6);
    doc.text(`${Math.round(dominant.pct)}% ${dominant.lbl}`, mx + MAP_W - 3, my + 7.2, { align: 'right' });

    // Stat pills under each map — dominant pill uses full hazard colour for visual emphasis.
    const PILL_W = MAP_W / 3 - 1.2;
    const py     = my + MAP_H - PILL_H;

    pills.forEach((p, pi) => {
      const px         = mx + pi * (PILL_W + 1.2);
      const isDominant = p === dominant;
      setFill(doc, isDominant ? p.fg : p.bg);
      setDraw(doc, p.fg);
      doc.setLineWidth(isDominant ? 0.6 : 0.3);
      doc.roundedRect(px, py, PILL_W, PILL_H - 1, 1.0, 1.0, 'FD');
      setFont(doc, isDominant ? [255, 255, 255] : p.fg, 6.5, 'bold');
      doc.text(`${Math.round(p.pct)}% ${p.lbl}`, px + PILL_W / 2, py + (PILL_H - 1) * 0.68, { align: 'center' });
    });

    // Panel border
    setDraw(doc, [185, 200, 215]);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([], 0);
    doc.rect(mx, my, MAP_W, MAP_H, 'S');
  });

  // Footer — two lines: domain boundary note + model guidance disclaimer
  setFont(doc, TEXT_MD, 5.5);
  doc.text(
    'Dashed rectangle on each map = SWAN model domain boundary. No suitability classification is available outside this extent.',
    W / 2, H - 6, { align: 'center' }
  );
  setFont(doc, TEXT_MD, 5.5, 'italic');
  doc.text('SWAN wave model guidance — mesh resolution may not capture all local sea state variability. Use alongside official warnings.', W / 2, H - 2.5, { align: 'center' });
}

// ── Daily 06:00 local time step selector (Niue UTC-11 → 17:00 UTC) ────────────
// Returns up to nDays steps, one per calendar day, each closest to 17:00 UTC.

function selectDailyTimelineSteps(timeIndex, timeSeriesData, nDays = 6) {
  const TARGET_UTC_HOUR = 17; // 06:00 Niue local (UTC-11)
  const future = timeSeriesData
    .filter(s => s.time_index != null && s.time_index >= timeIndex)
    .sort((a, b) => a.time_index - b.time_index);
  if (!future.length) return [];
  const startTime = new Date(future[0].time);
  const steps = [];
  const seen  = new Set();
  for (let day = 1; day <= nDays; day++) {
    const target = new Date(startTime);
    target.setUTCDate(startTime.getUTCDate() + day);
    target.setUTCHours(TARGET_UTC_HOUR, 0, 0, 0);
    let best = null, bestDiff = Infinity;
    for (const s of future) {
      const diff = Math.abs(new Date(s.time).getTime() - target.getTime());
      if (diff < bestDiff) { bestDiff = diff; best = s; }
    }
    if (best && bestDiff < 4 * 3600 * 1000 && !seen.has(best.time_index)) {
      seen.add(best.time_index);
      steps.push({ time_index: best.time_index, role: 'daily', valid_time: best.time, available: true });
    } else {
      // No model output within 4 h of the target — day is beyond the forecast horizon.
      steps.push({ time_index: null, role: 'daily', valid_time: null, available: false, target_time: target.toISOString() });
    }
  }
  return steps;
}

// ── Page 4 — Forecast timeline ────────────────────────────────────────────────

async function drawPage4(doc, { baseUrl, selectedVessel = 'small_craft', timeIndex = 0, timeSeriesData = [], runId = null, domainBbox = null }) {
  doc.addPage();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  rect(doc, 0, 0, W, H, PAGE_BG);

  const VESSEL = selectedVessel;

  // Daily 06:00 Niue local time (= 17:00 UTC) schedule for the next 6 days.
  // Returns exactly 6 entries; beyond-horizon days have available: false.
  const stepMeta = selectDailyTimelineSteps(timeIndex, timeSeriesData, 6);
  const availableDayCount = stepMeta.filter(s => s.available !== false).length;

  const HDR_H = 18;
  rect(doc, 0, 0, W, HDR_H, HEADER_BG);
  setFont(doc, TEXT_LT, 14, 'bold');
  const vesselLabel = VESSEL_CLASSES.find(vc => vc.code === VESSEL)?.label ?? VESSEL.replaceAll('_', ' ');
  doc.text(`${vesselLabel.toUpperCase()} - FORECAST EVOLUTION`, 5, HDR_H * 0.55);
  setFont(doc, TEXT_LT, 8.5);
  const dayCountLabel = availableDayCount > 0 ? `${availableDayCount}-day` : 'forecast';
  doc.text(`Daily 06:00 Niue local time (17:00 UTC) — ${dayCountLabel} evolution`, 5, HDR_H * 0.85);
  setFont(doc, TEXT_LT, 7.5);
  const issuedStr4 = formatRunId(runId);
  doc.text(
    issuedStr4 ? `Issued: ${issuedStr4}  ·  SWAN  |  Page 4` : 'SWAN  |  Page 4',
    W - 5, HDR_H * 0.85, { align: 'right' }
  );

  // Fetch maps + summaries only for steps within the forecast horizon.
  // Placeholder entries (available: false) resolve to null without any network request.
  const p4DomainAspect = (() => {
    if (!domainBbox) return 1.78;  // fallback ≈ display slot ratio
    const latMidRad = ((domainBbox.latMin + domainBbox.latMax) / 2) * Math.PI / 180;
    const lonSpan = (domainBbox.lonMax - domainBbox.lonMin) * Math.cos(latMidRad);
    const latSpan = domainBbox.latMax - domainBbox.latMin;
    return lonSpan / latSpan;
  })();
  const p4FetchH = 900;
  const p4FetchW = Math.round(p4FetchH * p4DomainAspect);

  const [mapImages, summaries] = await Promise.all([
    Promise.all(stepMeta.map(meta =>
      meta.available !== false && meta.time_index != null
        ? fetchMapImage(VESSEL, meta.time_index, baseUrl, {
            width: p4FetchW, height: p4FetchH, dpi: 220,
            showLabels: false, showLegend: false, showClassBoundaries: true, viewRadiusKm: 30,
            ...(domainBbox || {}),
          })
        : Promise.resolve(null)
    )),
    Promise.all(stepMeta.map(meta =>
      meta.available !== false && meta.time_index != null
        ? fetchSummary(meta.time_index, baseUrl).catch(() => null)
        : Promise.resolve(null)
    )),
  ]);

  // Incomplete only if an *available* step failed to load — beyond-horizon placeholders are expected.
  const timelineIncomplete = availableDayCount < 1 ||
    stepMeta.some((meta, i) => meta.available !== false && !mapImages[i]);

  const trendInsight = describeForecastShape(timeSeriesData, VESSEL);
  const INSIGHT_H = trendInsight ? 7 : 0;
  if (trendInsight) {
    rect(doc, 5, HDR_H + 1.5, W - 10, INSIGHT_H - 1, [236, 242, 250], [190, 205, 225], 0.25);
    setFont(doc, trendInsight.color, 6.5, 'bold');
    doc.text(trendInsight.text, W / 2, HDR_H + INSIGHT_H * 0.78, { align: 'center' });
  }

  let noteBannerH = 0;
  if (timelineIncomplete) {
    noteBannerH = 9;
    drawFailurePanel(
      doc,
      5,
      HDR_H + INSIGHT_H + 2,
      W - 10,
      noteBannerH - 2,
      'Timeline incomplete',
      'One or more maps or forecast summaries could not be loaded'
    );
  }

  const MAP_Y0  = HDR_H + INSIGHT_H + (noteBannerH > 0 ? noteBannerH + 2 : 2);

  // Tiny pill-order legend — reader does not have to guess bar order
  setFont(doc, TEXT_MD, 5.8, 'italic');
  doc.text('Bottom bars: Suitable | Caution | Avoid', W - 3, MAP_Y0 - 1.2, { align: 'right' });

  const COLS    = 3;
  const ROWS    = 2;
  const H_GAP   = 3;   // horizontal gap between columns
  const V_GAP   = 4;   // vertical gap between rows
  const MARGIN   = 2;
  const FOOTER_H = 8;   // clearance for disclaimer line at page bottom
  const PILL_H   = 5.5;
  const MAP_W    = (W - MARGIN * 2 - H_GAP * (COLS - 1)) / COLS;
  const MAP_H    = (H - MAP_Y0 - FOOTER_H - V_GAP * (ROWS - 1)) / ROWS;

  // Image slot geometry: centre the domain-aspect image in each panel slot so jsPDF
  // scales without distortion. Any remaining width is filled with PRESENTATION_OCEAN.
  const p4PanelImgH = MAP_H - PILL_H - 2;
  const p4PanelImgW = Math.min(p4PanelImgH * p4DomainAspect, MAP_W);
  const p4ImgHOffset = (MAP_W - p4PanelImgW) / 2;

  stepMeta.forEach((meta, idx) => {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const mx  = MARGIN + col * (MAP_W + H_GAP);
    const my  = MAP_Y0 + row * (MAP_H + V_GAP);

    // ── Beyond-horizon placeholder panel ─────────────────────────────────────
    if (meta.available === false) {
      const targetLabel = meta.target_time ? formatDayLocal(meta.target_time).toUpperCase() : `DAY ${idx + 1}`;
      setFill(doc, PAGE_BG);
      doc.rect(mx, my, MAP_W, p4PanelImgH, 'F');
      setDraw(doc, GRID_CLR);
      doc.setLineWidth(0.4);
      doc.setLineDashPattern([1.8, 1.8], 0);
      doc.rect(mx, my, MAP_W, p4PanelImgH, 'S');
      doc.setLineDashPattern([], 0);
      setFont(doc, TEXT_MD, 5.5, 'italic');
      doc.text('Beyond forecast horizon', mx + MAP_W / 2, my + p4PanelImgH * 0.52, { align: 'center' });
      // Label chip (greyed out)
      setFill(doc, [200, 200, 210]);
      doc.roundedRect(mx + 1, my + 2.5, MAP_W - 2, 8, 1.5, 1.5, 'F');
      setFont(doc, TEXT_MD, 8, 'bold');
      doc.text(targetLabel, mx + MAP_W / 2, my + 6.8, { align: 'center' });
      setFont(doc, TEXT_MD, 5.5);
      doc.text('06:00 local · 17:00 UTC', mx + MAP_W / 2, my + 10.5, { align: 'center' });
      return;
    }

    // ── Normal panel ──────────────────────────────────────────────────────────
    const s  = summaries[idx];
    const vd = s?.vessels?.[VESSEL] ?? {};

    // Border frame spans the full slot; image is centred inside it.
    setDraw(doc, [200, 200, 200]);
    doc.setLineWidth(0.5);
    doc.rect(mx - 0.5, my - 0.5, MAP_W + 1, p4PanelImgH + 1, 'S');
    if (mapImages[idx]) {
      setFill(doc, [221, 239, 243]);   // PRESENTATION_OCEAN = #DDEFF3
      doc.rect(mx, my, MAP_W, p4PanelImgH, 'F');
      doc.addImage(mapImages[idx], 'PNG', mx + p4ImgHOffset, my, p4PanelImgW, p4PanelImgH, 'p4_map_' + String(meta.time_index), 'FAST');
    } else {
      drawFailurePanel(doc, mx, my, MAP_W, p4PanelImgH, 'Map data unavailable for this panel', 'Map unavailable - data could not be loaded');
    }

    // Timestep label: local day plus dominant suitability state for this daily panel.
    const stepTime = meta.valid_time ?? s?.valid_time;
    const dayLabel = stepTime ? formatDayLocal(stepTime).toUpperCase() : `DAY ${idx + 1}`;
    const dominantState = [
      { pct: vd.suitable_percent ?? 0, label: 'Suitable' },
      { pct: vd.caution_percent  ?? 0, label: 'Caution'  },
      { pct: vd.warning_percent  ?? 0, label: 'Avoid'    },
    ].reduce((a, b) => a.pct >= b.pct ? a : b);
    const headerLabel = `${dayLabel} - ${Math.round(dominantState.pct)}% ${dominantState.label}`;
    const dominantHaz4 = dominantState.label === 'Avoid' ? 2 : dominantState.label === 'Caution' ? 1 : 0;
    setFill(doc, hazardColor(dominantHaz4));
    doc.roundedRect(mx + 1, my + 2.5, MAP_W - 2, 8, 1.5, 1.5, 'F');
    setFont(doc, [255, 255, 255], headerLabel.length > 24 ? 6.7 : 7.4, 'bold');
    doc.text(headerLabel, mx + MAP_W / 2, my + 6.7, { align: 'center' });
    setFont(doc, [255, 255, 255], 5.3);
    doc.text('06:00 local · 17:00 UTC', mx + MAP_W / 2, my + 10.4, { align: 'center' });

    // Stat pills
    const pills = [
      { pct: vd.suitable_percent ?? 0, bg: hazardLight(0),  fg: hazardColor(0) },
      { pct: vd.caution_percent  ?? 0, bg: hazardLight(1),  fg: hazardColor(1) },
      { pct: vd.warning_percent  ?? 0, bg: hazardLight(2),  fg: hazardColor(2) },
    ];
    const py = my + MAP_H - PILL_H - 1;
    pills.forEach((p, pi) => {
      const pw = MAP_W / 3 - 0.6;
      const px = mx + pi * (pw + 0.6);
      setFill(doc, p.bg); setDraw(doc, p.fg); doc.setLineWidth(0.35);
      doc.roundedRect(px, py, pw, PILL_H, 1.2, 1.2, 'FD');
      setFont(doc, p.fg, 6.5, 'bold');
      doc.text(`${Math.round(p.pct)}%`, px + pw / 2, py + PILL_H * 0.68, { align: 'center' });
    });

  });

  setFont(doc, TEXT_MD, 5.8, 'italic');
  doc.text('SWAN wave model guidance — mesh resolution may not capture all local sea state variability. Use alongside official warnings.', W / 2, H - 2.5, { align: 'center' });
}

// ── Page 5 — Forecast trend chart ────────────────────────────────────────────

function describeForecastShape(timeSeriesData, vessel) {
  if (!timeSeriesData.length) return null;
  const avoidAt = s => s?.vessels?.[vessel]?.warning_percent ?? 0;
  const vesselLabel = VESSEL_CLASSES.find(vc => vc.code === vessel)?.label ?? vessel;
  const values = timeSeriesData.map(avoidAt);
  const n = values.length;
  const first = values[0];
  const last = values[n - 1];
  const peak = Math.max(...values);
  const peakIdx = values.indexOf(peak);
  const afterPeak = values.slice(peakIdx + 1);
  const highRiskPeriods = values.reduce((count, value, index) => {
    const wasBelowThreshold = index === 0 || values[index - 1] < 50;
    return value >= 50 && wasBelowThreshold ? count + 1 : count;
  }, 0);
  const hasRecovery = afterPeak.length > 0 && Math.min(...afterPeak) < peak - 20;
  const earlySlice = values.slice(1, Math.max(2, Math.floor(n * 0.25)));
  const hasBriefDip = first > 5 && earlySlice.some(v => v < first - 10);

  if (highRiskPeriods >= 2) {
    return { text: `${vesselLabel} conditions fluctuate between Caution and Avoid, with limited improvement between peaks.`, color: hazardColor(2) };
  }
  if (peak >= 80 && hasRecovery && hasBriefDip) {
    return { text: `${vesselLabel} conditions briefly improve, then deteriorate sharply to full Avoid before recovering later.`, color: hazardColor(2) };
  }
  if (peak >= 80 && hasRecovery) {
    return { text: `${vesselLabel} conditions deteriorate sharply to full Avoid before recovering later.`, color: hazardColor(2) };
  }
  if (peak >= 99.5) {
    return { text: `${vesselLabel} conditions deteriorate to full Avoid. No recovery within the forecast window.`, color: hazardColor(2) };
  }
  if (peak >= 80) {
    return { text: `${vesselLabel} conditions reach high-risk Avoid levels. No recovery within the forecast window.`, color: hazardColor(2) };
  }
  if (peak >= 40) {
    return { text: `${vesselLabel} conditions show elevated risk — peak Avoid reaches ${Math.round(peak)}%.`, color: hazardColor(1) };
  }
  if (last < first - 10) {
    return { text: `${vesselLabel} conditions improve through the forecast period.`, color: hazardColor(0) };
  }
  return { text: `${vesselLabel} conditions remain mostly suitable through the forecast period.`, color: hazardColor(0) };
}

async function drawPage5(doc, { selectedVessel = 'small_craft', timeIndex = 0, timeSeriesData = [], runId = null }) {
  doc.addPage();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  rect(doc, 0, 0, W, H, PAGE_BG);

  const VESSEL      = selectedVessel;
  const vesselLabel = VESSEL_CLASSES.find(vc => vc.code === VESSEL)?.label ?? VESSEL.replaceAll('_', ' ');

  // Recompute the same daily steps as page 4 so chart markers match panels exactly.
  const stepMeta = selectDailyTimelineSteps(timeIndex, timeSeriesData, 6);
  const STEPS    = stepMeta.length ? stepMeta.map(s => s.time_index) : [timeIndex];

  const HDR_H = 18;
  rect(doc, 0, 0, W, HDR_H, HEADER_BG);
  setFont(doc, TEXT_LT, 14, 'bold');
  doc.text(`${vesselLabel.toUpperCase()} - FORECAST TREND`, 5, HDR_H * 0.55);
  setFont(doc, TEXT_LT, 8.5);
  doc.text('Avoid % across the full forecast period — all vessel classes', 5, HDR_H * 0.85);
  setFont(doc, TEXT_LT, 7.5);
  const issuedStr5 = formatRunId(runId);
  doc.text(
    issuedStr5 ? `Issued: ${issuedStr5}  ·  SWAN  |  Page 5` : 'SWAN  |  Page 5',
    W - 5, HDR_H * 0.85, { align: 'right' }
  );

  // Chart geometry
  // CY is pushed down 16mm from header to give room for chart title + marker labels.
  const FOOT_H = 27;  // space for lower marker labels, recovery note, shape sentence + disclaimer
  const CX     = 16;  // left margin for Y-axis labels
  const CY     = HDR_H + 16;
  const CW     = W - CX - 6;
  const CH     = H - CY - FOOT_H;
  const n      = timeSeriesData.length;

  // Chart title
  setFont(doc, TEXT_MD, 7, 'bold');
  doc.text('Avoid % over forecast time', CX, CY - 12);

  // Legend (top right of chart title row)
  const SELECTED_COLOR = hazardColor(2);  // coral — plotting Avoid %
  const OTHER_COLOR    = [225, 225, 225];
  const legY = CY - 12;
  setDraw(doc, SELECTED_COLOR);
  doc.setLineWidth(1.8);
  doc.line(W - 72, legY, W - 62, legY);
  setFont(doc, TEXT_MD, 6);
  doc.text(vesselLabel, W - 60, legY + 1);
  setDraw(doc, OTHER_COLOR);
  doc.setLineWidth(0.7);
  doc.line(W - 43, legY, W - 33, legY);
  setFont(doc, TEXT_MD, 6, 'italic');
  doc.text('other vessels (faint)', W - 31, legY + 1);

  // Avoid-zone shaded band: above 50%
  const avoidBandY = CY + CH * 0.5;
  setFill(doc, hazardLight(2));
  doc.rect(CX, CY, CW, avoidBandY - CY, 'F');

  // Chart border
  setDraw(doc, GRID_CLR);
  doc.setLineWidth(0.25);
  doc.rect(CX, CY, CW, CH, 'S');

  // Y-axis grid lines + labels
  for (const pct of [25, 50, 75, 100]) {
    const gy = CY + CH * (1 - pct / 100);
    setDraw(doc, GRID_CLR);
    doc.setLineWidth(pct === 50 ? 0.45 : 0.2);
    doc.line(CX, gy, CX + CW, gy);
    setFont(doc, TEXT_MD, 5.5);
    doc.text(`${pct}%`, CX - 1.5, gy + 1.5, { align: 'right' });
  }
  setFont(doc, TEXT_MD, 5.5);
  doc.text('0%', CX - 1.5, CY + CH + 1.5, { align: 'right' });

  // Right-side operational threshold labels describe Avoid coverage, not map classes.
  const rightLabels = [
    { pct: 35, label: 'significant Avoid', color: hazardColor(1) },
    { pct: 75, label: 'widespread Avoid',  color: hazardColor(2) },
  ];
  rightLabels.forEach(({ pct, label, color }) => {
    const gy = CY + CH * (1 - pct / 100);
    setFont(doc, color, 5.2, 'italic');
    const tw = doc.getTextWidth(label);
    // Thin dashed threshold guide line (stops just before label)
    setDraw(doc, [210, 210, 215]);
    doc.setLineWidth(0.12);
    doc.setLineDashPattern([2, 4], 0);
    doc.line(CX, gy, CX + CW - tw - 3.5, gy);
    doc.setLineDashPattern([], 0);
    // Background chip so label is always readable over data lines
    setFill(doc, PAGE_BG);
    doc.rect(CX + CW - tw - 3.2, gy - 4.2, tw + 2.8, 6.0, 'F');
    doc.text(label, CX + CW - 1.5, gy + 1.2, { align: 'right' });
  });

  // X-axis time labels with daily tick marks
  if (n >= 2) {
    const p5t0ms = new Date(timeSeriesData[0].time).getTime();
    const p5t1ms = new Date(timeSeriesData[n - 1].time).getTime();
    const p5tRange = p5t1ms - p5t0ms;
    const MONS_P5 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    setFont(doc, TEXT_MD, 5.5);
    doc.text(formatUtcTiny(timeSeriesData[0].time), CX, CY + CH + 5);
    doc.text(formatUtcTiny(timeSeriesData[n - 1].time), CX + CW, CY + CH + 5, { align: 'right' });

    const p5firstMidnight = new Date(p5t0ms);
    p5firstMidnight.setUTCHours(0, 0, 0, 0);
    p5firstMidnight.setUTCDate(p5firstMidnight.getUTCDate() + 1);
    for (let d = p5firstMidnight.getTime(); d < p5t1ms; d += 86400000) {
      const xPos = CX + (d - p5t0ms) / p5tRange * CW;
      if (xPos > CX + 14 && xPos < CX + CW - 14) {
        setDraw(doc, GRID_CLR);
        doc.setLineWidth(0.2);
        doc.line(xPos, CY + CH, xPos, CY + CH + 2);
        const dayD = new Date(d);
        setFont(doc, TEXT_MD, 5.0);
        doc.text(`${dayD.getUTCDate()} ${MONS_P5[dayD.getUTCMonth()]}`, xPos, CY + CH + 6, { align: 'center' });
      }
    }
  }

  // Plot lines — other vessels first (faint), selected vessel on top
  if (n >= 2) {
    for (const vc of VESSEL_CLASSES) {
      const isSelected = vc.code === VESSEL;
      setDraw(doc, isSelected ? SELECTED_COLOR : OTHER_COLOR);
      doc.setLineWidth(isSelected ? 2.0 : 0.22);
      let px0 = null, py0 = null;
      for (let si = 0; si < n; si++) {
        const w  = timeSeriesData[si]?.vessels?.[vc.code]?.warning_percent ?? 0;
        const px = CX + (CW / (n - 1)) * si;
        const py = CY + CH * (1 - Math.min(1, w / 100));
        if (px0 !== null) doc.line(px0, py0, px, py);
        px0 = px; py0 = py;
      }
    }
  }

  // Risk-window strip: one interval-label system for the full trend story.
  // Coral = high-risk period (Avoid ≥ 50%); muted green = recovery window.
  if (n >= 2) {
    const STRIP_Y = CY + CH - 4.2;
    const STRIP_H = 4.2;
    const avoidFn = s => s?.vessels?.[VESSEL]?.warning_percent ?? 0;
    const highFlags = timeSeriesData.map(s => avoidFn(s) >= 50);

    const highSegs = [];
    let wStart = null;
    for (let si = 0; si <= n; si++) {
      const isHigh = si < n && highFlags[si];
      if (isHigh && wStart === null) wStart = si;
      else if (!isHigh && wStart !== null) {
        highSegs.push({ start: wStart, end: si - 1 });
        wStart = null;
      }
    }

    // Opening suitable period — shown before the first high-risk window if the forecast
    // doesn't start at high risk (e.g., elevated seas arrive after day 1).
    if (highSegs.length > 0 && highSegs[0].start > 0) {
      const rx1 = CX;
      const rx2 = CX + (CW / (n - 1)) * highSegs[0].start;
      setFill(doc, [214, 239, 219]);
      doc.rect(rx1, STRIP_Y, Math.max(0.6, rx2 - rx1), STRIP_H, 'F');
      if (rx2 - rx1 > 20) {
        setFont(doc, [55, 130, 75], 4.2, 'bold');
        doc.text('SUITABLE PERIOD', (rx1 + rx2) / 2, STRIP_Y + 2.8, { align: 'center' });
      }
    }

    highSegs.forEach((seg, hi) => {
      const x1 = CX + (CW / (n - 1)) * seg.start;
      const x2 = CX + (CW / (n - 1)) * seg.end;
      const label = hi === highSegs.length - 1 && hi >= 2
        ? 'LATE RISK RETURN'
        : `HIGH-RISK PERIOD ${hi + 1}`;
      setFill(doc, hazardLight(2));
      doc.rect(x1, STRIP_Y, Math.max(0.6, x2 - x1), STRIP_H, 'F');
      if (x2 - x1 > 18) {
        setFont(doc, hazardColor(2), 4.2, 'bold');
        doc.text(label, (x1 + x2) / 2, STRIP_Y + 2.8, { align: 'center' });
      } else if (x2 - x1 > 3) {
        // Too narrow for inline label — draw a callout tick + readable label above the strip.
        const midX = (x1 + x2) / 2;
        setDraw(doc, hazardColor(2));
        doc.setLineWidth(0.4);
        doc.line(midX, STRIP_Y, midX, STRIP_Y - 4.5);
        setFont(doc, hazardColor(2), 4.5, 'bold');
        doc.text(`HR ${hi + 1}`, midX, STRIP_Y - 5.5, { align: 'center' });
      }

      if (hi < highSegs.length - 1) {
        const rx1 = x2;
        const rx2 = CX + (CW / (n - 1)) * highSegs[hi + 1].start;
        setFill(doc, [214, 239, 219]);
        doc.rect(rx1, STRIP_Y, Math.max(0.6, rx2 - rx1), STRIP_H, 'F');
        if (rx2 - rx1 > 20) {
          setFont(doc, [55, 130, 75], 4.2, 'bold');
          doc.text('RECOVERY WINDOW', (rx1 + rx2) / 2, STRIP_Y + 2.8, { align: 'center' });
        }
      }
    });
  }

  // Page 4 selected moments: quiet reference markers, secondary to interval labels.
  const MARKER_COLOR = [95, 95, 160];
  const CLOSE_MARKER_MS = 3 * 36e5;
  const usedMomentLabels = new Set();
  const momentLabel = (role, value, validTimeStr) => {
    if (role === 'daily') return formatDayLocal(validTimeStr).toUpperCase();
    return ({
      current:               'CURRENT',
      high_risk_peak:        'HIGH RISK PEAK',
      temporary_improvement: 'BRIEF WINDOW',
      recovery:              'RECOVERY',
      best_window:           'BRIEF WINDOW',
      deteriorating:         value >= 50 ? 'HIGH RISK PEAK' : 'RISK RISING',
      improving:             'RECOVERY',
      forecast_step:         'FORECAST',
    }[role] ?? 'FORECAST');
  };

  const markerInfos = STEPS.map((stepIdx, i) => {
    const meta = stepMeta[i];
    const tsEntry = timeSeriesData.find(s => s.time_index === stepIdx);
    if (!tsEntry || n < 1) return null;
    const si = timeSeriesData.indexOf(tsEntry);
    const px = CX + (n > 1 ? (CW / (n - 1)) * si : 0);
    const w = tsEntry?.vessels?.[VESSEL]?.warning_percent ?? 0;
    const py = CY + CH * (1 - Math.min(1, w / 100));
    const validTime = meta?.valid_time ?? tsEntry.time;
    const validMs = new Date(validTime).getTime();
    const label = momentLabel(meta?.role ?? '', w, validTime);
    return { label, px, py, validTime, validMs };
  }).filter(Boolean);

  markerInfos.forEach((marker, i) => {
    const closeToNeighbour = Number.isFinite(marker.validMs) && markerInfos.some((other, j) => (
      i !== j && Number.isFinite(other.validMs) && Math.abs(marker.validMs - other.validMs) < CLOSE_MARKER_MS
    ));
    const shouldLabel = !usedMomentLabels.has(marker.label) && !closeToNeighbour;
    if (shouldLabel) usedMomentLabels.add(marker.label);

    setDraw(doc, MARKER_COLOR);
    doc.setLineWidth(0.22);
    doc.setLineDashPattern([1.2, 1.6], 0);
    doc.line(marker.px, CY, marker.px, CY + CH);
    doc.setLineDashPattern([], 0);

    setFill(doc, MARKER_COLOR);
    doc.circle(marker.px, marker.py, 0.9, 'F');

    if (shouldLabel) {
      setFont(doc, MARKER_COLOR, 4.3, 'bold');
      doc.text(marker.label, marker.px, CY + CH + 6.8, { align: 'center' });
    }
  });

  // Forecast shape summary sentence
  const shape = describeForecastShape(timeSeriesData, VESSEL);
  if (shape) {
    setFont(doc, shape.color, 7, 'bold');
    doc.text(shape.text, W / 2, H - 8.5, { align: 'center' });
  }

  setFont(doc, [55, 130, 75], 5, 'italic');
  doc.text(
    '"Recovery window" = period between consecutive high-risk events where Avoid% drops below 50% of the domain.',
    W / 2, H - 5.2, { align: 'center' }
  );

  setFont(doc, TEXT_MD, 5, 'italic');
  doc.text(
    'SWAN wave model guidance — mesh resolution may not capture all local sea state variability. Use alongside official warnings.',
    W / 2, H - 2, { align: 'center' }
  );
}

// ── Page 6 — Methodology & transparency ───────────────────────────────────────

function drawPage6(doc, { validTime, runId }) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  doc.addPage();
  rect(doc, 0, 0, W, H, PAGE_BG);

  // Header
  const HDR_H = 18;
  rect(doc, 0, 0, W, HDR_H, HEADER_BG);
  setFont(doc, TEXT_LT, 14, 'bold');
  doc.text('NIUE COASTAL WATERS', 5, HDR_H * 0.55);
  setFont(doc, TEXT_LT, 8.5);
  doc.text('SUITABILITY METHODOLOGY & TRANSPARENCY', 5, HDR_H * 0.85);
  const validStr = validTime ? formatUtcTiny(validTime) : '—';
  setFont(doc, TEXT_LT, 8);
  doc.text(`Valid: ${validStr}`, W - 5, HDR_H * 0.55, { align: 'right' });
  setFont(doc, TEXT_LT, 7.5);
  const issuedStr = formatRunId(runId);
  doc.text(
    issuedStr ? `Issued: ${issuedStr}  |  Page 6` : 'Page 6',
    W - 5, HDR_H * 0.85, { align: 'right' },
  );

  const MX     = 5;
  const BODY_Y = HDR_H + 5;

  // ── Classification logic (intro) ─────────────────────────────────────────────
  setFont(doc, HEADER_BG, 8, 'bold');
  doc.text('HOW SUITABILITY IS CLASSIFIED', MX, BODY_Y + 4.5);

  setFont(doc, TEXT_MD, 6.5);
  const logicLines = [
    'Classification is applied independently to each grid cell using two meteorological parameters: significant wave height (Hs) and',
    'sustained 10-metre wind speed. A cell is flagged Avoid when either parameter meets or exceeds the warning threshold for the',
    'selected vessel class; Caution when it meets the caution threshold; Suitable otherwise. Domain-level summaries report the',
    'percentage of grid cells in each category. Thresholds are defined per vessel class as shown in the table below.',
  ];
  logicLines.forEach((line, i) => {
    doc.text(line, MX, BODY_Y + 10.5 + i * 4.2);
  });

  // ── Vessel threshold table ────────────────────────────────────────────────────
  const TBL_Y = BODY_Y + 37;
  const TBL_X = MX;
  const tblW  = W - 2 * MX;                   // 287 mm
  const COL_W = [58, 56, 87, 86];             // vessel, typical use, caution, avoid
  const HDR_ROW_H = 9;
  const ROW_H     = 10;

  const colX = [];
  let cxAcc = TBL_X;
  COL_W.forEach(w => { colX.push(cxAcc); cxAcc += w; });

  // Header row
  rect(doc, TBL_X, TBL_Y, tblW, HDR_ROW_H, HEADER_BG);
  const tblHdrs = ['Vessel Class', 'Typical Use', 'Caution Threshold', 'Avoid Threshold'];
  tblHdrs.forEach((h, i) => {
    setFont(doc, TEXT_LT, 7, 'bold');
    doc.text(h, colX[i] + COL_W[i] / 2, TBL_Y + HDR_ROW_H * 0.68, { align: 'center' });
  });

  const RULES = [
    { label: 'Traditional Craft',   examples: 'Canoes, vaka, outrigger canoes',    cHs: '0.5', aHs: '1.0', cWind: '10', aWind: '12' },
    { label: 'Very Small Motor',    examples: 'Dinghies, open skiffs under 6 m',   cHs: '1.0', aHs: '1.5', cWind: '12', aWind: '15' },
    { label: 'Small Craft',         examples: 'Fibreglass boats 6-10 m, inter-island skiffs', cHs: '1.5', aHs: '2.0', cWind: '15', aWind: '20' },
    { label: 'Larger Vessels',      examples: 'Decked vessels over 10-12 m',       cHs: '2.5', aHs: '3.0', cWind: '20', aWind: '25' },
  ];

  RULES.forEach((r, ri) => {
    const ry = TBL_Y + HDR_ROW_H + ri * ROW_H;
    rect(doc, TBL_X, ry, tblW, ROW_H, ri % 2 === 0 ? [245, 247, 252] : [255, 255, 255]);

    setFont(doc, TEXT_DK, 7, 'bold');
    doc.text(r.label, colX[0] + 3, ry + ROW_H * 0.62);

    setFont(doc, TEXT_MD, 6);
    doc.text(r.examples, colX[1] + 3, ry + ROW_H * 0.62);

    setFont(doc, hazardText(1), 6.5, 'bold');
    doc.text(`Hs >= ${r.cHs} m`, colX[2] + COL_W[2] / 2, ry + 3.8, { align: 'center' });
    doc.text(`Wind >= ${r.cWind} kt`, colX[2] + COL_W[2] / 2, ry + 7.5, { align: 'center' });

    setFont(doc, hazardText(2), 6.5, 'bold');
    doc.text(`Hs >= ${r.aHs} m`, colX[3] + COL_W[3] / 2, ry + 3.8, { align: 'center' });
    doc.text(`Wind >= ${r.aWind} kt`, colX[3] + COL_W[3] / 2, ry + 7.5, { align: 'center' });
  });

  // Table border and grid lines
  setDraw(doc, GRID_CLR);
  doc.setLineWidth(0.3);
  doc.rect(TBL_X, TBL_Y, tblW, HDR_ROW_H + RULES.length * ROW_H, 'S');
  doc.setLineWidth(0.15);
  colX.slice(1).forEach(x => {
    doc.line(x, TBL_Y, x, TBL_Y + HDR_ROW_H + RULES.length * ROW_H);
  });
  doc.line(TBL_X, TBL_Y + HDR_ROW_H, TBL_X + tblW, TBL_Y + HDR_ROW_H);
  RULES.forEach((_, ri) => {
    if (ri > 0) {
      const ry = TBL_Y + HDR_ROW_H + ri * ROW_H;
      doc.line(TBL_X, ry, TBL_X + tblW, ry);
    }
  });

  // ── Classification legend ─────────────────────────────────────────────────────
  const LEG_Y = TBL_Y + HDR_ROW_H + RULES.length * ROW_H + 6;
  setFont(doc, TEXT_MD, 6, 'bold');
  doc.text('Classification:', MX, LEG_Y);
  let legXAcc = MX + 26;
  [
    { label: 'Suitable — all parameters below caution thresholds', haz: 0 },
    { label: 'Caution — any parameter at or above caution threshold', haz: 1 },
    { label: 'Avoid — any parameter at or above warning threshold', haz: 2 },
  ].forEach(item => {
    const sw = 5;
    rect(doc, legXAcc, LEG_Y - 4.2, sw, 5.2, hazardLight(item.haz), hazardColor(item.haz), 0.4);
    setFont(doc, hazardText(item.haz), 6);
    doc.text(item.label, legXAcc + sw + 2, LEG_Y);
    legXAcc += sw + 2 + doc.getTextWidth(item.label) + 8;
  });

  // ── Two-column information section ────────────────────────────────────────────
  const INFO_Y  = LEG_Y + 10;
  const COL_L_X = MX;
  const COL_L_W = (W - 2 * MX - 6) / 2;
  const COL_R_X = COL_L_X + COL_L_W + 6;

  const infoBlock = (x, y, title, lines, titleColor = HEADER_BG) => {
    setFont(doc, titleColor, 7, 'bold');
    doc.text(title, x, y);
    setFont(doc, TEXT_MD, 6);
    lines.forEach((line, i) => { doc.text(line, x, y + 5 + i * 3.5); });
    return y + 5 + lines.length * 3.5 + 4;
  };

  let ly = INFO_Y;
  ly = infoBlock(COL_L_X, ly, 'WAVE MODEL', [
    'SWAN (Simulating WAves Nearshore) — third-generation spectral wave model run operationally',
    'by the Pacific Community (SPC) for Niue. Atmospheric forcing: GFS 0.25° analysis fields.',
  ]);
  ly = infoBlock(COL_L_X, ly, 'FORECAST SCHEDULE', [
    'Runs every 6 hours: 00:00, 06:00, 12:00, 18:00 UTC. Forecast horizon: 7 days.',
  ]);

  let ry2 = INFO_Y;
  ry2 = infoBlock(COL_R_X, ry2, 'LIMITATIONS & CAVEATS', [
    '· Outputs are from a numerical model; local conditions may differ.',
    '· Forecast uncertainty grows at longer lead times (>48 h).',
    '· Coastal effects (currents, swell refraction) may not be fully resolved.',
    '· Not a substitute for official maritime warnings — always cross-check with Niue Met Service.',
  ], hazardColor(2));
  ry2 = infoBlock(COL_R_X, ry2, 'ATTRIBUTION', [
    'Produced by the Pacific Community (SPC), Ocean & Maritime Programme.',
    'SWAN © Delft University of Technology. Thresholds per WMO Pacific guidelines.',
  ]);

  // ── Hazard class visual guide ─────────────────────────────────────────────
  const GUIDE_Y = Math.max(ly, ry2) + 3;
  const GUIDE_H = H - 7 - GUIDE_Y - 6;
  if (GUIDE_H >= 26) {
    setFont(doc, HEADER_BG, 7, 'bold');
    doc.text('UNDERSTANDING THE HAZARD CLASSES', MX, GUIDE_Y + 4);

    const CARD_H6  = GUIDE_H - 8;
    const CARD_W6  = (W - 2 * MX - 8) / 3;
    const GUIDE_DATA = [
      {
        haz: 0,
        title: 'SUITABLE',
        lines: ['Conditions within safe operating limits.', 'Proceed with normal seamanship.'],
        action: 'Action: Proceed — standard watch applies.',
      },
      {
        haz: 1,
        title: 'CAUTION',
        lines: ['One or more parameters near threshold.', 'Conditions marginal for this vessel class.'],
        action: 'Action: Monitor closely — ready to return.',
      },
      {
        haz: 2,
        title: 'AVOID',
        lines: ['Conditions exceed safe operating limits.', 'Departure is not recommended.'],
        action: 'Action: Do not proceed — await improvement.',
      },
    ];

    GUIDE_DATA.forEach((gd, gi) => {
      const gx = MX + gi * (CARD_W6 + 4);
      const gy = GUIDE_Y + 7;
      rect(doc, gx, gy, CARD_W6, CARD_H6, hazardLight(gd.haz), hazardColor(gd.haz), 0.5);
      rect(doc, gx, gy, CARD_W6, 6, hazardColor(gd.haz));
      setFont(doc, [255, 255, 255], 7.5, 'bold');
      doc.text(gd.title, gx + CARD_W6 / 2, gy + 4.3, { align: 'center' });
      setFont(doc, hazardText(gd.haz), 6);
      gd.lines.forEach((line, li) => {
        doc.text(line, gx + CARD_W6 / 2, gy + 9 + li * 3.5, { align: 'center' });
      });
      setFont(doc, hazardText(gd.haz), 6, 'bold');
      const actionY = gy + 9 + gd.lines.length * 3.5 + 3;
      if (actionY < gy + CARD_H6) {
        doc.text(gd.action, gx + CARD_W6 / 2, actionY, { align: 'center' });
      }
    });
  }

  // Footer disclaimer
  const FOOT_Y = H - 5;
  setDraw(doc, GRID_CLR);
  doc.setLineWidth(0.25);
  doc.line(MX, FOOT_Y - 3.5, W - MX, FOOT_Y - 3.5);
  setFont(doc, [140, 140, 140], 5.5);
  doc.text(
    'This advisory is generated automatically from numerical model output. It does not constitute an official weather or marine forecast. ' +
    'Always consult the Niue Meteorological Service and official maritime warnings before making navigation decisions.',
    W / 2, FOOT_Y, { align: 'center', maxWidth: W - 2 * MX },
  );
}

// ── Main export function ───────────────────────────────────────────────────────

export async function exportSuitabilityPDF({
  mapElement,
  timeIndex,
  validTime,
  runId,
  suitabilityBaseUrl = '',
  publicUrl = process.env.PUBLIC_URL ?? '',
  selectedVessel = 'small_craft',
  onProgress,
}) {
  const { jsPDF } = await import('jspdf');
  const progress = onProgress ?? (() => {});

  // ── Step 1: Fetch timesteps once; clamp provided timeIndex to backend bounds ──
  // The PDF's printed valid time comes only from backend summary.valid_time.
  progress('Resolving forecast timestep...');
  let apiBaseUrl = suitabilityBaseUrl;
  let tsMeta = null;
  let effectiveTimeIndex = timeIndex;
  try {
    const resolved = await resolveSuitabilityApi(suitabilityBaseUrl);
    apiBaseUrl = resolved.baseUrl;
    tsMeta = resolved.timesteps;
    if (tsMeta?.count) {
      effectiveTimeIndex = Math.max(0, Math.min(tsMeta.count - 1, Number(timeIndex) || 0));
    }
  } catch (error) {
    console.error(error.message);
    throw error;
  }

  // ── Step 2: Fetch advisory map ────────────────────────────────────────────────
  // Page 1 slot is nearly square (≈178×160 mm) so request at 1.09:1 to avoid stretch.
  // Cartographic elements (scale bar, north arrow, markers) come from the backend.
  // The jsPDF legend is drawn separately, so showLegend is false here.
  progress('Rendering advisory map...');
  const mapDataUrl = await fetchMapImage(selectedVessel, effectiveTimeIndex, apiBaseUrl, {
    width: 1100, height: 1010, dpi: 200,
    showLabels: false, showLegend: false,
    showClassBoundaries: true, viewRadiusKm: 34,
  }).catch(() => null).then(url => url || (mapElement ? captureMap(mapElement) : null));

  // ── Step 3: Fetch summary → backend valid_time is the source of truth ─────────
  progress('Fetching suitability data...');
  let summary = null;
  let effectiveValidTime = null;
  try {
    summary = await fetchSummary(effectiveTimeIndex, apiBaseUrl);
    if (summary?.valid_time) {
      effectiveValidTime = summary.valid_time;
      if (validTime) {
        const widgetMs = new Date(validTime).getTime();
        const backendMs = new Date(summary.valid_time).getTime();
        if (
          Number.isFinite(widgetMs)
          && Number.isFinite(backendMs)
          && Math.abs(widgetMs - backendMs) > 60_000
        ) {
          console.warn(
            `Ignoring widget validTime ${validTime}; PDF uses backend summary.valid_time ${summary.valid_time}.`
          );
        }
      }
    }
  } catch (e) {
    console.warn('Suitability summary unavailable:', e.message);
  }

  // ── Step 3b: Preload vessel SVG icons (one per vessel at its current hazard class) ──
  progress('Loading vessel icons...');
  const vesselIcons = {};
  if (summary?.vessels) {
    await Promise.all(VESSEL_CLASSES.map(async vc => {
      const vd  = summary.vessels[vc.code] ?? {};
      const haz = domainHazard(vd.warning_percent ?? 0, vd.caution_percent ?? 0);
      vesselIcons[vc.code] = await loadVesselSvgIcon(vc.code, haz);
    }));
  }

  // ── Step 4: Build forward time series in parallel (reuse tsMeta) ─────────────
  // Starts at effectiveTimeIndex — no historical steps, pure forward outlook.
  let timeSeriesData = [];
  try {
    if (tsMeta?.timesteps) {
      const start     = effectiveTimeIndex;
      const stepHours = inferStepHours(tsMeta.timesteps);
      const neededSteps = Math.ceil((7 * 24) / stepHours);   // 7 days regardless of model interval
      const end       = Math.min(tsMeta.count - 1, effectiveTimeIndex + neededSteps);
      const indices = [];
      for (let i = start; i <= end; i++) indices.push(i);
      const fetched = await Promise.all(
        indices.map(i =>
          fetchSummary(i, apiBaseUrl)
            .then(s => ({ time_index: i, time: s.valid_time, vessels: s.vessels }))
            .catch(() => null)
        )
      );
      timeSeriesData = fetched.filter(Boolean);
    }
  } catch { /* leave sparklines empty */ }

  // ── Step 5: Build PDF ─────────────────────────────────────────────────────────
  progress('Building PDF...');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Domain bounds from tsMeta pin all backend map renders to the true model extent,
  // activating adjustable="box" in the backend and eliminating the ocean-bg rectangle.
  const domainBbox = (tsMeta?.lon_min != null) ? {
    lonMin: tsMeta.lon_min,
    latMin: tsMeta.lat_min,
    lonMax: tsMeta.lon_max,
    latMax: tsMeta.lat_max,
  } : null;

  // Print Issued only when real run metadata is available; never reuse the first valid timestep.
  const effectiveRunId = runId ?? tsMeta?.run_id ?? tsMeta?.forecast_run_id ?? tsMeta?.issued_at ?? null;

  await drawPage1(doc, { mapDataUrl, summary, validTime: effectiveValidTime, runId: effectiveRunId, selectedVessel, timeSeriesData, vesselIcons });
  await drawPage2(doc, { summary, validTime: effectiveValidTime, runId: effectiveRunId, timeSeriesData, vesselIcons });

  progress('Finding best comparison timestep...');
  await drawPage3(doc, { baseUrl: apiBaseUrl, timeIndex: effectiveTimeIndex, runId: effectiveRunId, validTime: effectiveValidTime, domainBbox });

  progress('Building forecast timeline...');
  await drawPage4(doc, { baseUrl: apiBaseUrl, selectedVessel, timeIndex: effectiveTimeIndex, timeSeriesData, runId: effectiveRunId, domainBbox });

  progress('Building trend chart...');
  await drawPage5(doc, { selectedVessel, timeIndex: effectiveTimeIndex, timeSeriesData, runId: effectiveRunId });

  progress('Adding methodology...');
  drawPage6(doc, { validTime: effectiveValidTime, runId: effectiveRunId });

  const filename = `niue_suitability_advisory_t${String(effectiveTimeIndex).padStart(3,'0')}.pdf`;
  doc.save(filename);
  progress('Done');
  return filename;
}

// ── Competition poster export ──────────────────────────────────────────────────
// Single A3 landscape page. Dark editorial style. Visual-first — no tables.
// Core argument: same ocean, different risk across vessel classes.

// Per-vessel line colours for the shared timeline chart
const VESSEL_LINE_COLOR = {
  traditional_craft:          hazardColor(2),   // coral — highest risk class
  very_small_motorised_craft: hazardColor(1),   // amber
  small_craft:                hazardColor(0),   // teal
  larger_vessels:             [25,   94,  89],  // dark teal — lowest risk
};

function drawPosterPage(doc, { vessels, posterMapImg, posterVessel, timeSeriesData, validTime }) {
  const W = doc.internal.pageSize.getWidth();   // 420 mm (A3 landscape)
  const H = doc.internal.pageSize.getHeight();  // 297 mm

  // ── Layout constants ──────────────────────────────────────────────────────
  const HDR_H    = 22;    // headline strip
  const FOOT_H   = 10;
  const TL_H     = 52;    // timeline ribbon (larger than before — primary data view)
  const QUOTE_H  =  9;    // editorial pull-quote strip
  const LADDER_W = 118;   // wide vessel ranking column — the story lives here
  const MAP_Y0   = HDR_H;
  const MAP_BTM  = H - FOOT_H - TL_H - QUOTE_H;   // 297 - 10 - 52 - 9 = 226
  const MAP_AREA_H = MAP_BTM - MAP_Y0;              // 226 - 22 = 204
  const BADGE_H  = 11;
  const IMG_H    = MAP_AREA_H - BADGE_H - 1;        // 192
  const MAP_X0   = LADDER_W + 3;                    // 121
  const MAP_W    = W - MAP_X0 - 2;                  // 299 — single large map

  // ── Dark canvas ────────────────────────────────────────────────────────────
  rect(doc, 0, 0, W, H, [12, 20, 42]);

  // ── Headline strip ─────────────────────────────────────────────────────────
  rect(doc, 0, 0, W, HDR_H, [8, 14, 32]);

  // "SAME OCEAN." in white, "DIFFERENT RISK." in coral — poster-scale headline
  setFont(doc, [255, 255, 255], 20, 'bold');
  const sameOceanText = 'SAME OCEAN.';
  const sameW = doc.getTextWidth(sameOceanText + '  ');
  doc.text(sameOceanText, 5, HDR_H * 0.47);
  setFont(doc, hazardColor(2), 20, 'bold');
  doc.text('DIFFERENT RISK.', 5 + sameW, HDR_H * 0.47);

  // Subtitle: core insight
  setFont(doc, [150, 175, 215], 7);
  doc.text(
    'Vessel class determines hazard exposure — same sea state, different risk to life and vessel.',
    5, HDR_H * 0.82,
  );

  // Valid time and attribution (right-aligned)
  const validStr = validTime ? formatUtcTiny(validTime) : '—';
  setFont(doc, [110, 140, 185], 6.5);
  doc.text(`Most contrasting window: ${validStr}`, W - 4, HDR_H * 0.47, { align: 'right' });
  setFont(doc, [80, 108, 158], 6);
  doc.text('Niue Coastal Waters  ·  SPC Ocean Products', W - 4, HDR_H * 0.82, { align: 'right' });

  // ── Vessel ranking ladder ─────────────────────────────────────────────────
  rect(doc, 0, MAP_Y0, LADDER_W, MAP_AREA_H, [17, 28, 62]);

  setFont(doc, [120, 150, 200], 6, 'bold');
  doc.text('VESSEL RISK', LADDER_W / 2, MAP_Y0 + 5.5, { align: 'center' });
  doc.text('RANKING', LADDER_W / 2, MAP_Y0 + 10, { align: 'center' });

  const sortedVC = [...VESSEL_CLASSES].sort((a, b) => {
    const wa = vessels[a.code]?.warning_percent ?? 0;
    const wb = vessels[b.code]?.warning_percent ?? 0;
    const ca = vessels[a.code]?.caution_percent ?? 0;
    const cb = vessels[b.code]?.caution_percent ?? 0;
    return domainHazard(wb, cb) - domainHazard(wa, ca) || wb - wa;
  });

  const RUNG_Y0 = MAP_Y0 + 13;
  const RUNG_H  = (MAP_AREA_H - 14) / 4;
  const PAD     = 3;

  for (let ri = 0; ri < sortedVC.length; ri++) {
    const vc   = sortedVC[ri];
    const vd   = vessels[vc.code] ?? {};
    const warn = vd.warning_percent ?? 0;
    const caut = vd.caution_percent ?? 0;
    const haz  = domainHazard(warn, caut);
    const ry   = RUNG_Y0 + ri * RUNG_H;

    // Rank number — large visual anchor
    setFont(doc, [35, 52, 95], 30, 'bold');
    doc.text(`${ri + 1}`, PAD + 3, ry + RUNG_H * 0.50);

    // Vessel name
    setFont(doc, [215, 228, 248], 7.5, 'bold');
    doc.text(vc.label, PAD + 16, ry + RUNG_H * 0.24);

    // Hazard badge
    const bw = LADDER_W - PAD - 18;
    setFill(doc, hazardColor(haz));
    doc.roundedRect(PAD + 16, ry + RUNG_H * 0.31, bw, 6, 1.5, 1.5, 'F');
    setFont(doc, [255, 255, 255], 7, 'bold');
    doc.text(
      hazardLabel(haz).toUpperCase(),
      PAD + 16 + bw / 2,
      ry + RUNG_H * 0.31 + 4.2,
      { align: 'center' },
    );

    // Three-segment bar (avoid | caution | suitable)
    const bx = PAD + 1;
    const by = ry + RUNG_H * 0.65;
    const bw2 = LADDER_W - PAD * 2;
    const bh = 4;
    // base (suitable / teal)
    setFill(doc, hazardColor(0));
    doc.roundedRect(bx, by, bw2, bh, 1.2, 1.2, 'F');
    // caution layer
    if (warn + caut > 0) {
      setFill(doc, hazardColor(1));
      doc.roundedRect(bx, by, bw2 * Math.min(1, (warn + caut) / 100), bh, 1.2, 1.2, 'F');
    }
    // avoid layer (front)
    if (warn > 0) {
      setFill(doc, hazardColor(2));
      doc.roundedRect(bx, by, bw2 * Math.min(1, warn / 100), bh, 1.2, 1.2, 'F');
    }

    // Editorial risk sentence
    const riskSentence = warn >= 80  ? `${Math.round(warn)}% — no safe departure window`
                       : warn >= 40  ? `${Math.round(warn)}% Avoid, high exposure`
                       : warn > 0    ? `${Math.round(warn)}% Avoid, limited risk`
                       : caut >= 50  ? 'Elevated caution, monitor closely'
                       : caut > 0    ? 'Mostly suitable, localised caution'
                       :               'Suitable conditions across domain';
    setFont(doc, [110, 138, 178], 5);
    doc.text(riskSentence, bx + bw2 / 2, by + bh + 3.2, { align: 'center' });

    // Separator
    if (ri < sortedVC.length - 1) {
      setDraw(doc, [32, 48, 88]);
      doc.setLineWidth(0.28);
      doc.line(PAD, ry + RUNG_H - 1, LADDER_W - PAD, ry + RUNG_H - 1);
    }
  }

  // ── Single large map ─────────────────────────────────────────────────────
  // One beautiful map at ~299×204 mm shows the suitability pattern for the
  // vessel class with the most spatial contrast.  The ladder on the left
  // provides the vessel-to-vessel comparison — the map provides the geography.
  {
    const mx = MAP_X0;
    const my = MAP_Y0;
    const vcObj = VESSEL_CLASSES.find(vc => vc.code === posterVessel) ?? VESSEL_CLASSES[0];
    const vd  = vessels[vcObj.code] ?? {};
    const warn = vd.warning_percent ?? 0;
    const caut = vd.caution_percent ?? 0;
    const haz  = domainHazard(warn, caut);

    if (posterMapImg) {
      const fmt = posterMapImg.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(posterMapImg, fmt, mx, my, MAP_W, IMG_H, 'poster_map_' + (posterVessel ?? 'default'), 'FAST');
    } else {
      rect(doc, mx, my, MAP_W, IMG_H, [17, 28, 62]);
      setFont(doc, [100, 130, 180], 9, 'italic');
      doc.text('Map data unavailable', mx + MAP_W / 2, my + IMG_H / 2, { align: 'center' });
    }

    // Vessel context pill — top-left of image
    {
      const lbl = `${vcObj.label.toUpperCase()} — ${hazardLabel(haz).toUpperCase()}`;
      setFont(doc, [220, 235, 255], 7, 'bold');
      const pw = doc.getTextWidth(lbl) + 6;
      rect(doc, mx + 3, my + 3, pw, 8, [8, 16, 42]);
      doc.text(lbl, mx + 6, my + 8.2);
    }

    // Avoid/Caution annotation pill — top-right
    if (warn > 0 || caut > 0) {
      const ann = warn > 0 ? `${Math.round(warn)}% Avoid` : `${Math.round(caut)}% Caution`;
      setFont(doc, [255, 255, 255], 6.5, 'bold');
      const aw = doc.getTextWidth(ann) + 4;
      rect(doc, mx + MAP_W - aw - 4, my + 3, aw + 1, 7, hazardColor(warn > 0 ? 2 : 1));
      doc.text(ann, mx + MAP_W - 5, my + 7.8, { align: 'right' });
    }

    // Hazard badge strip below map
    setFill(doc, hazardColor(haz));
    doc.rect(mx, my + IMG_H, MAP_W, BADGE_H, 'F');
    setFont(doc, [255, 255, 255], 6.5, 'bold');
    doc.text(vcObj.label.toUpperCase(), mx + MAP_W / 2, my + IMG_H + BADGE_H * 0.33, { align: 'center' });
    setFont(doc, [255, 255, 255], 9, 'bold');
    doc.text(hazardLabel(haz).toUpperCase(), mx + MAP_W / 2, my + IMG_H + BADGE_H * 0.80, { align: 'center' });
  }

  // ── Editorial pull-quote strip ────────────────────────────────────────
  const QUOTE_Y = MAP_BTM;
  rect(doc, 0, QUOTE_Y, W, QUOTE_H, [22, 36, 75]);
  setFont(doc, [215, 225, 255], 7.5, 'bold');
  doc.text(
    'SAME OCEAN — BUT VESSEL CLASS DETERMINES WHETHER YOU COME HOME.',
    W / 2, QUOTE_Y + QUOTE_H * 0.62,
    { align: 'center' },
  );

  // ── Shared timeline ribbon ─────────────────────────────────────────────
  const TL_Y = QUOTE_Y + QUOTE_H;
  rect(doc, 0, TL_Y, W, TL_H, [13, 22, 50]);

  setFont(doc, [110, 142, 192], 6, 'bold');
  doc.text('72-HOUR FORECAST — AVOID % BY VESSEL CLASS', 5, TL_Y + 6);

  // Legend (right of title) — set font BEFORE measuring text widths
  setFont(doc, [255, 255, 255], 5, 'bold');
  let legX = W - 5;
  for (const vc of [...VESSEL_CLASSES].reverse()) {
    const haz   = domainHazard(vessels[vc.code]?.warning_percent ?? 0, vessels[vc.code]?.caution_percent ?? 0);
    const color = VESSEL_LINE_COLOR[vc.code] ?? hazardColor(haz);
    const lw    = doc.getTextWidth(vc.short);
    setFill(doc, color);
    doc.roundedRect(legX - lw - 5.5, TL_Y + 2.5, lw + 5, 4, 1, 1, 'F');
    setFont(doc, [255, 255, 255], 5, 'bold');   // re-assert after setFill resets nothing, but explicit is safe
    doc.text(vc.short, legX - lw - 3, TL_Y + 5.5);
    legX -= lw + 8;
  }

  // Chart area
  const CX = 5, CY = TL_Y + 10, CW = W - 12, CH = TL_H - 14;

  // Grid
  setDraw(doc, [28, 44, 84]);
  doc.setLineWidth(0.2);
  for (const pct of [25, 50, 75]) {
    const gy = CY + CH * (1 - pct / 100);
    doc.line(CX, gy, CX + CW, gy);
    setFont(doc, [72, 95, 138], 4.5);
    doc.text(`${pct}%`, CX - 1.5, gy + 1.5, { align: 'right' });
  }
  // Baseline
  setDraw(doc, [42, 62, 108]);
  doc.setLineWidth(0.35);
  doc.line(CX, CY + CH, CX + CW, CY + CH);

  // Plot vessel series — clean polylines, no broken GState area fills
  if (timeSeriesData.length >= 2) {
    const n = timeSeriesData.length;

    for (const vc of VESSEL_CLASSES) {
      const color = VESSEL_LINE_COLOR[vc.code] ?? hazardColor(0);
      setDraw(doc, color);
      doc.setLineWidth(1.8);

      let px0 = null, py0 = null;
      for (let si = 0; si < n; si++) {
        const warn = timeSeriesData[si]?.vessels?.[vc.code]?.warning_percent ?? 0;
        const px = CX + (CW / (n - 1)) * si;
        const py = CY + CH * (1 - Math.min(1, warn / 100));
        if (px0 !== null) doc.line(px0, py0, px, py);
        px0 = px; py0 = py;
      }
    }

    // "NOW" marker: vertical tick at the first step
    setDraw(doc, [180, 200, 235]);
    doc.setLineWidth(0.4);
    doc.line(CX, CY, CX, CY + CH);
    setFont(doc, [160, 185, 225], 5, 'bold');
    doc.text('NOW', CX + 1, CY - 1);

    // X-axis time labels
    setFont(doc, [80, 108, 152], 5.5);
    doc.text(formatUtcTiny(timeSeriesData[0].time),     CX,      CY + CH + 4.5);
    doc.text(formatUtcTiny(timeSeriesData[n - 1].time), CX + CW, CY + CH + 4.5, { align: 'right' });

    // End-of-line labels, staggered to prevent overlap
    const labelQueue = VESSEL_CLASSES.map(vc => {
      const lastWarn = timeSeriesData[n - 1]?.vessels?.[vc.code]?.warning_percent ?? 0;
      return {
        label: vc.short,
        color: VESSEL_LINE_COLOR[vc.code] ?? hazardColor(0),
        ly: CY + CH * (1 - Math.min(1, lastWarn / 100)),
      };
    }).sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < labelQueue.length; i++) {
      if (labelQueue[i].ly - labelQueue[i - 1].ly < 5) labelQueue[i].ly = labelQueue[i - 1].ly + 5;
    }
    for (const { label, color, ly } of labelQueue) {
      setFont(doc, color, 5.5, 'bold');
      doc.text(label, CX + CW + 2, ly + 1.5);
    }
  } else {
    setFont(doc, [72, 98, 145], 6, 'italic');
    doc.text('Time series data unavailable', CX + CW / 2, CY + CH / 2, { align: 'center' });
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const FY = H - FOOT_H;
  rect(doc, 0, FY, W, FOOT_H, [7, 12, 28]);
  setFont(doc, [190, 215, 255], 9, 'bold');
  doc.text('Marine risk is not universal — it depends on the vessel.', W / 2, FY + 5.5, { align: 'center' });
  setFont(doc, [90, 120, 170], 5.5, 'italic');
  doc.text(
    'Advisory guidance only — not an official navigation chart. All suitability classifications are model-derived forecasts. Verify with official warnings before departure.',
    W / 2, FY + 9.5, { align: 'center' },
  );
}

export async function exportSuitabilityPoster({
  timeIndex,
  validTime,
  suitabilityBaseUrl = '',
  onProgress,
}) {
  const { jsPDF } = await import('jspdf');
  const progress = onProgress ?? (() => {});

  progress('Resolving suitability API...');
  const resolved = await resolveSuitabilityApi(suitabilityBaseUrl);
  const apiBaseUrl = resolved.baseUrl;

  progress('Finding best contrast timestep...');
  const best = await fetchJsonEndpoint(
    `/niue/suitability/best-comparison-timestep?start_time_index=${timeIndex}`,
    apiBaseUrl,
    'Best comparison timestep'
  ).catch(() => null);
  const compTimeIndex = best?.time_index ?? timeIndex;
  const vessels = best?.vessels ?? {};
  const posterValidTime = best?.valid_time ?? validTime;

  // Full summary at the comparison timestep — needed before we pick the poster vessel.
  let fullSummaryEarly = null;
  try { fullSummaryEarly = await fetchSummary(compTimeIndex, apiBaseUrl); } catch { /* fall back */ }
  const earlyVessels = fullSummaryEarly?.vessels ?? vessels;

  // Pick the vessel with the most spatial variation (farthest from 100% single class).
  // This gives the most visually rich map for the competition single-map layout.
  const posterVessel = (() => {
    let best = VESSEL_CLASSES[0].code;
    let bestVar = -1;
    for (const vc of VESSEL_CLASSES) {
      const w = earlyVessels[vc.code]?.warning_percent ?? 0;
      const c = earlyVessels[vc.code]?.caution_percent ?? 0;
      const s = earlyVessels[vc.code]?.suitable_percent ?? 0;
      const variation = 100 - Math.max(w, c, s);
      if (variation > bestVar) { bestVar = variation; best = vc.code; }
    }
    return best;
  })();

  progress('Rendering poster map (high resolution)...');
  // Single large map: poster slot is ~299 × 192 mm = 1.56:1 landscape aspect.
  // viewRadiusKm=55 with no explicit bbox → adjustable="datalim" lets the ocean
  // extend naturally around the domain, giving a geographically rich composition.
  const posterMapImg = await fetchMapImage(posterVessel, compTimeIndex, apiBaseUrl, {
    width: 1560, height: 1000, dpi: 200,
    showLabels: false, showLegend: false, showClassBoundaries: true, viewRadiusKm: 55,
  }).catch(() => null);

  progress('Fetching forecast time series...');
  let timeSeriesData = [];
  try {
    const tsMeta = resolved.timesteps;
    if (tsMeta?.timesteps) {
      const start = Math.max(0, timeIndex - 6);
      const end   = Math.min(tsMeta.count - 1, timeIndex + 66);
      const steps = [];
      for (let i = start; i <= end; i++) {
        try {
          const s = await fetchSummary(i, apiBaseUrl);
          steps.push({ time: s.valid_time, vessels: s.vessels });
        } catch { /* skip */ }
      }
      timeSeriesData = steps;
    }
  } catch { /* leave empty */ }

  progress('Building poster...');
  const posterVessels = earlyVessels;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });

  drawPosterPage(doc, {
    vessels:      posterVessels,
    posterMapImg,
    posterVessel,
    timeSeriesData,
    validTime:    posterValidTime,
  });

  const filename = `niue_same_ocean_different_risk_t${String(compTimeIndex).padStart(3,'0')}.pdf`;
  doc.save(filename);
  progress('Done');
  return filename;
}
