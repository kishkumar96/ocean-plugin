// CookIslandsRouteAdvisoryPdf.js
// Generates a two-page route advisory PDF from an already-run Cook Islands
// route forecast result (see cookIslandsRouteForecastService.js).
//
// Page 1 (decision brief) and page 2 (supporting evidence) are built to
// match widget1's route-PDF template structurally -- landscape A4, 5 stat
// cards, a critical-point panel, a time-proportional hazard ribbon, a
// curated (not dumped) sample table, and a wind/wave chart -- while keeping
// Cook Islands' own header colors, timezone, vessel presets, and geography.
// No tide/current chart: unlike Niue, this app has no sea-level dataset to
// draw one from (confirmed elsewhere in this codebase), so that page-2
// element is skipped entirely rather than faked.
//
// PAGE_W/HDR_H below stay their existing portrait values -- they're shared,
// exported constants CookIslandsScenarioComparisonPdf.js also imports and
// relies on for its own (still-portrait) layout math. This file's own
// landscape page width/height are read locally off the doc instance inside
// buildCookIslandsRouteAdvisoryPdfDoc instead, the same way
// drawHeaderBand/drawFooter already do -- that's what makes this file safe
// to switch to landscape without silently breaking a sibling report that
// still imports these same constants.

// jsPDF is loaded lazily (dynamic import), not at module top-level -- same
// pattern as widget1's SuitabilityPDFExporter.js. Two reasons: it keeps
// jsPDF out of the main bundle until someone actually exports a PDF, and it
// keeps the pure-logic helpers below (formatNumber, routeThresholdText,
// findWorstRun, etc.) importable and unit-testable in plain Node/jsdom --
// jsPDF's Node build pulls in a PNG decoder chain that needs TextEncoder/
// TextDecoder, which CRA's default jsdom test environment doesn't provide,
// and which a real browser (where this code actually runs) always does.
import { VESSEL_OPERATING_ENVELOPE, VESSEL_CLASS_OPTIONS, deriveSuitabilityDriver } from '../lib/CookIslandsSuitabilityOverlay';
import { tzLabel } from '../utils/timeZoneFormat';
import { coverageConfidence } from '../reports/reportRules';
import { pickWorstSample, thresholdsForHazard } from '../domain/suitability/routeSeverity';
import { ISLAND_ZOOM_TARGETS } from '../config/islandConfig';

// Shared visual theme (page furniture, palette, hazard colours, formatting) -- see pdfTheme.js.
// Re-exported here because the scenario and landing reports historically imported these from
// this file.
import {
  PAGE_W, HDR_H, HEADER_BG, TEXT_LT, TEXT_MD, TEXT_DK, GRID_CLR, NO_DATA_GREY,
  setFill, setDraw, setFont, rect, hazardColor, hazardLight, hazardText, hazardLabel,
  formatNumber, formatEta, drawHeaderBand, drawFooter, MODEL_DISCLAIMER, StatCard, ensureReportFont,
} from './pdfTheme';

export {
  PAGE_W, HDR_H, HEADER_BG, TEXT_LT, TEXT_MD, TEXT_DK, GRID_CLR, NO_DATA_GREY,
  setFill, setDraw, setFont, rect, hazardColor, hazardLight, hazardText, hazardLabel,
  formatNumber, formatEta, drawHeaderBand, drawFooter, MODEL_DISCLAIMER, StatCard,
};

const WIND_LINE = [56, 189, 248];    // sky-400, distinct from both hazard colors and the wave line below
const WAVE_LINE = [167, 139, 250];   // violet-400
const DRIVER_LABELS = { none: 'None', wind: 'Wind', waves: 'Waves', wind_and_waves: 'Wind & waves' };

// A route's lon/lat bounding box almost never matches the sketch box's own aspect
// ratio -- independently stretching lon to fill the box width and lat to fill its
// height (this function's previous behaviour) warps the route's true shape, so a
// route that's mostly a straight line with one small jog gets that jog stretched
// out into what reads as a dramatic zig-zag. This preserves true proportions
// (also correcting for longitude degrees covering less true distance than
// latitude degrees away from the equator, via cos(latitude)) and letterboxes the
// result centred in the box, the way any real map projection would, instead of
// distorting the geometry to fill every pixel.
function computeRouteSketchProjection(bbox, rectX, rectY, rectW, rectH) {
  const midLatRad = ((bbox.latMin + bbox.latMax) / 2) * (Math.PI / 180);
  const lonScale = Math.cos(midLatRad) || 1;
  const lonSpanEq = Math.max((bbox.lonMax - bbox.lonMin) * lonScale, 1e-9);
  const latSpanEq = Math.max(bbox.latMax - bbox.latMin, 1e-9);
  const scale = Math.min(rectW / lonSpanEq, rectH / latSpanEq);
  const usedW = lonSpanEq * scale;
  const usedH = latSpanEq * scale;
  const offsetX = rectX + (rectW - usedW) / 2;
  const offsetY = rectY + (rectH - usedH) / 2;
  return (lon, lat) => [
    offsetX + (lon - bbox.lonMin) * lonScale * scale,
    offsetY + (bbox.latMax - lat) * scale,
  ];
}

// Named islands (islandConfig.js -- the same list the on-screen "Island Navigation"
// jump-to menu uses) whose centre falls within the route's own plotted extent.
// Gives the schematic sketch a geographic anchor or two ("near Rarotonga") without
// needing real coastline/basemap data; a route through open ocean far from any
// named island correctly shows none, rather than always forcing a nearest one.
export function nearbyIslandsForRouteSketch(bbox) {
  return ISLAND_ZOOM_TARGETS
    .map((island) => ({
      label: island.label,
      lon: (island.bounds.southWest[1] + island.bounds.northEast[1]) / 2,
      lat: (island.bounds.southWest[0] + island.bounds.northEast[0]) / 2,
    }))
    .filter((p) => p.lon >= bbox.lonMin && p.lon <= bbox.lonMax && p.lat >= bbox.latMin && p.lat <= bbox.latMax);
}

