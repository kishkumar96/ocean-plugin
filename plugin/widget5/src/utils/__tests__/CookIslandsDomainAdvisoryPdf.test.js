import { domainFinding, hasVesselData, domainHazard } from '../CookIslandsDomainAdvisoryPdf';
import { fetchCookIslandsSuitabilitySummary } from '../../services/cookIslandsSuitabilitySummaryService';

jest.mock('jspdf', () => ({ jsPDF: class {} }));

const step = (over = {}) => ({ available: true, suitable: 100, caution: 0, warning: 0, ...over });

describe('hasVesselData', () => {
  test('an unavailable / zero-point step is "no data", not "all suitable"', () => {
    expect(hasVesselData(step({ available: false, suitable: null, caution: null, warning: null }))).toBe(false);
    expect(hasVesselData(undefined)).toBe(false);
    expect(hasVesselData(step())).toBe(true);
  });
});

describe('domainFinding', () => {
  const label = 'Small craft';
  test('no data never claims safe conditions', () => {
    const text = domainFinding({ label, data: step({ available: false, warning: null, caution: null }) });
    expect(text).toMatch(/No model data/);
    expect(text).not.toMatch(/safe/i);
  });

  test('a small Warning share stays explicit rather than being reported as caution', () => {
    const text = domainFinding({ label, data: step({ warning: 10, caution: 0 }) });
    expect(text).toMatch(/10% Warning-level/);
    expect(text).toMatch(/Modelled/);
    expect(domainHazard(10, 0)).toBe(1);
  });

  test('reports Warning and Caution together, and <1% for tiny non-zero shares', () => {
    expect(domainFinding({ label, data: step({ warning: 5, caution: 30 }) })).toMatch(/30% Caution and 5% Warning-level/);
    expect(domainFinding({ label, data: step({ warning: 0.2, caution: 0 }) })).toMatch(/<1%/);
  });

  test('>= 20% Warning escalates and still states the Caution share', () => {
    expect(domainFinding({ label, data: step({ warning: 25, caution: 10 }) })).toMatch(/10% Caution and 25% of assessed points are Warning-level/);
  });

  test('no exceedances uses non-directive wording', () => {
    const text = domainFinding({ label, data: step() });
    expect(text).toMatch(/No modelled threshold exceedances were identified/);
    expect(text).not.toMatch(/safe conditions for departure/);
  });
});

describe('legacy summary service statisticsBasis', () => {
  afterEach(() => { delete global.fetch; });
  const bounds = { west: -160, south: -22, east: -159, north: -21 };

  test('is "viewport" when the bounds-scoped backend endpoint answers', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ percentages: { warning: 1, caution: 2 }, total_points: 9 }) }));
    expect((await fetchCookIslandsSuitabilitySummary(0, bounds)).statisticsBasis).toBe('viewport');
  });

  test('is "domain" when no bounds were sent, or the points fallback was used', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ percentages: {}, total_points: 3 }) }));
    expect((await fetchCookIslandsSuitabilitySummary(0, null)).statisticsBasis).toBe('domain');

    global.fetch = jest.fn((url) => (String(url).includes('/summary/')
      ? Promise.resolve({ ok: false, status: 404 })
      : Promise.resolve({ ok: true, json: () => Promise.resolve({ features: [{ properties: { vessel_class: 'small_craft', hazard_class: 1 } }] }) })));
    const out = await fetchCookIslandsSuitabilitySummary(0, bounds);
    expect(out.statisticsBasis).toBe('domain');
    expect(out.vessels.small_craft.point_count).toBe(1);
  });
});

