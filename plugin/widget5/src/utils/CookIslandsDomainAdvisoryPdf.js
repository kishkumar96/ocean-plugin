// CookIslandsDomainAdvisoryPdf.js
// Renders a domain report bundle (reports/domainReportBundle.js) as the Cook Islands marine
// suitability advisory. This file only draws: it never fetches or interprets endpoint responses,
// so every page prints the same model run, valid time, scope and coverage. Page furniture,
// palette and components come from the shared theme (pdfTheme.js): A4 landscape, light page,
// navy header with cyan accent, white cards.
//
// A "current time" report is pages 1 and 6 only; an outlook report (72 h / seven days) adds 2-5:
//   1  Executive advisory        banner, provenance, map, four vessel cards
//   2  Multi-vessel outlook      hazard ribbons, best window, highest risk, recovery, gaps
//   3  Same conditions, different vessels   four maps at the time of greatest contrast
//   4  Daily forecast evolution  selected vessel at local noon, "beyond horizon" panels
//   5  Forecast trend            Warning share over time, elevated periods, gaps
//   6  Methodology and limits    scope, coverage, model run, thresholds, limitations
import {
  MARGIN, HDR_H, HEADER_BG, TEXT_MD, TEXT_DK, GRID_CLR, NO_DATA_GREY, TEXT_LT,
  hazardColor, hazardText, hazardLabel, setFill, setDraw, setFont, rect,
  drawHeaderBand, drawFooter, card, hazardLight, notice, sectionTitle, keyValue, fitText, drawLegendRow,
  drawHazardShareBar, contentBottom, loadVesselSvgIcon, ensureReportFont, PAGE_W,
} from './pdfTheme';
import { tzLabel } from './timeZoneFormat';
import { VESSEL_OPERATING_ENVELOPE, VESSEL_CLASS_OPTIONS } from '../lib/CookIslandsSuitabilityOverlay';
import { buildDomainReportBundle } from '../reports/domainReportBundle';
import { dailyEvolutionRows, estimateDriver, deltaText } from '../reports/dailyEvolution';
import { operationalSummary, thresholdMargin } from '../reports/domainBriefing';
import { MAP_FILL_RGB } from '../reports/mapRecolor';
import { drawBoundaryOverlay, BOUNDARY_CAPTION } from '../reports/mapOverlay';
import {
  stepLevel, pctText, scopeLabel, formatLocal, formatUtc, zonedWallTimeToUtc, ELEVATED_WARNING_PERCENT, ELEVATED_WARNING_RULE, SOURCE_TEXT, governanceText,
} from '../reports/reportRules';

const CW = PAGE_W - 2 * MARGIN; // content width

export function formatNumber(value, digits = 1) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

export function formatValidTime(dateLike, timeDisplayZone) {
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

// Escalates at >= 20% Warning, otherwise flags any Caution/Warning (see reportRules.stepLevel).
export function domainHazard(warningPercent, cautionPercent) {
  return stepLevel(warningPercent, cautionPercent);
}

// A vessel step is usable only when it summarises at least one classified point.
// Zero points (an empty view) is "no data", never "all waters suitable".
export function hasVesselData(step) {
  if (!step || step.available === false) return false;
  return Number.isFinite(step.warning) && Number.isFinite(step.caution);
}

// Headline sentence for the selected vessel. Every non-zero Warning share is stated
// explicitly and hazard conclusions are always "modelled".
export function domainFinding({ label, data }) {
  if (!hasVesselData(data)) return 'No model data for the selected vessel in this area and time.';
  const warn = Number(data.warning) || 0;
  const caution = Number(data.caution) || 0;
  if (warn >= ELEVATED_WARNING_PERCENT) {
    return `Modelled conditions for ${label}: ${pctText(caution)}% Caution and ${pctText(warn)}% of assessed points are Warning-level.`;
  }
  if (warn > 0 || caution > 0) {
    const parts = [];
    if (caution > 0) parts.push(`${pctText(caution)}% Caution`);
    if (warn > 0) parts.push(`${pctText(warn)}% Warning-level`);
    return `Modelled conditions for ${label} are mostly below threshold; ${parts.join(' and ')} of assessed points.`;
  }
  return `No modelled threshold exceedances were identified for ${label} at the assessed points and time.`;
}

const vesselLabel = (code) => VESSEL_CLASS_OPTIONS.find((v) => v.value === code)?.label ?? code;

const ctx = (bundle) => {
  const tz = bundle.timezone;
  const label = tzLabel(tz);
  return { tz, local: (ms) => (Number.isFinite(ms) ? formatLocal(ms, tz, label) : '—') };
};

// ── shared drawing helpers ──────────────────────────────────────────────────

function placeholderBox(doc, x, y, w, h, text) {
  rect(doc, x, y, w, h, [240, 240, 240], GRID_CLR, 0.25);
  setFont(doc, TEXT_MD, 7.5, 'italic');
  doc.text(doc.splitTextToSize(text, w - 6), x + w / 2, y + h / 2, { align: 'center' });
}

// Draws the image at its own aspect ratio, centred horizontally and top-aligned in the box,
// with a hairline border around the image itself. Returns the rectangle actually used.
function fitImage(doc, dataUrl, x, y, w, h, alias) {
  try {
    const props = doc.getImageProperties(dataUrl);
    const aspect = props.width / props.height;
    let iw = w; let ih = h; let ix = x; const iy = y;
    if (Number.isFinite(aspect) && aspect > 0) {
      if (aspect > w / h) { ih = w / aspect; } else { iw = h * aspect; ix += (w - iw) / 2; }
    }
    doc.addImage(dataUrl, 'PNG', ix, iy, iw, ih, alias, 'FAST');
    setDraw(doc, GRID_CLR); doc.setLineWidth(0.25);
    doc.rect(ix, iy, iw, ih, 'S');
    return { x: ix, y: iy, w: iw, h: ih };
  } catch {
    placeholderBox(doc, x, y, w, h, 'Map could not be drawn');
    return null;
  }
}

// Overlay the model-domain boundary on a service-rendered map (never on a screenshot fallback,
// whose extent is not known exactly).
function overlayBoundary(doc, bundle, map, imageRect) {
  if (!map || map.fallback || !imageRect) return;
  drawBoundaryOverlay(doc, bundle.domainBoundary, bundle.maps.bounds, imageRect);
}

// Classified maps are softened with a light white wash so a view that is all one class (a 100% Warning
// map is common for small craft) reads as a tinted area, not a solid block of alarm red. The strong
// colours stay for what needs to stand out: the verdict banner, card bars and badges. Map keys use the
// same tints, so each swatch matches what is on the map.
const MAP_WASH = 0.3;
const tint = (rgb, f) => rgb.map((c) => Math.round(c + (255 - c) * f));
const MAP_LEGEND_WASHED = [[0, 'Suitable'], [1, 'Caution'], [2, 'Warning']].map(([h, label]) => [tint(hazardColor(h), MAP_WASH), label]);
// Recoloured maps (see reports/mapRecolor.js) carry their own map-fill palette; their key uses it.
const MAP_LEGEND_FILL = [[0, 'Suitable'], [1, 'Caution'], [2, 'Warning']].map(([h, label]) => [MAP_FILL_RGB[h], label]);
const mapLegend = (bundle) => (bundle.maps.selected?.recolored ? MAP_LEGEND_FILL : MAP_LEGEND_WASHED);

// Scale bar (bottom-left) and north marker (top-right) on a service-rendered map, whose extent is known
// exactly. Never on a screenshot fallback, whose extent is not.
const NICE = [1, 2, 5];
function niceKm(target) {
  const exp = 10 ** Math.floor(Math.log10(target));
  return NICE.map((n) => n * exp).concat([10 * exp]).reduce((best, v) => (v <= target ? v : best), exp);
}
function drawMapFurniture(doc, r, bounds) {
  if (!r || !bounds) return;
  const midLat = (bounds.south + bounds.north) / 2;
  const widthKm = (bounds.east - bounds.west) * 111.32 * Math.cos((midLat * Math.PI) / 180);
  if (!(widthKm > 0)) return;
  const kmPerMm = widthKm / r.w;
  const km = niceKm(Math.max(kmPerMm * r.w * 0.22, 0.1));
  const barW = km / kmPerMm;
  const bx = r.x + 3; const by = r.y + r.h - 4.5;
  setFill(doc, [255, 255, 255]); doc.rect(bx - 1.5, by - 4.2, barW + 13, 6.2, 'F');
  setFill(doc, [36, 49, 58]); doc.rect(bx, by, barW / 2, 1, 'F');
  setFill(doc, [255, 255, 255]); setDraw(doc, [36, 49, 58]); doc.setLineWidth(0.2); doc.rect(bx + barW / 2, by, barW / 2, 1, 'FD');
  doc.rect(bx, by, barW, 1, 'S');
  setFont(doc, [36, 49, 58], 5.4, 'bold'); doc.text(`${km >= 1 ? km : km.toFixed(1)} km`, bx + barW + 1.5, by + 1);
  setFont(doc, [36, 49, 58], 4.6); doc.text('0', bx, by - 1);
  // north marker
  const nx = r.x + r.w - 6; const ny = r.y + 4;
  setFill(doc, [255, 255, 255]); doc.circle(nx, ny + 2.2, 3.4, 'F');
  setFill(doc, [36, 49, 58]); doc.triangle(nx, ny - 0.4, nx - 1.5, ny + 3.6, nx + 1.5, ny + 3.6, 'F');
  setFont(doc, [36, 49, 58], 4.6, 'bold'); doc.text('N', nx, ny + 5.4, { align: 'center' });
}

function drawMap(doc, bundle, map, x, y, w, h, alias, { furniture = false } = {}) {
  const r = fitImage(doc, map.dataUrl, x, y, w, h, alias);
  // A recoloured map already has calm fills; only an original-palette image is washed.
  if (r && !map.recolored) {
    try {
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: MAP_WASH }));
      setFill(doc, [255, 255, 255]);
      doc.rect(r.x, r.y, r.w, r.h, 'F');
    } finally {
      doc.restoreGraphicsState();
    }
  }
  overlayBoundary(doc, bundle, map, r);
  if (furniture && !map.fallback) drawMapFurniture(doc, r, bundle.maps.bounds);
  return r;
}