function drawRouteSketch(doc, x, y, w, h, samples, vesselCode = null) {
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

  const project = computeRouteSketchProjection(bbox, x, y, w, h);

  const nearbyIslands = nearbyIslandsForRouteSketch(bbox);
  nearbyIslands.forEach((island) => {
    const [ix, iy] = project(island.lon, island.lat);
    setFill(doc, [120, 134, 148]);
    doc.circle(ix, iy, 0.6, 'F');
    setFont(doc, TEXT_MD, 5.2);
    doc.text(island.label, ix + 1.4, iy + 1.2);
  });

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

  // Departure/destination use neutral navy markers with text labels, NOT green/red:
  // those are the hazard colours the route line itself is drawn in, so a green
  // origin on a Warning segment (or a red destination on a Suitable one) read as
  // a hazard rating for the endpoint.
  const [ox, oy] = project(points[0].lon, points[0].lat);
  const [dx, dy] = project(points[points.length - 1].lon, points[points.length - 1].lat);
  setFill(doc, HEADER_BG);
  doc.circle(ox, oy, 1.6, 'F');
  doc.rect(dx - 1.5, dy - 1.5, 3, 3, 'F');
  setFont(doc, HEADER_BG, 6.2, 'bold');
  doc.text('Departure', ox + 2.6, oy + 0.9);
  doc.text('Destination', dx + 2.6, dy + 0.9);

  // Critical-point marker -- a distinct diamond (not reused circle/triangle
  // shapes, so it can't be mistaken for start/destination or the timeline
  // ribbon's own worst-sample marker elsewhere on the same page) at the
  // single worst available sample, if any.
  const worst = getWorstRouteSample(points, vesselCode);
  if (worst && worst !== points[0] && worst !== points[points.length - 1]) {
    const [wx, wy] = project(worst.lon, worst.lat);
    setFill(doc, TEXT_DK);
    doc.triangle(wx, wy - 1.8, wx + 1.8, wy, wx, wy + 1.8, 'F');
    doc.triangle(wx, wy - 1.8, wx - 1.8, wy, wx, wy + 1.8, 'F');
    setFont(doc, TEXT_DK, 6.2, 'bold');
    doc.text('Critical point', wx + 2.6, wy + 0.9);
  }
}

// Text width in mm; jsPDF measures it exactly, the ~1.2 mm/char fallback only keeps
// layout math finite under the stub documents the unit tests use.
const textWidth = (doc, str) => doc.getTextWidth?.(str) ?? String(str).length * 1.2;

// Key for the sketch's symbols and line colours, so the page reads without
// guessing: colour alone is not the only cue (markers carry labels too).
export function drawRouteSketchLegend(doc, x, y, w) {
  rect(doc, x, y, w, 8, [255, 255, 255], GRID_CLR, 0.25);
  setFont(doc, TEXT_MD, 6.2);
  let lx = x + 3;
  const cy = y + 4.4;
  setFill(doc, HEADER_BG);
  doc.circle(lx + 1, cy - 0.8, 1.2, 'F'); doc.text('Departure', lx + 3.6, cy); lx += 20;
  doc.rect(lx, cy - 2, 2.4, 2.4, 'F'); doc.text('Destination', lx + 3.6, cy); lx += 24;
  doc.triangle(lx + 1.2, cy - 2.4, lx + 2.6, cy - 0.8, lx + 1.2, cy + 0.8, 'F');
  doc.triangle(lx + 1.2, cy - 2.4, lx - 0.2, cy - 0.8, lx + 1.2, cy + 0.8, 'F');
  doc.text('Critical point', lx + 4.4, cy); lx += 26;
  [[0, 'Suitable'], [1, 'Caution'], [2, 'Warning']].forEach(([h, label]) => {
    setDraw(doc, hazardColor(h)); doc.setLineWidth(1.1); doc.line(lx, cy - 0.8, lx + 6, cy - 0.8);
    setFont(doc, TEXT_MD, 6.2); doc.text(label, lx + 7.6, cy); lx += 7.6 + textWidth(doc, label) + 4;
  });
  setDraw(doc, NO_DATA_GREY); doc.setLineWidth(1.1); doc.line(lx, cy - 0.8, lx + 6, cy - 0.8);
  setFont(doc, TEXT_MD, 6.2); doc.text('No data', lx + 7.6, cy);
}

// ── route-specific analysis helpers (trimmed from widget1's exporter) ──────

export function routeAvailableSamples(samples = []) {
  return samples.filter((s) => s?.available !== false && Number.isFinite(s?.hazard_class));
}

// The single most severe sample: highest hazard class, then furthest past its
// own thresholds (see domain/suitability/routeSeverity.js for why "earliest in
// the class" was wrong), then earliest. Pass the vessel class so severity can
// be measured; without it the tie-break falls back to earliest-first.
export function getWorstRouteSample(samples = [], vesselCode = null) {
  return pickWorstSample(routeAvailableSamples(samples), vesselCode);
}

// Start/end of the single worst contiguous hazard run along the route (by
// eta), not just the single worst sample -- powers "between HH:MM-HH:MM"
// phrasing in the recommendation sentence below.
//
// Walks the FULL sample array (not routeAvailableSamples()'s filtered one)
// so a gap of unavailable samples can end a run in progress -- filtering
// unavailable samples out first, as this used to do, silently deletes the
// gap: two real hazard periods either side of missing model coverage then
// read as one uninterrupted run spanning the whole gap between them
// (confirmed live: a route with hazard=2 samples at the start and end of
// an out-of-domain gap in the middle reported one continuous "worst run"
// covering the entire span, implying continuous danger through a stretch
// the model actually said nothing about). A gap must end whatever run was
// open, not be silently bridged.
export function findWorstRun(samples = []) {
  let worstHazard = -1, worstLen = 0, worstStart = null, worstEnd = null;
  let runHazard = null, runStart = null, runEnd = null, runLen = 0;

  const closeRun = () => {
    if (runStart === null) return;
    if (runHazard > worstHazard || (runHazard === worstHazard && runLen > worstLen)) {
      worstHazard = runHazard;
      worstLen = runLen;
      worstStart = runStart;
      worstEnd = runEnd;
    }
    runHazard = null;
    runStart = null;
    runEnd = null;
    runLen = 0;
  };

  for (const sample of samples) {
    const available = sample?.available !== false && Number.isFinite(sample?.hazard_class);
    if (!available) {
      closeRun(); // gap in coverage -- end any run in progress, start fresh after it
      continue;
    }
    const haz = Number(sample.hazard_class);
    if (runStart === null || haz !== runHazard) {
      closeRun();
      runHazard = haz;
      runStart = sample;
      runLen = 0;
    }
    runEnd = sample;
    runLen += 1;
  }
  closeRun();

  if (!worstStart) return null;
  return { hazard: worstHazard, startTime: worstStart.eta, endTime: worstEnd.eta };
}

