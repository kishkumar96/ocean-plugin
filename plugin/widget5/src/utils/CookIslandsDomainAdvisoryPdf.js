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
  drawHeaderBand, drawFooter, card, banner, notice, sectionTitle, keyValue, fitText, drawLegendRow,
  drawHazardShareBar, contentBottom, loadVesselSvgIcon, ensureReportFont, PAGE_W,
} from './pdfTheme';
import { tzLabel } from './timeZoneFormat';
import { VESSEL_OPERATING_ENVELOPE, VESSEL_CLASS_OPTIONS } from '../lib/CookIslandsSuitabilityOverlay';
import { buildDomainReportBundle } from '../reports/domainReportBundle';
import { drawBoundaryOverlay, BOUNDARY_CAPTION } from '../reports/mapOverlay';
import {
  stepLevel, pctText, scopeLabel, formatLocal, formatUtc, zonedWallTimeToUtc, ELEVATED_WARNING_PERCENT, SOURCE_TEXT,
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

function provenanceLine(bundle) {
  const { local } = ctx(bundle);
  const run = bundle.modelRun.time ? formatUtc(bundle.modelRun.time) : 'not reported';
  return `Model run ${run} · Valid ${local(bundle.validTime)} · Scope: ${scopeLabel(bundle.scope.effective)} · Generated ${formatLocal(bundle.generatedAt, bundle.timezone, tzLabel(bundle.timezone))} · Source: ${SOURCE_TEXT}`;
}

function pageHeader(doc, bundle, subtitle, pageNo, pageCount) {
  const { local } = ctx(bundle);
  drawHeaderBand(doc, {
    title: 'COOK ISLANDS COASTAL WATERS',
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
  banner(doc, {
    y: HDR_H + 4,
    hazard: present ? haz : null,
    text: `${selLabel.toUpperCase()} — ${present ? hazardLabel(haz).toUpperCase() : 'NO DATA'}   ·   ${domainFinding({ label: selLabel, data: selected })}`,
    h: 9.5,
  });

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
      y: HDR_H + 4 + 9.5 + 2,
      w: PAGE_W - 2 * MARGIN,
      text: `REQUESTED VIEW UNAVAILABLE — this report uses ${scopeLabel(bundle.scope.effective).toLowerCase()} instead. `
        + `Requested: ${scopeLabel(bundle.scope.requested)}. Applied: ${scopeLabel(bundle.scope.effective)}. `
        + `Reason: ${bundle.scope.reasons.join(' ')}`,
      size: 6.8,
    }) + 2;
  }

  const top = HDR_H + 16 + substitutionNoticeH;
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
    overlayBoundary(doc, bundle, bundle.maps.selected, fitImage(doc, bundle.maps.selected.dataUrl, MARGIN + 2, top + 2, mapW - 4, bottom - top - capH - legendH - 4, 'domain_map'));
    drawLegendRow(doc, MARGIN + 3, bottom - capH - legendH + 5, [[hazardColor(0), 'Suitable'], [hazardColor(1), 'Caution'], [hazardColor(2), 'Warning']]);
  } else {
    placeholderBox(doc, MARGIN + 2, top + 2, mapW - 4, bottom - top - capH - 4, 'Map unavailable — the service did not return a map for this view. Statistics are still shown.');
  }
  setFont(doc, TEXT_MD, 6, 'italic');
  doc.text(
    doc.splitTextToSize(`${selLabel} · ${scopeLabel(bundle.scope.effective)} · SWAN wave model${bundle.domainBoundary?.length ? ` · ${BOUNDARY_CAPTION}` : ''}`, mapW - 6),
    MARGIN + 3, bottom - capH + 3,
  );

  // Provenance / evidence card
  const cov = bundle.coverage.points;
  const age = bundle.modelRun.ageHours;
  const rows = [
    ['Model run', bundle.modelRun.time ? `${formatUtc(bundle.modelRun.time)}${Number.isFinite(age) ? ` (${Math.round(age)} h before generation)` : ''}` : 'Not reported by the service'],
    ['Valid time', local(bundle.validTime)],
    ['Scope', `${scopeLabel(bundle.scope.effective)}${bundle.scope.mismatch ? ' (differs from request — see notice)' : ''}`],
    ['Point coverage', cov ? `${cov.classified} of ${cov.eligible ?? cov.total ?? '—'} eligible model points classified` : 'Unavailable'],
    ['Thresholds', bundle.methodology.thresholdSource],
  ];
  const evH = 8 + rows.length * 4.6;
  card(doc, colX, top, colW, evH);
  sectionTitle(doc, 'EVIDENCE', colX + 3, top + 5, { size: 7 });
  let ry = top + 10;
  rows.forEach(([k, v]) => { ry += keyValue(doc, colX + 3, ry, k, v, { keyW: 27, maxW: colW - 34, size: 6.6 }); });
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
    + `Each bar step is Suitable (no Caution/Warning points), Caution (some Caution/Warning points) or Warning (>= ${ELEVATED_WARNING_PERCENT}% of points Warning). Grey = Unavailable, never assumed Suitable.`, CW - 116), MARGIN, HDR_H + 6);
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
      setFill(doc, s.available === false ? NO_DATA_GREY : hazardColor(stepLevel(s.warning, s.caution)));
      doc.rect(px, by, stepW + 0.15, 9, 'F');
    });
    drawTimeAxis(doc, bundle, ribX, by + 9.5, ribW, t0, t1);

    const facts = [
      ['Best window', an.bestWithheld
        ? `Not assessed: only ${pctText(an.coverage.ratio * 100)}% of outlook steps had a model value`
        : (an.best ? spanText(local, an.best.start.validTime, an.best.end.validTime) : 'None: no run without Caution or Warning points')],
      ['Highest risk', an.highest && an.highest.warning > 0 ? `${pctText(an.highest.warning)}% Warning at ${local(an.highest.validTime)}` : `No Warning-level points modelled${an.bestWithheld ? ' in the assessed steps' : ''}`],
      ['Recovery', an.recovery.length ? an.recovery.slice(0, 2).map((r) => spanText(local, r.from.validTime, r.to.validTime)).join('; ') : (an.elevated.length ? 'None within the assessed period' : 'No elevated period')],
      ['Unavailable', an.unavailable.length ? an.unavailable.slice(0, 2).map((g) => spanText(local, g.start.validTime, g.end.validTime)).join('; ') : 'None'],
    ];
    facts.forEach(([k, v], fi) => {
      const fy = y + 7 + fi * 6.4;
      setFont(doc, TEXT_MD, 6.2, 'bold'); doc.text(`${k}:`, factsX, fy);
      setFont(doc, TEXT_DK, 6.4); doc.text(fitText(doc, v, factsW - 22), factsX + 22, fy);
    });
  });
  pageFooter(doc, bundle);
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
    doc.text(doc.splitTextToSize(`Same geographic extent and valid time in every panel. The panels differ only because each vessel class has its own wind and wave thresholds.${bundle.domainBoundary?.length ? ` ${BOUNDARY_CAPTION}` : ''}`, CW - 116), MARGIN, y + 4.6);
    drawLegendRow(doc, PAGE_W - MARGIN - 106, y + 5.6, [[hazardColor(0), 'Suitable'], [hazardColor(1), 'Caution'], [hazardColor(2), 'Warning']]);
    y += 12;
    const bottom = contentBottom(doc);
    const gap = 5;
    const pw = (CW - gap * 3) / 4;
    let aspect = 1;
    try { const first = c.panels.find((p) => p.map?.dataUrl); if (first) { const ip = doc.getImageProperties(first.map.dataUrl); aspect = ip.width / ip.height; } } catch { aspect = 1; }
    const imgH = Math.min(bottom - y - 60, (pw - 4) / (aspect > 0 ? aspect : 1));
    const ph = 9 + imgH + 46;
    c.panels.forEach((p, i) => {
      const px = MARGIN + i * (pw + gap);
      const ok = hasVesselData(p.step);
      const vh = ok ? domainHazard(p.step.warning, p.step.caution) : 0;
      card(doc, px, y, pw, ph);
      setFill(doc, ok ? hazardColor(vh) : NO_DATA_GREY); doc.rect(px, y, pw, 7, 'F');
      setFont(doc, TEXT_LT, 8, 'bold'); doc.text(vesselLabel(p.vessel), px + 3, y + 4.9);
      if (p.map?.dataUrl) overlayBoundary(doc, bundle, p.map, fitImage(doc, p.map.dataUrl, px + 2, y + 9, pw - 4, imgH, `contrast_${p.vessel}`));
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
      }
    });
  }
  pageFooter(doc, bundle);
}

