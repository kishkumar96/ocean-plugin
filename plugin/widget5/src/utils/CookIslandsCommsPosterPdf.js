// CookIslandsCommsPosterPdf.js -- A3 portrait "Same Ocean, Different Vessels" poster,
// rendered from the same validated domain bundle as the advisory (reports/
// domainReportBundle.js, built with an outlook so the trend is available).
//
// This is a COMMUNICATIONS product for outreach (notice boards, community briefings).
// It is deliberately separate from the operational advisory and says so on its face:
// plain-language colour key, one map, one card per vessel class, a shared Warning
// trend, exact valid time and model run, and a strong model-guidance disclaimer.
import {
  HEADER_BG, ACCENT, PAGE_BG, TEXT_LT, TEXT_MD, TEXT_DK, GRID_CLR, NO_DATA_GREY,
  hazardColor, hazardText, hazardLabel, setFill, setDraw, setFont, rect, loadVesselSvgIcon, drawHazardShareBar,
  ensureReportFont,
} from './advisoryPdfPrimitives';
import { tzLabel } from './timeZoneFormat';
import { VESSEL_CLASS_OPTIONS } from '../lib/CookIslandsSuitabilityOverlay';
import { buildDomainReportBundle } from '../reports/domainReportBundle';
import { drawBoundaryOverlay, BOUNDARY_CAPTION } from '../reports/mapOverlay';
import {
  stepLevel, pctText, scopeLabel, formatLocal, formatUtc, zonedWallTimeToUtc, ELEVATED_WARNING_PERCENT, SOURCE_TEXT,
} from '../reports/reportRules';

const W = 297; const H = 420; const MX = 14;

const label = (code) => VESSEL_CLASS_OPTIONS.find((v) => v.value === code)?.label ?? code;
const hasData = (s) => Boolean(s) && s.available !== false && Number.isFinite(s.warning) && Number.isFinite(s.caution);

function fitImage(doc, dataUrl, x, y, w, h) {
  try {
    const p = doc.getImageProperties(dataUrl);
    const a = p.width / p.height;
    let iw = w; let ih = h; let ix = x; let iy = y;
    if (Number.isFinite(a) && a > 0) { if (a > w / h) { ih = w / a; iy += (h - ih) / 2; } else { iw = h * a; ix += (w - iw) / 2; } }
    doc.addImage(dataUrl, 'PNG', ix, iy, iw, ih, undefined, 'FAST');
    setDraw(doc, GRID_CLR); doc.setLineWidth(0.4); doc.rect(ix, iy, iw, ih, 'S');
    return { x: ix, y: iy, w: iw, h: ih };
  } catch {
    rect(doc, x, y, w, h, [240, 240, 240], GRID_CLR, 0.3);
    setFont(doc, TEXT_MD, 10, 'italic'); doc.text('Map could not be drawn', x + w / 2, y + h / 2, { align: 'center' });
    return null;
  }
}

// One plain sentence per vessel class -- always "modelled", never an instruction.
export function posterVesselSentence(step) {
  if (!hasData(step)) return 'No model data for this vessel class in this area and time.';
  const warn = Number(step.warning) || 0; const caution = Number(step.caution) || 0;
  if (warn >= ELEVATED_WARNING_PERCENT) return `Modelled conditions exceed the Warning threshold at ${pctText(warn)}% of points.`;
  if (warn > 0 || caution > 0) return `Modelled conditions reach Caution at ${pctText(caution)}% and Warning at ${pctText(warn)}% of points.`;
  return 'No modelled threshold exceedances at the assessed points.';
}