// How far past the relevant threshold (caution or warning, whichever the
// sample's own hazard_class actually crossed) the worst sample's driving
// parameter is, and which parameter (wind/waves) that is -- the "amount
// above threshold" the critical-point panel reports. Reuses
// deriveSuitabilityDriver/classifyAgainstOperatingEnvelope's own >=
// comparison (via VESSEL_OPERATING_ENVELOPE) so this number can never
// disagree with the hazard_class the sample was actually classified as.
// Returns null when there's nothing to report (no hazard, unknown vessel,
// or non-finite readings).
export function computeExceedance(vesselCode, sample) {
  const envelope = VESSEL_OPERATING_ENVELOPE[vesselCode];
  // null/undefined must short-circuit before Number() -- Number(null) is 0
  // (finite), which would otherwise read a genuinely missing wind/wave
  // reading as "confirmed calm" and attribute the hazard to the other
  // parameter instead of reporting "unknown" (same footgun formatNumber's
  // own header comment above already documents for this file).
  if (sample?.wind_speed_kt === null || sample?.wind_speed_kt === undefined) return null;
  if (sample?.wave_height_m === null || sample?.wave_height_m === undefined) return null;
  const windKt = Number(sample.wind_speed_kt);
  const waveM = Number(sample.wave_height_m);
  if (!envelope || !Number.isFinite(windKt) || !Number.isFinite(waveM)) return null;
  const driver = deriveSuitabilityDriver(vesselCode, windKt, waveM);
  if (!driver || driver === 'none') return null;

  const hazard = Number(sample.hazard_class);
  const { windKt: windThreshold, waveM: waveThreshold } = thresholdsForHazard(envelope, hazard);
  const windExceed = windKt - windThreshold;
  const waveExceed = waveM - waveThreshold;

  if (driver === 'wind') return { driver, amount: windExceed, unit: 'kt' };
  if (driver === 'waves') return { driver, amount: waveExceed, unit: 'm' };
  // wind_and_waves: the panel shows one headline "+X" figure, so report
  // whichever parameter is exceeding its own threshold by more -- compared as
  // a fraction of each threshold. The raw differences are kt vs m and must
  // never be compared to each other (0.9 kt is not "less" than 0.8 m).
  return windExceed / windThreshold >= waveExceed / waveThreshold
    ? { driver, amount: windExceed, unit: 'kt' }
    : { driver, amount: waveExceed, unit: 'm' };
}

// Curated table rows: pins the first, last, and worst-hazard sample (so
// the start, end, and single most important reading are never resampled
// away), then fills the remaining row budget by even index-stride
// resampling across the full route -- same technique this app's own
// heatmapSteps.js/widget1's selectHeatmapSteps use for date-column
// selection. Returns every sample unchanged when there are already fewer
// than maxRows -- curation only kicks in once dumping everything would
// actually be unwieldy. Never returns MORE than maxRows (a Set dedupes any
// stride index that lands on an already-pinned one), so callers can rely
// on that as a hard upper bound, not just a target.
export function selectRouteTableRows(samples = [], maxRows = 14, vesselCode = null) {
  if (samples.length <= maxRows) return samples;

  const worst = getWorstRouteSample(samples, vesselCode);
  const worstIdx = worst ? samples.indexOf(worst) : -1;
  const pinned = new Set([0, samples.length - 1]);
  if (worstIdx >= 0) pinned.add(worstIdx);

  const remaining = maxRows - pinned.size;
  const rows = new Set(pinned);
  if (remaining > 0) {
    const stride = (samples.length - 1) / (remaining + 1);
    for (let i = 1; i <= remaining; i++) {
      rows.add(Math.round(i * stride));
    }
  }
  return [...rows].sort((a, b) => a - b).map((i) => samples[i]);
}

