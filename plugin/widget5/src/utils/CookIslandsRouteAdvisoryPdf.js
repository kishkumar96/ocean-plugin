// CookIslandsRouteAdvisoryPdf.js
// Generates a one-to-few-page route advisory PDF from an already-run Cook
// Islands route forecast result (see cookIslandsRouteForecastService.js).
//
// Deliberately a fraction of widget1's SuitabilityPDFExporter.js (~5,500
// lines covering a 7-page whole-domain advisory, scenario comparisons, and
// sea-level context this app doesn't have): this app only has one thing to
// export -- the route forecast the user just ran -- so this file draws
// exactly that, borrowing the same jsPDF drawing techniques (manual vector
// draws, no autotable plugin) and route-specific helpers (worst-run
// detection, route sketch projection) rather than a table/canvas library.
//
// Page 1: header, stat cards, operational recommendation, route sketch,
//         vessel threshold text.
// Page 2+: full per-sample table, paginated manually (jsPDF has no
//         built-in table pagination without the autotable plugin, which
//         this app doesn't depend on).

// jsPDF is loaded lazily (dynamic import), not at module top-level -- same
// pattern as widget1's SuitabilityPDFExporter.js. Two reasons: it keeps
// jsPDF out of the main bundle until someone actually exports a PDF, and it
// keeps the pure-logic helpers below (formatNumber, routeThresholdText,
// findWorstRun, etc.) importable and unit-testable in plain Node/jsdom --
// jsPDF's Node build pulls in a PNG decoder chain that needs TextEncoder/
// TextDecoder, which CRA's default jsdom test environment doesn't provide,
// and which a real browser (where this code actually runs) always does.
import { HAZARD_COLORS, VESSEL_OPERATING_ENVELOPE, VESSEL_CLASS_OPTIONS } from '../lib/CookIslandsSuitabilityOverlay';
import { tzLabel } from '../utils/timeZoneFormat';

// Exported (not just module-local) so CookIslandsScenarioComparisonPdf.js can
// reuse these same low-level drawing primitives and the app's own visual
// language (header band, footer disclaimer, hazard palette) instead of a
// second copy of them -- see that file's header comment.
export const PAGE_W = 210; // A4 portrait, mm
export const HDR_H = 22;
export const HEADER_BG = [15, 42, 66]; // dark navy, matches the app's header band
const ACCENT = [0, 212, 255];        // #00d4ff, the app's own accent cyan
export const TEXT_LT = [255, 255, 255];
export const TEXT_MD = [90, 100, 110];
export const TEXT_DK = [30, 35, 40];
export const GRID_CLR = [220, 224, 228];
export const NO_DATA_GREY = [150, 150, 150];

const HAZARD_LIGHT = {
  0: [220, 243, 240],
  1: [255, 240, 219],
  2: [252, 222, 224],
};
const HAZARD_TEXT = {
  0: [25, 94, 89],
  1: [150, 95, 10],
  2: [166, 34, 43],
};

export function setFill(doc, rgb) { doc.setFillColor(...rgb); }
export function setDraw(doc, rgb) { doc.setDrawColor(...rgb); }
export function setFont(doc, rgb, size, style = 'normal') {
  doc.setTextColor(...rgb);
  doc.setFontSize(size);
  doc.setFont('helvetica', style);
}
export function rect(doc, x, y, w, h, fill, draw, lw = 0.1) {
  setFill(doc, fill);
  if (draw) { setDraw(doc, draw); doc.setLineWidth(lw); }
  doc.rect(x, y, w, h, draw ? 'FD' : 'F');
}

export function hazardColor(h) { return HAZARD_COLORS[h] ? hexToRgb(HAZARD_COLORS[h]) : NO_DATA_GREY; }
export function hazardLight(h) { return HAZARD_LIGHT[h] ?? [235, 236, 238]; }
export function hazardText(h) { return HAZARD_TEXT[h] ?? TEXT_MD; }
function hexToRgb(hex) {
  const raw = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16));
}

