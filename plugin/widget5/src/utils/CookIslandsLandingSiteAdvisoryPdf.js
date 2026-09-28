// CookIslandsLandingSiteAdvisoryPdf.js -- three-page selected-site landing advisory, rendered
// from a bundle (reports/landingSiteReportBundle.js) in the shared Widget 5 PDF theme
// (pdfTheme.js: A4 landscape, light page, navy header with cyan accent, white cards):
//   1  Site, vessel and thresholds, current modelled suitability and driver, map with the
//      landing point and its 500 m assessment boundary
//   2  Seven-day timeline, best operating windows, Caution and Warning periods, coverage
//   3  All-site heatmap (letter-coded, per-row method) with an explicit omitted-site list
import {
  MARGIN, HDR_H, TEXT_LT, TEXT_MD, TEXT_DK, GRID_CLR, NO_DATA_GREY, PAGE_W,
  hazardColor, hazardText, setFont, setDraw, setFill, rect, drawHeaderBand, drawFooter, card, banner, notice,
  sectionTitle, keyValue, fitText, drawLegendRow, contentBottom, ensureReportFont,
} from './pdfTheme';
import { tzLabel } from './timeZoneFormat';
import { findMatchingStep } from './heatmapSteps';
import { formatLocal, formatUtc, pctText, SOURCE_TEXT } from '../reports/reportRules';
import { METHOD_LABELS, ASSESSMENT_RADIUS_KM, buildLandingSiteReport } from '../reports/landingSiteReportBundle';
import { drawBoundaryOverlay, BOUNDARY_CAPTION } from '../reports/mapOverlay';

const CW = PAGE_W - 2 * MARGIN;
const DRIVER_TEXT = { none: 'None (below Caution thresholds)', wind: 'Wind', waves: 'Waves', wind_and_waves: 'Wind and waves' };
const BASIS_SHORT = { area_500m: '500 m area', nearest_point_area_fallback: 'nearest pt (area)', nearest_point_fallback: 'nearest pt' };
const TYPE_TEXT = { landing_site: 'Landing site', fishing_ground: 'Fishing ground' };

const ctx = (b) => { const label = tzLabel(b.timezone); return { local: (ms) => (Number.isFinite(ms) ? formatLocal(ms, b.timezone, label) : '—') }; };

function header(doc, b, subtitle, page, pages) {
  const { local } = ctx(b);
  drawHeaderBand(doc, { title: 'LANDING SITE ADVISORY', subtitle, rightLine1: `Valid: ${local(b.validTime)}`, rightLine2: `Page ${page} of ${pages}` });
}

function footer(doc, b) {
  const { local } = ctx(b);
  drawFooter(doc, {
    provenance: `Model run ${b.modelRun.time ? formatUtc(b.modelRun.time) : 'not reported'} · Valid ${local(b.validTime)} · Site: ${b.site.name} · Generated ${formatLocal(b.generatedAt, b.timezone, tzLabel(b.timezone))} · Source: ${SOURCE_TEXT}`,
  });
}