// The area the report describes, in its title: an island's map view is never headed as if it covered
// the whole Cook Islands.
function reportTitle(bundle) {
  if (bundle.scope.effective === 'viewport') {
    return bundle.scope.placeName
      ? `COOK ISLANDS · ${bundle.scope.placeName.toUpperCase()} — CURRENT MAP VIEW`
      : 'COOK ISLANDS COASTAL WATERS — CURRENT MAP VIEW';
  }
  return 'COOK ISLANDS COASTAL WATERS — WHOLE FORECAST DOMAIN';
}

// A 6 h step stripe is wide enough for its class letter, so the ribbon reads without colour too.
const LEVEL_LETTER = { 0: 'S', 1: 'C', 2: 'W' };

function provenanceLine(bundle) {
  const { local } = ctx(bundle);
  const run = bundle.modelRun.time ? formatUtc(bundle.modelRun.time) : 'not reported';
  return `${bundle.reportId ? `Report ${bundle.reportId} · ` : ''}Model run ${run} · Valid ${local(bundle.validTime)} · Scope: ${scopeLabel(bundle.scope.effective)} · Generated ${formatLocal(bundle.generatedAt, bundle.timezone, tzLabel(bundle.timezone))} · Source: ${SOURCE_TEXT}`;
}

function pageHeader(doc, bundle, subtitle, pageNo, pageCount) {
  const { local } = ctx(bundle);
  drawHeaderBand(doc, {
    title: reportTitle(bundle),
    titleSize: 12.5,
    subtitle,
    rightLine1: `Valid: ${local(bundle.validTime)}`,
    rightLine2: `Page ${pageNo} of ${pageCount}`,
  });
}

const pageFooter = (doc, bundle) => drawFooter(doc, { provenance: provenanceLine(bundle) });

// Day ticks (local midnights) along a time axis.
function drawTimeAxis(doc, bundle, x, y, w, t0, t1) {
  const { tz, local } = ctx(bundle);
  setDraw(doc, GRID_CLR); doc.setLineWidth(0.15);
  setFont(doc, TEXT_MD, 5.5);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(t0)).reduce((a, q) => ({ ...a, [q.type]: q.value }), {});
  let cursor = Date.UTC(+p.year, +p.month - 1, +p.day);
  for (let i = 0; i < 20; i += 1) {
    const d = new Date(cursor);
    const mid = zonedWallTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, tz).getTime();
    cursor += 86400e3;
    if (mid < t0) continue;
    if (mid > t1) break;
    const px = x + ((mid - t0) / (t1 - t0)) * w;
    doc.line(px, y, px, y + 2.2);
    doc.text(local(mid).split(' ').slice(0, 3).join(' '), px + 0.6, y + 4.6);
  }
}

// "A to B", or just "A" when the window is a single step.
const spanText = (local, a, b) => (a === b || !Number.isFinite(b) ? local(a) : `${local(a)} to ${local(b)}`);

// ── Page 1 — Executive advisory ─────────────────────────────────────────────