export function formatNumber(value, digits = 1) {
  // null/undefined must short-circuit before Number() -- Number(null) is 0,
  // which is finite, so this would otherwise fabricate a "0" reading for an
  // explicitly unavailable (out-of-domain) sample.
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

export function formatEta(dateLike, timeDisplayZone) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timeDisplayZone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

// Reads the page's own actual width off the doc (doc.internal.pageSize.
// getWidth()) rather than assuming the portrait PAGE_W constant -- both
// existing reports (route advisory, scenario comparison) are portrait, so
// getWidth() returns exactly PAGE_W (210) for them and this is a no-op
// behavior change, but it lets a landscape report (the landing-area
// comparison heatmap needs the extra width for many site rows x many date
// columns) reuse this same header/footer drawing instead of a second copy
// hardcoded to a different width.
export function drawHeaderBand(doc, { title, subtitle, rightLine1, rightLine2 }) {
  const pageWidth = doc.internal.pageSize.getWidth();
  rect(doc, 0, 0, pageWidth, HDR_H, HEADER_BG);
  setFont(doc, TEXT_LT, 15, 'bold');
  doc.text(title, 8, HDR_H * 0.45);
  if (subtitle) {
    setFont(doc, ACCENT, 9);
    doc.text(subtitle, 8, HDR_H * 0.8);
  }
  if (rightLine1) {
    setFont(doc, TEXT_LT, 8.5);
    doc.text(rightLine1, pageWidth - 8, HDR_H * 0.45, { align: 'right' });
  }
  if (rightLine2) {
    setFont(doc, [200, 210, 220], 7.5);
    doc.text(rightLine2, pageWidth - 8, HDR_H * 0.8, { align: 'right' });
  }
}

export const MODEL_DISCLAIMER = 'SWAN wave model guidance. Vessel operating envelope thresholds are advisory defaults, not navigation advice — use alongside official warnings and local seamanship.';
export function drawFooter(doc) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  setFont(doc, TEXT_MD, 6.2, 'italic');
  const lines = doc.splitTextToSize(MODEL_DISCLAIMER, pageWidth - 16);
  doc.text(lines, pageWidth / 2, pageHeight - 4 - (lines.length - 1) * 3, { align: 'center' });
}

function projectLonLatToRect(lon, lat, bbox, rectX, rectY, rectW, rectH) {
  const px = rectX + ((lon - bbox.lonMin) / (bbox.lonMax - bbox.lonMin)) * rectW;
  const py = rectY + (1 - (lat - bbox.latMin) / (bbox.latMax - bbox.latMin)) * rectH;
  return [px, py];
}

function drawRouteSketch(doc, x, y, w, h, samples) {
  rect(doc, x, y, w, h, [221, 239, 243], GRID_CLR, 0.3);

  const points = samples.filter((s) => Number.isFinite(s.lon) && Number.isFinite(s.lat));
  if (points.length < 2) {
    setFont(doc, TEXT_MD, 7, 'italic');
    doc.text('Route sketch unavailable', x + w / 2, y + h / 2, { align: 'center' });
    return;
  }

  const lons = points.map((p) => p.lon);
  const lats = points.map((p) => p.lat);
  const PAD = 0.02;
  const bbox = {
    lonMin: Math.min(...lons) - PAD, lonMax: Math.max(...lons) + PAD,
    latMin: Math.min(...lats) - PAD, latMax: Math.max(...lats) + PAD,
  };
  if (bbox.lonMax === bbox.lonMin) { bbox.lonMax += PAD; bbox.lonMin -= PAD; }
  if (bbox.latMax === bbox.latMin) { bbox.latMax += PAD; bbox.latMin -= PAD; }

  const project = (lon, lat) => projectLonLatToRect(lon, lat, bbox, x, y, w, h);

  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = project(points[i - 1].lon, points[i - 1].lat);
    const [x1, y1] = project(points[i].lon, points[i].lat);
    const prevHazard = points[i - 1].hazard_class;
    const segColor = Number.isFinite(prevHazard)
      ? hazardColor(Math.max(prevHazard, Number.isFinite(points[i].hazard_class) ? points[i].hazard_class : prevHazard))
      : NO_DATA_GREY;
    setDraw(doc, segColor);
    doc.setLineWidth(1.1);
    doc.line(x0, y0, x1, y1);
  }

  const [ox, oy] = project(points[0].lon, points[0].lat);
  const [dx, dy] = project(points[points.length - 1].lon, points[points.length - 1].lat);
  setFill(doc, [34, 197, 94]);
  doc.circle(ox, oy, 1.3, 'F');
  setFill(doc, [239, 68, 68]);
  doc.circle(dx, dy, 1.3, 'F');
}