function page1(doc, b, pages) {
  header(doc, b, `${b.site.name.toUpperCase()} — ${b.vessel.label.toUpperCase()}`, 1, pages);
  const { local } = ctx(b);
  const cur = b.current;
  const haz = cur.hazardClass;
  banner(doc, {
    y: HDR_H + 4,
    hazard: haz,
    text: haz === null
      ? 'No assessed model value for this site at the valid time.'
      : `Modelled conditions at ${b.site.name}: ${cur.label}${haz > 0 && cur.driver ? ` — driven by ${DRIVER_TEXT[cur.driver].toLowerCase()}` : ''}.`,
    h: 9.5,
  });

  const top = HDR_H + 16;
  const bottom = contentBottom(doc);
  const leftW = 132;
  const facts = [
    ['Site', b.site.name], ['Type', TYPE_TEXT[b.site.type] ?? b.site.type ?? 'Not classified'],
    ['Coordinates', `${b.site.lat.toFixed(4)}, ${b.site.lon.toFixed(4)}`],
    ['Assessment area', `${Math.round((b.site.radiusKm ?? ASSESSMENT_RADIUS_KM) * 1000)} m radius around the site`],
    ['Vessel', b.vessel.label],
    ['Valid time', local(b.validTime)],
    ['Wind', cur.wind !== null ? `${cur.wind.toFixed(1)} kt` : 'Unavailable'],
    ['Waves (Hs)', cur.wave !== null ? `${cur.wave.toFixed(2)} m` : 'Unavailable'],
    ['Model run', b.modelRun.time ? `${formatUtc(b.modelRun.time)}${Number.isFinite(b.modelRun.ageHours) ? ` (${Math.round(b.modelRun.ageHours)} h before generation)` : ''}` : 'Not reported'],
    ['Aggregation', `${METHOD_LABELS[b.aggregation.basis] ?? b.aggregation.basis}${b.aggregation.pointCount !== null ? ` (${b.aggregation.pointCount} points)` : ''}`],
    ['Step coverage', `${b.timeline.coverage.available} of ${b.timeline.coverage.total} forecast steps assessed`],
  ];
  const factsH = 12 + facts.length * 4.9;
  card(doc, MARGIN, top, leftW, factsH);
  sectionTitle(doc, 'SITE AND CONDITIONS', MARGIN + 4, top + 6, { size: 7.5 });
  let ly = top + 12;
  facts.forEach(([k, v]) => { ly += keyValue(doc, MARGIN + 4, ly, k, v, { keyW: 32, maxW: leftW - 40 }); });

  let y = top + factsH + 4;
  const t = b.vessel.thresholds;
  card(doc, MARGIN, y, leftW, 24);
  sectionTitle(doc, 'THRESHOLDS FOR THIS VESSEL (PRESET)', MARGIN + 4, y + 6, { size: 7.5 });
  if (t) {
    setFont(doc, hazardText(1), 7, 'bold'); doc.text(`Caution: Hs >= ${t.cautionWaveHeightM} m or wind >= ${t.cautionWindKt} kt`, MARGIN + 4, y + 12);
    setFont(doc, hazardText(2), 7, 'bold'); doc.text(`Warning: Hs >= ${t.maxWaveHeightM} m or wind >= ${t.maxWindKt} kt`, MARGIN + 4, y + 17.5);
  } else { setFont(doc, TEXT_MD, 7); doc.text('Thresholds unavailable for this vessel class.', MARGIN + 4, y + 12); }
  y += 28;
  if (b.warnings.length) notice(doc, { x: MARGIN, y, w: leftW, text: `Notice: ${b.warnings.join(' ')}`, size: 6.4 });

  // Map card with point + assessment boundary
  const mx = MARGIN + leftW + 6;
  const mw = PAGE_W - MARGIN - mx;
  card(doc, mx, top, mw, bottom - top);
  const capH = 11;
  const legendH = b.map?.dataUrl ? 7 : 0;
  const side = Math.min(mw - 4, bottom - top - capH - legendH - 4);
  const ix = mx + (mw - side) / 2;
  const iy = top + 2;
  if (b.map?.dataUrl) {
    try {
      doc.addImage(b.map.dataUrl, 'PNG', ix, iy, side, side, 'site_map', 'FAST');
      setDraw(doc, GRID_CLR); doc.setLineWidth(0.25); doc.rect(ix, iy, side, side, 'S');
      const bb = b.map.bounds;
      if (bb) {
        drawBoundaryOverlay(doc, b.domainBoundary, bb, { x: ix, y: iy, w: side, h: side });
        const px = ix + ((b.site.lon - bb.west) / (bb.east - bb.west)) * side;
        const py = iy + ((bb.north - b.site.lat) / (bb.north - bb.south)) * side;
        const rDeg = (b.site.radiusKm ?? ASSESSMENT_RADIUS_KM) / 111.32;
        const rMm = (rDeg / (bb.north - bb.south)) * side;
        setDraw(doc, [0, 0, 0]); doc.setLineWidth(0.5); doc.circle(px, py, rMm, 'S');
        setFill(doc, [255, 255, 255]); doc.circle(px, py, 0.9, 'FD');
      }
      drawLegendRow(doc, ix, iy + side + 6, [[hazardColor(0), 'Suitable'], [hazardColor(1), 'Caution'], [hazardColor(2), 'Warning']]);
    } catch { rect(doc, ix, iy, side, side, [240, 240, 240], GRID_CLR, 0.25); }
  } else {
    rect(doc, ix, iy, side, side, [240, 240, 240], GRID_CLR, 0.25);
    setFont(doc, TEXT_MD, 7.5, 'italic'); doc.text('Map unavailable', ix + side / 2, iy + side / 2, { align: 'center' });
  }
  setFont(doc, TEXT_MD, 6, 'italic');
  doc.text(doc.splitTextToSize(`Modelled suitability for ${b.vessel.label} at the valid time. Black circle: ${Math.round((b.site.radiusKm ?? ASSESSMENT_RADIUS_KM) * 1000)} m assessment boundary; white dot: site.${b.domainBoundary?.length ? ` ${BOUNDARY_CAPTION}` : ''}`, mw - 6), mx + 3, bottom - capH + 4);
  footer(doc, b);
}

