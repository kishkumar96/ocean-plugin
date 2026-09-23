// jsPDF itself is loaded via dynamic import inside CookIslandsRouteAdvisoryPdf.js
// specifically so these pure-logic helpers stay unit-testable in plain
// jsdom (jsPDF's Node build pulls in a PNG decoder chain needing
// TextEncoder/TextDecoder, which CRA's default jsdom test environment
// doesn't provide) -- see that file's header comment. The actual PDF
// build/save path is exercised separately via a real headless browser, not
// here.
import {
  formatNumber,
  formatEta,
  routeAvailableSamples,
  getWorstRouteSample,
  findWorstRun,
  routeOperationalRecommendation,
  routeThresholdText,
  customEnvelopeNoteText,
  buildCookIslandsRouteAdvisoryPdfDoc,
} from '../CookIslandsRouteAdvisoryPdf';

describe('formatNumber', () => {
  test('formats a finite number to the given precision', () => {
    expect(formatNumber(16.643, 1)).toBe('16.6');
    expect(formatNumber(8, 0)).toBe('8');
  });

  // Regression: Number(null) is 0 (finite), so a naive
  // Number.isFinite(Number(value)) check would silently turn an explicitly
  // unavailable reading into a fabricated "0.0" in the PDF.
  test('renders null/undefined as an em dash, not 0', () => {
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
  });

  test('renders a non-numeric value as an em dash', () => {
    expect(formatNumber('not a number')).toBe('—');
  });
});

describe('formatEta', () => {
  test('formats a valid ISO timestamp in the given zone', () => {
    const out = formatEta('2026-08-31T06:00:00Z', 'UTC');
    expect(out).toMatch(/31 Aug/);
    expect(out).toMatch(/06:00/);
  });

  test('falls back gracefully for an invalid date', () => {
    expect(formatEta('not-a-date', 'UTC')).toBe('—');
  });
});

describe('routeAvailableSamples / getWorstRouteSample', () => {
  const samples = [
    { sample_index: 0, hazard_class: 0, eta: '2026-08-31T06:00:00Z', available: true },
    { sample_index: 1, hazard_class: 2, eta: '2026-08-31T06:30:00Z', available: true },
    { sample_index: 2, hazard_class: null, eta: '2026-08-31T07:00:00Z', available: false },
    { sample_index: 3, hazard_class: 2, eta: '2026-08-31T06:15:00Z', available: true },
  ];

  test('excludes unavailable/null-hazard samples', () => {
    expect(routeAvailableSamples(samples)).toHaveLength(3);
  });

  test('picks the highest-hazard sample, tie-broken by earliest eta', () => {
    const worst = getWorstRouteSample(samples);
    // Both index 1 and 3 are hazard_class 2; index 3's eta (06:15) is
    // earlier than index 1's (06:30), so it should win the tie-break.
    expect(worst.sample_index).toBe(3);
  });

  test('returns null when every sample is unavailable', () => {
    expect(getWorstRouteSample([{ hazard_class: null, available: false }])).toBeNull();
  });
});

describe('findWorstRun', () => {
  test('finds the longest run at the worst hazard level', () => {
    const samples = [
      { hazard_class: 0, eta: '2026-08-31T06:00:00Z', available: true },
      { hazard_class: 2, eta: '2026-08-31T06:15:00Z', available: true },
      { hazard_class: 2, eta: '2026-08-31T06:30:00Z', available: true },
      { hazard_class: 1, eta: '2026-08-31T06:45:00Z', available: true },
      { hazard_class: 2, eta: '2026-08-31T07:00:00Z', available: true },
    ];
    const run = findWorstRun(samples);
    expect(run.hazard).toBe(2);
    expect(run.startTime).toBe('2026-08-31T06:15:00Z');
    expect(run.endTime).toBe('2026-08-31T06:30:00Z'); // the 2-long run, not the isolated single sample at 07:00
  });

  test('returns null when there are no available samples', () => {
    expect(findWorstRun([{ hazard_class: null, available: false }])).toBeNull();
  });
});