// Advisory language, not operational commands: this is a modelled rating
// against a configured threshold, not clearance to sail or an order to
// stand down -- "Proceed"/"Delay departure" read as instructions this
// model has no authority to give. "Modelled route rating" frames every
// sentence as what it actually is, and the hazard>=1 cases describe the
// condition ("conditions approach/exceed the configured envelope") before
// suggesting a response ("consider delaying"), rather than leading with
// the command.
export function routeOperationalRecommendation({
  hazardAvailable, hazard, worstRun, timeDisplayZone, coverage = null,
}) {
  if (!hazardAvailable) {
    return 'Assessment unavailable — insufficient model coverage along this route.';
  }
  // Below MIN_COVERAGE (reportRules), a hazard reading from the assessed slice
  // isn't grounds for a route-wide instruction -- report the evidence (the Rating
  // card above still shows it) but withhold "consider delaying departure"/"Suitable"
  // either way, matching the coverage gate the scenario-comparison report already
  // enforces (reportRules.MIN_COVERAGE / coverageConfidence).
  if (coverage?.confidence === 'insufficient') {
    const pct = Math.round((coverage.ratio ?? 0) * 100);
    const hazardNote = hazard > 0
      ? ` ${hazard === 1 ? 'Caution' : 'Warning'}-level conditions occur within the assessed portion.`
      : '';
    return `Assessment incomplete — only ${pct}% of the route could be modelled.${hazardNote} No route recommendation can be produced from this assessment.`;
  }
  if (hazard === 0) {
    return 'Modelled route rating: Suitable within the assessed departure window.';
  }
  const startTime = worstRun?.startTime ? formatEta(worstRun.startTime, timeDisplayZone) : null;
  const endTime = worstRun?.endTime ? formatEta(worstRun.endTime, timeDisplayZone) : null;
  const windowText = startTime && endTime && startTime !== endTime
    ? ` between ${startTime}-${endTime}`
    : (startTime ? ` near ${startTime}` : '');
  if (hazard === 1) {
    return `Modelled route rating: Caution — conditions approach the configured envelope${windowText}.`;
  }
  return `Modelled route rating: Conditions exceed the configured envelope${windowText} — consider delaying departure.`;
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

// Where the thresholds come from, stated as fact: the preset envelope is generated from
// the pipeline's vessel_suitability_rules.yaml (see the VESSEL_META comment in
// CookIslandsSuitabilityOverlay.js). What is NOT known is stated too, rather than
// implied: no approving authority, version or effective date is recorded for them.
export function thresholdProvenanceText(vesselCode) {
  const label = VESSEL_OPERATING_ENVELOPE[vesselCode]?.label ?? vesselCode;
  return `Preset thresholds for ${label}, generated from the forecast pipeline's vessel_suitability_rules. These are advisory defaults: `
    + 'no approving authority, version or effective date is recorded for them.';
}

export const ROUTE_NOTICE = 'Modelled guidance only. This advisory rates wind and waves along the route against preset vessel thresholds. '
  + 'It is not a forecast of what you will experience at sea and it is not navigation advice; conditions can differ locally and change quickly. '
  + 'Check official marine warnings and use local knowledge and seamanship.';

export function routeThresholdText(vesselCode) {
  const rule = VESSEL_OPERATING_ENVELOPE[vesselCode];
  if (!rule) return 'Thresholds unavailable for this vessel class.';
  return `Caution from ${formatNumber(rule.cautionWindKt, 0)} kt or ${formatNumber(rule.cautionWaveHeightM, 1)} m — `
    + `Warning from ${formatNumber(rule.maxWindKt, 0)} kt or ${formatNumber(rule.maxWaveHeightM, 1)} m.`;
}


// Only rendered by the caller when hazard >= 1 (matching widget1: an
// all-clear route has no "critical point" worth a dedicated panel). Shows
// the single worst sample -- time, position, wind/wave readings, how far
// past its threshold it is, and how long that severity was sustained for
// (via worstRun), so a reader isn't left wondering whether the worst
// moment was a one-off spike or a sustained stretch.
export function drawCriticalPointPanel(doc, x, y, w, h, { worstSample, exceedance, worstRun, timeDisplayZone }) {
  const haz = worstSample?.hazard_class;
  rect(doc, x, y, w, h, hazardLight(haz), hazardColor(haz), 0.5);

  setFont(doc, hazardText(haz), 8, 'bold');
  doc.text(`CRITICAL POINT — ${hazardLabel(haz).toUpperCase()}`, x + 4, y + 6);

  setFont(doc, TEXT_DK, 7.5);
  const posText = Number.isFinite(worstSample?.lat)
    ? `${worstSample.lat.toFixed(4)}, ${worstSample.lon.toFixed(4)}`
    : 'position unavailable';
  doc.text(
    `${formatEta(worstSample?.eta, timeDisplayZone)} · ${formatNumber(worstSample?.distance_nm, 1)} nm along route · ${posText}`,
    x + 4, y + 11.5,
  );
  doc.text(
    `Wind ${formatNumber(worstSample?.wind_speed_kt, 1)} kt · Wave ${formatNumber(worstSample?.wave_height_m, 2)} m`,
    x + 4, y + 16.5,
  );

  if (exceedance) {
    const sign = exceedance.amount >= 0 ? '+' : '';
    setFont(doc, hazardText(haz), 7.5, 'bold');
    doc.text(
      `${DRIVER_LABELS[exceedance.driver] ?? exceedance.driver} driving this reading: ${sign}${exceedance.amount.toFixed(1)} ${exceedance.unit} past threshold`,
      x + 4, y + 22,
    );
  }

  if (worstRun?.startTime && worstRun?.endTime) {
    setFont(doc, TEXT_MD, 7, 'italic');
    const sameInstant = worstRun.startTime === worstRun.endTime;
    doc.text(
      sameInstant
        ? `Isolated reading at ${formatEta(worstRun.startTime, timeDisplayZone)} — not part of a sustained run.`
        : `Sustained from ${formatEta(worstRun.startTime, timeDisplayZone)} to ${formatEta(worstRun.endTime, timeDisplayZone)}.`,
      x + 4, y + h - 3,
    );
  }
}

// Sea state at the route midpoint at the time the vessel is actually there: height,
// period, direction, how the sea meets the bow, and the wind-sea / primary-swell split.
// Data comes from the wave model feed (buildMidpointConditions), a separate feed from
// the route ratings, and the panel says so.
export function drawMidpointConditionsPanel(doc, x, y, w, h, mc, timeDisplayZone) {
  rect(doc, x, y, w, h, [255, 255, 255], GRID_CLR, 0.4);
  setFont(doc, HEADER_BG, 8, 'bold');
  doc.text('MIDPOINT WAVE CONDITIONS — AT VESSEL ETA', x + 4, y + 6);

  const n = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '—');
  const from = (pt, deg) => (Number.isFinite(deg) ? `${pt} ${Math.round(deg)}°` : '—');
  setFont(doc, TEXT_DK, 7.5);
  doc.text(
    doc.splitTextToSize(`${formatEta(mc.etaIso, timeDisplayZone)} ${tzLabel(timeDisplayZone)} · ${mc.lat.toFixed(3)}, ${mc.lon.toFixed(3)} · route heading ${Math.round(mc.headingDeg)}°`, w - 8),
    x + 4, y + 11.5,
  );
  setFont(doc, TEXT_DK, 7.5, 'bold');
  const angleText = Number.isFinite(mc.angleOffBowDeg) ? ` — ${mc.angleText} (${Math.round(mc.angleOffBowDeg)}° off the bow)` : '';
  doc.text(
    doc.splitTextToSize(`Wave height ${n(mc.hsM, 2)} m · Peak period ${n(mc.tpS, 1)} s · waves from ${from(mc.dirPoint, mc.dirDeg)}${angleText}`, w - 8),
    x + 4, y + 16.5,
  );
  setFont(doc, TEXT_MD, 7);
  doc.text(
    doc.splitTextToSize(
      `Primary swell ${n(mc.primarySwell.hsM, 2)} m at ${n(mc.primarySwell.tpS, 1)} s from ${from(mc.primarySwell.dirPoint, mc.primarySwell.dirDeg)}`
      + ` · Wind sea ${n(mc.windSea.hsM, 2)} m at ${n(mc.windSea.tpS, 1)} s from ${from(mc.windSea.dirPoint, mc.windSea.dirDeg)}`,
      w - 8,
    ),
    x + 4, y + 21.2,
  );
  setFont(doc, TEXT_MD, 6.3, 'italic');
  doc.text(
    doc.splitTextToSize('Directions are where waves come FROM, degrees true. From the wave model feed, which is separate from the route ratings, so values can differ slightly.', w - 8),
    x + 4, y + h - 5,
  );
}

// Time-proportional hazard ribbon: one rect per interval between
// consecutive available samples, its width proportional to the elapsed
// time between them (not fixed-width per-sample markers) -- so a long gap
// between two samples reads as a long segment, matching what "how much of
// the transit was at this severity" actually means. A gap in coverage
// (unavailable sample) draws as NO_DATA_GREY rather than silently
// stretching the segment on either side of it over the missing stretch.
// A small triangle marks the worst sample's time position underneath the
// ribbon.
export function drawHazardTimelineRibbon(doc, x, y, w, h, samples, vesselCode = null, timeDisplayZone = null) {
  const withTimes = samples.filter((s) => s?.eta && Number.isFinite(new Date(s.eta).getTime()));
  if (withTimes.length < 2) {
    rect(doc, x, y, w, h, [235, 236, 238]);
    setFont(doc, TEXT_MD, 6.5, 'italic');
    doc.text('Timeline unavailable', x + w / 2, y + h / 2 + 1, { align: 'center' });
    return;
  }

  const times = withTimes.map((s) => new Date(s.eta).getTime());
  const t0 = times[0];
  const span = times[times.length - 1] - t0 || 1;
  const xAt = (t) => x + ((t - t0) / span) * w;

  for (let i = 0; i < withTimes.length - 1; i++) {
    const sample = withTimes[i];
    const segX0 = xAt(times[i]);
    const segX1 = xAt(times[i + 1]);
    const available = sample.available !== false && Number.isFinite(sample.hazard_class);
    rect(doc, segX0, y, Math.max(segX1 - segX0, 0.15), h, available ? hazardColor(sample.hazard_class) : NO_DATA_GREY);
  }

  const worst = getWorstRouteSample(withTimes, vesselCode);
  if (worst) {
    const wx = xAt(new Date(worst.eta).getTime());
    setFill(doc, TEXT_DK);
    doc.triangle(wx - 1.3, y - 1.6, wx + 1.3, y - 1.6, wx, y + 0.3, 'F');
  }

  // Time labels at both ends (the ribbon was otherwise unlabelled) and a key, so the
  // hazard colours are not the only information.
  if (timeDisplayZone) {
    setFont(doc, TEXT_MD, 6);
    doc.text(formatEta(withTimes[0].eta, timeDisplayZone), x, y + h + 3.4);
    doc.text(formatEta(withTimes[withTimes.length - 1].eta, timeDisplayZone), x + w, y + h + 3.4, { align: 'right' });
    let lx = x + w * 0.3;
    [[0, 'Suitable'], [1, 'Caution'], [2, 'Warning']].forEach(([hz, label]) => {
      rect(doc, lx, y + h + 1.6, 2.6, 2.2, hazardColor(hz));
      setFont(doc, TEXT_MD, 6); doc.text(label, lx + 3.6, y + h + 3.4);
      lx += 3.6 + textWidth(doc, label) + 3.5;
    });
    rect(doc, lx, y + h + 1.6, 2.6, 2.2, NO_DATA_GREY);
    setFont(doc, TEXT_MD, 6); doc.text('No data', lx + 3.6, y + h + 3.4);
  }
}

