// CookIslandsDomainAdvisoryPdf.js
// Phase 1 of porting widget1's 7-page SuitabilityPDFExporter.js "executive
// advisory" structure to widget5, which had no whole-domain "right now"
// advisory PDF at all (only route/scenario/landing-area comparison PDFs).
// See /home/kishank/.claude/plans/elegant-snuggling-dahl.md for the full
// phased plan and why pages 2-6 (continuous outlook, hazard heatmap,
// 4-vessel map comparison, forecast timeline/trend) aren't built here --
// they need backend work (per-timestep bounds-scoped summary stats, a
// server-rendered map-image endpoint) that doesn't exist for Cook Islands
// yet, unlike Niue.
//
// Two pages instead of widget1's seven:
//   Page 1 — Executive advisory: header, vessel badge, one-line summary,
//            a captured map image, per-vessel condition cards.
//   Page 2 — Methodology & transparency: classification logic + the vessel
//            threshold table, ported near-verbatim from widget1's Page 7
//            (pure static content, zero data dependency -- the cheapest,
//            highest-credibility piece to port first).
//
// jsPDF loaded lazily -- same reasoning as CookIslandsRouteAdvisoryPdf.js:
// keeps it out of the main bundle, and keeps this file's pure logic
// (domainHazard, vessel percentage formatting) importable/testable without
// a browser.
import {
  PAGE_W, HDR_H, HEADER_BG, TEXT_LT, TEXT_MD, TEXT_DK, GRID_CLR, NO_DATA_GREY,
  hazardColor, hazardLight, hazardText, hazardLabel,
  setFill, setDraw, setFont, rect, drawHeaderBand, drawFooter, loadVesselSvgIcon,
} from './advisoryPdfPrimitives';
import { VESSEL_OPERATING_ENVELOPE, VESSEL_CLASS_OPTIONS } from '../lib/CookIslandsSuitabilityOverlay';
import { fetchCookIslandsSuitabilitySummary } from '../services/cookIslandsSuitabilitySummaryService';

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

// Same thresholds as widget1's domainHazard: any Avoid/Caution coverage
// flags the advisory, and >=20% Avoid coverage escalates it to its own
// Warning-level badge rather than reading as merely "some caution zones".
export function domainHazard(warningPercent, cautionPercent) {
  const warn = Number(warningPercent) || 0;
  const caution = Number(cautionPercent) || 0;
  if (warn >= 20) return 2;
  if (warn > 0 || caution > 0) return 1;
  return 0;
}

function vesselLabel(code) {
  return VESSEL_CLASS_OPTIONS.find((v) => v.value === code)?.label ?? code;
}

// ── Page 1 — Executive advisory ─────────────────────────────────────────────