async function drawPage1(doc, bundle, pageCount) {
  const H = doc.internal.pageSize.getHeight();
  const { local } = ctx(bundle);
  pageHeader(doc, bundle, 'MARINE VESSEL SUITABILITY ADVISORY', 1, pageCount);

  const selected = bundle.vessels[bundle.selectedVessel];
  const present = hasVesselData(selected);
  const haz = present ? domainHazard(selected.warning, selected.caution) : null;
  const selLabel = vesselLabel(bundle.selectedVessel);
  // Meaning first (a sentence a reader can act on), then the numbers behind it.
  const bannerH = 13;
  rect(doc, MARGIN, HDR_H + 4, PAGE_W - 2 * MARGIN, bannerH, present ? hazardLight(haz) : [238, 242, 246], present ? hazardColor(haz) : GRID_CLR, 0.3);
  setFill(doc, present ? hazardColor(haz) : NO_DATA_GREY); doc.rect(MARGIN, HDR_H + 4, 2.2, bannerH, 'F');
  setFont(doc, present ? hazardText(haz) : TEXT_MD, 9, 'bold');
  doc.text(fitText(doc, `${selLabel.toUpperCase()} — ${present ? hazardLabel(haz).toUpperCase() : 'NO DATA'}   ·   ${operationalSummary(selLabel, selected).replace(`${selLabel}: `, '')}`, PAGE_W - 2 * MARGIN - 10), MARGIN + 5, HDR_H + 9.2);
  setFont(doc, present ? hazardText(haz) : TEXT_MD, 7);
  doc.text(fitText(doc, domainFinding({ label: selLabel, data: selected }), PAGE_W - 2 * MARGIN - 10), MARGIN + 5, HDR_H + 14.2);

  // A viewport request that the service could not honour and fell back to the whole
  // domain instead (scope.effective !== scope.requested) is a much bigger semantic
  // change than a minor bounds-snap -- the figures below now describe a different,
  // larger area than what was asked for. That deserves its own explicit state, not
  // a line buried in the shared warnings notice further down (which still also
  // carries this, for anyone reading the evidence card in detail).
  const scopeSubstituted = bundle.scope.mismatch && bundle.scope.effective !== bundle.scope.requested;
  let substitutionNoticeH = 0;
  if (scopeSubstituted) {
    substitutionNoticeH = notice(doc, {
      x: MARGIN,
      y: HDR_H + 4 + 13 + 2,
      w: PAGE_W - 2 * MARGIN,
      text: `REQUESTED VIEW UNAVAILABLE — this report uses ${scopeLabel(bundle.scope.effective).toLowerCase()} instead. `
        + `Requested: ${scopeLabel(bundle.scope.requested)}. Applied: ${scopeLabel(bundle.scope.effective)}. `
        + `Reason: ${bundle.scope.reasons.join(' ')}`,
      size: 6.8,
    }) + 2;
  }

  // Directly under the verdict, before anything else: what this model can and cannot see, and (if the
  // user had a custom envelope on screen) that this report does not use it.
  let noticeY = HDR_H + 4 + 13 + 2 + substitutionNoticeH;
  const smallCraft = ['traditional_craft', 'very_small_motorised_craft'].includes(bundle.selectedVessel);
  noticeY += notice(doc, {
    x: MARGIN, y: noticeY, w: PAGE_W - 2 * MARGIN, size: 6.8,
    text: `Offshore and coastal model grid only. Reef passages, lagoons and nearshore waters are not resolved by the wave model; conditions there can differ substantially from these figures.${smallCraft ? ` These are the waters ${selLabel.toLowerCase()} use most.` : ''}`,
  }) + 2;
  if (bundle.methodology.customEnvelopeNotApplied) {
    noticeY += notice(doc, {
      x: MARGIN, y: noticeY, w: PAGE_W - 2 * MARGIN, size: 6.8,
      text: 'Thresholds: PRESET for every vessel class. The custom envelope set on the map is NOT applied in this report, so its colours can differ from what you saw on screen.',
    }) + 2;
  }
  const top = noticeY + 1;
  const bottom = contentBottom(doc);
  const mapW = 150;
  const colX = MARGIN + mapW + 6;
  const colW = PAGE_W - MARGIN - colX;

  // Map card
  card(doc, MARGIN, top, mapW, bottom - top);
  const capH = 9;
  const hasMap = Boolean(bundle.maps.selected?.dataUrl);
  const legendH = hasMap ? 7 : 0;
  if (hasMap) {
    drawMap(doc, bundle, bundle.maps.selected, MARGIN + 2, top + 2, mapW - 4, bottom - top - capH - legendH - 4, 'domain_map', { furniture: true });
    drawLegendRow(doc, MARGIN + 3, bottom - capH - legendH + 5, mapLegend(bundle));
  } else {
    placeholderBox(doc, MARGIN + 2, top + 2, mapW - 4, bottom - top - capH - 4, 'Map unavailable — the service did not return a map for this view. Statistics are still shown.');
  }
  setFont(doc, TEXT_MD, 6, 'italic');
  doc.text(
    doc.splitTextToSize(`${selLabel} · ${scopeLabel(bundle.scope.effective)} · SWAN wave model${bundle.domainBoundary?.length ? ` · ${BOUNDARY_CAPTION}` : ''}`, mapW - 6),
    MARGIN + 3, bottom - capH + 3,
  );

  // Decision briefing: status, why, what next, how much to trust it -- then the provenance behind it.
  const cov = bundle.coverage.points;
  const updatedAt = bundle.modelRun.updatedAt;
  const updateAge = bundle.modelRun.updateAgeHours;
  const br = bundle.briefing ?? {};
  const env = VESSEL_OPERATING_ENVELOPE[bundle.selectedVessel];
  const FRESH = { current: [25, 94, 89], aging: hazardText(1), stale: hazardText(2), unknown: TEXT_MD };
  const marginBits = [];
  if (Number.isFinite(br.peakHsM) && env) marginBits.push(`Hs ${formatNumber(br.peakHsM)} m (${thresholdMargin(br.peakHsM, env.cautionWaveHeightM, env.maxWaveHeightM, { unit: 'm' })?.text})`);
  if (Number.isFinite(br.peakWindKt) && env) marginBits.push(`wind ${formatNumber(br.peakWindKt, 0)} kt (${thresholdMargin(br.peakWindKt, env.cautionWindKt, env.maxWindKt, { unit: 'kt', digits: 0 })?.text})`);
  const stepCov = bundle.coverage.steps;
  const confText = br.confidence
    ? `${br.confidence[0].toUpperCase()}${br.confidence.slice(1)} · ${cov ? `${cov.classified} of ${cov.eligible ?? '—'} points` : 'points n/a'}${stepCov ? ` · ${pctText((100 * stepCov.available) / Math.max(1, stepCov.total))}% of outlook steps` : ''}`
    : 'Unavailable';
  const lowestBrief = (() => {
    const lw = br.lowest;
    if (!bundle.timeSeries) return null;
    if (!lw) return 'Not assessed';
    if (lw.kind === 'all-suitable') return `All Suitable ${spanText(local, lw.start.validTime, lw.end.validTime)}`;
    if (lw.flat) return `No lower period (Warning ${pctText(lw.highestWarning)}% throughout)`;
    return `${spanText(local, lw.start.validTime, lw.end.validTime)} · ${pctText(lw.warning)}% Warning`;
  })();
  const rows = [
    ['Status', present ? `${hazardLabel(haz)} · ${pctText(selected.caution)}% Caution · ${pctText(selected.warning)}% Warning` : 'No data', present ? hazardText(haz) : TEXT_MD],
    ['Estimated driver', br.driver ? (br.driver.level ? `${br.driver.label}, over the ${br.driver.level} threshold` : br.driver.label) : 'Not reported'],
    ...(marginBits.length ? [['Peak vs threshold', marginBits.join('; ')]] : []),
    ...(lowestBrief ? [['Lowest exposure', lowestBrief]] : []),
    ...(bundle.timeSeries ? [['Worst in outlook', br.worst && br.worst.warning > 0 ? `${pctText(br.worst.warning)}% Warning at ${local(br.worst.validTime)}` : 'No Warning-level points modelled']] : []),
    ['Data confidence', confText],
    // When it last updated, not an age from the model's init time (~16 h old even when fresh).
    ['Forecast', `${updatedAt ? `Updated ${formatUtc(updatedAt)}${Number.isFinite(updateAge) ? ` (${Math.round(updateAge)} h ago)` : ''} · model data ` : 'Model data '}${bundle.modelRun.time ? formatUtc(bundle.modelRun.time) : 'not reported'} · ${{ current: 'Current', aging: 'Aging', stale: 'Stale', unknown: 'Age unknown' }[br.freshness ?? 'unknown']}`, FRESH[br.freshness ?? 'unknown']],
    ['Valid time', local(bundle.validTime)],
    ['Scope', `${scopeLabel(bundle.scope.effective)}${bundle.scope.mismatch ? ' (differs from request — see notice)' : ''}`],
    ['Thresholds', bundle.methodology.thresholdSource],
  ];
  const kvSize = 6.4; const keyW = 26; const valW = colW - keyW - 7;
  const rowH = (v) => Math.max(4.2, doc.splitTextToSize(String(v), valW).length * (kvSize * 0.5 + 0.1) + 1);
  setFont(doc, TEXT_DK, kvSize);
  const evH = 9 + rows.reduce((a, [, v]) => a + rowH(v), 0) + (bundle.dashboardUrl ? 4.5 : 0);
  card(doc, colX, top, colW, evH);
  sectionTitle(doc, 'BRIEFING', colX + 3, top + 5, { size: 7 });
  let ry = top + 10;
  rows.forEach(([k, v, color]) => {
    const h = rowH(v);
    setFont(doc, TEXT_MD, kvSize, 'bold'); doc.text(`${k}:`, colX + 3, ry);
    setFont(doc, color ?? TEXT_DK, kvSize, color ? 'bold' : 'normal');
    doc.text(doc.splitTextToSize(String(v), valW), colX + 3 + keyW, ry);
    ry += h;
  });
  if (bundle.dashboardUrl) {
    setFont(doc, [0, 110, 160], kvSize, 'bold');
    doc.textWithLink(fitText(doc, 'Live dashboard: latest conditions and updated forecast', colW - 6), colX + 3, ry + 0.5, { url: bundle.dashboardUrl });
  }
  let y = top + evH + 3;
  if (bundle.warnings.length) y += notice(doc, { x: colX, y, w: colW, text: `Notice: ${bundle.warnings.join(' ')}`, size: 6.2 }) + 3;

  // Four vessel cards
  const n = VESSEL_CLASS_OPTIONS.length;
  const gap = 3;
  const ch = (bottom - y - gap * (n - 1)) / n;
  for (let i = 0; i < n; i += 1) {
    const vc = VESSEL_CLASS_OPTIONS[i];
    const step = bundle.vessels[vc.value];
    const ok = hasVesselData(step);
    const vh = ok ? domainHazard(step.warning, step.caution) : 0;
    const cy = y + i * (ch + gap);
    card(doc, colX, cy, colW, ch);
    setFill(doc, ok ? hazardColor(vh) : NO_DATA_GREY);
    doc.rect(colX, cy, 3.2, ch, 'F');
    const icon = await loadVesselSvgIcon(vc.value, ok ? vh : 0);
    if (icon) { try { doc.addImage(icon, 'PNG', colX + colW - 27, cy + 3, 24, 8, undefined, 'FAST'); } catch { /* text only */ } }
    setFont(doc, TEXT_DK, 8.5, 'bold'); doc.text(vc.label, colX + 7, cy + 6);
    setFont(doc, TEXT_MD, 6.4); doc.text(vc.examples ?? '', colX + 7, cy + 10.5);
    setFont(doc, ok ? hazardText(vh) : TEXT_MD, 7.2, 'bold');
    doc.text(fitText(doc, ok ? `${hazardLabel(vh)} · ${pctText(step.caution)}% Caution · ${pctText(step.warning)}% Warning` : 'No data', colW - 10), colX + 7, cy + ch - 3);
  }
  pageFooter(doc, bundle);
  return H;
}