function drawRibbon(doc, b, x, y, w, h) {
  const s = b.timeline.series;
  const t0 = b.forecastWindow.start; const t1 = b.forecastWindow.end;
  const stepW = Math.max(0.4, ((b.timeline.stepHours * 3600e3) / Math.max(1, t1 - t0)) * w);
  s.forEach((st) => {
    const px = x + ((st.validTime - t0) / Math.max(1, t1 - t0)) * (w - stepW);
    setFill(doc, st.hazardClass === null ? NO_DATA_GREY : hazardColor(st.hazardClass));
    doc.rect(px, y, stepW + 0.12, h, 'F');
  });
}

function page2(doc, b, pages) {
  doc.addPage();
  header(doc, b, `${b.site.name.toUpperCase()} — SEVEN-DAY TIMELINE`, 2, pages);
  const { local } = ctx(b);
  const top = HDR_H + 4;
  const bottom = contentBottom(doc);

  // timeline card
  const tlH = 50;
  card(doc, MARGIN, top, CW, tlH);
  sectionTitle(doc, `Modelled hazard at ${b.site.name} for ${b.vessel.label}`, MARGIN + 4, top + 6, { color: TEXT_DK, size: 8.5 });
  setFont(doc, TEXT_MD, 6.8);
  doc.text(`${local(b.forecastWindow.start)} to ${local(b.forecastWindow.end)} · ${b.timeline.coverage.available} of ${b.timeline.coverage.total} steps assessed`, MARGIN + 4, top + 10.5);
  const rx = MARGIN + 4; const rw = CW - 8;
  drawRibbon(doc, b, rx, top + 14, rw, 11);
  setFont(doc, TEXT_MD, 5.8); setDraw(doc, GRID_CLR); doc.setLineWidth(0.15);
  const t0 = b.forecastWindow.start; const t1 = b.forecastWindow.end;
  for (let d = 1; d <= 7; d += 1) {
    const t = t0 + d * 24 * 3600e3; if (t > t1) break;
    const px = rx + ((t - t0) / (t1 - t0)) * rw;
    doc.line(px, top + 25, px, top + 27.5); doc.text(local(t).split(' ').slice(0, 3).join(' '), px, top + 31, { align: 'center' });
  }
  drawLegendRow(doc, MARGIN + 4, top + 42);

  // three window cards
  const y = top + tlH + 5;
  const gap = 5;
  const cw3 = (CW - gap * 2) / 3;
  const wh = 62;
  const list = (i, title, runs, empty, color) => {
    const x = MARGIN + i * (cw3 + gap);
    card(doc, x, y, cw3, wh);
    sectionTitle(doc, title, x + 4, y + 6, { color, size: 8 });
    if (!runs.length) { setFont(doc, TEXT_MD, 7); doc.text(doc.splitTextToSize(empty, cw3 - 8), x + 4, y + 13); return; }
    runs.forEach((r, k) => {
      setFont(doc, TEXT_DK, 7);
      doc.text(fitText(doc, `${local(r.from)}${r.to !== r.from ? ` to ${local(r.to)}` : ''}`, cw3 - 8), x + 4, y + 13 + k * 9);
      setFont(doc, TEXT_MD, 6.4); doc.text(`${Math.round(r.steps * b.timeline.stepHours)} h`, x + 4, y + 17 + k * 9);
    });
  };
  list(0, 'BEST OPERATING WINDOWS (MODELLED SUITABLE)', b.windows.suitable, 'No period without Caution or Warning conditions in this forecast.', hazardText(0));
  list(1, 'CAUTION PERIODS', b.windows.caution, 'No Caution-level periods modelled.', hazardText(1));
  list(2, 'WARNING PERIODS', b.windows.warning, 'No Warning-level periods modelled.', hazardText(2));

  // method + limitations
  const y2 = y + wh + 5;
  const h2 = bottom - y2;
  const half = (CW - gap) / 2;
  card(doc, MARGIN, y2, half, h2);
  sectionTitle(doc, 'METHOD AND COVERAGE', MARGIN + 4, y2 + 6, { size: 8 });
  let ky = y2 + 12;
  ky += keyValue(doc, MARGIN + 4, ky, 'Aggregation', `${METHOD_LABELS[b.aggregation.basis] ?? b.aggregation.basis}${b.aggregation.pointCount !== null ? ` — ${b.aggregation.pointCount} model points` : ''}`, { keyW: 30, maxW: half - 38 });
  ky += keyValue(doc, MARGIN + 4, ky, 'Coverage', `${b.timeline.coverage.available} of ${b.timeline.coverage.total} steps (${pctText(b.timeline.coverage.ratio * 100)}%) had a model value; the rest are Unavailable.`, { keyW: 30, maxW: half - 38 });
  keyValue(doc, MARGIN + 4, ky, 'Tide / sea level', 'Not included: no authoritative Cook Islands tide or sea-level dataset is connected to this report.', { keyW: 30, maxW: half - 38 });
  const rx2 = MARGIN + half + gap;
  card(doc, rx2, y2, half, h2);
  sectionTitle(doc, 'LIMITATIONS', rx2 + 4, y2 + 6, { size: 8 });
  let ly = y2 + 12;
  b.limitations.forEach((t) => { setFont(doc, TEXT_MD, 6.6); const lines = doc.splitTextToSize(`• ${t}`, half - 8); doc.text(lines, rx2 + 4, ly); ly += lines.length * 3.4 + 1.2; });
  footer(doc, b);
}

