// CookIslandsLandingAreaComparisonPdf.js
// Generates the "Landing Area Suitability Advisory Brief" PDF: the same
// site x time heatmap CookIslandsLandingAreaComparisonHeatmap.jsx renders on
// screen, as a standalone document -- wired to
// CookIslandsLandingAreaComparisonPanel.jsx's "Export PDF" button (bottom
// sheet, 'landing-area-comparison' mode).
//
// Reuses selectHeatmapSteps/findMatchingStep (heatmapSteps.js) so the PDF's
// column selection is identical to the on-screen heatmap's, not a second,
// independently-sampled set of dates that could disagree with it -- see
// that file's own header comment for the date-gap bug this matters for.
//
// Landscape, not portrait like the route/scenario reports: a dozen-plus
// named sites each with up to ~15 date columns needs the extra width.
// drawHeaderBand()/drawFooter() (CookIslandsRouteAdvisoryPdf.js) read the
// doc's own actual page width rather than assuming portrait, so they work
// here unmodified -- no second copy of that drawing code for this report.
import {
  HDR_H, TEXT_MD, TEXT_DK, NO_DATA_GREY,
  setFont, rect,
  hazardColor,
  formatEta,
  drawHeaderBand, drawFooter,
} from './CookIslandsRouteAdvisoryPdf';
import { formatZoned, formatZonedTime, tzLabel } from './timeZoneFormat';
import { ROUTE_HAZARD_LABELS } from '../services/cookIslandsRouteForecastService';
import { selectHeatmapSteps, findMatchingStep } from './heatmapSteps';

const PAGE_W = 297; // A4 landscape, mm

// Matches CookIslandsLandingAreaComparisonHeatmap.jsx's own basis-disclosure
// text (same field names, same priority order) -- this PDF should never
// describe the underlying statistic differently than the screen it mirrors.
function statisticsBasisLabel(sites) {
  if (sites.some((s) => s.statistics_basis === 'area_500m')) return '500 m area';
  if (sites.some((s) => s.statistics_basis === 'nearest_point_area_fallback')) return 'nearest-point area fallback';
  if (sites.some((s) => s.statistics_basis === 'nearest_point_fallback')) return 'nearest-point fallback';
  return 'landing area';
}

function drawLegend(doc, x, y) {
  const entries = [...[0, 1, 2].map((h) => [hazardColor(h), ROUTE_HAZARD_LABELS[h]]), [NO_DATA_GREY, 'Unavailable']];
  let cx = x;
  setFont(doc, TEXT_MD, 7);
  for (const [color, label] of entries) {
    rect(doc, cx, y - 2.6, 3, 3, color);
    doc.text(label, cx + 4.5, y);
    cx += 4.5 + doc.getTextWidth(label) + 8;
  }
}

// rows: useCookIslandsLandingAreaComparison's own row shape (id/name/steps/
// statistics_basis/point_count/...). Rows with no steps at all (a site the
// backend returned nothing usable for) are dropped rather than rendered as
// an all-"Unavailable" row -- same reasoning as the on-screen heatmap only
// ever receiving rows useCookIslandsLandingAreaComparison already filtered
// down to withData.length (see that hook's own header comment).
export async function buildCookIslandsLandingAreaComparisonPdfDoc({ rows, vesselLabel, timeDisplayZone = 'Pacific/Rarotonga' }) {
  const sites = Array.isArray(rows) ? rows.filter((r) => r?.steps?.length) : [];
  if (sites.length === 0) {
    throw new Error('No landing area comparison data to export.');
  }

  // Same reference-series choice as the heatmap component: the longest
  // steps[] among the compared sites, so a short-lived site's own gaps
  // don't shrink the column set every site is measured against.
  const referenceSteps = sites.reduce((best, row) => (row.steps.length > best.length ? row.steps : best), []);
  const heatmapSteps = selectHeatmapSteps(referenceSteps, 168);
  if (heatmapSteps.length === 0) {
    throw new Error('No landing area comparison data to export.');
  }

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setProperties({
    title: 'Cook Islands Landing Area Suitability Advisory Brief',
    subject: 'Vessel suitability across landing and fishing-ground sites',
    creator: 'Cook Islands Ocean Dashboard',
    author: 'Pacific Community (SPC)',
  });
  doc.setLanguage('en');

  const generatedAt = new Date();
  const basisLabel = statisticsBasisLabel(sites);
  drawHeaderBand(doc, {
    title: 'Cook Islands Landing Area Suitability Advisory Brief',
    subtitle: (vesselLabel ? `${vesselLabel} · ` : '') + `next 7 days · ${basisLabel}`,
    rightLine1: `Generated ${formatEta(generatedAt, timeDisplayZone)} ${tzLabel(timeDisplayZone)}`,
    rightLine2: `${sites.length} site${sites.length === 1 ? '' : 's'} compared`,
  });

  const labelW = 52;
  const marginX = 8;
  const availableW = PAGE_W - marginX * 2 - labelW;
  const colW = availableW / heatmapSteps.length;
  const rowH = 6.5;
  const dateHeaderH = 11;
  let y = HDR_H + 8;

  // Column date headers -- two lines (date, time) per column, same split as
  // the on-screen heatmap's "19 Sep\n02:00" cells.
  heatmapSteps.forEach((hs, i) => {
    const d = new Date(hs.time);
    const cx = marginX + labelW + i * colW + colW / 2;
    setFont(doc, TEXT_MD, 6, 'bold');
    if (Number.isFinite(d.getTime())) {
      doc.text(formatZoned(d, timeDisplayZone, { withLabel: false, year: undefined, month: 'short', day: '2-digit' }), cx, y, { align: 'center' });
      doc.text(formatZonedTime(d, timeDisplayZone), cx, y + 4, { align: 'center' });
    } else {
      doc.text('—', cx, y, { align: 'center' });
    }
  });
  y += dateHeaderH;

  sites.forEach((site, rowIndex) => {
    if (rowIndex % 2 === 1) rect(doc, marginX, y - rowH * 0.72, labelW + availableW, rowH, [246, 248, 250]);

    setFont(doc, TEXT_DK, 7.2, 'bold');
    const label = doc.splitTextToSize(site.name ?? site.label ?? 'Unknown site', labelW - 2)[0];
    doc.text(label, marginX + 1, y);

    heatmapSteps.forEach((hs, i) => {
      const matched = findMatchingStep(site.steps, hs);
      const hazard = matched && Number.isFinite(matched.hazard_class) ? matched.hazard_class : null;
      const color = hazard === null ? NO_DATA_GREY : hazardColor(hazard);
      const cellX = marginX + labelW + i * colW + 0.6;
      rect(doc, cellX, y - rowH * 0.62, colW - 1.2, rowH * 0.62, color);
    });

    y += rowH;
  });

  y += 5;
  drawLegend(doc, marginX, y);

  drawFooter(doc);

  const filename = `cook_islands_landing_area_comparison_${generatedAt.toISOString().slice(0, 16).replace(/[:T]/g, '')}.pdf`;
  return { doc, filename };
}

export async function exportCookIslandsLandingAreaComparisonPdf(params) {
  const { doc, filename } = await buildCookIslandsLandingAreaComparisonPdfDoc(params);
  doc.save(filename);
  return filename;
}