// ── Page 4 — Daily forecast evolution ───────────────────────────────────────

function drawPage4(doc, bundle, pageNo, pageCount) {
  doc.addPage();
  pageHeader(doc, bundle, `DAILY FORECAST EVOLUTION — ${vesselLabel(bundle.selectedVessel).toUpperCase()}`, pageNo, pageCount);
  const { local } = ctx(bundle);
  setFont(doc, TEXT_MD, 7);
  doc.text(doc.splitTextToSize('Modelled conditions at 12:00 local time each day (nearest forecast step shown under every panel). Days beyond the forecast horizon are shown as such, not estimated.', CW - 116), MARGIN, HDR_H + 6);
  drawLegendRow(doc, PAGE_W - MARGIN - 106, HDR_H + 7, [[hazardColor(0), 'Suitable'], [hazardColor(1), 'Caution'], [hazardColor(2), 'Warning']]);
  const top = HDR_H + 11;
  const bottom = contentBottom(doc);
  const daily = bundle.maps.daily;
  const cols = 3; const gap = 4;
  const pw = (CW - gap * (cols - 1)) / cols;
  const rows = Math.max(1, Math.ceil(daily.length / cols));
  const ph = (bottom - top - gap * (rows - 1)) / rows;
  daily.forEach((p, i) => {
    const px = MARGIN + (i % cols) * (pw + gap);
    const py = top + Math.floor(i / cols) * (ph + gap);
    card(doc, px, py, pw, ph);
    setFont(doc, TEXT_DK, 7.5, 'bold'); doc.text(local(p.targetTime).replace(/ \d{2}:\d{2}.*$/, ''), px + 3, py + 5);
    const mapH = ph - 21;
    if (p.beyondHorizon) {
      placeholderBox(doc, px + 2, py + 8, pw - 4, mapH, 'Beyond forecast horizon');
      setFont(doc, TEXT_MD, 6.2, 'italic'); doc.text('No forecast available for this time', px + 3, py + ph - 3);
      return;
    }
    if (p.map?.dataUrl) overlayBoundary(doc, bundle, p.map, fitImage(doc, p.map.dataUrl, px + 2, py + 8, pw - 4, mapH, `daily_${i}`));
    else placeholderBox(doc, px + 2, py + 8, pw - 4, mapH, 'Map unavailable');
    setFont(doc, TEXT_MD, 6); doc.text(`Matched: ${local(p.matchedTime)}`, px + 3, py + ph - 8);
    const ok = hasVesselData(p.step);
    setFont(doc, ok ? hazardText(domainHazard(p.step.warning, p.step.caution)) : TEXT_MD, 6.8, 'bold');
    doc.text(ok ? `${pctText(p.step.suitable)}% Suitable · ${pctText(p.step.caution)}% Caution · ${pctText(p.step.warning)}% Warning` : 'No data', px + 3, py + ph - 3);
  });
  pageFooter(doc, bundle);
}