// Dual-axis wind/wave line chart with dashed Caution/Warning threshold
// reference lines for the given vessel -- two independently-scaled series
// on one time axis, not a single combined figure, so a reader isn't left
// guessing which axis a given line belongs to at a glance (the legend
// below states it explicitly too). No tide/current series: this app has no
// sea-level dataset for Cook Islands to plot one from.
export function drawWindWaveChart(doc, x, y, w, h, samples, vesselCode, timeDisplayZone = 'Pacific/Rarotonga') {
  rect(doc, x, y, w, h, [255, 255, 255], GRID_CLR, 0.25);
  const pts = samples.filter((s) => s?.eta && Number.isFinite(new Date(s.eta).getTime())
    && Number.isFinite(s.wind_speed_kt) && Number.isFinite(s.wave_height_m));
  if (pts.length < 2) {
    setFont(doc, TEXT_MD, 7, 'italic');
    doc.text('Chart unavailable', x + w / 2, y + h / 2, { align: 'center' });
    return;
  }

  const chartTop = y + 4;
  const chartH = h - 22; // reserve space for the time axis and the legend row below the plot
  const chartLeft = x + 10; // reserve space for the wind (left) axis labels
  const chartRight = x + w - 10; // reserve space for the wave (right) axis labels
  const times = pts.map((s) => new Date(s.eta).getTime());
  const t0 = times[0];
  const span = times[times.length - 1] - t0 || 1;
  const xAt = (t) => chartLeft + ((t - t0) / span) * (chartRight - chartLeft);

  const envelope = VESSEL_OPERATING_ENVELOPE[vesselCode];
  const winds = pts.map((s) => s.wind_speed_kt);
  const waves = pts.map((s) => s.wave_height_m);
  const windMax = Math.max(...winds, envelope?.maxWindKt ?? 0) * 1.15 || 1;
  const waveMax = Math.max(...waves, envelope?.maxWaveHeightM ?? 0) * 1.15 || 1;
  const windY = (v) => chartTop + chartH - (v / windMax) * chartH;
  const waveY = (v) => chartTop + chartH - (v / waveMax) * chartH;

  // Gridlines + axis tick labels: wind (left, kt) drives the gridlines; wave (right, m)
  // gets its own labels at the same rows so both series can be read off the one chart.
  const windStep = windMax > 40 ? 20 : windMax > 15 ? 10 : 5;
  setDraw(doc, GRID_CLR); doc.setLineWidth(0.15);
  for (let v = 0; v <= windMax; v += windStep) {
    doc.line(chartLeft, windY(v), chartRight, windY(v));
    setFont(doc, TEXT_MD, 5.4); doc.text(`${Math.round(v)}`, chartLeft - 1.5, windY(v) + 1, { align: 'right' });
    setFont(doc, TEXT_MD, 5.4); doc.text(`${((v / windMax) * waveMax).toFixed(1)}`, chartRight + 1.5, windY(v) + 1);
  }

  // Time axis along the bottom, matching the ETA of the plotted samples.
  setDraw(doc, GRID_CLR); doc.setLineWidth(0.15);
  const axisY = chartTop + chartH;
  const tickCount = Math.min(pts.length, 5);
  const timeLabel = (ms) => {
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone: timeDisplayZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
    } catch {
      return new Date(ms).toISOString().slice(11, 16);
    }
  };
  for (let i = 0; i < tickCount; i += 1) {
    const t = t0 + (i / Math.max(1, tickCount - 1)) * span;
    const px = xAt(t);
    doc.line(px, axisY, px, axisY + 1.6);
    setFont(doc, TEXT_MD, 5.2);
    doc.text(timeLabel(t), px, axisY + 4.5, { align: i === tickCount - 1 ? 'right' : (i === 0 ? 'left' : 'center') });
  }

  if (envelope) {
    doc.setLineWidth(0.35);
    doc.setLineDashPattern([1, 1], 0);
    setDraw(doc, hazardColor(1));
    doc.line(chartLeft, windY(envelope.cautionWindKt), chartRight, windY(envelope.cautionWindKt));
    setDraw(doc, hazardColor(2));
    doc.line(chartLeft, windY(envelope.maxWindKt), chartRight, windY(envelope.maxWindKt));
    // Wave thresholds on the WAVE axis, dotted (wind ones are dashed) so the two
    // kinds of line stay distinguishable. Previously only wind thresholds were
    // drawn, which left a wave-driven Warning with no visible line to cross.
    doc.setLineDashPattern([0.3, 1.2], 0);
    doc.setLineWidth(0.5);
    setDraw(doc, hazardColor(1));
    doc.line(chartLeft, waveY(envelope.cautionWaveHeightM), chartRight, waveY(envelope.cautionWaveHeightM));
    setDraw(doc, hazardColor(2));
    doc.line(chartLeft, waveY(envelope.maxWaveHeightM), chartRight, waveY(envelope.maxWaveHeightM));
    doc.setLineDashPattern([], 0);
  }

  setDraw(doc, WIND_LINE);
  doc.setLineWidth(0.7);
  for (let i = 1; i < pts.length; i++) doc.line(xAt(times[i - 1]), windY(winds[i - 1]), xAt(times[i]), windY(winds[i]));

  setDraw(doc, WAVE_LINE);
  for (let i = 1; i < pts.length; i++) doc.line(xAt(times[i - 1]), waveY(waves[i - 1]), xAt(times[i]), waveY(waves[i]));

  const legendY = y + h - 6;
  setFont(doc, WIND_LINE, 6.5, 'bold');
  doc.text('— Wind (kt, left)', x + 3, legendY);
  setFont(doc, WAVE_LINE, 6.5, 'bold');
  doc.text('— Wave (m, right)', x + 3, legendY + 4.5);
  if (envelope) {
    setFont(doc, TEXT_MD, 6, 'normal');
    doc.text('- - -  Caution / Warning: wind (left axis)', x + w / 2, legendY);
    doc.text('· · ·  Caution / Warning: waves (right axis)', x + w / 2, legendY + 4.5);
  }
}

