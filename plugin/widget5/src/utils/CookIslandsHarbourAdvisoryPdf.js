// CookIslandsHarbourAdvisoryPdf.js -- Harbour Conditions Advisory, A4 landscape, 2 pages.
//
//   Page 1  current conditions + next-24h worst at every named harbour, anchorage
//           and passage, with the unloading verdict where (and only where) an
//           approved or clearly-labelled draft limits set backs one.
//   Page 2  next-72h wave-height trend per harbour, one shared vertical scale.
//
// Rendered from an already-decided bundle (reports/harbourAdvisoryBundle.js); this
// file only draws. jsPDF is loaded lazily (same reasoning as CookIslandsRouteAdvisoryPdf.js)
// so this module stays importable in plain jsdom tests.
import {
  MARGIN, HDR_H, CONTENT_TOP, TEXT_DK, TEXT_MD, TEXT_LT, GRID_CLR, HEADER_BG, NO_DATA_GREY,
  setFill, setDraw, setFont, rect, fitText, hazardColor, hazardLight, hazardText,
  formatEta, drawHeaderBand, drawFooter, notice, sectionTitle, card, contentBottom, contentWidth, ensureReportFont,
} from './pdfTheme';
import { tzLabel } from './timeZoneFormat';
import { INCOMPLETE } from '../config/cookIslandsHarbourLimits';
import { verdictText } from '../reports/harbourAdvisoryBundle';

export const HARBOUR_DISCLAIMER = 'SWAN wave model guidance for planning barge unloading. Not navigation advice; confirm conditions with the harbour authority and official marine warnings, and use local knowledge.';

const fmt = (v, digits, unit) => (Number.isFinite(v) ? `${v.toFixed(digits)} ${unit}` : '—');

// Column layout for page 1; widths sum to the content width (281 mm on A4 landscape). The island
// sits under the harbour name (two lines) to leave room for the verdict columns, which carry WHICH
// variable drove the verdict, its peak against the limit, and when.
const COLUMNS = [
  { key: 'name', label: 'Harbour / anchorage / passage', w: 50, align: 'left' },
  { key: 'hs', label: 'Sig. wave height (Hs) now', w: 17, align: 'right' },
  { key: 'tp', label: 'Peak period', w: 14, align: 'right' },
  { key: 'dir', label: 'Waves from', w: 20, align: 'right' },
  { key: 'wind', label: 'Wind now', w: 15, align: 'right' },
  { key: 'max24', label: 'Max Hs next 24 h', w: 17, align: 'right' },
  { key: 'maxWind24', label: 'Max wind next 24 h', w: 17, align: 'right' },
  { key: 'node', label: 'Wave node', w: 14, align: 'right' },
  { key: 'v1', label: 'Verdict now', w: 54, align: 'left' },
  { key: 'v24', label: 'Worst next 24 h', w: 63, align: 'left' },
];

// Which limits the verdict columns are judged against, in the header itself, so a verdict cell that
// is cropped out of the page still carries its status.
const BASIS_HEADER_TAG = { provisional: ' (PROVISIONAL)', draft: ' (DRAFT)' };

function verdictStyle(v) {
  if (v === INCOMPLETE) return { fill: [235, 236, 238], text: [80, 70, 20] };
  if (v === 0 || v === 1 || v === 2) return { fill: hazardLight(v), text: hazardText(v) };
  return { fill: null, text: TEXT_MD };
}