// ── route-specific analysis helpers (trimmed from widget1's exporter) ──────

export function routeAvailableSamples(samples = []) {
  return samples.filter((s) => s?.available !== false && Number.isFinite(s?.hazard_class));
}

export function getWorstRouteSample(samples = []) {
  return routeAvailableSamples(samples).reduce((worst, sample) => {
    if (!worst) return sample;
    if (sample.hazard_class > worst.hazard_class) return sample;
    if (sample.hazard_class === worst.hazard_class && new Date(sample.eta) < new Date(worst.eta)) return sample;
    return worst;
  }, null);
}

// Start/end of the single worst contiguous hazard run along the route (by
// eta), not just the single worst sample -- powers "between HH:MM-HH:MM"
// phrasing in the recommendation sentence below.
export function findWorstRun(samples = []) {
  const avail = routeAvailableSamples(samples);
  if (!avail.length) return null;
  let worstHazard = -1, worstLen = 0, worstStart = null, worstEnd = null;
  let runStart = 0, runHazard = Number(avail[0].hazard_class);
  for (let i = 0; i <= avail.length; i++) {
    const haz = i < avail.length ? Number(avail[i].hazard_class) : null;
    if (i === avail.length || haz !== runHazard) {
      const len = i - runStart;
      if (runHazard > worstHazard || (runHazard === worstHazard && len > worstLen)) {
        worstHazard = runHazard;
        worstLen = len;
        worstStart = avail[runStart];
        worstEnd = avail[i - 1];
      }
      runStart = i;
      runHazard = haz;
    }
  }
  if (!worstStart) return null;
  return { hazard: worstHazard, startTime: worstStart.eta, endTime: worstEnd.eta };
}

export function routeOperationalRecommendation({ hazardAvailable, hazard, worstRun, timeDisplayZone }) {
  if (!hazardAvailable) {
    return 'Assessment unavailable — insufficient model coverage along this route.';
  }
  if (hazard === 0) {
    return 'Proceed within the assessed departure window.';
  }
  const startTime = worstRun?.startTime ? formatEta(worstRun.startTime, timeDisplayZone) : null;
  const endTime = worstRun?.endTime ? formatEta(worstRun.endTime, timeDisplayZone) : null;
  const windowText = startTime && endTime && startTime !== endTime
    ? ` between ${startTime}-${endTime}`
    : (startTime ? ` near ${startTime}` : '');
  if (hazard === 1) {
    return `Proceed with caution — conditions approach the operating threshold${windowText}.`;
  }
  return `Delay departure — operating envelope exceeded${windowText}.`;
}

// Route hazard classes come from the server, which always scores against the
// vessel's preset thresholds. When the map was showing user-edited thresholds
// (Custom mode), say so explicitly rather than let the two silently disagree.
export function customEnvelopeNoteText(envelope) {
  if (!envelope) return null;
  const { cautionWindKt, maxWindKt, cautionWaveHeightM, maxWaveHeightM } = envelope;
  if (![cautionWindKt, maxWindKt, cautionWaveHeightM, maxWaveHeightM].every(Number.isFinite)) return null;
  return `The map was set to custom thresholds (caution ${formatNumber(cautionWindKt, 0)} kt / ${formatNumber(cautionWaveHeightM, 1)} m, `
    + `warning ${formatNumber(maxWindKt, 0)} kt / ${formatNumber(maxWaveHeightM, 1)} m). `
    + 'This route was classified against the preset thresholds above, so map colours may differ from this advisory.';
}