// ── Page 2 — Multi-vessel outlook ───────────────────────────────────────────

function drawPage2(doc, bundle, pageNo, pageCount) {
  doc.addPage();
  pageHeader(doc, bundle, 'MULTI-VESSEL OUTLOOK', pageNo, pageCount);
  const { local } = ctx(bundle);
  const ts = bundle.timeSeries;
  setFont(doc, TEXT_MD, 7);
  doc.text(doc.splitTextToSize(
    `Modelled conditions from ${local(bundle.forecastWindow.start)} to ${local(bundle.forecastWindow.end)} (steps every ${formatNumber(ts.strideHours, 0)} h). `
    + `Each bar step is S Suitable (no Caution/Warning points), C Caution (some Caution/Warning points) or W Warning (>= ${ELEVATED_WARNING_PERCENT}% of points Warning; a report summary rule, see methodology). Grey = Unavailable, never assumed Suitable.`, CW - 116), MARGIN, HDR_H + 6);
  drawLegendRow(doc, PAGE_W - MARGIN - 106, HDR_H + 7);

  const t0 = bundle.forecastWindow.start;
  const t1 = ts.byVessel[bundle.selectedVessel].filter((s) => s.validTime).slice(-1)[0]?.validTime ?? t0 + 1;
  const top = HDR_H + 14;
  const bottom = contentBottom(doc);
  const gap = 3;
  const rowH = (bottom - top - gap * 3) / 4;
  const labelW = 46;
  const ribX = MARGIN + labelW + 4;
  const factsX = MARGIN + 188;
  const ribW = factsX - ribX - 6;
  const factsW = PAGE_W - MARGIN - factsX - 3;
  const stepW = (t1 - t0) > 0 ? Math.max(0.5, ((ts.strideHours * 3600e3) / (t1 - t0)) * ribW) : 2;

  VESSEL_CLASS_OPTIONS.forEach((vc, i) => {
    const y = top + i * (rowH + gap);
    const series = ts.byVessel[vc.value];
    const an = ts.analysis[vc.value];
    const isSel = vc.value === bundle.selectedVessel;
    card(doc, MARGIN, y, CW, rowH, isSel ? { border: [0, 150, 190], lw: 0.7 } : {});
    setFont(doc, TEXT_DK, 9, 'bold'); doc.text(vc.label, MARGIN + 4, y + 8);
    setFont(doc, TEXT_MD, 6.5); doc.text(isSel ? 'Selected vessel' : (vc.examples ?? ''), MARGIN + 4, y + 13);

    const by = y + 7;
    series.forEach((s) => {
      if (!Number.isFinite(s.validTime)) return;
      const px = ribX + ((s.validTime - t0) / (t1 - t0 || 1)) * (ribW - stepW);
      const lvl = s.available === false ? null : stepLevel(s.warning, s.caution);
      setFill(doc, lvl === null ? NO_DATA_GREY : hazardColor(lvl));
      doc.rect(px, by, stepW + 0.15, 9, 'F');
      if (stepW >= 2.4 && lvl !== null) {
        setFont(doc, lvl === 1 ? [70, 45, 0] : [255, 255, 255], 5.2, 'bold');
        doc.text(LEVEL_LETTER[lvl], px + stepW / 2 + 0.07, by + 5.8, { align: 'center' });
      }
    });
    drawTimeAxis(doc, bundle, ribX, by + 9.5, ribW, t0, t1);

    const facts = [
      ['Best window', an.bestWithheld
        ? `Not assessed: only ${pctText(an.coverage.ratio * 100)}% of outlook steps had a model value`
        : (an.best ? spanText(local, an.best.start.validTime, an.best.end.validTime) : 'None: no run without Caution or Warning points')],
      ['Lowest exposure', lowestText(an, local)],
      ['Highest risk', an.highest && an.highest.warning > 0 ? `${pctText(an.highest.warning)}% Warning at ${local(an.highest.validTime)}` : `No Warning-level points modelled${an.bestWithheld ? ' in the assessed steps' : ''}`],
      ['Recovery', an.recovery.length ? an.recovery.slice(0, 2).map((r) => spanText(local, r.from.validTime, r.to.validTime)).join('; ') : (an.elevated.length ? 'None within the assessed period' : 'No elevated period')],
      ['Unavailable', an.unavailable.length ? an.unavailable.slice(0, 2).map((g) => spanText(local, g.start.validTime, g.end.validTime)).join('; ') : 'None'],
    ];
    facts.forEach(([k, v], fi) => {
      const fy = y + 7 + fi * 5.6;
      setFont(doc, TEXT_MD, 6.2, 'bold'); doc.text(`${k}:`, factsX, fy);
      setFont(doc, TEXT_DK, 6.4); doc.text(fitText(doc, v, factsW - 25), factsX + 25, fy);
    });
  });
  pageFooter(doc, bundle);
}

// When there is no all-Suitable window, the period with the least modelled exposure -- "least bad",
// never "safe". Said plainly when it is no better than the rest.
function lowestText(an, local) {
  if (an.bestWithheld) return 'Not assessed (insufficient coverage)';
  if (an.best) return 'See best window';
  const lw = an.lowest;
  if (!lw) return 'Not available';
  if (lw.flat) return `No lower period: Warning stays at ${pctText(lw.highestWarning)}% throughout`;
  return `${spanText(local, lw.start.validTime, lw.end.validTime)} · ${pctText(lw.warning)}% Warning (peak ${pctText(lw.highestWarning)}%)`;
}

// ── Page 3 — Same conditions, different vessels ─────────────────────────────

function drawPage3(doc, bundle, pageNo, pageCount) {
  doc.addPage();
  pageHeader(doc, bundle, 'SAME CONDITIONS, DIFFERENT VESSELS', pageNo, pageCount);
  const { local } = ctx(bundle);
  const c = bundle.maps.contrast;
  let y = HDR_H + 6;
  if (!c) {
    setFont(doc, TEXT_DK, 9, 'bold'); doc.text('Vessel comparison unavailable', MARGIN, y);
    setFont(doc, TEXT_MD, 7); doc.text('The service did not identify a comparison time for this period.', MARGIN, y + 5);
  } else {
    setFont(doc, TEXT_DK, 8.5, 'bold');
    doc.text(`Modelled conditions at ${local(c.validTime)} — the time in this period where vessel classes differ most`, MARGIN, y);
    setFont(doc, TEXT_MD, 6.8);
    doc.text(doc.splitTextToSize(`Same sea state in every panel (same extent, same valid time). The classes differ only because each vessel has its own wave and wind thresholds; the line under each map says which variable crosses them.${bundle.domainBoundary?.length ? ` ${BOUNDARY_CAPTION}` : ''}`, CW - 116), MARGIN, y + 4.6);
    drawLegendRow(doc, PAGE_W - MARGIN - 106, y + 5.6, mapLegend(bundle));
    y += 12;
    const bottom = contentBottom(doc);
    const gap = 5;
    const pw = (CW - gap * 3) / 4;
    let aspect = 1;
    try { const first = c.panels.find((p) => p.map?.dataUrl); if (first) { const ip = doc.getImageProperties(first.map.dataUrl); aspect = ip.width / ip.height; } } catch { aspect = 1; }
    const imgH = Math.min(bottom - y - 68, (pw - 4) / (aspect > 0 ? aspect : 1));
    const ph = 9 + imgH + 54;
    c.panels.forEach((p, i) => {
      const px = MARGIN + i * (pw + gap);
      const ok = hasVesselData(p.step);
      const vh = ok ? domainHazard(p.step.warning, p.step.caution) : 0;
      card(doc, px, y, pw, ph);
      setFill(doc, ok ? hazardColor(vh) : NO_DATA_GREY); doc.rect(px, y, pw, 7, 'F');
      setFont(doc, TEXT_LT, 8, 'bold'); doc.text(vesselLabel(p.vessel), px + 3, y + 4.9);
      if (p.map?.dataUrl) drawMap(doc, bundle, p.map, px + 2, y + 9, pw - 4, imgH, `contrast_${p.vessel}`, { furniture: true });
      else placeholderBox(doc, px + 2, y + 9, pw - 4, imgH, 'Map unavailable');
      const by = y + 9 + imgH + 4;
      if (ok) {
        drawHazardShareBar(doc, px + 3, by, pw - 6, 4, [[0, p.step.suitable], [1, p.step.caution], [2, p.step.warning]]);
      }
      setFont(doc, ok ? hazardText(vh) : TEXT_MD, 6.8, 'bold');
      doc.text(fitText(doc, ok ? `${hazardLabel(vh)} · ${pctText(p.step.suitable)}% S · ${pctText(p.step.caution)}% C · ${pctText(p.step.warning)}% W` : 'No data', pw - 6), px + 3, by + 9);
      // why this vessel differs: its own thresholds
      const rule = VESSEL_OPERATING_ENVELOPE[p.vessel];
      if (rule) {
        setFont(doc, hazardText(1), 6.2, 'bold'); doc.text(`Caution: Hs >= ${formatNumber(rule.cautionWaveHeightM)} m or wind >= ${formatNumber(rule.cautionWindKt, 0)} kt`, px + 3, by + 15);
        setFont(doc, hazardText(2), 6.2, 'bold'); doc.text(`Warning: Hs >= ${formatNumber(rule.maxWaveHeightM)} m or wind >= ${formatNumber(rule.maxWindKt, 0)} kt`, px + 3, by + 19.5);
        // What these thresholds mean for this sea state: which variable crosses them (estimated, as on page 4).
        const est = ok ? estimateDriver(p.step, rule) : null;
        if (est) {
          setFont(doc, TEXT_DK, 6.1, 'bold');
          doc.text(fitText(doc, est.level ? `Estimated driver: ${est.label.toLowerCase()} over ${est.level}` : 'Peaks stay below this vessel\'s thresholds', pw - 6), px + 3, by + 25.5);
          // How far the shared peaks sit from THIS vessel's thresholds: the reason the panels differ.
          const hsM = thresholdMargin(p.step.wave?.max, rule.cautionWaveHeightM, rule.maxWaveHeightM, { unit: 'm' });
          const windM = thresholdMargin(p.step.wind?.max, rule.cautionWindKt, rule.maxWindKt, { unit: 'kt', digits: 0 });
          [[hsM, `Hs ${formatNumber(p.step.wave?.max)} m`], [windM, `Wind ${formatNumber(p.step.wind?.max, 0)} kt`]].forEach(([m, lab], k) => {
            if (!m) return;
            setFont(doc, m.side === 'above' || (m.side === 'at' && m.level === 'warning') ? hazardText(2) : m.level === 'warning' || m.side === 'at' ? hazardText(1) : hazardText(0), 6.1, 'bold');
            doc.text(fitText(doc, `${lab}: ${m.text}`, pw - 6), px + 3, by + 30 + k * 4.2);
          });
        }
      }
    });
  }
  pageFooter(doc, bundle);
}