// Standard PDF fonts (Helvetica) have no glyphs outside WinAnsi: "≥" and "★" print as
// garbage (seen in a real render: "Hs ≥ 0.5" came out as `Hs "e 0.5`). Keep the PDF
// generators' drawn strings within Latin-1 + common typographic punctuation.
describe('PDF generators only draw characters the standard font can render', () => {
  const fs = require('fs');
  const path = require('path');
  const files = ['CookIslandsDomainAdvisoryPdf.js', 'CookIslandsScenarioComparisonPdf.js', 'CookIslandsLandingAreaComparisonPdf.js', 'CookIslandsRouteAdvisoryPdf.js', 'advisoryPdfPrimitives.js', 'CookIslandsLandingSiteAdvisoryPdf.js', 'CookIslandsCommsPosterPdf.js', 'CookIslandsImpactInundationPdf.js'];
  const bad = /[^\t -ÿ–—‘’“”•…]/;
  test.each(files)('%s', (file) => {
    const lines = fs.readFileSync(path.join(__dirname, '..', file), 'utf8').split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    const offenders = lines.filter((l) => bad.test(l.replace(/\/\/.*$/, '')));
    expect(offenders).toEqual([]);
  });
});

// Shared editorial rules (reports/reportRules.js): no report may tell the reader what to do
// or assure them; hazard language is "modelled" guidance.
describe('PDF generators follow the shared editorial rules', () => {
  const fs = require('fs');
  const path = require('path');
  const { findForbiddenPhrases } = require('../../reports/reportRules');
  const files = ['utils/CookIslandsDomainAdvisoryPdf.js', 'utils/CookIslandsScenarioComparisonPdf.js', 'utils/CookIslandsLandingAreaComparisonPdf.js', 'utils/CookIslandsLandingSiteAdvisoryPdf.js', 'utils/CookIslandsRouteAdvisoryPdf.js', 'utils/CookIslandsCommsPosterPdf.js', 'utils/CookIslandsImpactInundationPdf.js', 'reports/domainReportBundle.js', 'reports/landingSiteReportBundle.js'];
  test.each(files)('%s has no forbidden phrases in drawn text', (file) => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8').split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\/\/.*$/, ''));
    const hits = src.flatMap((l) => findForbiddenPhrases(l).map((p) => `${p}: ${l.trim()}`));
    expect(hits).toEqual([]);
  });
});

describe('communications poster', () => {
  const { posterVesselSentence, renderCookIslandsCommsPosterPdfDoc } = require('../CookIslandsCommsPosterPdf');
  test('vessel sentences are modelled, non-directive, and never call missing data suitable', () => {
    expect(posterVesselSentence({ available: false, warning: null, caution: null })).toMatch(/No model data/);
    expect(posterVesselSentence(step({ warning: 30, caution: 10 }))).toMatch(/exceed the Warning threshold at 30%/);
    expect(posterVesselSentence(step({ warning: 0, caution: 12 }))).toMatch(/Caution at 12% and Warning at 0%/);
    expect(posterVesselSentence(step())).toMatch(/No modelled threshold exceedances/);
  });
  test('refuses to render without an outlook', async () => {
    await expect(renderCookIslandsCommsPosterPdfDoc({ timeSeries: null })).rejects.toThrow(/needs an outlook/);
  });
});

// One shared theme (pdfTheme.js): report modules must not carry their own palette or page
// furniture, so the PDFs cannot drift apart visually again.
describe('PDF reports use the shared theme', () => {
  const fs = require('fs');
  const path = require('path');
  const reports = ['CookIslandsDomainAdvisoryPdf.js', 'CookIslandsScenarioComparisonPdf.js', 'CookIslandsLandingAreaComparisonPdf.js', 'CookIslandsLandingSiteAdvisoryPdf.js', 'CookIslandsRouteAdvisoryPdf.js', 'CookIslandsCommsPosterPdf.js', 'CookIslandsImpactInundationPdf.js'];
  test.each(reports)('%s defines no palette or header/footer of its own', (file) => {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    expect(src).not.toMatch(/^(export )?const (HEADER_BG|PAGE_BG|HAZARD_LIGHT|HAZARD_TEXT|GRID_CLR)\s*=/m);
    expect(src).not.toMatch(/^(export )?function (drawHeaderBand|drawFooter)\b/m);
  });
  test.each(reports.filter((f) => f !== 'CookIslandsCommsPosterPdf.js'))('%s renders A4 landscape', (file) => {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    expect(src).toMatch(/orientation: 'landscape'/);
    expect(src).not.toMatch(/orientation: 'portrait'/);
  });
});