describe('routeOperationalRecommendation', () => {
  test('reports unavailable when no hazard data exists', () => {
    expect(routeOperationalRecommendation({ hazardAvailable: false })).toMatch(/unavailable/i);
  });

  test('recommends proceeding for an all-clear route', () => {
    expect(routeOperationalRecommendation({ hazardAvailable: true, hazard: 0 })).toMatch(/proceed/i);
  });

  test('recommends caution with a time window for hazard 1', () => {
    const text = routeOperationalRecommendation({
      hazardAvailable: true, hazard: 1,
      worstRun: { startTime: '2026-08-31T06:00:00Z', endTime: '2026-08-31T06:30:00Z' },
      timeDisplayZone: 'UTC',
    });
    expect(text).toMatch(/caution/i);
    expect(text).toMatch(/between/i);
  });

  test('recommends delaying departure for hazard 2', () => {
    const text = routeOperationalRecommendation({ hazardAvailable: true, hazard: 2 });
    expect(text).toMatch(/delay departure/i);
  });
});

describe('routeThresholdText', () => {
  test('describes a known vessel class\'s thresholds', () => {
    const text = routeThresholdText('small_craft');
    expect(text).toMatch(/Caution from/);
    expect(text).toMatch(/Warning from/);
  });

  test('reports unavailable thresholds for an unknown vessel', () => {
    expect(routeThresholdText('bogus_vessel')).toMatch(/unavailable/i);
  });
});

describe('customEnvelopeNoteText', () => {
  test('is null when the map is on the preset', () => {
    expect(customEnvelopeNoteText(null)).toBeNull();
  });

  test('is null for an incomplete envelope rather than printing NaN', () => {
    expect(customEnvelopeNoteText({ cautionWindKt: 10 })).toBeNull();
  });

  test('states the custom values and that the route used the preset', () => {
    const text = customEnvelopeNoteText({
      cautionWindKt: 8, maxWindKt: 30, cautionWaveHeightM: 0.4, maxWaveHeightM: 4,
    });
    expect(text).toMatch(/custom thresholds/i);
    expect(text).toMatch(/8 kt/);
    expect(text).toMatch(/preset thresholds/i);
  });
});