// ── Page 4 — Daily forecast evolution ───────────────────────────────────────

function drawPage4(doc, bundle, pageNo, pageCount) {
  doc.addPage();
  const vessel = bundle.selectedVessel;
  pageHeader(doc, bundle, `DAILY FORECAST EVOLUTION — ${vesselLabel(vessel).toUpperCase()}`, pageNo, pageCount);
  const { local } = ctx(bundle);
  const envelope = VESSEL_OPERATING_ENVELOPE[vessel];
  const rows = dailyEvolutionRows(bundle.maps.daily, envelope);
  setFont(doc, TEXT_MD, 7);
  doc.text(doc.splitTextToSize('One map and one row per day at 12:00 local time (the nearest forecast step is shown). Peaks are the highest wave height and wind anywhere in the report area at that hour. Days beyond the forecast horizon are shown as such, not estimated.', CW - 116), MARGIN, HDR_H + 6);
  drawLegendRow(doc, PAGE_W - MARGIN - 106, HDR_H + 7, mapLegend(bundle));

  const dayLabel = (r) => local(r.targetTime).replace(/ \d{2}:\d{2}.*$/, '');
  const noteH = 8;
  const bottom = contentBottom(doc) - noteH;
  const n = Math.max(1, rows.length);

  // ── map strip: one panel per day, as large as the page allows (a tall whole-domain view gets its
  // height; a wide island view its width), so the spatial pattern is readable, not a thumbnail.
  const stripTop = HDR_H + 13;
  const gap = 3;
  const panelW = (CW - gap * (n - 1)) / n;
  const tableRowH = 11;
  const headerH = 8;
  // The strip takes whatever height the table does not need: three days get large maps, six still fit.
  const maxStripH = Math.min(125, bottom - stripTop - 6 - headerH - n * tableRowH - 6);
  // ...but no taller than the maps need: a wide island view gets short cards, not empty space under it.
  let aspect = null;
  try { const m = rows.find((r) => r.map?.dataUrl)?.map; if (m) { const ip = doc.getImageProperties(m.dataUrl); aspect = ip.width / ip.height; } } catch { aspect = null; }
  const stripH = Number.isFinite(aspect) && aspect > 0 ? Math.min(maxStripH, (panelW - 3) / aspect + 9.5) : maxStripH;
  rows.forEach((r, i) => {
    const px = MARGIN + i * (panelW + gap);
    card(doc, px, stripTop, panelW, stripH);
    const lvl = r.available ? domainHazard(r.warning, r.caution) : null;
    setFill(doc, lvl === null ? NO_DATA_GREY : hazardColor(lvl));
    doc.rect(px, stripTop, panelW, 6, 'F');
    setFont(doc, lvl === 1 ? [60, 40, 0] : TEXT_LT, 7, 'bold');
    doc.text(fitText(doc, dayLabel(r), panelW - 4), px + 2, stripTop + 4.2);
    const my = stripTop + 7.5; const mh = stripH - 9.5;
    if (r.beyondHorizon) placeholderBox(doc, px + 1.5, my, panelW - 3, mh, 'Beyond forecast horizon');
    else if (r.map?.dataUrl) drawMap(doc, bundle, r.map, px + 1.5, my, panelW - 3, mh, `daily_${i}`);
    else placeholderBox(doc, px + 1.5, my, panelW - 3, mh, 'Map unavailable');
  });

  // ── table: the numbers behind each map, one compact row per day
  const top = stripTop + stripH + 6;
  const COLS = [
    { key: 'day', label: 'Day', w: 40 },
    { key: 'share', label: 'Share of assessed points', w: 84 },
    { key: 'hs', label: 'Peak wave height (Hs)', w: 31 },
    { key: 'wind', label: 'Peak wind', w: 22 },
    { key: 'driver', label: 'Estimated driver', w: 52 },
  ];
  COLS.push({ key: 'change', label: 'Change from previous day', w: CW - COLS.reduce((a, c) => a + c.w, 0) });
  const colX = (key) => COLS.slice(0, COLS.findIndex((c) => c.key === key)).reduce((a, c) => a + c.w, MARGIN);
  const colW = (key) => COLS.find((c) => c.key === key).w;
  rect(doc, MARGIN, top, CW, headerH, HEADER_BG);
  COLS.forEach((c) => { setFont(doc, TEXT_LT, 6.6, 'bold'); doc.text(c.label, colX(c.key) + 2.5, top + 5.2); });

  // Peak value coloured by the vessel threshold it reaches, so the numbers carry their own meaning.
  const levelOf = (v, caution, warning) => (v === null ? null : v >= warning ? 2 : v >= caution ? 1 : 0);

  rows.forEach((r, i) => {
    const y = top + headerH + i * tableRowH;
    rect(doc, MARGIN, y, CW, tableRowH, i % 2 ? [248, 250, 252] : [255, 255, 255]);
    setDraw(doc, GRID_CLR); doc.setLineWidth(0.15); doc.line(MARGIN, y + tableRowH, MARGIN + CW, y + tableRowH);
    const mid = y + tableRowH / 2;
    setFont(doc, TEXT_DK, 7.4, 'bold'); doc.text(dayLabel(r), colX('day') + 2.5, mid - 0.4);
    if (!r.beyondHorizon && r.matchedTime) { setFont(doc, TEXT_MD, 5.6); doc.text(`step ${local(r.matchedTime).split(' ').slice(-2).join(' ')}`, colX('day') + 2.5, mid + 3.2); }

    if (r.beyondHorizon) {
      setFont(doc, TEXT_MD, 7, 'italic'); doc.text('Beyond the forecast horizon: no forecast for this day.', colX('share') + 2.5, mid + 1.2);
      return;
    }
    if (!r.available) {
      setFont(doc, TEXT_MD, 7, 'italic'); doc.text('No data for this day (not assumed Suitable).', colX('share') + 2.5, mid + 1.2);
      return;
    }
    const sx = colX('share') + 2.5;
    const barW = 40;
    drawHazardShareBar(doc, sx, mid - 2, barW, 4, [[0, r.suitable], [1, r.caution], [2, r.warning]]);
    setFont(doc, hazardText(domainHazard(r.warning, r.caution)), 6.6, 'bold');
    doc.text(fitText(doc, `${pctText(r.suitable)}% S · ${pctText(r.caution)}% C · ${pctText(r.warning)}% W`, colW('share') - barW - 7), sx + barW + 2.5, mid + 1.2);
    const hsLvl = envelope ? levelOf(r.peakHsM, envelope.cautionWaveHeightM, envelope.maxWaveHeightM) : null;
    const windLvl = envelope ? levelOf(r.peakWindKt, envelope.cautionWindKt, envelope.maxWindKt) : null;
    setFont(doc, hsLvl === null ? TEXT_MD : hazardText(hsLvl), 7.8, 'bold');
    doc.text(r.peakHsM === null ? '—' : `${formatNumber(r.peakHsM)} m`, colX('hs') + 2.5, mid + 1.2);
    setFont(doc, windLvl === null ? TEXT_MD : hazardText(windLvl), 7.8, 'bold');
    doc.text(r.peakWindKt === null ? '—' : `${formatNumber(r.peakWindKt, 0)} kt`, colX('wind') + 2.5, mid + 1.2);
    setFont(doc, r.driver?.level ? hazardText(r.driver.level === 'warning' ? 2 : 1) : TEXT_MD, 7, 'bold');
    const driverText = r.driver ? (r.driver.level ? `${r.driver.label} · over ${r.driver.level}` : r.driver.label) : 'Not reported';
    doc.text(fitText(doc, driverText, colW('driver') - 4), colX('driver') + 2.5, mid + 1.2);
    setFont(doc, r.change ? (r.change.direction === 'higher' ? hazardText(2) : r.change.direction === 'lower' ? hazardText(0) : TEXT_DK) : TEXT_MD, 7, r.change ? 'bold' : 'normal');
    const changeLabel = r.delta ? deltaText(r.delta) : (!rows.slice(0, i).some((q) => q.available) ? 'First day shown' : '—');
    if (r.delta) setFont(doc, r.delta.warning > 1 ? hazardText(2) : r.delta.warning < -1 ? hazardText(0) : TEXT_DK, 6.3, 'bold');
    doc.text(fitText(doc, changeLabel, colW('change') - 4), colX('change') + 2.5, mid + 1.2);
  });

  setFont(doc, TEXT_MD, 5.9, 'italic');
  doc.text(doc.splitTextToSize(`Estimated driver: the peak wave height and wind in the area are compared with the ${vesselLabel(vessel)} thresholds (Caution Hs >= ${formatNumber(envelope?.cautionWaveHeightM)} m or wind >= ${formatNumber(envelope?.cautionWindKt, 0)} kt; Warning Hs >= ${formatNumber(envelope?.maxWaveHeightM)} m or wind >= ${formatNumber(envelope?.maxWindKt, 0)} kt). The service does not report which variable classified each point. Peak values are coloured by the threshold they reach. Change: W / C = change in Warning / Caution share (percentage points) and in peak Hs and wind since the previous day shown.`, CW), MARGIN, top + headerH + n * tableRowH + 4.5);
  pageFooter(doc, bundle);
}

