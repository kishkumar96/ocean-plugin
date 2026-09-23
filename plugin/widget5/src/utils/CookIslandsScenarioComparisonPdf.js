// CookIslandsScenarioComparisonPdf.js
// Generates the "Scenario Comparison Advisory Brief" PDF from a
// buildScenarioComparisonBriefConfig() config (cookIslandsScenarioService.js),
// wired to CookIslandsScenarioComparisonPanel.jsx's "Generate Scenario
// Comparison Brief" button via Home.jsx's onExportScenarioComparisonBrief.
// That button already existed but had no exporter to call -- onExportBrief
// was optional and never supplied, so it never rendered.
//
// Shares its low-level jsPDF drawing primitives (header band, footer
// disclaimer, hazard palette, StatCard) with CookIslandsRouteAdvisoryPdf.js
// rather than duplicating them -- this report and the single-route one are
// the same visual system, just a different layout on top. See that file's
// header comment for why jsPDF itself is a lazy dynamic import.
//
// One page: a card per compared scenario (vessel/speed/departure and its own
// worst-hazard outcome), then the same side-by-side comparison table
// CookIslandsScenarioComparisonPanel.jsx already renders on screen. No
// per-sample table the way the route brief has one -- comparing summaries
// across up to MAX_SCENARIOS scenarios is the point of this report, not
// re-dumping each scenario's full timeseries (already available per-scenario
// via the single-route export, run separately for whichever one wins).
import {
  PAGE_W, HDR_H, TEXT_LT, TEXT_MD, TEXT_DK, GRID_CLR, HEADER_BG,
  setFont, rect,
  hazardText,
  formatNumber, formatEta,
  drawHeaderBand, drawFooter,
} from './CookIslandsRouteAdvisoryPdf';
import { tzLabel } from './timeZoneFormat';
import { ROUTE_HAZARD_LABELS } from '../services/cookIslandsRouteForecastService';
import { driverLabel } from '../services/cookIslandsScenarioService';

const ACCENT = [0, 212, 255]; // #00d4ff, matches drawHeaderBand's own subtitle accent

function drawScenarioCard(doc, x, y, w, h, scenario, isRecommended, timeDisplayZone) {
  const decision = scenario.decision;
  const hazardAvailable = Number.isFinite(decision?.worstHazardClass);
  rect(doc, x, y, w, h, [255, 255, 255], isRecommended ? ACCENT : GRID_CLR, isRecommended ? 0.7 : 0.25);

  setFont(doc, TEXT_DK, 9, 'bold');
  doc.text(scenario.name + (isRecommended ? '  ★ Recommended' : ''), x + 4, y + 7);

  setFont(doc, TEXT_MD, 7);
  doc.text(
    `${scenario.vesselLabel} · ${formatNumber(Number(scenario.speedKt), 1)} kt · `
    + `Depart ${formatEta(scenario.departureTime, timeDisplayZone)} ${tzLabel(timeDisplayZone)}`,
    x + 4, y + 13,
  );

  setFont(doc, hazardAvailable ? hazardText(decision.worstHazardClass) : TEXT_MD, 8.5, 'bold');
  doc.text(
    hazardAvailable
      ? `${ROUTE_HAZARD_LABELS[decision.worstHazardClass] ?? 'Unknown'} · ${driverLabel(decision.primaryDriver)}`
      : (scenario.status === 'error' ? (scenario.error || 'Failed') : 'No result'),
    x + 4, y + 20,
  );

  if (hazardAvailable) {
    setFont(doc, TEXT_MD, 6.8);
    doc.text(
      `Caution+Warning ${formatNumber((decision.cautionPercent ?? 0) + (decision.warningPercent ?? 0), 0)}% · `
      + `Duration ${formatNumber(decision.durationHours, 1)} h · Unavailable ${decision.unavailableSamples ?? '—'}`,
      x + 4, y + 26,
    );
  }
}