async function drawPage1(doc, { mapImageDataUrl, vessels, selectedVessel, validTime, generatedAt, timeDisplayZone }) {
  const W = PAGE_W;
  const H = doc.internal.pageSize.getHeight();

  drawHeaderBand(doc, {
    title: 'COOK ISLANDS COASTAL WATERS',
    subtitle: 'MARINE VESSEL SUITABILITY ADVISORY',
    rightLine1: `Valid: ${formatValidTime(validTime, timeDisplayZone)}`,
    rightLine2: `Generated ${formatValidTime(generatedAt, timeDisplayZone)}  ·  SWAN  |  Page 1 of 2`,
  });

  const selectedData = vessels[selectedVessel];
  const selectedPresent = Boolean(selectedData);
  const selectedHaz = selectedPresent ? domainHazard(selectedData.warning_percent, selectedData.caution_percent) : 0;
  const selectedLabel = vesselLabel(selectedVessel);

  // Vessel badge, centered in the header band
  const badgeW = 62, badgeX = W / 2 - badgeW / 2;
  setFill(doc, selectedPresent ? hazardColor(selectedHaz) : NO_DATA_GREY);
  doc.roundedRect(badgeX, 1.5, badgeW, HDR_H - 3, 1.5, 1.5, 'F');
  setFont(doc, TEXT_LT, 8, 'bold');
  doc.text(
    `${selectedLabel.toUpperCase()} — ${selectedPresent ? hazardLabel(selectedHaz).toUpperCase() : 'NO DATA'}`,
    W / 2, HDR_H * 0.68, { align: 'center' },
  );

  // Summary sentence strip
  const SUM_H = 10, SUM_Y = HDR_H;
  rect(doc, 0, SUM_Y, W, SUM_H, selectedPresent ? hazardLight(selectedHaz) : [238, 238, 238]);
  const warnPct = Math.round(selectedData?.warning_percent ?? 0);
  const cautionPct = Math.round(selectedData?.caution_percent ?? 0);
  const finding = !selectedPresent
    ? 'Suitability data unavailable for the selected vessel.'
    : selectedHaz === 2
      ? `${selectedLabel} faces ${warnPct}% Warning-level waters — check conditions before departure.`
      : selectedHaz === 1
        ? `${selectedLabel} is mostly operable, but ${cautionPct}% of waters require caution.`
        : `All modelled waters are Suitable for ${selectedLabel} — safe conditions for departure.`;
  setFont(doc, selectedPresent ? hazardText(selectedHaz) : hazardColor(2), 9, 'bold');
  doc.text(doc.splitTextToSize(finding, W - 20), W / 2, SUM_Y + SUM_H * 0.64, { align: 'center' });

  // ── Layout ──────────────────────────────────────────────────────────────
  const MAP_Y = SUM_Y + SUM_H + 2;
  const MAP_W = W * 0.58;
  const FOOT_RESERVE = 8;
  const MAP_H = H - MAP_Y - FOOT_RESERVE - 6;
  const CARD_X0 = MAP_W + 4;
  const CARD_W = W - CARD_X0 - 3;
  const CARD_GAP = 3;
  const CARD_H = (MAP_H - CARD_GAP * 3) / 4;

  // Map image (captured live from the map, see the caller) or a failure panel
  if (mapImageDataUrl) {
    setDraw(doc, GRID_CLR);
    doc.setLineWidth(0.5);
    doc.rect(2.5, MAP_Y - 0.5, MAP_W - 3, MAP_H + 1, 'S');
    setFill(doc, [9, 24, 42]);
    doc.rect(3, MAP_Y, MAP_W - 4, MAP_H, 'F');
    try {
      const props = doc.getImageProperties(mapImageDataUrl);
      const sourceAspect = props.width / props.height;
      const boxAspect = (MAP_W - 4) / MAP_H;
      let imageX = 3, imageY = MAP_Y, imageW = MAP_W - 4, imageH = MAP_H;
      if (Number.isFinite(sourceAspect) && sourceAspect > 0) {
        if (sourceAspect > boxAspect) {
          imageH = (MAP_W - 4) / sourceAspect;
          imageY += (MAP_H - imageH) / 2;
        } else {
          imageW = MAP_H * sourceAspect;
          imageX += (MAP_W - 4 - imageW) / 2;
        }
      }
      doc.addImage(mapImageDataUrl, 'PNG', imageX, imageY, imageW, imageH, 'domain_advisory_map', 'FAST');
    } catch {
      // keep the plain navy box if the image can't be read
    }
  } else {
    setFill(doc, [240, 240, 240]);
    doc.rect(3, MAP_Y, MAP_W - 4, MAP_H, 'F');
    setFont(doc, TEXT_MD, 8, 'italic');
    doc.text('Map view unavailable', 3 + (MAP_W - 4) / 2, MAP_Y + MAP_H / 2, { align: 'center' });
  }
  setFont(doc, TEXT_MD, 6, 'italic');
  doc.text('Current map view — SWAN wave model', 5, MAP_Y + MAP_H + 3.5);

  // Per-vessel condition cards
  for (let i = 0; i < VESSEL_CLASS_OPTIONS.length; i += 1) {
    const vc = VESSEL_CLASS_OPTIONS[i];
    const data = vessels[vc.value];
    const present = Boolean(data);
    const haz = present ? domainHazard(data.warning_percent, data.caution_percent) : 0;
    const cardY = MAP_Y + i * (CARD_H + CARD_GAP);

    rect(doc, CARD_X0, cardY, CARD_W, CARD_H, [255, 255, 255], GRID_CLR, 0.25);
    const BAR_H = Math.max(4, CARD_H * 0.2);
    setFill(doc, present ? hazardColor(haz) : NO_DATA_GREY);
    doc.rect(CARD_X0, cardY, CARD_W, BAR_H, 'F');

    const icon = await loadVesselSvgIcon(vc.value, present ? haz : 0);
    let textX = CARD_X0 + 3;
    if (icon) {
      const iconH = Math.min(CARD_H - BAR_H - 4, 10);
      const iconW = iconH * 3;
      try {
        doc.addImage(icon, 'PNG', CARD_X0 + 3, cardY + BAR_H + 2, iconW, iconH, undefined, 'FAST');
        textX = CARD_X0 + 3 + iconW + 3;
      } catch { /* fall back to text-only card */ }
    }
    setFont(doc, TEXT_DK, 8, 'bold');
    doc.text(vc.label, textX, cardY + BAR_H + 6);
    setFont(doc, TEXT_MD, 6.5);
    doc.text(vc.examples ?? '', textX, cardY + BAR_H + 10);
    setFont(doc, present ? hazardText(haz) : TEXT_MD, 7, 'bold');
    doc.text(
      present
        ? `${hazardLabel(haz)} · ${formatNumber(data.caution_percent, 0)}% caution · ${formatNumber(data.warning_percent, 0)}% warning`
        : 'No data',
      textX, cardY + CARD_H - 2.5,
    );
  }

  drawFooter(doc);
}