// ── Page 5 — Forecast trend ─────────────────────────────────────────────────

// A faint band: it marks the elevated period without competing with the lines.
const ELEVATED_BG = [253, 239, 240];
const SELECTED_LINE = [18, 50, 74];

function drawPage5(doc, bundle, pageNo, pageCount) {
  doc.addPage();
  pageHeader(doc, bundle, 'FORECAST TREND', pageNo, pageCount);
  const { local } = ctx(bundle);
  const ts = bundle.timeSeries;
  const sel = bundle.selectedVessel;
  const top = HDR_H + 4;
  const bottom = contentBottom(doc);
  const chartCardW = 196;
  const sideX = MARGIN + chartCardW + 5;
  const sideW = PAGE_W - MARGIN - sideX;

  card(doc, MARGIN, top, chartCardW, bottom - top);
  sectionTitle(doc, `Modelled conditions over the outlook — ${scopeLabel(bundle.scope.effective).toLowerCase()}`, MARGIN + 4, top + 6, { color: TEXT_DK, size: 8 });
  setFont(doc, TEXT_MD, 6.6);
  doc.text(`Forecast period: ${local(bundle.forecastWindow.start)} to ${local(bundle.forecastWindow.end)}`, MARGIN + 4, top + 10.5);

  const cx = MARGIN + 16; const cw = chartCardW - 24;
  const t0 = bundle.forecastWindow.start; const t1 = bundle.forecastWindow.end > t0 ? bundle.forecastWindow.end : t0 + 3600e3;
  const X = (t) => cx + ((t - t0) / (t1 - t0)) * cw;

  // Panel A: every class for the selected vessel, stacked to 100% per step, so a move from Caution to
  // Suitable shows even when the Warning share does not change.
  const aTop = top + 19; const aH = (bottom - top - 62) * 0.42;
  setFont(doc, TEXT_DK, 6.8, 'bold'); doc.text(`${vesselLabel(sel)}: share of points by class`, cx, aTop - 2);
  drawLegendRow(doc, cx + cw - 81, aTop - 2, MAP_LEGEND_FILL);
  rect(doc, cx, aTop, cw, aH, [252, 253, 254], GRID_CLR, 0.25);
  const selSeries = ts.byVessel[sel].filter((st) => Number.isFinite(st.validTime));
  const barW = Math.max(0.6, ((ts.strideHours * 3600e3) / (t1 - t0)) * cw);
  selSeries.forEach((st) => {
    const bx = Math.min(cx + cw - barW, X(st.validTime));
    if (st.available === false) { setFill(doc, [225, 225, 225]); doc.rect(bx, aTop, barW, aH, 'F'); return; }
    let acc = 0;
    [[2, st.warning], [1, st.caution], [0, st.suitable]].forEach(([h, v]) => {
      const share = Math.max(0, Number(v) || 0);
      if (!share) return;
      const hh = (Math.min(share, 100 - acc) / 100) * aH;
      setFill(doc, MAP_FILL_RGB[h]); // large filled areas use the calmer map-fill palette, like the maps
      doc.rect(bx, aTop + aH - (acc / 100) * aH - hh, barW + 0.1, hh, 'F');
      acc += share;
    });
  });
  setDraw(doc, GRID_CLR); doc.setLineWidth(0.15);
  [0, 50, 100].forEach((v) => {
    const yy = aTop + aH - (v / 100) * aH;
    doc.line(cx, yy, cx + cw, yy);
    setFont(doc, TEXT_MD, 5.8); doc.text(`${v}%`, cx - 1.5, yy + 1, { align: 'right' });
  });

  // Panel B: Warning share for all four vessels (selected one emphasised), against the summary rule.
  const cy = aTop + aH + 12; const ch = bottom - cy - 30;
  setFont(doc, TEXT_DK, 6.8, 'bold'); doc.text('Warning share, all vessel classes', cx, cy - 2);
  const allWarn = VESSEL_CLASS_OPTIONS.flatMap((v) => ts.byVessel[v.value]).filter((st) => st.available !== false).map((st) => st.warning);
  const yMax = Math.max(20, Math.ceil(Math.max(0, ...allWarn) / 10) * 10 + 5);
  const Y = (v) => cy + ch - (v / yMax) * ch;

  rect(doc, cx, cy, cw, ch, [252, 253, 254], GRID_CLR, 0.25);
  ts.analysis[sel].elevated.forEach((r) => { setFill(doc, ELEVATED_BG); doc.rect(X(r.start.validTime) - 1, cy, Math.max(2, X(r.end.validTime) - X(r.start.validTime) + 2), ch, 'F'); });
  ts.analysis[sel].unavailable.forEach((g) => { setFill(doc, [225, 225, 225]); doc.rect(X(g.start.validTime) - 1, cy, Math.max(2, X(g.end.validTime) - X(g.start.validTime) + 2), ch, 'F'); });
  setDraw(doc, GRID_CLR); doc.setLineWidth(0.15);
  for (let v = 0; v <= yMax; v += yMax > 40 ? 20 : 10) {
    doc.line(cx, Y(v), cx + cw, Y(v));
    setFont(doc, TEXT_MD, 6); doc.text(`${v}%`, cx - 1.5, Y(v) + 1, { align: 'right' });
  }
  setDraw(doc, hazardColor(2)); doc.setLineWidth(0.25);
  doc.setLineDashPattern([1.2, 0.9], 0);
  doc.line(cx, Y(ELEVATED_WARNING_PERCENT), cx + cw, Y(ELEVATED_WARNING_PERCENT));
  doc.setLineDashPattern([], 0);
  setFont(doc, hazardText(2), 5.6, 'italic'); doc.text(`${ELEVATED_WARNING_PERCENT}% = elevated (summary rule)`, cx + cw - 1, Y(ELEVATED_WARNING_PERCENT) - 1, { align: 'right' });

  const drawSeries = (code, color, lw) => {
    setDraw(doc, color); doc.setLineWidth(lw);
    let prev = null;
    ts.byVessel[code].forEach((st) => {
      if (st.available === false || !Number.isFinite(st.validTime)) { prev = null; return; }
      if (prev) doc.line(X(prev.validTime), Y(prev.warning), X(st.validTime), Y(st.warning));
      prev = st;
    });
  };
  // The selected vessel is the line to follow; the other three are context, in quiet greys.
  // Medium grey, light grey and a muted blue-grey: told apart from each other, all quieter than it.
  const OTHER = [[128, 136, 146], [186, 192, 199], [112, 140, 170]];
  VESSEL_CLASS_OPTIONS.filter((v) => v.value !== sel).forEach((v, i) => drawSeries(v.value, OTHER[i % 3], 0.5));
  drawSeries(sel, SELECTED_LINE, 1.4);

  // Event markers for the selected vessel: where "now" is, when exposure is lowest, when Warning first
  // appears and when it peaks -- labels staggered so they never overlap.
  const anSel = ts.analysis[sel];
  const firstWarn = ts.byVessel[sel].find((st) => st.available !== false && st.warning > 0);
  const events = [
    ['Now (valid time)', bundle.validTime],
    anSel.lowest && !anSel.lowest.flat && !anSel.best ? ['Lowest exposure', anSel.lowest.start.validTime] : null,
    anSel.best ? ['All Suitable', anSel.best.start.validTime] : null,
    firstWarn && firstWarn.validTime !== bundle.validTime ? ['Warning first appears', firstWarn.validTime] : null,
    anSel.highest && anSel.highest.warning > 0 ? [`Peak Warning ${pctText(anSel.highest.warning)}%`, anSel.highest.validTime] : null,
  ].filter((e) => e && Number.isFinite(e[1]) && e[1] >= t0 && e[1] <= t1).sort((a, b) => a[1] - b[1]);
  const placed = [];
  events.forEach(([label, t]) => {
    const ex = X(t);
    setDraw(doc, [18, 50, 74]); doc.setLineWidth(0.25); doc.setLineDashPattern([0.8, 0.8], 0);
    doc.line(ex, cy, ex, cy + ch);
    doc.setLineDashPattern([], 0);
    setFont(doc, [18, 50, 74], 5.4, 'bold');
    const w = doc.getTextWidth(label) + 2;
    const clashes = (r) => placed.some((q) => q.row === r && Math.abs(q.x - ex) < (q.w + w) / 2 + 1);
    const row = [0, 1, 2, 3].find((r) => !clashes(r)) ?? 3;
    placed.push({ x: ex, w, row });
    const lx2 = Math.min(Math.max(ex - w / 2, cx), cx + cw - w);
    setFill(doc, [255, 255, 255]); doc.rect(lx2, cy + 1 + row * 4, w, 3.4, 'F');
    doc.text(label, lx2 + 1, cy + 3.6 + row * 4);
  });
  drawTimeAxis(doc, bundle, cx, cy + ch + 0.5, cw, t0, t1);

  // legend
  let lx = MARGIN + 6; const ly = cy + ch + 11;
  setDraw(doc, SELECTED_LINE); doc.setLineWidth(1.4); doc.line(lx, ly, lx + 8, ly);
  setFont(doc, TEXT_DK, 6.5, 'bold'); doc.text(`${vesselLabel(sel)} (selected)`, lx + 10, ly + 0.9);
  lx += 52;
  VESSEL_CLASS_OPTIONS.filter((v) => v.value !== sel).forEach((v, i) => {
    setDraw(doc, OTHER[i % 3]); doc.setLineWidth(0.5); doc.line(lx, ly, lx + 6, ly);
    setFont(doc, TEXT_MD, 6.3); doc.text(v.label, lx + 7.5, ly + 0.9); lx += 36;
  });
  rect(doc, MARGIN + 6, ly + 5, 3, 3, ELEVATED_BG, [230, 190, 192], 0.2); setFont(doc, TEXT_MD, 6.3); doc.text('Elevated period (selected vessel)', MARGIN + 10.5, ly + 7.5);
  rect(doc, MARGIN + 70, ly + 5, 3, 3, [225, 225, 225]); doc.text('Unavailable (gap — not assumed Suitable)', MARGIN + 74.5, ly + 7.5);

  // side summary card
  card(doc, sideX, top, sideW, bottom - top);
  sectionTitle(doc, `${vesselLabel(sel).toUpperCase()} — EVIDENCE`, sideX + 4, top + 6, { size: 7.5 });
  const an = ts.analysis[sel];
  const items = [
    ['Elevated periods', an.elevated.length ? an.elevated.slice(0, 4).map((r) => spanText(local, r.start.validTime, r.end.validTime)).join('; ') : 'None modelled'],
    ['Recovery windows', an.recovery.length ? an.recovery.slice(0, 3).map((r) => spanText(local, r.from.validTime, r.to.validTime)).join('; ') : (an.elevated.length ? 'None within the assessed period' : 'Not applicable')],
    ['Data gaps', an.unavailable.length ? an.unavailable.slice(0, 3).map((g) => spanText(local, g.start.validTime, g.end.validTime)).join('; ') : 'None'],
    ['Forecast start', local(bundle.forecastWindow.forecastStart)],
    ['Forecast end', local(bundle.forecastWindow.forecastEnd)],
  ];
  let ry = top + 13;
  items.forEach(([k, v]) => {
    setFont(doc, TEXT_MD, 6.5, 'bold'); doc.text(`${k}`, sideX + 4, ry);
    setFont(doc, TEXT_DK, 6.8);
    const lines = doc.splitTextToSize(v, sideW - 8);
    doc.text(lines, sideX + 4, ry + 4);
    ry += 4 + lines.length * 3.5 + 4;
  });
  pageFooter(doc, bundle);
}

