// CookIslandsScenarioComparisonPdf.js
// Generates the "Scenario Comparison Advisory Brief" PDF from a
// buildScenarioComparisonBriefConfig() config (cookIslandsScenarioService.js), wired to
// CookIslandsScenarioComparisonPanel.jsx's "Generate Scenario Comparison Brief" button.
//
// Same visual theme as every other Widget 5 PDF (pdfTheme.js): A4 landscape, light page, navy
// header with cyan accent, white cards, hazard-tinted recommendation banner, shared footer.
// One page: a banner naming the recommendation (or that none is eligible), a card per compared
// scenario (vessel/speed/departure, model run, worst hazard, separate Suitable/Caution/Warning
// shares, coverage, mini hazard timeline), the side-by-side table, then notices (mixed model
// runs, different route geometry, superseded scenarios) and the ranking rationale.
import {
  MARGIN, HDR_H, HEADER_BG, TEXT_LT, TEXT_MD, TEXT_DK, NO_DATA_GREY, PAGE_W,
  hazardColor, hazardText, hazardLabel, setFont, setFill, rect,
  formatNumber, formatEta, drawHeaderBand, drawFooter, card, banner, notice, fitText, drawHazardShareBar,
  ensureReportFont,
} from './pdfTheme';
import { tzLabel } from './timeZoneFormat';
import { ROUTE_HAZARD_LABELS } from '../services/cookIslandsRouteForecastService';
import { driverLabel, MIN_RECOMMEND_COVERAGE } from '../services/cookIslandsScenarioService';
import { formatUtc } from '../reports/reportRules';

const MIN_SCENARIOS = 2;
const CW = PAGE_W - 2 * MARGIN;
const ACCENT_BORDER = [0, 150, 190];

const coveragePercent = (decision) => (decision?.totalSamples
  ? Math.round((100 * (decision.totalSamples - (decision.unavailableSamples ?? 0))) / decision.totalSamples)
  : null);

function drawScenarioCard(doc, x, y, w, h, scenario, isRecommended, timeDisplayZone) {
  const decision = scenario.decision;
  const hazardAvailable = Number.isFinite(decision?.worstHazardClass);
  card(doc, x, y, w, h, isRecommended ? { border: ACCENT_BORDER, lw: 0.8 } : {});
  if (hazardAvailable) { setFill(doc, hazardColor(decision.worstHazardClass)); doc.rect(x, y, 3, h, 'F'); }

  const tx = x + 6;
  const tw = w - 10;
  setFont(doc, TEXT_DK, 9, 'bold');
  doc.text(fitText(doc, scenario.name + (isRecommended ? '  - RECOMMENDED' : ''), tw), tx, y + 7);

  setFont(doc, TEXT_MD, 6.6);
  doc.text(fitText(doc, `${scenario.vesselLabel} · ${formatNumber(Number(scenario.speedKt), 1)} kt`, tw), tx, y + 12.5);
  doc.text(fitText(doc, `Depart ${formatEta(scenario.departureTime, timeDisplayZone)} ${tzLabel(timeDisplayZone)}`, tw), tx, y + 16.5);
  setFont(doc, TEXT_MD, 6.1, 'italic');
  doc.text(
    doc.splitTextToSize(`Model run: ${scenario.modelRunStartAtRun ? formatUtc(scenario.modelRunStartAtRun) : 'not recorded'}${scenario.superseded ? ' · SUPERSEDED by a newer run' : ''}`, tw),
    tx, y + 20.5,
  );

  setFont(doc, hazardAvailable ? hazardText(decision.worstHazardClass) : TEXT_MD, 8.5, 'bold');
  doc.text(
    fitText(doc, hazardAvailable
      ? `${ROUTE_HAZARD_LABELS[decision.worstHazardClass] ?? 'Unknown'} · ${driverLabel(decision.primaryDriver)}`
      : (scenario.status === 'error' ? (scenario.error || 'Failed') : 'No result'), tw),
    tx, y + 30,
  );

  if (hazardAvailable) {
    // separate Suitable / Caution / Warning shares as a bar plus text
    drawHazardShareBar(doc, tx, y + 33, tw, 3.6, [[0, decision.suitablePercent], [1, decision.cautionPercent], [2, decision.warningPercent]]);
    setFont(doc, TEXT_MD, 6.4);
    doc.text(fitText(doc, `Suitable ${formatNumber(decision.suitablePercent, 0)}% · Caution ${formatNumber(decision.cautionPercent, 0)}% · Warning ${formatNumber(decision.warningPercent, 0)}%`, tw), tx, y + 41);
    const total = decision.totalSamples ?? 0;
    const avail = total - (decision.unavailableSamples ?? 0);
    doc.text(fitText(doc, `Coverage ${total ? `${Math.round((100 * avail) / total)}% (${avail} of ${total} samples)` : '—'}`, tw), tx, y + 45.5);
    if (scenario.insufficientCoverage) { setFont(doc, hazardText(1), 6.4, 'bold'); doc.text('INSUFFICIENT COVERAGE', tx, y + 50); }
    setFont(doc, TEXT_MD, 6.4);
    doc.text(`Duration ${formatNumber(decision.durationHours, 1)} h`, tx + tw, y + 50, { align: 'right' });
  }
  // Mini hazard timeline along the route (grey = unavailable)
  const tl = scenario.timeline ?? [];
  if (tl.length) {
    const cw = tw / tl.length;
    tl.forEach((hc, i) => { rect(doc, tx + i * cw, y + h - 7, cw + 0.05, 3.4, hc === null ? NO_DATA_GREY : hazardColor(hc)); });
  }
}