// ── main export ─────────────────────────────────────────────────────────────

// result: the normalized object from cookIslandsRouteForecastService.js's
// normalizeRouteForecastResponse (samples/segments/summary already
// null-safe). vessel: vessel class code. speedKt: number.
// vesselSuggestion/departureSuggestion: the same objects the on-screen
// panel already computes (suggestBetterVessel result / the confirmed
// departure-suggestion result) -- optional, rendered as short lines when
// present rather than requiring a second fetch.
//
// Split from exportCookIslandsRouteAdvisoryPdf below so tests can inspect
// the built jsPDF document (page count, output bytes) without needing a
// browser's download machinery -- doc.save() below is a thin, untestable
// side effect on top of this.
// Evidence about how much weight a route result can bear, all derived from the samples:
// coverage (available/total, high|reduced|insufficient), approximate sampling interval,
// forecast age at generation, whether the departure time has already passed, and the
// separate Caution and Warning shares of the *assessed* samples (unavailable excluded).
export function routeEvidence({ samples = [], departureTime = null, modelRunStart = null, generatedAt = new Date() }) {
  const total = samples.length;
  const assessed = samples.filter((s) => s && s.available !== false && Number.isFinite(s.hazard_class));
  const available = assessed.length;
  const times = samples.map((s) => new Date(s?.eta).getTime()).filter(Number.isFinite);
  const intervalMin = times.length > 1 ? (times[times.length - 1] - times[0]) / (times.length - 1) / 60000 : null;
  const runMs = modelRunStart ? new Date(modelRunStart).getTime() : NaN;
  const depMs = departureTime ? new Date(departureTime).getTime() : NaN;
  const share = (n) => (available > 0 ? (100 * n) / available : null);
  return {
    total, available, ratio: total ? available / total : 0,
    confidence: coverageConfidence(available, total),
    intervalMin,
    forecastAgeHours: Number.isFinite(runMs) ? (generatedAt.getTime() - runMs) / 3600e3 : null,
    departurePassed: Number.isFinite(depMs) ? depMs < generatedAt.getTime() : false,
    cautionPercent: share(assessed.filter((s) => s.hazard_class === 1).length),
    warningPercent: share(assessed.filter((s) => s.hazard_class >= 2).length),
  };
}