// ── Page 2 — Methodology & transparency (ported near-verbatim from
//     widget1's Page 7, which is pure static content over
//     VESSEL_OPERATING_ENVELOPE -- no data/backend dependency) ─────────────

function drawPage2(doc, { validTime, generatedAt, timeDisplayZone }) {
  const W = PAGE_W;
  doc.addPage();

  drawHeaderBand(doc, {
    title: 'COOK ISLANDS COASTAL WATERS',
    subtitle: 'SUITABILITY METHODOLOGY & TRANSPARENCY',
    rightLine1: `Valid: ${formatValidTime(validTime, timeDisplayZone)}`,
    rightLine2: `Generated ${formatValidTime(generatedAt, timeDisplayZone)}  |  Page 2 of 2`,
  });

  const MX = 8, BODY_Y = HDR_H + 6;
  setFont(doc, HEADER_BG, 9, 'bold');
  doc.text('HOW SUITABILITY IS CLASSIFIED', MX, BODY_Y);

  setFont(doc, TEXT_MD, 7.5);
  const logicLines = doc.splitTextToSize(
    'Classification is applied independently at each modelled point using two meteorological parameters: significant wave '
    + 'height (Hs) and sustained 10-metre wind speed. A point is flagged Warning when either parameter meets or exceeds the '
    + 'warning threshold for the selected vessel class; Caution when it meets the caution threshold; Suitable otherwise. '
    + 'The vessel condition cards on Page 1 report the percentage of modelled points in each category. Thresholds are '
    + 'defined per vessel class as shown in the table below.',
    W - 2 * MX,
  );
  doc.text(logicLines, MX, BODY_Y + 7);

  const TBL_Y = BODY_Y + 7 + logicLines.length * 4.2 + 8;
  const TBL_X = MX;
  const tblW = W - 2 * MX;
  const COL_W = [46, 60, tblW - 46 - 60 - 46, 46];
  const HDR_ROW_H = 9, ROW_H = 14;

  const colX = [];
  let cxAcc = TBL_X;
  COL_W.forEach((w) => { colX.push(cxAcc); cxAcc += w; });

  rect(doc, TBL_X, TBL_Y, tblW, HDR_ROW_H, HEADER_BG);
  ['Vessel Class', 'Typical Use', 'Caution Threshold', 'Warning Threshold'].forEach((h, i) => {
    setFont(doc, TEXT_LT, 7.5, 'bold');
    doc.text(h, colX[i] + COL_W[i] / 2, TBL_Y + HDR_ROW_H * 0.68, { align: 'center' });
  });

  VESSEL_CLASS_OPTIONS.forEach((vc, ri) => {
    const rule = VESSEL_OPERATING_ENVELOPE[vc.value];
    const ry = TBL_Y + HDR_ROW_H + ri * ROW_H;
    rect(doc, TBL_X, ry, tblW, ROW_H, ri % 2 === 0 ? [245, 247, 252] : [255, 255, 255]);

    setFont(doc, TEXT_DK, 8, 'bold');
    doc.text(vc.label, colX[0] + 3, ry + ROW_H * 0.5);

    setFont(doc, TEXT_MD, 6.5);
    doc.text(doc.splitTextToSize(vc.examples ?? '', COL_W[1] - 5), colX[1] + 3, ry + ROW_H * 0.42);

    if (rule) {
      setFont(doc, hazardText(1), 7, 'bold');
      doc.text(`Hs ≥ ${formatNumber(rule.cautionWaveHeightM)} m`, colX[2] + COL_W[2] / 2, ry + 5, { align: 'center' });
      doc.text(`Wind ≥ ${formatNumber(rule.cautionWindKt, 0)} kt`, colX[2] + COL_W[2] / 2, ry + 9.5, { align: 'center' });

      setFont(doc, hazardText(2), 7, 'bold');
      doc.text(`Hs ≥ ${formatNumber(rule.maxWaveHeightM)} m`, colX[3] + COL_W[3] / 2, ry + 5, { align: 'center' });
      doc.text(`Wind ≥ ${formatNumber(rule.maxWindKt, 0)} kt`, colX[3] + COL_W[3] / 2, ry + 9.5, { align: 'center' });
    }
  });

  setDraw(doc, GRID_CLR);
  doc.setLineWidth(0.3);
  const tblH = HDR_ROW_H + VESSEL_CLASS_OPTIONS.length * ROW_H;
  doc.rect(TBL_X, TBL_Y, tblW, tblH, 'S');
  colX.slice(1).forEach((x) => doc.line(x, TBL_Y, x, TBL_Y + tblH));
  doc.line(TBL_X, TBL_Y + HDR_ROW_H, TBL_X + tblW, TBL_Y + HDR_ROW_H);

  setFont(doc, TEXT_MD, 6.5, 'italic');
  doc.text(
    doc.splitTextToSize(
      'Percentages are computed from every modelled point currently in view, at the forecast time shown. '
      + 'This advisory is model guidance, not navigation advice — always confirm with official marine warnings and local seamanship before departure.',
      W - 2 * MX,
    ),
    MX, TBL_Y + tblH + 8,
  );

  drawFooter(doc);
}