function drawTablePage(doc, bundle, tz) {
  const cw = contentWidth(doc);
  let y = HDR_H + 5;

  // Authority for the verdicts (or the statement that there are none).
  const flagged = ['draft', 'provisional', 'unavailable'].includes(bundle.basis);
  if (flagged) {
    y += notice(doc, { x: MARGIN, y, w: cw, text: bundle.basisStatement, size: 7.4 }) + 2.5;
  } else {
    setFont(doc, TEXT_DK, 7.6, 'bold');
    const lines = doc.splitTextToSize(bundle.basisStatement, cw);
    doc.text(lines, MARGIN, y + 2.5);
    y += lines.length * 3.6 + 3;
  }
  bundle.warnings.forEach((w) => { y += notice(doc, { x: MARGIN, y, w: cw, text: w, size: 7 }) + 2; });

  // Footnotes, composed first so the table can leave exactly the room they need.
  const partial = bundle.harbours.some((h) => h.available && h.missing24Hours > 0);
  const farNode = bundle.harbours.some((h) => h.available && h.nodeFar);
  const first = bundle.harbours.find((h) => h.available && h.validTime);
  const validText = bundle.validTimeCommon
    ? `"Now" is the forecast hour valid ${formatEta(bundle.validTimeCommon, tz)} ${tzLabel(tz)}.`
    : (first
      ? `"Now" is each location's nearest forecast hour (between ${formatEta(bundle.validTimeMin, tz)} and ${formatEta(bundle.validTimeMax, tz)} ${tzLabel(tz)}).`
      : '"Now" is unavailable: no location has a forecast hour near the current time.');
  const notes = [
    validText,
    '24 h figures cover the 24 hours from "now". Hs = significant wave height. Peak period and direction are the wave model\'s; wave height and wind are from the vessel-suitability forecast. Wave node = distance from the location to the wave-model point actually sampled.',
    partial ? '* Less than a full 24 h of forecast is available for this location.' : null,
    farNode ? `† Wave-model point more than ${bundle.nodeFarKm} km from the location; reefs, lagoons and passages are not resolved.` : null,
  ].filter(Boolean).join(' ');
  setFont(doc, TEXT_MD, 6.2, 'italic');
  const noteLines = doc.splitTextToSize(notes, cw);
  const notesH = noteLines.length * 2.7 + 3;

  const headerH = 11;
  const bottom = contentBottom(doc) - notesH;
  const rowH = Math.min(8.2, Math.max(6.2, (bottom - y - headerH) / Math.max(1, bundle.harbours.length)));
  const fontSize = rowH >= 7.4 ? 7.2 : 6.5;
  const subSize = rowH >= 7.4 ? 5.6 : 5.2;
  const tag = BASIS_HEADER_TAG[bundle.basis] ?? '';

  // Header row
  rect(doc, MARGIN, y, cw, headerH, HEADER_BG);
  setFont(doc, TEXT_LT, 6.1, 'bold');
  let x = MARGIN;
  COLUMNS.forEach((c) => {
    const label = (c.key === 'v1' || c.key === 'v24') ? `${c.label}${tag}` : c.label;
    const lines = doc.splitTextToSize(label, c.w - 3).slice(0, 3);
    const tx = c.align === 'right' ? x + c.w - 1.5 : x + 1.5;
    doc.text(lines, tx, y + (lines.length === 1 ? 6.2 : lines.length === 2 ? 4.7 : 3.4), { align: c.align === 'right' ? 'right' : 'left', lineHeightFactor: 1.05 });
    x += c.w;
  });
  y += headerH;

  bundle.harbours.forEach((h, i) => {
    if (i % 2 === 1) rect(doc, MARGIN, y, cw, rowH, [243, 246, 249]);
    setDraw(doc, GRID_CLR); doc.setLineWidth(0.1); doc.line(MARGIN, y + rowH, MARGIN + cw, y + rowH);
    const line1 = y + rowH / 2 - 0.2; // baseline of the first of two lines
    const line2 = y + rowH / 2 + 2.4;
    const mid = y + rowH / 2 + 1.1;
    let cx = MARGIN;
    const cell = (col, text, opts = {}) => {
      setFont(doc, opts.color ?? TEXT_DK, opts.size ?? fontSize, opts.style ?? 'normal');
      const t = fitText(doc, text, col.w - 3);
      const yy = opts.y ?? mid;
      if (col.align === 'right') doc.text(t, cx + col.w - 1.5, yy, { align: 'right' });
      else doc.text(t, cx + 1.5, yy);
    };
    COLUMNS.forEach((col) => {
      if (col.key === 'name') {
        cell(col, `${h.name}${h.available && h.nodeFar ? ' †' : ''}`, { style: 'bold', y: line1 });
        cell(col, h.island, { color: TEXT_MD, size: subSize, y: line2 });
      } else if (!h.available) {
        if (col.key === 'hs') {
          setFont(doc, TEXT_MD, fontSize, 'italic');
          const reason = doc.splitTextToSize(h.unavailableReason || 'No model data for this location', 17 + 14 + 20 + 15 + 17 + 17 + 14 - 3);
          doc.text(reason.slice(0, 2), cx + 1.5, reason.length > 1 ? line1 : mid);
        }
      } else if (col.key === 'hs') cell(col, fmt(h.hsM, 1, 'm'));
      else if (col.key === 'tp') {
        if (Number.isFinite(h.tpS)) cell(col, fmt(h.tpS, 1, 's'));
        else cell(col, bundle.periodWithheld ? 'withheld' : '—', { color: TEXT_MD, style: 'italic' });
      } else if (col.key === 'dir') {
        if (Number.isFinite(h.dirDeg)) cell(col, `${h.dirPoint} ${Math.round(h.dirDeg)}°`);
        else cell(col, bundle.periodWithheld ? 'withheld' : '—', { color: TEXT_MD, style: 'italic' });
      } else if (col.key === 'wind') cell(col, fmt(h.windKt, 0, 'kt'));
      else if (col.key === 'max24') cell(col, `${fmt(h.max24HsM, 1, 'm')}${h.missing24Hours > 0 ? ' *' : ''}`);
      else if (col.key === 'maxWind24') cell(col, `${fmt(h.max24WindKt, 0, 'kt')}${h.missing24Hours > 0 ? ' *' : ''}`);
      else if (col.key === 'node') {
        cell(col, Number.isFinite(h.nodeDistanceKm) ? `${h.nodeDistanceKm.toFixed(1)} km${h.nodeFar ? ' †' : ''}` : '—', { color: h.nodeFar ? hazardText(1) : TEXT_DK, style: h.nodeFar ? 'bold' : 'normal' });
      } else if (col.key === 'v1' || col.key === 'v24') {
        const v = col.key === 'v1' ? h.verdictNow : h.verdict24h;
        const detail = col.key === 'v1' ? h.detailNowShort : h.detail24hShort;
        const st = verdictStyle(v);
        if (st.fill) rect(doc, cx + 0.5, y + 0.6, col.w - 1, rowH - 1.2, st.fill);
        if (Number.isFinite(v) && v >= 0 && v <= 2) { setFill(doc, hazardColor(v)); doc.rect(cx + 0.5, y + 0.6, 1.2, rowH - 1.2, 'F'); }
        const twoLines = Boolean(detail);
        cell(col, verdictText(v), { color: st.text, style: v === null ? 'normal' : 'bold', y: twoLines ? line1 : mid });
        if (twoLines) cell(col, detail, { color: st.text, size: subSize, y: line2 });
      }
      cx += col.w;
    });
    y += rowH;
  });

  setFont(doc, TEXT_MD, 6.2, 'italic');
  doc.text(noteLines, MARGIN, y + 3.6, { lineHeightFactor: 1.15 });
}