function page3(doc, b, pages) {
  doc.addPage();
  header(doc, b, 'ALL SITES — SEVEN-DAY COMPARISON', 3, pages);
  const { local } = ctx(b);
  const top = HDR_H + 4;
  const bottom = contentBottom(doc);
  card(doc, MARGIN, top, CW, bottom - top);
  const labelW = 62;
  const steps = b.heatmap.steps;
  const x0 = MARGIN + 4;
  const availW = CW - 8 - labelW;
  const colW = availW / Math.max(1, steps.length);
  const rowH = 7;
  let y = top + 6;
  setFont(doc, TEXT_MD, 6.8);
  doc.text(doc.splitTextToSize(`Modelled conditions for ${b.vessel.label} at every named site with data. ${b.heatmap.mixedMethods ? 'Sites use different aggregation methods (see each row’s tag). ' : ''}The selected site is outlined.`, CW - 8), x0, y);
  y += 9;
  steps.forEach((hs, i) => {
    const cx = x0 + labelW + i * colW + colW / 2;
    setFont(doc, TEXT_MD, 5.2, 'bold');
    const parts = local(new Date(hs.time).getTime()).split(' ');
    doc.text(`${parts[1]} ${parts[2]}`, cx, y, { align: 'center' });
    doc.text(parts[3] ?? '', cx, y + 3.2, { align: 'center' });
  });
  y += 9;
  b.heatmap.rows.forEach((row, ri) => {
    if (ri % 2 === 1) rect(doc, x0, y - rowH * 0.72, labelW + availW, rowH, [246, 248, 250]);
    setFont(doc, TEXT_DK, 6.8, 'bold');
    doc.text(fitText(doc, row.name ?? 'Unknown site', labelW - 30), x0 + 1, y);
    setFont(doc, TEXT_MD, 5);
    doc.text(`${BASIS_SHORT[row.basis] ?? row.basis}${row.pointCount !== null ? ` · ${row.pointCount} pts` : ''}`, x0 + labelW - 1, y, { align: 'right' });
    steps.forEach((hs, i) => {
      const m = findMatchingStep(row.steps, hs);
      const hc = m && Number.isFinite(m.hazard_class) ? m.hazard_class : null;
      const cellX = x0 + labelW + i * colW + 0.4;
      rect(doc, cellX, y - rowH * 0.62, colW - 0.8, rowH * 0.62, hc === null ? NO_DATA_GREY : hazardColor(hc));
      setFont(doc, TEXT_LT, 5, 'bold');
      doc.text(hc === null ? '-' : ['S', 'C', 'W'][Math.min(hc, 2)], cellX + (colW - 0.8) / 2, y - rowH * 0.2, { align: 'center' });
    });
    if (row.isSelected) { setDraw(doc, [0, 0, 0]); doc.setLineWidth(0.4); doc.rect(x0, y - rowH * 0.72, labelW + availW, rowH, 'S'); }
    y += rowH;
  });
  y += 4;
  drawLegendRow(doc, x0, y, [[hazardColor(0), 'Suitable (S)'], [hazardColor(1), 'Caution (C)'], [hazardColor(2), 'Warning (W)'], [NO_DATA_GREY, 'Unavailable (-)']]);
  y += 7;
  setFont(doc, TEXT_MD, 6.6, 'italic');
  const omitted = b.heatmap.omittedSites;
  doc.text(doc.splitTextToSize(omitted.length ? `Not shown — no model data returned for: ${omitted.join(', ')}. These sites are Unavailable, not confirmed suitable.` : 'All named sites returned model data.', CW - 8), x0, y);
  footer(doc, b);
}

export async function renderCookIslandsLandingSiteAdvisoryPdfDoc(bundle) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  await ensureReportFont(doc);
  doc.setProperties({ title: `Landing Site Advisory — ${bundle.site.name}`, subject: 'Modelled marine suitability at a landing site', creator: 'Cook Islands Ocean Dashboard', author: 'Pacific Community (SPC)' });
  doc.setLanguage('en');
  page1(doc, bundle, 3); page2(doc, bundle, 3); page3(doc, bundle, 3);
  const stamp = bundle.generatedAt.toISOString().slice(0, 16).replace(/[:T]/g, '');
  const slug = String(bundle.site.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return { doc, filename: `cook_islands_landing_site_${slug}_${bundle.vessel.code}_${stamp}.pdf` };
}

export async function exportCookIslandsLandingSiteAdvisoryPdf(params, opts) {
  const bundle = await buildLandingSiteReport(params, opts);
  const { doc, filename } = await renderCookIslandsLandingSiteAdvisoryPdfDoc(bundle);
  doc.save(filename);
  return filename;
}