// ── Page 6 — Methodology & limitations ──────────────────────────────────────

function drawPageMethodology(doc, bundle, pageNo, pageCount) {
  doc.addPage();
  pageHeader(doc, bundle, 'METHODOLOGY, SCOPE & LIMITATIONS', pageNo, pageCount);
  const { local } = ctx(bundle);
  const top = HDR_H + 4;
  const bottom = contentBottom(doc);
  const gap = 5;
  const leftW = 138;
  const rightX = MARGIN + leftW + gap;
  const rightW = PAGE_W - MARGIN - rightX;

  // left: classification + scope
  const para = (t, x, y, w, size = 6.9, color = TEXT_MD) => { setFont(doc, color, size); const lines = doc.splitTextToSize(t, w); doc.text(lines, x, y); return lines.length * (size * 0.42 + 0.6) + 1.5; };
  const cls1 = 'Classification is applied independently at each modelled point using significant wave height (Hs) and sustained 10-metre wind speed. A point is Warning when either parameter meets or exceeds the Warning threshold for the vessel class; Caution when it meets the Caution threshold; Suitable otherwise. Percentages are shares of assessed model points in each category.';
  const cls2 = `Warning aggregation (${ELEVATED_WARNING_RULE.kind.toLowerCase()}, version ${ELEVATED_WARNING_RULE.version}): a time step is described as "Warning" (elevated) in the outlook and trend pages when at least ${ELEVATED_WARNING_RULE.percent}% of assessed points are Warning-level; any smaller Warning share is reported explicitly as a percentage and the step is shown as Caution. ${ELEVATED_WARNING_RULE.basis}`;
  card(doc, MARGIN, top, leftW, bottom - top);
  let y = top + 6;
  sectionTitle(doc, 'HOW SUITABILITY IS CLASSIFIED', MARGIN + 4, y); y += 4.5;
  y += para(cls1, MARGIN + 4, y, leftW - 8);
  y += para(cls2, MARGIN + 4, y, leftW - 8);
  y += 2;
  sectionTitle(doc, 'SCOPE AND PROVENANCE', MARGIN + 4, y); y += 5;
  const cov = bundle.coverage.points;
  const rows = [
    // scope.effective and scope.requested can share the same coarse label (both
    // "viewport") even when scope.mismatch is true -- the mismatch was in the
    // applied BOUNDS, not the viewport/domain basis, and scopeLabel() only
    // distinguishes the latter. Printing "requested: <same label>" would read as
    // self-contradictory (see reportRules.scopeLabel); say what actually
    // differed (scope.reasons) instead of repeating an identical-looking label.
    ['Statistics scope', bundle.scope.mismatch
      ? (bundle.scope.effective !== bundle.scope.requested
        ? `${scopeLabel(bundle.scope.effective)} — requested: ${scopeLabel(bundle.scope.requested)}`
        : `${scopeLabel(bundle.scope.effective)} — ${bundle.scope.reasons.join(' ')}`)
      : scopeLabel(bundle.scope.effective)],
    ['Statistics basis', bundle.scope.basisReported ?? 'not reported'],
    ['Bounds applied', bundle.scope.appliedBounds ? `W ${bundle.scope.appliedBounds.west}, S ${bundle.scope.appliedBounds.south}, E ${bundle.scope.appliedBounds.east}, N ${bundle.scope.appliedBounds.north}` : 'Whole forecast domain'],
    ['Point coverage', cov ? `${cov.classified} classified of ${cov.eligible ?? '—'} eligible (${cov.total ?? '—'} total)` : 'Unavailable'],
    ['Model run', bundle.modelRun.time ? formatUtc(bundle.modelRun.time) : 'Not reported'],
    ['Valid time', `${local(bundle.validTime)} (${formatUtc(bundle.validTime)})`],
    // The model data starts before the run (spin-up history); said as three separate facts, so it does
    // not read as a forecast that starts before it was made.
    ['Model data window', `${local(bundle.forecastWindow.forecastStart)} – ${local(bundle.forecastWindow.forecastEnd)}`],
    ...(Number.isFinite(bundle.forecastWindow.hindcastHoursBeforeRun) && bundle.forecastWindow.hindcastHoursBeforeRun > 0
      ? [['History before run', `${Math.round(bundle.forecastWindow.hindcastHoursBeforeRun)} h of model history precede the run; not used as forecast`]] : []),
    ['Outlook in this report', bundle.timeSeries ? `${local(bundle.forecastWindow.start)} – ${local(bundle.forecastWindow.end)}` : `${local(bundle.validTime)} only`],
    ['Generated', formatLocal(bundle.generatedAt, bundle.timezone, tzLabel(bundle.timezone))],
    ['Methodology version', bundle.methodology.methodologyVersion ?? `Not reported by the service (API schema ${bundle.methodology.apiSchemaVersion ?? 'unknown'})`],
    ['Thresholds', bundle.methodology.thresholdSource],
    ['Threshold set', governanceText(bundle.governance?.thresholdSet)],
    ['Summary rule', governanceText(bundle.governance?.summaryRule)],
    ['Report ID', bundle.reportId ?? '—'],
    ...(bundle.dashboardUrl ? [['Live dashboard', bundle.dashboardUrl]] : []),
    ['Source', SOURCE_TEXT],
  ];
  rows.forEach(([k, v]) => { y += keyValue(doc, MARGIN + 4, y, k, v, { keyW: 34, maxW: leftW - 44 }); });
  y += 2;
  if (bundle.warnings.length) y += notice(doc, { x: MARGIN + 4, y, w: leftW - 8, text: `Notices for this report: ${bundle.warnings.join(' ')}`, size: 6.2 }) + 2;

  // right: thresholds table, limitations, missing data
  card(doc, rightX, top, rightW, bottom - top);
  sectionTitle(doc, 'VESSEL THRESHOLDS (PRESET)', rightX + 4, top + 6);
  const tx = rightX + 4; const tw = rightW - 8; const tCols = [40, 28, 34]; tCols.push(tw - tCols.reduce((a, b) => a + b, 0));
  const colX = []; let acc = tx; tCols.forEach((w) => { colX.push(acc); acc += w; });
  const ty = top + 10; const hh = 7; const rh = 10;
  rect(doc, tx, ty, tw, hh, HEADER_BG);
  ['Vessel class', 'Typical use', 'Caution', 'Warning'].forEach((t, i) => { setFont(doc, TEXT_LT, 6.8, 'bold'); doc.text(t, colX[i] + 2, ty + 4.8); });
  VESSEL_CLASS_OPTIONS.forEach((vc, ri) => {
    const rule = VESSEL_OPERATING_ENVELOPE[vc.value];
    const ry = ty + hh + ri * rh;
    rect(doc, tx, ry, tw, rh, ri % 2 === 0 ? [245, 247, 252] : [255, 255, 255]);
    setFont(doc, TEXT_DK, 7, 'bold'); doc.text(vc.label, colX[0] + 2, ry + 6);
    setFont(doc, TEXT_MD, 6); doc.text(fitText(doc, vc.examples ?? '', tCols[1] - 3), colX[1] + 2, ry + 6);
    if (rule) {
      setFont(doc, hazardText(1), 6.3, 'bold');
      doc.text(`Hs >= ${formatNumber(rule.cautionWaveHeightM)} m`, colX[2] + 2, ry + 4);
      doc.text(`Wind >= ${formatNumber(rule.cautionWindKt, 0)} kt`, colX[2] + 2, ry + 8);
      setFont(doc, hazardText(2), 6.3, 'bold');
      doc.text(`Hs >= ${formatNumber(rule.maxWaveHeightM)} m`, colX[3] + 2, ry + 4);
      doc.text(`Wind >= ${formatNumber(rule.maxWindKt, 0)} kt`, colX[3] + 2, ry + 8);
    }
  });
  setDraw(doc, GRID_CLR); doc.setLineWidth(0.25);
  doc.rect(tx, ty, tw, hh + VESSEL_CLASS_OPTIONS.length * rh, 'S');
  let ry2 = ty + hh + VESSEL_CLASS_OPTIONS.length * rh + 7;
  sectionTitle(doc, 'KNOWN LIMITATIONS', rightX + 4, ry2); ry2 += 5;
  bundle.limitations.forEach((t) => { ry2 += para(`• ${t}`, rightX + 4, ry2, rightW - 8, 6.6); });
  ry2 += 1.5;
  sectionTitle(doc, 'MISSING AND FALLBACK DATA', rightX + 4, ry2); ry2 += 5;
  para('When the service returns no classified points for a time or area, the report shows "No data" or "Unavailable". These are never treated as Suitable or as zero. If statistics for the requested map view cannot be produced, the report states which scope its figures describe. A map that could not be drawn at the requested extent is left out rather than substituted.', rightX + 4, ry2, rightW - 8, 6.6);
  pageFooter(doc, bundle);
}