// Whole metres, so the mid-scale tick lands on a clean half-metre value.
const niceMax = (v) => Math.max(1, Math.ceil(v));

function drawTrendPage(doc, bundle) {
  const cw = contentWidth(doc);
  sectionTitle(doc, 'Next 72 hours: significant wave height (Hs) at each location', MARGIN, CONTENT_TOP + 3);
  setFont(doc, TEXT_MD, 6.8);
  doc.text('Every panel uses the same vertical scale so locations can be compared directly.', MARGIN, CONTENT_TOP + 7.5);

  const allHs = bundle.harbours.flatMap((h) => h.series.map((p) => p.hsM)).filter(Number.isFinite);
  const maxHs = allHs.length ? Math.max(...allHs) : 1;
  // Limit lines stretch the scale only when they are in a plausible range;
  // a wildly high limit would flatten every curve, so it is left off the charts.
  const plausible = (l) => Number.isFinite(l) && l <= maxHs * 1.5 + 1;
  const limitVals = bundle.harbours.flatMap((h) => [h.hsCaution, h.hsStop]).filter(plausible);
  const yMax = niceMax(Math.max(maxHs, ...limitVals, 0));

  const cols = 4; const gap = 4;
  const top = CONTENT_TOP + 11;
  const bottom = contentBottom(doc) - 9;
  const rows = Math.ceil(bundle.harbours.length / cols) || 1;
  const cellW = (cw - gap * (cols - 1)) / cols;
  const cellH = (bottom - top - gap * (rows - 1)) / rows;

  bundle.harbours.forEach((h, i) => {
    const cx = MARGIN + (i % cols) * (cellW + gap);
    const cy = top + Math.floor(i / cols) * (cellH + gap);
    card(doc, cx, cy, cellW, cellH);
    setFont(doc, TEXT_DK, 7.2, 'bold');
    doc.text(fitText(doc, `${h.name}${h.available && h.nodeFar ? ' †' : ''}`, cellW - 6), cx + 3, cy + 4.6);
    setFont(doc, TEXT_MD, 6, 'normal');
    doc.text(fitText(doc, `${h.island}${h.available && Number.isFinite(h.nodeDistanceKm) ? ` · wave node ${h.nodeDistanceKm.toFixed(1)} km` : ''}`, cellW - 6), cx + 3, cy + 8);

    const px = cx + 9; const pw = cellW - 13; const py = cy + 11; const ph = cellH - 19;
    const series = h.series.filter((p) => Number.isFinite(p.hsM));
    if (h.available && h.missing72Hours > 0) {
      setFont(doc, hazardText(1), 5.6, 'bold');
      doc.text(`Only ${72 - h.missing72Hours} of 72 h of forecast available`, cx + 3, cy + cellH - 2.2);
    }
    if (!h.available || series.length < 2) {
      setFont(doc, TEXT_MD, 7, 'italic');
      doc.text(h.available ? 'No model data' : doc.splitTextToSize(h.unavailableReason || 'No model data', cellW - 8), cx + cellW / 2, cy + cellH / 2 + 1, { align: 'center' });
      return;
    }
    const t0 = h.series[0].t; const t1 = h.series[h.series.length - 1].t;
    const X = (t) => px + ((t - t0) / Math.max(1, t1 - t0)) * pw;
    const Y = (v) => py + ph - (v / yMax) * ph;

    // frame + y grid (0, mid, max)
    setDraw(doc, GRID_CLR); doc.setLineWidth(0.15);
    [0, yMax / 2, yMax].forEach((v) => {
      doc.line(px, Y(v), px + pw, Y(v));
      setFont(doc, TEXT_MD, 5.4); doc.text(`${v % 1 ? v.toFixed(1) : v}`, px - 1.2, Y(v) + 0.9, { align: 'right' });
    });
    // day ticks at +24/+48/+72 h
    [24, 48, 72].forEach((hr) => {
      const t = t0 + hr * 3600e3;
      if (t > t1 + 1800e3) return;
      doc.line(X(Math.min(t, t1)), py + ph, X(Math.min(t, t1)), py + ph + 1.6);
      setFont(doc, TEXT_MD, 5.4); doc.text(`+${hr}h`, X(Math.min(t, t1)), py + ph + 4.6, { align: 'center' });
    });

    // limit lines (Hs only), dashed
    [[h.hsCaution, [217, 119, 6]], [h.hsStop, [200, 40, 40]]].forEach(([lim, colour]) => {
      if (!plausible(lim)) return;
      setDraw(doc, colour); doc.setLineWidth(0.4); doc.setLineDashPattern([1.2, 0.9], 0);
      doc.line(px, Y(lim), px + pw, Y(lim));
      doc.setLineDashPattern([], 0);
    });

    // Hs curve (gaps break the line)
    setDraw(doc, [0, 120, 170]); doc.setLineWidth(0.55);
    let prev = null;
    h.series.forEach((p) => {
      if (!Number.isFinite(p.hsM)) { prev = null; return; }
      if (prev) doc.line(X(prev.t), Y(prev.hsM), X(p.t), Y(p.hsM));
      prev = p;
    });
    const peak = series.reduce((a, b) => (b.hsM > a.hsM ? b : a));
    setFont(doc, TEXT_DK, 5.8, 'bold');
    doc.text(`max ${peak.hsM.toFixed(1)} m`, cx + cellW - 3, cy + 4.6, { align: 'right' });
  });

  // key
  const ky = bottom + 5;
  setFont(doc, TEXT_MD, 6.4);
  setDraw(doc, [0, 120, 170]); doc.setLineWidth(0.6); doc.line(MARGIN, ky - 0.8, MARGIN + 7, ky - 0.8);
  doc.text('Hs (m)', MARGIN + 9, ky);
  let kx = MARGIN + 42;
  if (bundle.judged) {
    setDraw(doc, [217, 119, 6]); doc.setLineDashPattern([1.2, 0.9], 0); doc.line(kx, ky - 0.8, kx + 7, ky - 0.8); doc.setLineDashPattern([], 0);
    doc.text('Caution limit', kx + 9, ky); kx += 32;
    setDraw(doc, [200, 40, 40]); doc.setLineDashPattern([1.2, 0.9], 0); doc.line(kx, ky - 0.8, kx + 7, ky - 0.8); doc.setLineDashPattern([], 0);
    doc.text(`Stop limit (${{ draft: 'DRAFT, not approved', provisional: 'PROVISIONAL, not confirmed' }[bundle.basis] ?? 'approved'}; wave height only)`, kx + 9, ky);
  } else {
    doc.text('No unloading limits applied.', kx, ky);
  }
  setFill(doc, NO_DATA_GREY);
}

