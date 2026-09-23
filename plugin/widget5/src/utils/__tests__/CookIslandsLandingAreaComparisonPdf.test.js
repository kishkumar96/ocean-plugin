// Same fake-jsPDF approach as the other PDF exporter tests in this
// directory -- real jsPDF can't load in this project's jsdom test env (see
// CookIslandsRouteAdvisoryPdf.js's header comment). This fake also needs
// getTextWidth() (used by this module's drawLegend() to lay out legend
// entries), which the other exporters' fakes don't need.
import { buildCookIslandsLandingAreaComparisonPdfDoc } from '../CookIslandsLandingAreaComparisonPdf';

jest.mock('jspdf', () => {
  class FakePdfDoc {
    constructor(opts = {}) {
      this.pages = [[]];
      this._pageIndex = 0;
      const landscape = opts.orientation === 'landscape';
      this.internal = {
        pageSize: {
          getWidth: () => (landscape ? 297 : 210),
          getHeight: () => (landscape ? 210 : 297),
        },
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
    getTextWidth(text) { return String(text).length * 1.6; }
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

function makeSite(overrides = {}) {
  return {
    id: overrides.id ?? 'site-1',
    name: overrides.name ?? 'Avatiu Harbour',
    statistics_basis: 'area_500m',
    point_count: 54,
    steps: Array.from({ length: 229 }, (_, i) => ({
      time_index: i,
      valid_time: new Date(Date.UTC(2026, 8, 19, 12) + i * 3_600_000).toISOString(),
      hazard_class: i % 3,
      point_count: 54,
    })),
    ...overrides,
  };
}

describe('buildCookIslandsLandingAreaComparisonPdfDoc', () => {
  test('throws when there is nothing to compare', async () => {
    await expect(buildCookIslandsLandingAreaComparisonPdfDoc({ rows: [] })).rejects.toThrow(/no landing area comparison data/i);
    await expect(buildCookIslandsLandingAreaComparisonPdfDoc({ rows: [{ id: 'x', name: 'Empty', steps: [] }] }))
      .rejects.toThrow(/no landing area comparison data/i);
  });

  test('is landscape, lists every site, and states the statistics basis and vessel', async () => {
    const rows = [
      makeSite({ id: 'a', name: 'Avatiu Harbour' }),
      makeSite({ id: 'b', name: 'Aroa Passage', statistics_basis: 'nearest_point_fallback' }),
    ];
    const { doc, filename } = await buildCookIslandsLandingAreaComparisonPdfDoc({
      rows, vesselLabel: 'Traditional craft', timeDisplayZone: 'UTC',
    });

    expect(doc.internal.pageSize.getWidth()).toBe(297); // landscape
    const text = doc.pages[0].join(' | ');
    expect(text).toMatch(/Landing Area Suitability Advisory Brief/);
    expect(text).toMatch(/Traditional craft/);
    expect(text).toMatch(/Avatiu Harbour/);
    expect(text).toMatch(/Aroa Passage/);
    expect(text).toMatch(/2 sites compared/);
    // Mixed statistics_basis across rows falls back to the first-priority
    // label (matches CookIslandsLandingAreaComparisonHeatmap.jsx's own
    // hasAreaBasis-wins-first priority order).
    expect(text).toMatch(/500 m area/);
    expect(text).toMatch(/not navigation advice/); // shared footer disclaimer
    expect(filename).toMatch(/^cook_islands_landing_area_comparison_.*\.pdf$/);
  });

  test('date columns stay within the 7-day window even though the underlying series runs longer (the same bug heatmapSteps.js was just fixed for)', async () => {
    const rows = [makeSite()]; // 229 hourly steps = ~9.5 days of underlying data
    const { doc } = await buildCookIslandsLandingAreaComparisonPdfDoc({ rows, timeDisplayZone: 'UTC' });
    const text = doc.pages[0].join(' | ');
    // The series starts 19 Sept and runs to ~29 Sept; a correct 7-day window
    // must not show a column dated the 28th/29th.
    expect(text).not.toMatch(/29 Sep/);
  });

  test('includes the hazard/unavailable legend', async () => {
    const rows = [makeSite()];
    const { doc } = await buildCookIslandsLandingAreaComparisonPdfDoc({ rows, timeDisplayZone: 'UTC' });
    const text = doc.pages[0].join(' | ');
    expect(text).toMatch(/Suitable/);
    expect(text).toMatch(/Caution/);
    expect(text).toMatch(/Warning/);
    expect(text).toMatch(/Unavailable/);
  });

  test('drops a site with no steps at all rather than rendering an all-unavailable row', async () => {
    const rows = [makeSite({ id: 'a', name: 'Has data' }), { id: 'b', name: 'No data at all', steps: [] }];
    const { doc } = await buildCookIslandsLandingAreaComparisonPdfDoc({ rows, timeDisplayZone: 'UTC' });
    const text = doc.pages[0].join(' | ');
    expect(text).toMatch(/Has data/);
    expect(text).not.toMatch(/No data at all/);
    expect(text).toMatch(/1 site compared/); // singular, and excludes the empty row
  });
});