// ── Page 5 — Forecast trend ─────────────────────────────────────────────────

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
  sectionTitle(doc, `Share of assessed model points at Warning level — ${scopeLabel(bundle.scope.effective).toLowerCase()}`, MARGIN + 4, top + 6, { color: TEXT_DK, size: 8 });
  setFont(doc, TEXT_MD, 6.6);
  doc.text(`Forecast period: ${local(bundle.forecastWindow.start)} to ${local(bundle.forecastWindow.end)}`, MARGIN + 4, top + 10.5);

  const cx = MARGIN + 16; const cw = chartCardW - 24; const cy = top + 16; const ch = bottom - top - 46;
  const t0 = bundle.forecastWindow.start; const t1 = bundle.forecastWindow.end > t0 ? bundle.forecastWindow.end : t0 + 3600e3;
  const allWarn = VESSEL_CLASS_OPTIONS.flatMap((v) => ts.byVessel[v.value]).filter((s) => s.available !== false).map((s) => s.warning);
  const yMax = Math.max(20, Math.ceil(Math.max(0, ...allWarn) / 10) * 10 + 5);
  const X = (t) => cx + ((t - t0) / (t1 - t0)) * cw;
  const Y = (v) => cy + ch - (v / yMax) * ch;

  rect(doc, cx, cy, cw, ch, [252, 253, 254], GRID_CLR, 0.25);
  ts.analysis[sel].elevated.forEach((r) => { setFill(doc, [252, 222, 224]); doc.rect(X(r.start.validTime) - 1, cy, Math.max(2, X(r.end.validTime) - X(r.start.validTime) + 2), ch, 'F'); });
  ts.analysis[sel].unavailable.forEach((g) => { setFill(doc, [225, 225, 225]); doc.rect(X(g.start.validTime) - 1, cy, Math.max(2, X(g.end.validTime) - X(g.start.validTime) + 2), ch, 'F'); });
  setDraw(doc, GRID_CLR); doc.setLineWidth(0.15);
  for (let v = 0; v <= yMax; v += yMax > 40 ? 20 : 10) {
    doc.line(cx, Y(v), cx + cw, Y(v));
    setFont(doc, TEXT_MD, 6); doc.text(`${v}%`, cx - 1.5, Y(v) + 1, { align: 'right' });
  }
  setDraw(doc, hazardColor(2)); doc.setLineWidth(0.25);
  doc.line(cx, Y(ELEVATED_WARNING_PERCENT), cx + cw, Y(ELEVATED_WARNING_PERCENT));
  setFont(doc, hazardText(2), 5.6, 'italic'); doc.text(`${ELEVATED_WARNING_PERCENT}% = elevated`, cx + cw - 1, Y(ELEVATED_WARNING_PERCENT) - 1, { align: 'right' });

  const drawSeries = (code, color, lw) => {
    setDraw(doc, color); doc.setLineWidth(lw);
    let prev = null;
    ts.byVessel[code].forEach((s) => {
      if (s.available === false || !Number.isFinite(s.validTime)) { prev = null; return; }
      if (prev) doc.line(X(prev.validTime), Y(prev.warning), X(s.validTime), Y(s.warning));
      prev = s;
    });
  };
  const OTHER = [[150, 160, 170], [120, 130, 200], [200, 150, 90]];
  VESSEL_CLASS_OPTIONS.filter((v) => v.value !== sel).forEach((v, i) => drawSeries(v.value, OTHER[i % 3], 0.35));
  drawSeries(sel, [0, 120, 170], 0.9);
  drawTimeAxis(doc, bundle, cx, cy + ch + 0.5, cw, t0, t1);

  // legend
  let lx = MARGIN + 6; const ly = cy + ch + 11;
  setDraw(doc, [0, 120, 170]); doc.setLineWidth(0.9); doc.line(lx, ly, lx + 8, ly);
  setFont(doc, TEXT_DK, 6.5, 'bold'); doc.text(`${vesselLabel(sel)} (selected)`, lx + 10, ly + 0.9);
  lx += 52;
  VESSEL_CLASS_OPTIONS.filter((v) => v.value !== sel).forEach((v, i) => {
    setDraw(doc, OTHER[i % 3]); doc.setLineWidth(0.35); doc.line(lx, ly, lx + 6, ly);
    setFont(doc, TEXT_MD, 6.3); doc.text(v.label, lx + 7.5, ly + 0.9); lx += 36;
  });
  rect(doc, MARGIN + 6, ly + 5, 3, 3, [252, 222, 224]); setFont(doc, TEXT_MD, 6.3); doc.text('Elevated period (selected vessel)', MARGIN + 10.5, ly + 7.5);
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
  const cls2 = `Warning aggregation: a time step is described as "Warning" (elevated) in the outlook and trend pages when at least ${ELEVATED_WARNING_PERCENT}% of assessed points are Warning-level; any smaller Warning share is reported explicitly as a percentage and the step is shown as Caution.`;
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
    ['Forecast period', `${local(bundle.forecastWindow.forecastStart)} – ${local(bundle.forecastWindow.forecastEnd)}${Number.isFinite(bundle.forecastWindow.hindcastHoursBeforeRun) && bundle.forecastWindow.hindcastHoursBeforeRun > 0 ? ` (the first ${Math.round(bundle.forecastWindow.hindcastHoursBeforeRun)} h precede the model run)` : ''}`],
    ['Generated', formatLocal(bundle.generatedAt, bundle.timezone, tzLabel(bundle.timezone))],
    ['Methodology version', bundle.methodology.methodologyVersion ?? `Not reported by the service (API schema ${bundle.methodology.apiSchemaVersion ?? 'unknown'})`],
    ['Thresholds', bundle.methodology.thresholdSource],
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