function drawComparisonTable(doc, x, y, scenarios, recommendedId) {
  const columns = [
    { key: 'name', label: 'Scenario', w: 62 },
    { key: 'worst', label: 'Worst', w: 32 },
    { key: 'suitable', label: 'Suitable', w: 28 },
    { key: 'caution', label: 'Caution', w: 28 },
    { key: 'warning', label: 'Warning', w: 28 },
    { key: 'coverage', label: 'Coverage', w: 40 },
    { key: 'duration', label: 'Duration', w: 30 },
    { key: 'driver', label: 'Driver', w: 33 },
  ];
  const tableW = columns.reduce((sum, c) => sum + c.w, 0);
  const rowH = 7;
  const headerH = 7;

  rect(doc, x, y, tableW, headerH, HEADER_BG);
  setFont(doc, TEXT_LT, 7, 'bold');
  let cx = x;
  for (const col of columns) { doc.text(col.label, cx + 2, y + headerH * 0.65); cx += col.w; }
  y += headerH;

  scenarios.forEach((scenario, index) => {
    const decision = scenario.decision;
    const hazardAvailable = Number.isFinite(decision?.worstHazardClass);
    const isRecommended = scenario.id === recommendedId;
    rect(doc, x, y, tableW, rowH, index % 2 === 1 ? [246, 248, 250] : [255, 255, 255]);
    const rowTextColor = hazardAvailable ? hazardText(decision.worstHazardClass) : TEXT_MD;
    const cov = coveragePercent(decision);
    const values = {
      name: scenario.name + (isRecommended ? ' *' : ''),
      worst: hazardAvailable ? (ROUTE_HAZARD_LABELS[decision.worstHazardClass] ?? '—') : '—',
      suitable: hazardAvailable ? `${formatNumber(decision.suitablePercent, 0)}%` : '—',
      caution: hazardAvailable ? `${formatNumber(decision.cautionPercent, 0)}%` : '—',
      warning: hazardAvailable ? `${formatNumber(decision.warningPercent, 0)}%` : '—',
      coverage: cov === null ? '—' : `${cov}%${scenario.insufficientCoverage ? ' !' : ''}`,
      duration: hazardAvailable ? `${formatNumber(decision.durationHours, 1)} h` : '—',
      driver: hazardAvailable ? driverLabel(decision.primaryDriver) : '—',
    };
    cx = x;
    for (const col of columns) {
      setFont(doc, col.key === 'name' ? TEXT_DK : rowTextColor, 7, col.key === 'name' || col.key === 'worst' || col.key === 'driver' ? 'bold' : 'normal');
      doc.text(fitText(doc, String(values[col.key]), col.w - 3), cx + 2, y + rowH * 0.68);
      cx += col.w;
    }
    y += rowH;
  });
  return y;
}