// Real jsPDF can't load here -- its Node build pulls in fast-png/iobuffer,
// which need TextEncoder/TextDecoder that this project's jsdom test env
// doesn't provide (confirmed directly: importing the real 'jspdf' package
// in this suite throws "ReferenceError: TextEncoder is not defined" from
// node_modules/iobuffer/src/text.ts). A minimal fake stands in instead,
// recording each text() draw against whichever page is "current" when
// addPage() was last called -- enough to prove drawSampleTablePages()'s
// actual page-break control flow puts a footer on every page, not just
// page 1 and the last one, without needing a browser to run the real
// PDF renderer.
jest.mock('jspdf', () => {
  class FakePdfDoc {
    constructor(opts = {}) {
      this.pages = [[]];
      this._pageIndex = 0;
      // A4, mm -- landscape swaps the dimensions, matching real jsPDF, so a
      // report built with orientation: 'landscape' sees the wider page its
      // drawHeaderBand()/drawFooter() calls now ask doc.internal.pageSize
      // for directly, rather than assuming the portrait PAGE_W constant.
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

describe('buildCookIslandsRouteAdvisoryPdfDoc pagination', () => {
  const DISCLAIMER_SNIPPET = 'not navigation advice';

  function makeSamples(count) {
    return Array.from({ length: count }, (_, i) => ({
      sample_index: i,
      eta: new Date(Date.UTC(2026, 7, 31, 6, 0, 0) + i * 15 * 60 * 1000).toISOString(),
      distance_nm: i * 0.5,
      hazard_class: i % 3,
      hazard_label: ['Suitable', 'Caution', 'Warning'][i % 3],
      wave_height_m: 1.2,
      wind_speed_kt: 14,
      lat: -21.2 + i * 0.001,
      lon: -159.78 - i * 0.001,
      available: true,
    }));
  }

  // rowH=6mm, headerH=7mm, page height 297mm, bottomMargin=12mm -> roughly
  // 43 rows fit per table page. 120 samples forces the table across at
  // least 3 pages (page 2, 3, 4), so this actually exercises a page that's
  // neither the first nor the last -- exactly the case the bug lost.
  test('every page gets the model disclaimer footer, including pages in the middle of a multi-page table', async () => {
    const result = {
      departure_time: '2026-08-31T06:00:00Z',
      samples: makeSamples(120),
      summary: { distance_nm: 60, duration_hours: 8, worst_hazard_class: 2, recommendation: 'Warning' },
    };

    const { doc } = await buildCookIslandsRouteAdvisoryPdfDoc({ result, vessel: 'small_craft', speedKt: 8 });

    expect(doc.pages.length).toBeGreaterThanOrEqual(4); // page 1 + at least 3 table pages
    doc.pages.forEach((pageTexts, pageIndex) => {
      const hasDisclaimer = pageTexts.some((t) => t.includes(DISCLAIMER_SNIPPET));
      expect(hasDisclaimer).toBe(true);
      if (!hasDisclaimer) throw new Error(`Page ${pageIndex + 1} of ${doc.pages.length} is missing the footer disclaimer`);
    });
  });

  test('a single-page table (no page breaks) still gets exactly one footer on page 1 and one on the table page', async () => {
    const result = {
      departure_time: '2026-08-31T06:00:00Z',
      samples: makeSamples(5),
      summary: { distance_nm: 2, duration_hours: 0.5, worst_hazard_class: 0, recommendation: 'Suitable' },
    };

    const { doc } = await buildCookIslandsRouteAdvisoryPdfDoc({ result, vessel: 'small_craft', speedKt: 8 });

    expect(doc.pages).toHaveLength(2);
    const disclaimerCount = (pageTexts) => pageTexts.filter((t) => t.includes(DISCLAIMER_SNIPPET)).length;
    expect(disclaimerCount(doc.pages[0])).toBe(1);
    expect(disclaimerCount(doc.pages[1])).toBe(1);
  });

  test('the route sketch is captioned as schematic, not presented as a navigational map', async () => {
    const result = {
      departure_time: '2026-08-31T06:00:00Z',
      samples: makeSamples(5),
      summary: { distance_nm: 2, duration_hours: 0.5, worst_hazard_class: 0, recommendation: 'Suitable' },
    };
    const { doc } = await buildCookIslandsRouteAdvisoryPdfDoc({ result, vessel: 'small_craft', speedKt: 8 });
    const text = doc.pages[0].join(' | ');
    expect(text).toMatch(/schematic/i);
    expect(text).toMatch(/not for navigation/i);
  });

  describe('forecast provenance', () => {
    const result = {
      departure_time: '2026-08-31T06:00:00Z',
      samples: makeSamples(5),
      summary: { distance_nm: 2, duration_hours: 0.5, worst_hazard_class: 0, recommendation: 'Suitable' },
    };

    test('reports the authoritative model-run time and source endpoint when one is supplied', async () => {
      const { doc } = await buildCookIslandsRouteAdvisoryPdfDoc({
        result, vessel: 'small_craft', speedKt: 8, timeDisplayZone: 'UTC',
        modelRunStart: new Date('2026-08-31T00:00:00Z'),
      });
      const text = doc.pages[0].join(' | ');
      expect(text).toMatch(/Model run: 31 Aug/);
      expect(text).toMatch(/00:00/);
      expect(text).toMatch(/\/cok\/suitability\/route/);
      expect(text).not.toMatch(/unavailable/i);
    });

    // No model-run time to give (e.g. the wave layer's own timestamps
    // haven't loaded yet) must say so explicitly, not just omit the line --
    // silently dropping it would look identical to "this forecast has no
    // model run", which isn't true.
    test('says explicitly when no model-run time is available, rather than omitting the line', async () => {
      const { doc } = await buildCookIslandsRouteAdvisoryPdfDoc({
        result, vessel: 'small_craft', speedKt: 8, timeDisplayZone: 'UTC', modelRunStart: null,
      });
      const text = doc.pages[0].join(' | ');
      expect(text).toMatch(/Model run: unavailable/);
    });
  });
});