function drawComparisonTable(doc, x, y, scenarios, recommendedId) {
  const columns = [
    { key: 'name', label: 'Scenario', w: 40 },
    { key: 'worst', label: 'Worst', w: 26 },
    { key: 'caution', label: 'Caution+Warning', w: 32 },
    { key: 'unavailable', label: 'Unavailable', w: 26 },
    { key: 'duration', label: 'Duration', w: 24 },
    { key: 'driver', label: 'Driver', w: 26 },
  ];
  const tableW = columns.reduce((sum, c) => sum + c.w, 0);
  const rowH = 7;
  const headerH = 7;

  rect(doc, x, y, tableW, headerH, HEADER_BG);
  setFont(doc, TEXT_LT, 7, 'bold');
  let cx = x;
  for (const col of columns) {
    doc.text(col.label, cx + 2, y + headerH * 0.65);
    cx += col.w;
  }
  y += headerH;

  scenarios.forEach((scenario, index) => {
    const decision = scenario.decision;
    const hazardAvailable = Number.isFinite(decision?.worstHazardClass);
    const isRecommended = scenario.id === recommendedId;
    if (index % 2 === 1) rect(doc, x, y, tableW, rowH, [246, 248, 250]);
    const rowTextColor = hazardAvailable ? hazardText(decision.worstHazardClass) : TEXT_MD;
    const values = {
      name: scenario.name + (isRecommended ? ' ★' : ''),
      worst: hazardAvailable ? (ROUTE_HAZARD_LABELS[decision.worstHazardClass] ?? '—') : '—',
      caution: hazardAvailable ? `${formatNumber((decision.cautionPercent ?? 0) + (decision.warningPercent ?? 0), 0)}%` : '—',
      unavailable: decision?.unavailableSamples ?? '—',
      duration: hazardAvailable ? `${formatNumber(decision.durationHours, 1)} h` : '—',
      driver: hazardAvailable ? driverLabel(decision.primaryDriver) : '—',
    };
    cx = x;
    for (const col of columns) {
      setFont(doc, col.key === 'name' ? TEXT_DK : rowTextColor, 7, col.key === 'name' || col.key === 'worst' || col.key === 'driver' ? 'bold' : 'normal');
      doc.text(String(values[col.key]), cx + 2, y + rowH * 0.68);
      cx += col.w;
    }
    y += rowH;
  });

  return y;
}

// config: the object built by cookIslandsScenarioService.js's
// buildScenarioComparisonBriefConfig({ scenarios, recommendedId, vesselLabelFor })
// -- already-derived decisions and vessel labels, nothing left to compute
// here. timeDisplayZone is a display concern, not part of that pure-data
// config, so it's a separate argument (matches
// buildCookIslandsRouteAdvisoryPdfDoc's own top-level timeDisplayZone param).
//
// Split from exportCookIslandsScenarioComparisonPdf below for the same
// reason as the route exporter: tests can inspect the built jsPDF document
// without needing a browser's download machinery.
export async function buildCookIslandsScenarioComparisonPdfDoc(config, { timeDisplayZone = 'Pacific/Rarotonga' } = {}) {
  const scenarioComparison = config?.scenarioComparison;
  const scenarios = Array.isArray(scenarioComparison?.scenarios) ? scenarioComparison.scenarios : [];
  if (scenarios.length === 0) {
    throw new Error('No scenario comparison data to export.');
  }
  const recommendedId = scenarioComparison.recommendedId ?? null;
  const generatedAt = scenarioComparison.generatedAt ? new Date(scenarioComparison.generatedAt) : new Date();

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setProperties({
    title: 'Cook Islands Scenario Comparison Advisory Brief',
    subject: 'Vessel route scenario comparison',
    creator: 'Cook Islands Ocean Dashboard',
    author: 'Pacific Community (SPC)',
  });
  doc.setLanguage('en');

  drawHeaderBand(doc, {
    title: 'Cook Islands Scenario Comparison Advisory Brief',
    subtitle: `${scenarios.length} scenario${scenarios.length === 1 ? '' : 's'} compared`,
    rightLine1: `Generated ${formatEta(generatedAt, timeDisplayZone)} ${tzLabel(timeDisplayZone)}`,
  });

  let y = HDR_H + 8;
  const cardH = 30;
  const cardGap = 4;
  for (const scenario of scenarios) {
    drawScenarioCard(doc, 8, y, PAGE_W - 16, cardH, scenario, scenario.id === recommendedId, timeDisplayZone);
    y += cardH + cardGap;
  }

  y += 2;
  setFont(doc, TEXT_DK, 8.5, 'bold');
  doc.text('Side-by-side comparison', 8, y);
  y += 3;
  drawComparisonTable(doc, 8, y, scenarios, recommendedId);

  drawFooter(doc);

  const filename = `cook_islands_scenario_comparison_${generatedAt.toISOString().slice(0, 16).replace(/[:T]/g, '')}.pdf`;
  return { doc, filename };
}

export async function exportCookIslandsScenarioComparisonPdf(config, options) {
  const { doc, filename } = await buildCookIslandsScenarioComparisonPdfDoc(config, options);
  doc.save(filename);
  return filename;
}