// config: the object built by cookIslandsScenarioService.js's
// buildScenarioComparisonBriefConfig({ scenarios, recommendedId, vesselLabelFor }) -- already-derived
// decisions and vessel labels. timeDisplayZone is a display concern, so it is a separate argument.
// Split from exportCookIslandsScenarioComparisonPdf so tests can inspect the built jsPDF document
// without a browser's download machinery.
export async function buildCookIslandsScenarioComparisonPdfDoc(config, { timeDisplayZone = 'Pacific/Rarotonga' } = {}) {
  const scenarioComparison = config?.scenarioComparison;
  const scenarios = Array.isArray(scenarioComparison?.scenarios) ? scenarioComparison.scenarios : [];
  if (scenarios.length === 0) {
    throw new Error('No scenario comparison data to export.');
  }
  if (scenarios.length < MIN_SCENARIOS) {
    throw new Error(`A comparison needs at least ${MIN_SCENARIOS} ready scenarios (found ${scenarios.length}).`);
  }
  const recommendedId = scenarioComparison.recommendedId ?? null;
  const consistency = scenarioComparison.consistency ?? null;
  const generatedAt = scenarioComparison.generatedAt ? new Date(scenarioComparison.generatedAt) : new Date();

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  await ensureReportFont(doc);
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
    rightLine2: 'Page 1 of 1',
  });

  const rec = scenarios.find((s) => s.id === recommendedId);
  const recDecision = rec?.decision;
  const recCov = coveragePercent(recDecision);
  banner(doc, {
    y: HDR_H + 4,
    hazard: rec && Number.isFinite(recDecision?.worstHazardClass) ? recDecision.worstHazardClass : null,
    text: rec && recDecision
      ? `${rec.name} is the recommended scenario: modelled worst hazard ${hazardLabel(recDecision.worstHazardClass)}${recCov !== null ? `, ${recCov}% of route samples assessed` : ''}.`
      : 'No scenario has sufficient coverage, so none is recommended.',
    h: 9.5,
  });

  // Scenario cards
  let y = HDR_H + 16;
  const cols = Math.min(scenarios.length, 4);
  const gap = 5;
  const cardW = (CW - gap * (cols - 1)) / cols;
  const cardH = 58;
  scenarios.forEach((scenario, i) => {
    const row = Math.floor(i / cols);
    drawScenarioCard(doc, MARGIN + (i % cols) * (cardW + gap), y + row * (cardH + gap), cardW, cardH, scenario, scenario.id === recommendedId, timeDisplayZone);
  });
  y += Math.ceil(scenarios.length / cols) * (cardH + gap) + 1;

  setFont(doc, TEXT_DK, 8.5, 'bold');
  doc.text('Side-by-side comparison', MARGIN, y + 3);
  const tableEndY = drawComparisonTable(doc, MARGIN, y + 6, scenarios, recommendedId);

  let ny = tableEndY + 5;
  // Notices: anything that makes the scenarios not like-for-like.
  const notices = [];
  if (consistency?.modelRunsDiffer) notices.push(`These scenarios come from different forecast runs (${consistency.distinctModelRuns.map(formatUtc).join('; ')}); re-run them together before comparing.`);
  if (consistency?.unknownModelRunCount) notices.push(`${consistency.unknownModelRunCount} scenario(s) have no recorded model run.`);
  if (consistency && !consistency.geometryConsistent) notices.push('These scenarios use different route geometry, so hazard differences may reflect the route, not the vessel or departure.');
  if (scenarios.some((s) => s.superseded)) notices.push('One or more scenarios were computed from a superseded model run and are included at your request.');
  if (notices.length) ny += notice(doc, { x: MARGIN, y: ny, w: CW, text: `Notice: ${notices.join(' ')}` }) + 3;

  const anyInsufficient = scenarios.some((s) => s.insufficientCoverage);
  const rationale = rec && recDecision
    ? `Why ${rec.name} is recommended: it has the lowest modelled worst hazard (${ROUTE_HAZARD_LABELS[recDecision.worstHazardClass] ?? '—'}) among scenarios with sufficient coverage, `
      + `with ${formatNumber(recDecision.cautionPercent, 0)}% Caution and ${formatNumber(recDecision.warningPercent, 0)}% Warning of assessed samples. `
    : '';
  setFont(doc, TEXT_MD, 6.6, 'italic');
  doc.text(
    doc.splitTextToSize(
      rationale
      + 'Ranking order: lowest worst hazard class among scenarios with at least '
      + `${Math.round(MIN_RECOMMEND_COVERAGE * 100)}% of route samples available, then lowest Caution+Warning share, `
      + 'fewest unavailable samples, shortest duration. Recommended scenarios are marked *. '
      + (anyInsufficient ? '“!” / INSUFFICIENT COVERAGE marks scenarios below that coverage: they are shown but not eligible. ' : '')
      + (recommendedId ? '' : 'No scenario has sufficient coverage, so none is recommended. ')
      + 'Coverage = share of route samples with a model value. Bars under each scenario show the modelled hazard along the route (grey = unavailable).',
      CW,
    ),
    MARGIN, ny,
  );

  drawFooter(doc);

  const filename = `cook_islands_scenario_comparison_${generatedAt.toISOString().slice(0, 16).replace(/[:T]/g, '')}.pdf`;
  return { doc, filename };
}

export async function exportCookIslandsScenarioComparisonPdf(config, options) {
  const { doc, filename } = await buildCookIslandsScenarioComparisonPdfDoc(config, options);
  doc.save(filename);
  return filename;
}