export function routeThresholdText(vesselCode) {
  const rule = VESSEL_OPERATING_ENVELOPE[vesselCode];
  if (!rule) return 'Thresholds unavailable for this vessel class.';
  return `Caution from ${formatNumber(rule.cautionWindKt, 0)} kt or ${formatNumber(rule.cautionWaveHeightM, 1)} m — `
    + `Warning from ${formatNumber(rule.maxWindKt, 0)} kt or ${formatNumber(rule.maxWaveHeightM, 1)} m.`;
}

export function StatCard(doc, x, y, w, h, label, value, valueColor = TEXT_DK) {
  rect(doc, x, y, w, h, [255, 255, 255], GRID_CLR, 0.25);
  setFont(doc, TEXT_MD, 6.2, 'bold');
  doc.text(label.toUpperCase(), x + 3, y + 5.5);
  setFont(doc, valueColor, 11, 'bold');
  doc.text(value, x + 3, y + 12.5);
}

// ── main export ─────────────────────────────────────────────────────────────

// result: the normalized object from cookIslandsRouteForecastService.js's
// normalizeRouteForecastResponse (samples/segments/summary already
// null-safe). vessel: vessel class code. speedKt: number.
//
// Split from exportCookIslandsRouteAdvisoryPdf below so tests can inspect
// the built jsPDF document (page count, output bytes) without needing a
// browser's download machinery -- doc.save() below is a thin, untestable
// side effect on top of this.
export async function buildCookIslandsRouteAdvisoryPdfDoc({ result, vessel, speedKt, timeDisplayZone = 'Pacific/Rarotonga', mapCustomEnvelope = null, modelRunStart = null }) {
  if (!result) throw new Error('No route forecast result to export.');

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setProperties({
    title: 'Cook Islands Route Advisory',
    subject: 'Vessel route suitability forecast',
    creator: 'Cook Islands Ocean Dashboard',
    author: 'Pacific Community (SPC)',
  });
  doc.setLanguage('en');

  const samples = Array.isArray(result.samples) ? result.samples : [];
  const summary = result.summary ?? {};
  const vesselLabel = VESSEL_CLASS_OPTIONS.find((v) => v.value === vessel)?.label ?? vessel;
  const worstSample = getWorstRouteSample(samples);
  const worstRun = findWorstRun(samples);
  const hazardAvailable = Number.isFinite(summary.worst_hazard_class);
  const generatedAt = new Date();

  // ── page 1 ──────────────────────────────────────────────────────────────
  drawHeaderBand(doc, {
    title: 'Cook Islands Route Advisory',
    subtitle: vesselLabel,
    rightLine1: `Departure: ${formatEta(result.departure_time, timeDisplayZone)} ${tzLabel(timeDisplayZone)}`,
    rightLine2: `Generated ${formatEta(generatedAt, timeDisplayZone)} ${tzLabel(timeDisplayZone)}`,
  });

  let y = HDR_H + 8;
  const cardW = (PAGE_W - 16 - 3 * 4) / 4;
  StatCard(doc, 8, y, cardW, 18, 'Distance', `${formatNumber(summary.distance_nm, 1)} nm`);
  StatCard(doc, 8 + (cardW + 4), y, cardW, 18, 'Duration', `${formatNumber(summary.duration_hours, 1)} h`);
  StatCard(doc, 8 + 2 * (cardW + 4), y, cardW, 18, 'Speed', `${formatNumber(speedKt, 1)} kt`);
  StatCard(
    doc, 8 + 3 * (cardW + 4), y, cardW, 18,
    'Worst hazard',
    hazardAvailable ? (summary.recommendation ?? 'Unknown') : 'Unavailable',
    hazardAvailable ? hazardText(summary.worst_hazard_class) : TEXT_MD,
  );

  y += 24;
  const recommendation = routeOperationalRecommendation({
    hazardAvailable, hazard: summary.worst_hazard_class, worstRun, timeDisplayZone,
  });
  const recColor = hazardAvailable ? hazardColor(summary.worst_hazard_class) : NO_DATA_GREY;
  const recBg = hazardAvailable ? hazardLight(summary.worst_hazard_class) : [240, 240, 240];
  const recLines = doc.splitTextToSize(recommendation, PAGE_W - 24);
  const recH = 8 + recLines.length * 5;
  rect(doc, 8, y, PAGE_W - 16, recH, recBg, recColor, 0.6);
  setFont(doc, hazardAvailable ? hazardText(summary.worst_hazard_class) : TEXT_MD, 9, 'bold');
  doc.text(recLines, 12, y + 6);

  y += recH + 6;
  setFont(doc, TEXT_DK, 8.5, 'bold');
  doc.text('Route sketch (schematic — not for navigation)', 8, y);
  y += 4;
  // Not a map: no coastline, scale, or north arrow -- just a coordinate-
  // normalized projection of the route's own points, colored by hazard.
  // Labelled and captioned as schematic so it can't be mistaken for one.
  setFont(doc, TEXT_MD, 6.5, 'italic');
  doc.text('Not to scale. No coastline, bathymetry, or navigational detail — plan and route in a proper charting tool.', 8, y);
  y += 4;
  drawRouteSketch(doc, 8, y, PAGE_W - 16, 55, samples);
  y += 55 + 6;

  setFont(doc, TEXT_DK, 8.5, 'bold');
  doc.text('Vessel operating envelope (preset thresholds)', 8, y);
  y += 5;
  setFont(doc, TEXT_MD, 7.5);
  doc.text(routeThresholdText(vessel), 8, y);
  y += 7;
  const customNote = customEnvelopeNoteText(mapCustomEnvelope);
  if (customNote) {
    setFont(doc, hazardText(1), 7.5, 'bold');
    const noteLines = doc.splitTextToSize(customNote, PAGE_W - 16);
    doc.text(noteLines, 8, y);
    y += noteLines.length * 3.6 + 3;
  }

  // Authoritative forecast provenance -- the header's own "Generated" line
  // (above) is just this browser's clock at export time, not when the
  // underlying forecast was actually produced; conflating the two was the
  // gap here (unlike widget1's exporter, which already pulls its valid time
  // from backend metadata rather than the UI clock). modelRunStart is the
  // same forecast-cycle timestamp already trusted elsewhere in this app to
  // detect a stale/superseded scenario (see cookIslandsScenarioService.js's
  // isScenarioSuperseded) -- not fabricated, just not previously surfaced
  // here. Left as "unavailable" rather than silently omitted when the
  // caller has no model-run time to give (e.g. the wave layer hasn't
  // finished loading its own timestamps yet), matching this codebase's
  // usual explicit-over-hidden handling of missing provenance (compare
  // cookIslandsImpactService.js's population validity flag). Grid
  // resolution, dataset version, and coverage extent are NOT included here:
  // /cok/suitability/route's response carries none of them today, and
  // stating a number this app doesn't actually have would be exactly the
  // fabricated precision this report is warning against.
  setFont(doc, TEXT_DK, 8.5, 'bold');
  doc.text('Forecast provenance', 8, y);
  y += 5;
  setFont(doc, TEXT_MD, 7.5);
  const modelRunText = modelRunStart
    ? `Model run: ${formatEta(modelRunStart, timeDisplayZone)} ${tzLabel(timeDisplayZone)}`
    : 'Model run: unavailable';
  doc.text(`${modelRunText} · Source: SWAN wave model forecast (Cook Islands) via /cok/suitability/route`, 8, y);
  y += 7;

  if (worstSample) {
    setFont(doc, TEXT_DK, 8.5, 'bold');
    doc.text('Worst point on route', 8, y);
    y += 5;
    setFont(doc, TEXT_MD, 7.5);
    doc.text(
      `${formatEta(worstSample.eta, timeDisplayZone)} ${tzLabel(timeDisplayZone)} · ${formatNumber(worstSample.distance_nm, 1)} nm · `
      + `Wind ${formatNumber(worstSample.wind_speed_kt, 1)} kt · Wave ${formatNumber(worstSample.wave_height_m, 2)} m · `
      + `${worstSample.lat?.toFixed(4)}, ${worstSample.lon?.toFixed(4)}`,
      8, y,
    );
  }

  drawFooter(doc);

  // ── page(s) 2+: full sample table ────────────────────────────────────────
  if (samples.length > 0) {
    drawSampleTablePages(doc, samples, timeDisplayZone);
  }

  const filename = `cook_islands_route_advisory_${vessel}_${generatedAt.toISOString().slice(0, 16).replace(/[:T]/g, '')}.pdf`;
  return { doc, filename };
}