export async function buildCookIslandsRouteAdvisoryPdfDoc({
  result, vessel, speedKt, timeDisplayZone = 'Pacific/Rarotonga', mapCustomEnvelope = null, modelRunStart = null,
  vesselSuggestion = null, departureSuggestion = null, superseded = false, midpointConditions, startLabel: startLabelParam = null, destinationLabel: destinationLabelParam = null,
}) {
  const startLabel = startLabelParam ?? result?.start_label ?? null;
  const destinationLabel = destinationLabelParam ?? result?.destination_label ?? null;
  if (!result) throw new Error('No route forecast result to export.');

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  await ensureReportFont(doc);
  doc.setProperties({
    title: 'Cook Islands Route Advisory',
    subject: 'Vessel route suitability forecast',
    creator: 'Cook Islands Ocean Dashboard',
    author: 'Pacific Community (SPC)',
  });
  doc.setLanguage('en');

  // This report's own page dimensions, read off the doc instance rather
  // than the shared portrait PAGE_W constant above -- see this file's own
  // header comment for why that distinction matters here.
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const samples = Array.isArray(result.samples) ? result.samples : [];
  const summary = result.summary ?? {};
  const vesselLabel = VESSEL_CLASS_OPTIONS.find((v) => v.value === vessel)?.label ?? vessel;
  const worstSample = getWorstRouteSample(samples, vessel);
  const worstRun = findWorstRun(samples);
  const hazardAvailable = Number.isFinite(summary.worst_hazard_class);
  const hazard = summary.worst_hazard_class;
  const exceedance = worstSample ? computeExceedance(vessel, worstSample) : null;
  const unavailableCount = samples.filter((s) => s?.available === false || !Number.isFinite(s?.hazard_class)).length;
  // A missing wind or wave reading must not be treated as 0 (which would name the
  // other parameter as the driver on incomplete input) -- report no driver instead.
  const worstReadingsComplete = worstSample
    && Number.isFinite(worstSample.wind_speed_kt) && Number.isFinite(worstSample.wave_height_m);
  const primaryDriver = hazardAvailable && hazard > 0 && worstSample
    ? (worstReadingsComplete
      ? deriveSuitabilityDriver(vessel, worstSample.wind_speed_kt, worstSample.wave_height_m)
      : null)
    : 'none';
  const generatedAt = new Date();

  // ── page 1: decision brief ────────────────────────────────────────────
  drawHeaderBand(doc, {
    title: 'Cook Islands Route Advisory',
    // Speed isn't one of the 5 stat cards below (matching widget1's own
    // card set), but it's still a real assumption every downstream number
    // (duration, ETAs) depends on -- stated here rather than silently
    // dropped from the visible report now that it lost its dedicated card.
    subtitle: `${vesselLabel} · ${formatNumber(speedKt, 1)} kt assumed speed${startLabel && destinationLabel ? ` · ${startLabel} to ${destinationLabel}` : ''}`,
    rightLine1: `Departure: ${formatEta(result.departure_time, timeDisplayZone)} ${tzLabel(timeDisplayZone)}`,
    rightLine2: `Generated ${formatEta(generatedAt, timeDisplayZone)} ${tzLabel(timeDisplayZone)} · Page 1 of 2`,
  });

  let y = HDR_H + 6;
  // Computed here (not just below, by the evidence line) because the recommendation
  // itself must defer to coverage -- see routeOperationalRecommendation.
  const ev = routeEvidence({ samples, departureTime: result.departure_time, modelRunStart: modelRunStart ?? result.model_run_time ?? null, generatedAt });
  const recommendation = routeOperationalRecommendation({ hazardAvailable, hazard, worstRun, timeDisplayZone, coverage: ev });
  const recLines = doc.splitTextToSize(recommendation, pageW - 16);
  setFont(doc, hazardAvailable ? hazardText(hazard) : TEXT_MD, 10.5, 'bold');
  doc.text(recLines, 8, y + 4);
  y += recLines.length * 5 + 5;

  // 5 stat cards: Recommendation, Distance, Duration, Primary driver,
  // Samples (with an unavailable-count note when any exist).
  const cardY = y;
  const cardH = 18;
  const cardGap = 4;
  const cardW = (pageW - 16 - 4 * cardGap) / 5;
  StatCard(
    doc, 8, cardY, cardW, cardH,
    'Rating',
    hazardAvailable ? hazardLabel(hazard) : 'Unavailable',
    hazardAvailable ? hazardText(hazard) : TEXT_MD,
  );
  StatCard(doc, 8 + (cardW + cardGap), cardY, cardW, cardH, 'Distance', `${formatNumber(summary.distance_nm, 1)} nm`);
  StatCard(doc, 8 + 2 * (cardW + cardGap), cardY, cardW, cardH, 'Duration', `${formatNumber(summary.duration_hours, 1)} h`);
  StatCard(doc, 8 + 3 * (cardW + cardGap), cardY, cardW, cardH, 'Primary driver', DRIVER_LABELS[primaryDriver] ?? '—');
  StatCard(
    doc, 8 + 4 * (cardW + cardGap), cardY, cardW, cardH,
    'Samples',
    unavailableCount > 0 ? `${samples.length} (${unavailableCount} unavail.)` : String(samples.length),
  );
  y = cardY + cardH + 4;

  // Evidence line: how far the result can be relied on (coverage, cadence, age, exposure).
  const fmtPct = (v) => (v === null ? '—' : `${Math.round(v)}%`);
  setFont(doc, TEXT_MD, 6.8);
  const evLines = doc.splitTextToSize(
    `Coverage: ${ev.confidence} — ${ev.available} of ${ev.total} samples assessed · `
    + `Sampling: ${ev.intervalMin !== null ? `about every ${Math.round(ev.intervalMin)} min` : 'unknown'} · `
    + `Exposure (assessed samples): ${fmtPct(ev.cautionPercent)} Caution, ${fmtPct(ev.warningPercent)} Warning · `
    + `Forecast age: ${ev.forecastAgeHours !== null ? `${Math.round(ev.forecastAgeHours)} h at generation` : 'model run not reported'}`,
    pageW * 0.42,
  );
  doc.text(evLines, 8, y + 2);
  y += evLines.length * 3.5 + 3;
  if (ev.departurePassed) {
    setFont(doc, hazardText(1), 7, 'bold');
    const passed = doc.splitTextToSize('Departure time has already passed: conditions before now are historical; re-run the route for a current departure.', pageW * 0.42);
    doc.text(passed, 8, y);
    y += passed.length * 3.6 + 1.5;
  }
  y += 2;

  // Critical-point panel -- only when there's actually a hazard to explain
  // (matches widget1: an all-clear route gets no dedicated panel).
  const leftColW = pageW * 0.42;
  if (hazardAvailable && hazard >= 1 && worstSample) {
    const panelH = 30;
    drawCriticalPointPanel(doc, 8, y, leftColW, panelH, { worstSample, exceedance, worstRun, timeDisplayZone });
    y += panelH + 5;
  }

  setFont(doc, TEXT_DK, 8, 'bold');
  doc.text('Hazard timeline', 8, y);
  y += 3;
  drawHazardTimelineRibbon(doc, 8, y, leftColW, 6, samples, vessel, timeDisplayZone);
  y += 6 + 9;

  // Midpoint sea state at the vessel's ETA. undefined = caller didn't ask for it
  // (older callers); null = asked for and unavailable -- stated, not silently dropped.
  if (midpointConditions) {
    const mpH = 31;
    drawMidpointConditionsPanel(doc, 8, y, leftColW, mpH, midpointConditions, timeDisplayZone);
    y += mpH + 4;
  } else if (midpointConditions === null) {
    setFont(doc, TEXT_MD, 7, 'italic');
    doc.text('Midpoint wave conditions (period, direction, swell) were unavailable when this advisory was generated.', 8, y + 2);
    y += 7;
  }

  if (vesselSuggestion) {
    setFont(doc, TEXT_MD, 7, 'italic');
    const suggestLines = doc.splitTextToSize(
      `${vesselSuggestion.vesselLabel} would reduce worst conditions to ${hazardLabel(vesselSuggestion.estimatedWorstHazardClass)} for this same route and time (threshold estimate).`,
      leftColW,
    );
    doc.text(suggestLines, 8, y);
    y += suggestLines.length * 3.6 + 2;
  }
  if (departureSuggestion?.departureTime) {
    setFont(doc, TEXT_MD, 7, 'italic');
    setFont(doc, TEXT_MD, 7, 'italic');
    const b = departureSuggestion.best; const r = departureSuggestion.requested;
    const share = (x) => (x ? Math.round((x.caution_percent ?? 0) + (x.warning_percent ?? 0)) : null);
    const detail = b && r && share(b) !== null && share(r) !== null
      ? ` Modelled Caution+Warning share of assessed samples: ${share(r)}% at the requested time, ${share(b)}% then.`
      : '';
    const depLines = doc.splitTextToSize(`A later departure (${formatEta(departureSuggestion.departureTime, timeDisplayZone)}) may find better modelled conditions.${detail}`, leftColW);
    doc.text(depLines, 8, y);
    y += depLines.length * 3.6 + 2;
  }

  // Right column: route sketch, given the extra landscape width.
  const rightColX = 8 + leftColW + 8;
  const rightColW = pageW - rightColX - 8;
  let ry = cardY + cardH + 6;
  setFont(doc, TEXT_DK, 8, 'bold');
  doc.text('Route sketch (schematic — not for navigation)', rightColX, ry);
  ry += 3;
  setFont(doc, TEXT_MD, 6.5, 'italic');
  doc.text('Not to scale. No coastline, bathymetry, or navigational detail — plan and route in a proper charting tool.', rightColX, ry);
  ry += 4;
  // Important-notice box across the foot of page 1, at a readable size (the shared
  // footer line is 5.8 pt, too small for the one statement a reader must not miss).
  const noticeSize = 7.2;
  setFont(doc, TEXT_DK, noticeSize, 'bold');
  const noticeLines = doc.splitTextToSize(`${ROUTE_NOTICE} ${thresholdProvenanceText(vessel)}`, pageW - 16 - 6);
  const noticeH = noticeLines.length * (noticeSize * 0.3528 * 1.22) + 4.6; // pt -> mm, ~1.22 leading
  const noticeY = pageH - 12 - noticeH - 1.5;
  rect(doc, 8, noticeY, pageW - 16, noticeH, [255, 244, 214], [230, 180, 60], 0.3);
  setFont(doc, TEXT_DK, noticeSize, 'bold');
  doc.text(noticeLines, 11, noticeY + 4.4);

  const legendH = 8;
  const sketchH = Math.max(40, noticeY - 3 - legendH - 2 - ry);
  drawRouteSketch(doc, rightColX, ry, rightColW, sketchH, samples, vessel);
  drawRouteSketchLegend(doc, rightColX, ry + sketchH + 2, rightColW);

  drawFooter(doc);

  // ── page 2: supporting evidence ────────────────────────────────────────
  doc.addPage();
  drawHeaderBand(doc, {
    title: 'Cook Islands Route Advisory',
    subtitle: `${vesselLabel} — supporting evidence`,
    rightLine1: `Page 2 of 2`,
  });

  const p2Top = HDR_H + 8;
  const tableColW = pageW * 0.42;
  const chartColX = 8 + tableColW + 8;
  const chartColW = pageW - chartColX - 8;

  // Left: curated sample table.
  const tableRows = selectRouteTableRows(samples, 16, vessel);
  setFont(doc, TEXT_DK, 8, 'bold');
  doc.text('Route samples', 8, p2Top);
  let ty = p2Top + 4;
  if (tableRows.length < samples.length) {
    setFont(doc, TEXT_MD, 6.5, 'italic');
    doc.text(`Showing ${tableRows.length} of ${samples.length} samples (start, end, critical point, and evenly spaced points between).`, 8, ty);
    ty += 4;
  }
  drawRouteSampleTable(doc, 8, ty, tableColW, tableRows, timeDisplayZone);

  // Right: wind/wave chart, then thresholds/provenance/data-completeness text.
  let cy = p2Top;
  setFont(doc, TEXT_DK, 8, 'bold');
  doc.text('Wind & wave profile', chartColX, cy);
  cy += 3;
  drawWindWaveChart(doc, chartColX, cy, chartColW, 55, samples, vessel, timeDisplayZone);
  cy += 55 + 7;

  setFont(doc, TEXT_DK, 8, 'bold');
  doc.text('Vessel operating envelope (preset thresholds)', chartColX, cy);
  cy += 5;
  setFont(doc, TEXT_MD, 7.5);
  doc.text(routeThresholdText(vessel), chartColX, cy);
  cy += 4.5;
  setFont(doc, TEXT_MD, 6.8, 'italic');
  const provLines = doc.splitTextToSize(thresholdProvenanceText(vessel), chartColW);
  doc.text(provLines, chartColX, cy);
  cy += provLines.length * 3.3 + 3;
  const customNote = customEnvelopeNoteText(mapCustomEnvelope);
  if (customNote) {
    setFont(doc, hazardText(1), 7.5, 'bold');
    const noteLines = doc.splitTextToSize(customNote, chartColW);
    doc.text(noteLines, chartColX, cy);
    cy += noteLines.length * 3.6 + 3;
  }

  // Authoritative forecast provenance -- the header's own "Generated" line
  // (page 1) is just this browser's clock at export time, not when the
  // underlying forecast was actually produced. modelRunStart is the same
  // forecast-cycle timestamp already trusted elsewhere in this app to
  // detect a stale/superseded scenario (cookIslandsScenarioService.js's
  // isScenarioSuperseded). Left as "unavailable" rather than silently
  // omitted when the caller has no model-run time to give. Grid
  // resolution, dataset version, and coverage extent are NOT included
  // here: /cok/suitability/route's response carries none of them today.
  setFont(doc, TEXT_DK, 8, 'bold');
  doc.text('Forecast provenance', chartColX, cy);
  cy += 5;
  setFont(doc, TEXT_MD, 7.5);
  const modelRunText = modelRunStart
    ? `Model run: ${formatEta(modelRunStart, timeDisplayZone)} ${tzLabel(timeDisplayZone)}`
    : 'Model run: unavailable';
  doc.text(`${modelRunText} · Source: SWAN wave model forecast (Cook Islands) via /cok/suitability/route`, chartColX, cy);
  cy += 6;
  if (midpointConditions?.waveRunStart) {
    doc.text(`Midpoint wave feed: run starts ${formatEta(midpointConditions.waveRunStart, timeDisplayZone)} ${tzLabel(timeDisplayZone)} via /wave/ugrid/timeseries`, chartColX, cy);
    cy += 6;
  }
  if (superseded) {
    setFont(doc, hazardText(1), 7.5, 'bold');
    const supLines = doc.splitTextToSize(
      'SUPERSEDED: a newer forecast run was available when this advisory was exported. Re-run the route before relying on it.',
      chartColW,
    );
    doc.text(supLines, chartColX, cy);
    cy += supLines.length * 3.6 + 3;
  }

  setFont(doc, TEXT_DK, 8, 'bold');
  doc.text('Data completeness', chartColX, cy);
  cy += 5;
  setFont(doc, TEXT_MD, 7.5);
  const completenessText = samples.length === 0
    ? 'No samples returned for this route.'
    : unavailableCount === 0
      ? `All ${samples.length} sampled points along the route returned a reading — full coverage (${ev.confidence}).`
      : `${unavailableCount} of ${samples.length} sampled points had no model coverage (outside the forecast domain) — coverage ${ev.confidence}; unavailable is not the same as a confirmed-safe reading.`;
  doc.text(doc.splitTextToSize(completenessText, chartColW), chartColX, cy);

  drawFooter(doc);

  const filename = `cook_islands_route_advisory_${vessel}_${generatedAt.toISOString().slice(0, 16).replace(/[:T]/g, '')}.pdf`;
  return { doc, filename };
}