// ── Main export ──────────────────────────────────────────────────────────

// mapImageDataUrl: a PNG data URL captured by the caller (e.g.
// map.getCanvas().toDataURL('image/png'), which needs preserveDrawingBuffer
// on the MapLibre instance -- see useZarrMap.js) -- passed in rather than
// captured here so this file stays free of any direct map/DOM dependency.
export async function buildCookIslandsDomainAdvisoryPdfDoc({
  mapImageDataUrl = null, vesselClass, timeIndex = 0, validTime = null, timeDisplayZone = 'Pacific/Rarotonga', bounds = null,
}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setProperties({
    title: 'Cook Islands Domain Advisory',
    subject: 'Marine vessel suitability advisory',
    creator: 'Cook Islands Ocean Dashboard',
    author: 'Pacific Community (SPC)',
  });
  doc.setLanguage('en');

  const generatedAt = new Date();
  // bounds (the current map view) scopes the backend-summary attempt to
  // match what mapImageDataUrl actually shows -- see
  // fetchCookIslandsSuitabilitySummary's own comment for why the
  // points-based fallback can't honour this and always summarizes the
  // whole domain instead.
  const { vessels } = await fetchCookIslandsSuitabilitySummary(timeIndex, bounds);

  await drawPage1(doc, { mapImageDataUrl, vessels, selectedVessel: vesselClass, validTime: validTime ?? generatedAt, generatedAt, timeDisplayZone });
  drawPage2(doc, { validTime: validTime ?? generatedAt, generatedAt, timeDisplayZone });

  const filename = `cook_islands_domain_advisory_${vesselClass}_${generatedAt.toISOString().slice(0, 16).replace(/[:T]/g, '')}.pdf`;
  return { doc, filename };
}

export async function exportCookIslandsDomainAdvisoryPdf(params) {
  const { doc, filename } = await buildCookIslandsDomainAdvisoryPdfDoc(params);
  doc.save(filename);
  return filename;
}
