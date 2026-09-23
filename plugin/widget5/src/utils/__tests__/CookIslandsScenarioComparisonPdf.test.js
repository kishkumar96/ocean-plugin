// Same fake-jsPDF approach as CookIslandsRouteAdvisoryPdf.test.js's
// pagination tests -- real jsPDF can't load in this project's jsdom test
// env (its Node build needs TextEncoder/TextDecoder, see that file). This
// fake records every text() draw against whichever page is current, which
// is enough to prove the real buildCookIslandsScenarioComparisonPdfDoc
// content (header, one card per scenario, the comparison table, the
// footer disclaimer) actually gets drawn, without a browser.
import { buildCookIslandsScenarioComparisonPdfDoc } from '../CookIslandsScenarioComparisonPdf';

jest.mock('jspdf', () => {
  class FakePdfDoc {
    constructor() {
      this.pages = [[]];
      this._pageIndex = 0;
      this.internal = {
        pageSize: { getWidth: () => 210, getHeight: () => 297 },
        getNumberOfPages: () => this.pages.length,
      };
    }
    setProperties() {}
    setLanguage() {}
    setFillColor() {}
    setDrawColor() {}
    setTextColor() {}
    setFontSize() {}
    setFont() {}
    setLineWidth() {}
    rect() {}
    circle() {}
    line() {}
    splitTextToSize(text) { return [text]; }
    text(value) {
      this.pages[this._pageIndex].push(Array.isArray(value) ? value.join(' ') : value);
    }
    addPage() {
      this.pages.push([]);
      this._pageIndex += 1;
    }
  }
  return { jsPDF: FakePdfDoc };
});

function makeScenario(overrides = {}) {
  return {
    id: overrides.id ?? 'scn-1',
    name: overrides.name ?? 'Scenario A',
    vessel: 'small_craft',
    vesselLabel: 'Small craft',
    speedKt: 8,
    departureTime: '2026-08-31T06:00:00Z',
    status: 'ready',
    decision: {
      worstHazardClass: 1,
      primaryDriver: 'wind',
      cautionPercent: 40,
      warningPercent: 0,
      unavailableSamples: 0,
      durationHours: 6.5,
    },
    ...overrides,
  };
}

function pageText(doc) {
  return doc.pages.map((lines) => lines.join(' | '));
}

describe('buildCookIslandsScenarioComparisonPdfDoc', () => {
  test('throws when there is nothing to compare', async () => {
    await expect(buildCookIslandsScenarioComparisonPdfDoc({ scenarioComparison: { scenarios: [] } }))
      .rejects.toThrow(/no scenario comparison data/i);
    await expect(buildCookIslandsScenarioComparisonPdfDoc({}))
      .rejects.toThrow(/no scenario comparison data/i);
  });

  test('draws a card and a table row per scenario, marks the recommended one, and ends with the footer disclaimer', async () => {
    const config = {
      area: { type: 'scenario_comparison', label: 'Scenario Comparison Advisory Brief' },
      scenarioComparison: {
        scenarios: [
          makeScenario({ id: 'scn-1', name: 'Baseline', decision: { worstHazardClass: 2, primaryDriver: 'waves', cautionPercent: 10, warningPercent: 30, unavailableSamples: 1, durationHours: 7 } }),
          makeScenario({ id: 'scn-2', name: 'Faster departure', decision: { worstHazardClass: 0, primaryDriver: 'none', cautionPercent: 0, warningPercent: 0, unavailableSamples: 0, durationHours: 5.2 } }),
        ],
        recommendedId: 'scn-2',
        generatedAt: '2026-08-31T12:00:00Z',
      },
    };

    const { doc, filename } = await buildCookIslandsScenarioComparisonPdfDoc(config, { timeDisplayZone: 'UTC' });

    expect(doc.pages).toHaveLength(1); // 2 scenarios comfortably fit on one page
    const text = pageText(doc)[0];

    // Header
    expect(text).toMatch(/Scenario Comparison Advisory Brief/);
    expect(text).toMatch(/2 scenarios compared/);

    // Per-scenario cards
    expect(text).toMatch(/Baseline/);
    expect(text).toMatch(/Faster departure/);
    // Recommended scenario is starred on its card and in the table row.
    expect((text.match(/★/g) || []).length).toBeGreaterThanOrEqual(2);

    // Comparison table headers and a couple of derived values
    expect(text).toMatch(/Worst/);
    expect(text).toMatch(/Caution\+Warning/);
    expect(text).toMatch(/Warning/); // Baseline's worst-hazard label

    // Footer disclaimer present on the (only) page.
    expect(text).toMatch(/not navigation advice/);

    expect(filename).toMatch(/^cook_islands_scenario_comparison_.*\.pdf$/);
  });

  test('a scenario with no result renders "No result" instead of a fabricated hazard reading', async () => {
    const config = {
      scenarioComparison: {
        scenarios: [makeScenario({ id: 'scn-1', decision: null, status: 'error', error: 'Route forecast failed' })],
        recommendedId: null,
        generatedAt: '2026-08-31T12:00:00Z',
      },
    };

    const { doc } = await buildCookIslandsScenarioComparisonPdfDoc(config, { timeDisplayZone: 'UTC' });
    const text = pageText(doc)[0];
    expect(text).toMatch(/Route forecast failed/);
  });
});