function drawTrend(doc, bundle, x, y, w, h) {
  const ts = bundle.timeSeries;
  const t0 = bundle.forecastWindow.start; const t1 = bundle.forecastWindow.end > t0 ? bundle.forecastWindow.end : t0 + 3600e3;
  const all = VESSEL_CLASS_OPTIONS.flatMap((v) => ts.byVessel[v.value]).filter((s) => s.available !== false).map((s) => s.warning);
  const yMax = Math.max(20, Math.ceil(Math.max(0, ...all) / 10) * 10 + 5);
  const X = (t) => x + ((t - t0) / (t1 - t0)) * w;
  const Y = (v) => y + h - (v / yMax) * h;
  rect(doc, x, y, w, h, [252, 253, 254], GRID_CLR, 0.3);
  setDraw(doc, GRID_CLR); doc.setLineWidth(0.2);
  for (let v = 0; v <= yMax; v += yMax > 40 ? 20 : 10) { doc.line(x, Y(v), x + w, Y(v)); setFont(doc, TEXT_MD, 8); doc.text(`${v}%`, x - 2, Y(v) + 1.2, { align: 'right' }); }
  setDraw(doc, hazardColor(2)); doc.setLineWidth(0.35);
  doc.line(x, Y(ELEVATED_WARNING_PERCENT), x + w, Y(ELEVATED_WARNING_PERCENT));
  setFont(doc, hazardText(2), 7.5, 'italic'); doc.text(`${ELEVATED_WARNING_PERCENT}% = elevated`, x + w - 1.5, Y(ELEVATED_WARNING_PERCENT) - 1.5, { align: 'right' });
  const COLORS = { traditional_craft: [200, 150, 90], very_small_motorised_craft: [120, 130, 200], small_craft: [0, 120, 170], larger_vessels: [42, 157, 143] };
  VESSEL_CLASS_OPTIONS.forEach((v) => {
    const sel = v.value === bundle.selectedVessel;
    setDraw(doc, COLORS[v.value]); doc.setLineWidth(sel ? 1.1 : 0.6);
    let prev = null;
    ts.byVessel[v.value].forEach((s) => {
      if (s.available === false || !Number.isFinite(s.validTime)) { prev = null; return; }
      if (prev) doc.line(X(prev.validTime), Y(prev.warning), X(s.validTime), Y(s.warning));
      prev = s;
    });
  });
  // day ticks (local midnights)
  const tz = bundle.timezone; const lab = tzLabel(tz);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(t0)).reduce((a, q) => ({ ...a, [q.type]: q.value }), {});
  let cur = Date.UTC(+p.year, +p.month - 1, +p.day);
  setFont(doc, TEXT_MD, 8);
  for (let i = 0; i < 20; i += 1) {
    const d = new Date(cur);
    const mid = zonedWallTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, tz).getTime();
    cur += 86400e3;
    if (mid < t0) continue;
    if (mid > t1) break;
    doc.line(X(mid), y + h, X(mid), y + h + 2.5);
    doc.text(formatLocal(mid, tz, lab).split(' ').slice(0, 3).join(' '), X(mid) + 1, y + h + 6);
  }
  // legend
  let lx = x; const ly = y + h + 13;
  VESSEL_CLASS_OPTIONS.forEach((v) => {
    setDraw(doc, COLORS[v.value]); doc.setLineWidth(1); doc.line(lx, ly, lx + 9, ly);
    setFont(doc, TEXT_DK, 8.5, v.value === bundle.selectedVessel ? 'bold' : 'normal'); doc.text(v.label, lx + 11, ly + 1.2);
    lx += 64;
  });
}