// ── Main ─────────────────────────────────────────────────────────────────────

// Renders an already-built bundle (see reports/domainReportBundle.js).
export async function renderCookIslandsDomainAdvisoryPdfDoc(bundle) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  await ensureReportFont(doc);
  doc.setProperties({
    title: 'Cook Islands Domain Advisory',
    subject: 'Marine vessel suitability advisory (modelled guidance)',
    creator: 'Cook Islands Ocean Dashboard',
    author: 'Pacific Community (SPC)',
  });
  doc.setLanguage('en');

  const outlook = Boolean(bundle.timeSeries);
  const pageCount = outlook ? 6 : 2;
  await drawPage1(doc, bundle, pageCount);
  if (outlook) {
    drawPage2(doc, bundle, 2, pageCount);
    drawPage3(doc, bundle, 3, pageCount);
    drawPage4(doc, bundle, 4, pageCount);
    drawPage5(doc, bundle, 5, pageCount);
  }
  drawPageMethodology(doc, bundle, pageCount, pageCount);

  const stamp = bundle.generatedAt.toISOString().slice(0, 16).replace(/[:T]/g, '');
  return { doc, filename: `cook_islands_domain_advisory_${bundle.selectedVessel}_${stamp}.pdf` };
}

// Builds the bundle from live endpoints, then renders it.
export async function buildCookIslandsDomainAdvisoryPdfDoc(params, deps) {
  const bundle = await buildDomainReportBundle(params, deps);
  return renderCookIslandsDomainAdvisoryPdfDoc(bundle);
}

export async function exportCookIslandsDomainAdvisoryPdf(params) {
  const { doc, filename } = await buildCookIslandsDomainAdvisoryPdfDoc(params);
  doc.save(filename);
  return filename;
}