export async function exportCookIslandsRouteAdvisoryPdf(params) {
  const { doc, filename } = await buildCookIslandsRouteAdvisoryPdfDoc(params);
  doc.save(filename);
  return filename;
}

function drawSampleTablePages(doc, samples, timeDisplayZone) {
  const columns = [
    { key: 'eta', label: `ETA (${tzLabel(timeDisplayZone)})`, w: 34 },
    { key: 'distance_nm', label: 'Dist (nm)', w: 20 },
    { key: 'hazard_label', label: 'Hazard', w: 24 },
    { key: 'wave_height_m', label: 'Wave (m)', w: 22 },
    { key: 'wind_speed_kt', label: 'Wind (kt)', w: 22 },
    { key: 'position', label: 'Position', w: 40 },
  ];
  const tableX = 8;
  const tableW = columns.reduce((sum, c) => sum + c.w, 0);
  const rowH = 6;
  const headerH = 7;
  const pageH = doc.internal.pageSize.getHeight();
  const bottomMargin = 12;

  let page = 0;
  let y = 0;

  function newTablePage() {
    // Finalize the page being left behind before moving on -- without this,
    // only page 1 (footer drawn explicitly before the table starts, below)
    // and the very last table page (footer drawn once after the forEach
    // loop finishes) ever got a footer; every page in between a multi-page
    // table was missing the model disclaimer entirely. Guarded on page > 0
    // so the *first* newTablePage() call (page still 0, about to become
    // document page 2) doesn't redraw page 1's footer a second time on top
    // of the one already drawn before drawSampleTablePages() was called.
    if (page > 0) drawFooter(doc);
    doc.addPage();
    page += 1;
    drawHeaderBand(doc, { title: 'Cook Islands Route Advisory', subtitle: `Full sample table (page ${page + 1})` });
    y = HDR_H + 8;
    drawTableHeader();
  }

  function drawTableHeader() {
    rect(doc, tableX, y, tableW, headerH, HEADER_BG);
    setFont(doc, TEXT_LT, 6.8, 'bold');
    let cx = tableX;
    for (const col of columns) {
      doc.text(col.label, cx + 2, y + headerH * 0.65);
      cx += col.w;
    }
    y += headerH;
  }

  newTablePage();

  samples.forEach((sample, index) => {
    if (y + rowH > pageH - bottomMargin) {
      newTablePage();
    }
    if (index % 2 === 1) rect(doc, tableX, y, tableW, rowH, [246, 248, 250]);
    const hazard = sample.hazard_class;
    const values = {
      eta: formatEta(sample.eta, timeDisplayZone),
      distance_nm: formatNumber(sample.distance_nm, 1),
      hazard_label: sample.hazard_label ?? '—',
      wave_height_m: formatNumber(sample.wave_height_m, 2),
      wind_speed_kt: formatNumber(sample.wind_speed_kt, 1),
      position: Number.isFinite(sample.lat) ? `${sample.lat.toFixed(3)}, ${sample.lon.toFixed(3)}` : '—',
    };
    let cx = tableX;
    for (const col of columns) {
      if (col.key === 'hazard_label') {
        setFont(doc, Number.isFinite(hazard) ? hazardColor(hazard) : TEXT_MD, 7, 'bold');
      } else {
        setFont(doc, TEXT_DK, 7);
      }
      doc.text(String(values[col.key]), cx + 2, y + rowH * 0.68);
      cx += col.w;
    }
    y += rowH;
  });

  drawFooter(doc);
}