export async function renderCookIslandsCommsPosterPdfDoc(bundle) {
  if (!bundle.timeSeries) throw new Error('The poster needs an outlook (72 hours or seven days).');
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a3' });
  await ensureReportFont(doc);
  doc.setProperties({ title: 'Same Ocean, Different Vessels — Cook Islands (communications poster)', subject: 'Modelled marine conditions for different vessel classes', creator: 'Cook Islands Ocean Dashboard', author: 'Pacific Community (SPC)' });
  doc.setLanguage('en');
  const tz = bundle.timezone; const lab = tzLabel(tz);
  const local = (ms) => formatLocal(ms, tz, lab);

  // Page background + header (same palette as every Widget 5 PDF; see pdfTheme.js)
  rect(doc, 0, 0, W, H, PAGE_BG);
  rect(doc, 0, 0, W, 40, HEADER_BG);
  rect(doc, 0, 39.2, W, 0.8, ACCENT);
  setFont(doc, TEXT_LT, 30, 'bold'); doc.text('SAME OCEAN, DIFFERENT VESSELS', MX, 20);
  setFont(doc, ACCENT, 13); doc.text('COOK ISLANDS · MODELLED MARINE CONDITIONS BY VESSEL CLASS', MX, 31);
  setFont(doc, TEXT_LT, 12, 'bold'); doc.text(`Valid: ${local(bundle.validTime)}`, W - MX, 18, { align: 'right' });
  setFont(doc, [200, 210, 220], 9.5); doc.text(`${formatUtc(bundle.validTime)}`, W - MX, 24.5, { align: 'right' });
  doc.text(`Model run ${bundle.modelRun.time ? formatUtc(bundle.modelRun.time) : 'not reported'}`, W - MX, 31, { align: 'right' });
  doc.text('Page 1 of 1', W - MX, 37, { align: 'right' });

  // Communications-product label
  rect(doc, 0, 40, W, 9, [255, 244, 214]);
  setFont(doc, hazardText(1), 9.5, 'bold');
  doc.text('COMMUNICATIONS PRODUCT — a plain-language summary of modelled conditions for public information. It is not an operational advisory.', W / 2, 46, { align: 'center' });

  // Map (left) + vessel cards (right)
  const top = 56; const mapW = 168; const mapH = 210;
  if (bundle.maps.selected?.dataUrl) {
    const rectUsed = fitImage(doc, bundle.maps.selected.dataUrl, MX, top, mapW, mapH);
    if (!bundle.maps.selected.fallback) drawBoundaryOverlay(doc, bundle.domainBoundary, bundle.maps.bounds, rectUsed);
  }
  else { rect(doc, MX, top, mapW, mapH, [240, 240, 240], GRID_CLR, 0.3); setFont(doc, TEXT_MD, 11, 'italic'); doc.text('Map unavailable', MX + mapW / 2, top + mapH / 2, { align: 'center' }); }
  setFont(doc, TEXT_MD, 8, 'italic');
  doc.text(`${label(bundle.selectedVessel)} · ${scopeLabel(bundle.scope.effective)} · at the valid time above${bundle.domainBoundary?.length ? ` · ${BOUNDARY_CAPTION}` : ''}`, MX, top + mapH + 5);

  const cx = MX + mapW + 6; const cw = W - MX - cx; const gap = 5; const ch = (mapH - gap * 3) / 4;
  for (let i = 0; i < VESSEL_CLASS_OPTIONS.length; i += 1) {
    const vc = VESSEL_CLASS_OPTIONS[i]; const step = bundle.vessels[vc.value];
    const ok = hasData(step); const haz = ok ? stepLevel(step.warning, step.caution) : 0;
    const cy = top + i * (ch + gap);
    rect(doc, cx, cy, cw, ch, [255, 255, 255], GRID_CLR, 0.3);
    setFill(doc, ok ? hazardColor(haz) : NO_DATA_GREY); doc.rect(cx, cy, cw, 11, 'F');
    setFont(doc, TEXT_LT, 11, 'bold'); doc.text(`${vc.label.toUpperCase()} — ${ok ? hazardLabel(haz).toUpperCase() : 'NO DATA'}`, cx + 3, cy + 7.5);
    const icon = await loadVesselSvgIcon(vc.value, ok ? haz : 0);
    if (icon) { try { doc.addImage(icon, 'PNG', cx + cw - 40, cy + 13, 36, 12, undefined, 'FAST'); } catch { /* text only */ } }
    setFont(doc, TEXT_DK, 9.5, 'bold'); doc.text(vc.examples ?? '', cx + 4, cy + 20);
    // Leads with the plain-language verdict (what a poster reader actually needs); the
    // exact Suitable/Caution/Warning split is supporting detail, kept smaller below it.
    setFont(doc, TEXT_DK, 8.5, 'bold');
    doc.text(doc.splitTextToSize(posterVesselSentence(step), cw - 8), cx + 4, cy + 27);
    if (ok) {
      const bx = cx + 4; const bw = cw - 8; const by = cy + ch - 11;
      drawHazardShareBar(doc, bx, by, bw, 4, [[0, step.suitable], [1, step.caution], [2, step.warning]]);
      setFont(doc, TEXT_MD, 6);
      doc.text(`${pctText(step.suitable)}% Suitable · ${pctText(step.caution)}% Caution · ${pctText(step.warning)}% Warning`, bx, by + 7.5);
    }
  }

  // Trend
  const ty = top + mapH + 16;
  setFont(doc, TEXT_DK, 13, 'bold'); doc.text('How conditions change over the coming days', MX, ty);
  setFont(doc, TEXT_MD, 9); doc.text(`Share of assessed model points at Warning level, ${scopeLabel(bundle.scope.effective).toLowerCase()} · ${local(bundle.forecastWindow.start)} to ${local(bundle.forecastWindow.end)}`, MX, ty + 5.5);
  drawTrend(doc, bundle, MX + 8, ty + 10, W - 2 * MX - 8, 50);

  // Colour key
  const ky = ty + 84;
  setFont(doc, HEADER_BG, 11, 'bold'); doc.text('What the colours mean', MX, ky);
  [[0, 'Suitable', 'Modelled wind and waves are below the Caution thresholds for this vessel class.'],
    [1, 'Caution', 'Modelled wind or waves reach the Caution threshold for this vessel class.'],
    [2, 'Warning', 'Modelled wind or waves reach the Warning threshold for this vessel class.']].forEach(([hz, name, text], i) => {
    const yy = ky + 6 + i * 8;
    rect(doc, MX, yy - 4, 8, 6, hazardColor(hz)); setFont(doc, TEXT_DK, 9.5, 'bold'); doc.text(name, MX + 11, yy);
    setFont(doc, TEXT_MD, 9); doc.text(text, MX + 34, yy);
  });
  rect(doc, MX + 210, ky + 2, 8, 6, NO_DATA_GREY); setFont(doc, TEXT_DK, 9.5, 'bold'); doc.text('Unavailable', MX + 221, ky + 6.2);
  setFont(doc, TEXT_MD, 8.5); doc.text(doc.splitTextToSize('No model value: never treated as Suitable.', 50), MX + 210, ky + 12);

  // Notices + disclaimer + provenance
  let ny = H - 34;
  if (bundle.warnings.length) {
    const lines = doc.splitTextToSize(`Notice: ${bundle.warnings.join(' ')}`, W - 2 * MX - 6);
    rect(doc, MX, ny - 4, W - 2 * MX, lines.length * 4 + 4, [255, 244, 214], [230, 180, 60], 0.3);
    setFont(doc, hazardText(1), 8, 'bold'); doc.text(lines, MX + 3, ny); ny += lines.length * 4 + 5;
  }
  setFont(doc, TEXT_DK, 9.5, 'bold');
  doc.text(doc.splitTextToSize('Modelled guidance only. This poster summarises computer-model output for wind and waves. It is not a forecast of what you will experience at sea and it is not navigation advice. Conditions can differ locally and change quickly. Always check official marine weather warnings and use local knowledge and seamanship.', W - 2 * MX), MX, H - 23);
  setFont(doc, TEXT_MD, 7.2);
  doc.text(doc.splitTextToSize(`Model run ${bundle.modelRun.time ? formatUtc(bundle.modelRun.time) : 'not reported'} · Valid ${local(bundle.validTime)} · Scope: ${scopeLabel(bundle.scope.effective)} · Generated ${formatLocal(bundle.generatedAt, tz, lab)} · Source: ${SOURCE_TEXT}`, W - 2 * MX), MX, H - 10);

  const stamp = bundle.generatedAt.toISOString().slice(0, 16).replace(/[:T]/g, '');
  return { doc, filename: `cook_islands_comms_poster_${bundle.selectedVessel}_${stamp}.pdf` };
}

export async function exportCookIslandsCommsPosterPdf(params) {
  const bundle = await buildDomainReportBundle({ ...params, horizonHours: params.horizonHours > 0 ? params.horizonHours : 72 });
  const { doc, filename } = await renderCookIslandsCommsPosterPdfDoc(bundle);
  doc.save(filename);
  return filename;
}