export async function exportCookIslandsRouteAdvisoryPdf(params) {
  const { doc, filename } = await buildCookIslandsRouteAdvisoryPdfDoc(params);
  doc.save(filename);
  return filename;
}

function drawRouteSampleTable(doc, x, y, w, samples, timeDisplayZone) {
  const columns = [
    { key: 'eta', label: `ETA (${tzLabel(timeDisplayZone)})`, frac: 0.32 },
    { key: 'distance_nm', label: 'Dist (nm)', frac: 0.16 },
    { key: 'hazard_label', label: 'Hazard', frac: 0.18 },
    { key: 'wave_height_m', label: 'Wave (m)', frac: 0.17 },
    { key: 'wind_speed_kt', label: 'Wind (kt)', frac: 0.17 },
  ].map((c) => ({ ...c, w: c.frac * w }));
  const rowH = 6;
  const headerH = 7;

  rect(doc, x, y, w, headerH, HEADER_BG);
  setFont(doc, TEXT_LT, 6.5, 'bold');
  let cx = x;
  for (const col of columns) {
    doc.text(col.label, cx + 2, y + headerH * 0.65);
    cx += col.w;
  }
  let ty = y + headerH;

  samples.forEach((sample, index) => {
    if (index % 2 === 1) rect(doc, x, ty, w, rowH, [246, 248, 250]);
    const hazard = sample.hazard_class;
    const values = {
      eta: formatEta(sample.eta, timeDisplayZone),
      distance_nm: formatNumber(sample.distance_nm, 1),
      hazard_label: sample.hazard_label ?? (Number.isFinite(hazard) ? hazardLabel(hazard) : '—'),
      wave_height_m: formatNumber(sample.wave_height_m, 2),
      wind_speed_kt: formatNumber(sample.wind_speed_kt, 1),
    };
    let cellX = x;
    for (const col of columns) {
      setFont(doc, col.key === 'hazard_label' && Number.isFinite(hazard) ? hazardColor(hazard) : TEXT_DK, 7, col.key === 'hazard_label' ? 'bold' : 'normal');
      doc.text(String(values[col.key]), cellX + 2, ty + rowH * 0.68);
      cellX += col.w;
    }
    ty += rowH;
  });
}