// A diagonal, low-opacity watermark on every page whenever the verdicts rest on limits that are not
// approved. The statement at the top and the tagged column headers can be cropped away; a mark across
// the whole page cannot. Drawn on top of the content at low opacity so it never hides a value.
const WATERMARK_TEXT = { provisional: 'PROVISIONAL LIMITS - NOT APPROVED', draft: 'DRAFT LIMITS - NOT APPROVED' };

function drawWatermark(doc, bundle) {
  const text = WATERMARK_TEXT[bundle.basis];
  if (!text || !bundle.judged) return;
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  doc.saveGraphicsState();
  if (typeof doc.GState === 'function') doc.setGState(new doc.GState({ opacity: 0.11 }));
  setFont(doc, [190, 40, 40], 34, 'bold');
  // jsPDF rotates text about its start point, so place that start point such that the text's CENTRE
  // lands on the page centre (centring with `align` clips a rotated string at the page edges).
  const angle = 24;
  const rad = (angle * Math.PI) / 180;
  const w = doc.getTextWidth(text);
  doc.text(text, pw / 2 - (w / 2) * Math.cos(rad), ph / 2 + 4 + (w / 2) * Math.sin(rad), { angle });
  doc.restoreGraphicsState();
}

export async function buildCookIslandsHarbourAdvisoryPdfDoc(bundle) {
  if (!bundle || !Array.isArray(bundle.harbours)) throw new Error('No harbour conditions to export.');
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  await ensureReportFont(doc);
  doc.setProperties({
    title: 'Cook Islands Harbour Conditions Advisory',
    subject: 'Wave conditions at main harbours, anchorages and passages for barge unloading planning',
    creator: 'Cook Islands Ocean Dashboard',
    author: 'Pacific Community (SPC)',
  });
  doc.setLanguage('en');

  const tz = bundle.timezone;
  const zoned = (d) => `${formatEta(d, tz)} ${tzLabel(tz)}`;
  const provenance = [
    `Harbour forecast run ${bundle.runStart ? `${new Date(bundle.runStart).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'not reported'}`,
    bundle.waveRunStart ? `Wave feed run ${new Date(bundle.waveRunStart).toISOString().slice(0, 16).replace('T', ' ')} UTC` : null,
    `Generated ${zoned(bundle.generatedAt)}`,
    'Source: SPC SWAN wave model (Cook Islands) and vessel-suitability forecast',
  ].filter(Boolean).join(' · ');

  const header = (page) => drawHeaderBand(doc, {
    title: 'Cook Islands Harbour Conditions Advisory',
    subtitle: 'Wave conditions at main harbours, anchorages and passages · for planning barge unloading',
    rightLine1: `Issued ${zoned(bundle.generatedAt)}`,
    rightLine2: `Forecast run ${bundle.runStart ? `${new Date(bundle.runStart).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'not reported'} · Page ${page} of 2`,
  });

  header(1);
  drawTablePage(doc, bundle, tz);
  drawWatermark(doc, bundle);
  drawFooter(doc, { provenance, text: HARBOUR_DISCLAIMER });

  doc.addPage();
  header(2);
  drawTrendPage(doc, bundle);
  drawWatermark(doc, bundle);
  drawFooter(doc, { provenance, text: HARBOUR_DISCLAIMER });

  const stamp = bundle.generatedAt.toISOString().slice(0, 16).replace(/[:T-]/g, '');
  return { doc, filename: `cook_islands_harbour_advisory_${stamp}.pdf` };
}

export async function exportCookIslandsHarbourAdvisoryPdf(bundle) {
  const { doc, filename } = await buildCookIslandsHarbourAdvisoryPdfDoc(bundle);
  doc.save(filename);
  return filename;
}
