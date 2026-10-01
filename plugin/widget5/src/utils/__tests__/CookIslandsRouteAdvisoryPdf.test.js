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
  computeExceedance,
  selectRouteTableRows,
  routeOperationalRecommendation,
  routeThresholdText,
  customEnvelopeNoteText,
  buildCookIslandsRouteAdvisoryPdfDoc,
  routeEvidence,
  nearbyIslandsForRouteSketch,
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

  // Regression: filtering unavailable samples out before scanning for runs
  // silently deleted the gap, so two separate hazard=2 periods either side
  // of an out-of-domain stretch reported as one continuous run spanning
  // the whole thing -- implying danger through a period the model said
  // nothing about.
  test('a gap of unavailable samples ends the run instead of bridging it', () => {
    const samples = [
      { hazard_class: 2, eta: '2026-08-31T06:00:00Z', available: true },
      { hazard_class: 2, eta: '2026-08-31T06:15:00Z', available: true },
      { hazard_class: null, eta: '2026-08-31T06:30:00Z', available: false },
      { hazard_class: null, eta: '2026-08-31T06:45:00Z', available: false },
      { hazard_class: 2, eta: '2026-08-31T07:00:00Z', available: true },
      { hazard_class: 2, eta: '2026-08-31T07:15:00Z', available: true },
      { hazard_class: 2, eta: '2026-08-31T07:30:00Z', available: true },
    ];
    const run = findWorstRun(samples);
    // The second run (3 samples) is longer than the first (2 samples) --
    // if the gap were silently bridged, this would instead report one
    // 5-sample run from 06:00 to 07:30.
    expect(run.hazard).toBe(2);
    expect(run.startTime).toBe('2026-08-31T07:00:00Z');
    expect(run.endTime).toBe('2026-08-31T07:30:00Z');
  });

  test('a lower-hazard sample and a gap both end a run the same way', () => {
    const samples = [
      { hazard_class: 1, eta: '2026-08-31T06:00:00Z', available: true },
      { hazard_class: 1, eta: '2026-08-31T06:15:00Z', available: true },
      { hazard_class: 1, eta: '2026-08-31T06:30:00Z', available: true },
      { hazard_class: null, eta: '2026-08-31T06:45:00Z', available: false },
      { hazard_class: 1, eta: '2026-08-31T07:00:00Z', available: true },
    ];
    const run = findWorstRun(samples);
    // Worst hazard is 1 either way; the first (3-long) run must win on
    // length over the isolated single sample after the gap.
    expect(run.hazard).toBe(1);
    expect(run.startTime).toBe('2026-08-31T06:00:00Z');
    expect(run.endTime).toBe('2026-08-31T06:30:00Z');
  });
});

describe('routeOperationalRecommendation', () => {
  test('reports unavailable when no hazard data exists', () => {
    expect(routeOperationalRecommendation({ hazardAvailable: false })).toMatch(/unavailable/i);
  });

  test('rates an all-clear route as suitable, not a command to proceed', () => {
    const text = routeOperationalRecommendation({ hazardAvailable: true, hazard: 0 });
    expect(text).toMatch(/suitable/i);
    // Regression: this used to read "Proceed within the assessed departure
    // window" -- an operational command this model has no authority to
    // give. Every branch is now framed as a rating, not an instruction.
    expect(text).not.toMatch(/^proceed/i);
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

  test('describes the exceeded envelope and suggests, rather than orders, delaying departure', () => {
    const text = routeOperationalRecommendation({ hazardAvailable: true, hazard: 2 });
    expect(text).toMatch(/exceed/i);
    expect(text).toMatch(/consider delaying/i);
    // Regression: this used to open with the bare command "Delay
    // departure" -- same reasoning as the hazard-0 case above.
    expect(text).not.toMatch(/^delay departure/i);
  });

  // Regression: a route assessed at 41% coverage used to still print "consider
  // delaying departure" with full authority -- a hazard reading from under
  // MIN_COVERAGE isn't grounds for a route-wide instruction either way.
  test('withholds a recommendation below MIN_COVERAGE even when the assessed slice is Warning', () => {
    const text = routeOperationalRecommendation({
      hazardAvailable: true, hazard: 2, coverage: { confidence: 'insufficient', ratio: 0.41 },
    });
    expect(text).toMatch(/assessment incomplete/i);
    expect(text).toMatch(/41%/);
    expect(text).toMatch(/warning-level conditions occur within the assessed portion/i);
    expect(text).not.toMatch(/consider delaying/i);
  });

  test('withholds a Suitable rating below MIN_COVERAGE too -- absence of hazard isn\'t confirmed', () => {
    const text = routeOperationalRecommendation({
      hazardAvailable: true, hazard: 0, coverage: { confidence: 'insufficient', ratio: 0.3 },
    });
    expect(text).toMatch(/assessment incomplete/i);
    expect(text).not.toMatch(/suitable/i);
  });
});

// Real coordinates from config/islandConfig.js -- Rarotonga's centre is roughly
// -21.24, -159.78; Penrhyn (Northern Group) is roughly -9.0, -158.0.
describe('nearbyIslandsForRouteSketch', () => {
  test('includes an island whose centre falls within the route bbox', () => {
    const bbox = { lonMin: -160.5, lonMax: -159.0, latMin: -21.6, latMax: -20.9 };
    const labels = nearbyIslandsForRouteSketch(bbox).map((i) => i.label);
    expect(labels).toContain('Rarotonga');
    // Regression: this used to always be empty (the sketch had no island data at
    // all) -- a route box this size should pick up its one nearby named island,
    // not the whole 15-island list regardless of where the route actually is.
    expect(labels).not.toContain('Penrhyn');
  });

  test('a route through open ocean far from any named island returns none', () => {
    const bbox = { lonMin: -170.2, lonMax: -170.0, latMin: -15.1, latMax: -14.9 };
    expect(nearbyIslandsForRouteSketch(bbox)).toEqual([]);
  });
});

// small_craft's real thresholds (src/lib/vesselThresholds.generated.json):
// cautionWindKt 15, maxWindKt 20, cautionWaveHeightM 1.5, maxWaveHeightM 2.0.
describe('computeExceedance', () => {
  test('wind-driven caution: reports the wind exceedance above the caution threshold', () => {
    const result = computeExceedance('small_craft', { wind_speed_kt: 17, wave_height_m: 0.5, hazard_class: 1 });
    expect(result.driver).toBe('wind');
    expect(result.unit).toBe('kt');
    expect(result.amount).toBeCloseTo(2, 5); // 17 - 15 (caution, since hazard_class is 1 not 2)
  });

  test('wave-driven warning: reports the wave exceedance above the warning (not caution) threshold', () => {
    const result = computeExceedance('small_craft', { wind_speed_kt: 5, wave_height_m: 2.5, hazard_class: 2 });
    expect(result.driver).toBe('waves');
    expect(result.unit).toBe('m');
    expect(result.amount).toBeCloseTo(0.5, 5); // 2.5 - 2.0 (warning, since hazard_class is 2)
  });

  test('returns null when neither parameter crosses a threshold', () => {
    expect(computeExceedance('small_craft', { wind_speed_kt: 5, wave_height_m: 0.5, hazard_class: 0 })).toBeNull();
  });

  test('returns null for an unknown vessel', () => {
    expect(computeExceedance('bogus_vessel', { wind_speed_kt: 30, wave_height_m: 3, hazard_class: 2 })).toBeNull();
  });

  test('returns null for a sample with non-finite readings', () => {
    expect(computeExceedance('small_craft', { wind_speed_kt: null, wave_height_m: 2.5, hazard_class: 2 })).toBeNull();
  });
});

describe('selectRouteTableRows', () => {
  function makeIndexedSamples(count) {
    return Array.from({ length: count }, (_, i) => ({
      sample_index: i,
      eta: new Date(Date.UTC(2026, 7, 31, 6, 0, 0) + i * 15 * 60 * 1000).toISOString(),
      hazard_class: 0,
      wind_speed_kt: 5,
      wave_height_m: 0.5,
      available: true,
    }));
  }

  test('returns every sample unchanged when already at or under the row budget', () => {
    const samples = makeIndexedSamples(10);
    expect(selectRouteTableRows(samples, 14)).toEqual(samples);
  });

  test('curates down to at most maxRows, always keeping the first, last, and worst-hazard sample', () => {
    const samples = makeIndexedSamples(50);
    samples[27].hazard_class = 2; // the one sample that should always survive curation
    const rows = selectRouteTableRows(samples, 14);

    expect(rows.length).toBeLessThanOrEqual(14);
    expect(rows[0].sample_index).toBe(0);
    expect(rows[rows.length - 1].sample_index).toBe(49);
    expect(rows.some((r) => r.sample_index === 27)).toBe(true);
    // Rows stay in original route order (not e.g. worst-first) -- a table
    // is read top-to-bottom as "along the route", not "by severity".
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].sample_index).toBeGreaterThan(rows[i - 1].sample_index);
    }
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
    triangle() {}
    line() {}
    setLineDashPattern() {}
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
  // Text unique to the shared footer line (page 1 also carries its own, larger notice box
  // that says "not navigation advice"), so this still counts footers, not notices.
  const DISCLAIMER_SNIPPET = 'SWAN wave model guidance';

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

  // The route sample table is curated (selectRouteTableRows), not dumped --
  // unlike the old design, a large sample count no longer forces the report
  // past 2 pages at all. This replaces the old "many pages, footer on every
  // one" pagination test, whose premise (an unbounded multi-page table) no
  // longer exists in the new fixed page-1/page-2 layout.
  test('a large sample count still produces exactly 2 pages, both with the footer, and the table shows it curated the rows', async () => {
    const result = {
      departure_time: '2026-08-31T06:00:00Z',
      samples: makeSamples(120),
      summary: { distance_nm: 60, duration_hours: 8, worst_hazard_class: 2, recommendation: 'Warning' },
    };

    const { doc } = await buildCookIslandsRouteAdvisoryPdfDoc({ result, vessel: 'small_craft', speedKt: 8 });

    expect(doc.pages).toHaveLength(2);
    doc.pages.forEach((pageTexts, pageIndex) => {
      const hasDisclaimer = pageTexts.some((t) => t.includes(DISCLAIMER_SNIPPET));
      expect(hasDisclaimer).toBe(true);
      if (!hasDisclaimer) throw new Error(`Page ${pageIndex + 1} of ${doc.pages.length} is missing the footer disclaimer`);
    });
    const page2Text = doc.pages[1].join(' | ');
    expect(page2Text).toMatch(/Showing \d+ of 120 samples/);
  });

  test('prints a SUPERSEDED notice only when the result is superseded', async () => {
    const result = {
      departure_time: '2026-08-31T06:00:00Z', samples: makeSamples(5),
      summary: { distance_nm: 2, duration_hours: 0.5, worst_hazard_class: 1, recommendation: 'Caution' },
    };
    const all = (doc) => doc.pages.map((p) => p.join(' | ')).join(' | ');
    const fresh = await buildCookIslandsRouteAdvisoryPdfDoc({ result, vessel: 'small_craft', speedKt: 8 });
    const stale = await buildCookIslandsRouteAdvisoryPdfDoc({ result, vessel: 'small_craft', speedKt: 8, superseded: true });
    expect(all(fresh.doc)).not.toMatch(/SUPERSEDED/);
    expect(all(stale.doc)).toMatch(/SUPERSEDED: a newer forecast run was available/);
  });

  test('a worst sample with a missing wind/wave reading gets no primary driver instead of a zero-substituted one', async () => {
    const samples = makeSamples(4).map((smp) => ({ ...smp, hazard_class: 1, wind_speed_kt: null }));
    const result = {
      departure_time: '2026-08-31T06:00:00Z', samples,
      summary: { distance_nm: 2, duration_hours: 0.5, worst_hazard_class: 1, recommendation: 'Caution' },
    };
    const { doc } = await buildCookIslandsRouteAdvisoryPdfDoc({ result, vessel: 'small_craft', speedKt: 8 });
    const text = doc.pages[0].join(' | ');
    expect(text).not.toMatch(/Waves|Wind & waves/);
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
      // Provenance moved to page 2 (supporting evidence) in the landscape
      // rebuild -- page 1 is now the decision brief only.
      const text = doc.pages[1].join(' | ');
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
      const text = doc.pages[1].join(' | ');
      expect(text).toMatch(/Model run: unavailable/);
    });
  });
});

describe('routeEvidence', () => {
  const at = (m) => new Date(Date.UTC(2026, 8, 24, 0, m)).toISOString();
  const smp = (i, hc, available = true) => ({ eta: at(i * 15), hazard_class: hc, available });
  const now = new Date(Date.UTC(2026, 8, 24, 2, 0));

  test('coverage, cadence, age and separate Caution/Warning shares of assessed samples', () => {
    const samples = [smp(0, 0), smp(1, 1), smp(2, 2), smp(3, 2), smp(4, null, false)];
    const ev = routeEvidence({ samples, departureTime: at(0), modelRunStart: '2026-09-23T12:00:00Z', generatedAt: now });
    expect(ev.available).toBe(4);
    expect(ev.total).toBe(5);
    expect(ev.confidence).toBe('reduced'); // 80%
    expect(ev.intervalMin).toBe(15);
    expect(ev.forecastAgeHours).toBeCloseTo(14);
    expect(ev.cautionPercent).toBeCloseTo(25);
    expect(ev.warningPercent).toBeCloseTo(50);
  });

  test('flags a departure that has already passed, and low coverage as insufficient', () => {
    const ev = routeEvidence({ samples: [smp(0, 0), smp(1, null, false), smp(2, null, false)], departureTime: at(0), generatedAt: now });
    expect(ev.departurePassed).toBe(true);
    expect(ev.confidence).toBe('insufficient');
    expect(routeEvidence({ samples: [smp(0, 0)], departureTime: '2026-09-25T00:00:00Z', generatedAt: now }).departurePassed).toBe(false);
  });

  test('an empty route is insufficient and has no shares', () => {
    const ev = routeEvidence({ samples: [], generatedAt: now });
    expect(ev.confidence).toBe('insufficient');
    expect(ev.warningPercent).toBeNull();
  });

  test('the PDF prints coverage confidence, cadence and a passed-departure notice', async () => {
    const samples = Array.from({ length: 6 }, (_, i) => ({ sample_index: i, eta: at(i * 15), distance_nm: i, hazard_class: i % 2, hazard_label: 'x', wave_height_m: 1, wind_speed_kt: 10, lat: -21 + i * 0.01, lon: -159.8, available: true }));
    const { doc } = await buildCookIslandsRouteAdvisoryPdfDoc({
      result: { departure_time: at(0), samples, summary: { distance_nm: 5, duration_hours: 1, worst_hazard_class: 1 } },
      vessel: 'small_craft', speedKt: 8, modelRunStart: '2026-09-23T12:00:00Z', startLabel: 'Avarua', destinationLabel: 'Aitutaki',
    });
    const text = doc.pages[0].join(' | ');
    expect(text).toMatch(/Coverage: high — 6 of 6 samples assessed/);
    expect(text).toMatch(/about every 15 min/);
    expect(text).toMatch(/Departure time has already passed/);
    expect(text).toMatch(/Avarua to Aitutaki/);
  });
});

describe('route report departure suggestion', () => {
  test('states the modelled improvement when the server search found a better departure', async () => {
    const samples = Array.from({ length: 4 }, (_, i) => ({ sample_index: i, eta: new Date(Date.UTC(2026, 8, 24, 0, i * 15)).toISOString(), distance_nm: i, lat: -21, lon: -159.8, hazard_class: 1, hazard_label: 'Caution', wave_height_m: 1, wind_speed_kt: 16, available: true }));
    const { doc } = await buildCookIslandsRouteAdvisoryPdfDoc({
      result: { departure_time: '2026-09-25T00:00:00Z', samples, summary: { distance_nm: 3, duration_hours: 1, worst_hazard_class: 1 } },
      vessel: 'small_craft', speedKt: 8,
      departureSuggestion: { departureTime: '2026-09-25T21:00:00Z', requested: { caution_percent: 64, warning_percent: 0 }, best: { caution_percent: 9, warning_percent: 0 } },
    });
    const text = doc.pages[0].join(' | ');
    expect(text).toMatch(/A later departure \(.*\) may find better modelled conditions/);
    expect(text).toMatch(/64% at the requested time, 9% then/);
  });
});

describe('route advisory: critical point, midpoint conditions, legends, notice', () => {
  const LIVE = [
    { sample_index: 0, eta: '2026-09-30T00:00:00Z', distance_nm: 0, lat: -10.85, lon: -165.85, wind_speed_kt: 20.9, wave_height_m: 0.24, hazard_class: 2, available: true },
    { sample_index: 1, eta: '2026-09-30T02:00:00Z', distance_nm: 25, lat: -11.2, lon: -165.6, wind_speed_kt: 22.4, wave_height_m: 3.19, hazard_class: 2, available: true },
    { sample_index: 2, eta: '2026-09-30T04:00:00Z', distance_nm: 52, lat: -11.55, lon: -165.42, wind_speed_kt: 21.0, wave_height_m: 2.6, hazard_class: 2, available: true },
  ];
  const result = { departure_time: '2026-09-30T00:00:00Z', samples: LIVE, summary: { distance_nm: 52, duration_hours: 6.5, worst_hazard_class: 2, recommendation: 'Warning' } };
  const mc = {
    lat: -11.176, lon: -165.634, headingDeg: 151, etaIso: '2026-09-30T02:00:00Z', validTime: '2026-09-30T02:00:00Z', waveRunStart: '2026-09-30T00:00:00Z',
    hsM: 3.0, tpS: 9.2, dirDeg: 125, dirPoint: 'SE', angleOffBowDeg: 26, angleText: 'Head seas',
    windSea: { hsM: 2.9, tpS: 9.1, dirDeg: 126, dirPoint: 'SE' }, primarySwell: { hsM: 0.9, tpS: 11.4, dirDeg: 184, dirPoint: 'S' },
  };
  const page = async (extra, n = 0) => {
    const { doc } = await buildCookIslandsRouteAdvisoryPdfDoc({ result, vessel: 'small_craft', speedKt: 8, ...extra });
    return doc.pages[n].join(' | ');
  };

  test('the critical point panel reports the offshore 3.19 m sample, not the departure sample', async () => {
    const text = await page({});
    expect(text).toMatch(/Wave 3\.19 m/);
    expect(text).toMatch(/25\.0 nm along route/);
    expect(text).not.toMatch(/0\.0 nm along route/);
  });

  test('midpoint panel: height, period, direction, bow angle, swell and wind sea at the vessel ETA', async () => {
    const text = await page({ midpointConditions: mc });
    expect(text).toMatch(/MIDPOINT WAVE CONDITIONS/);
    expect(text).toMatch(/Wave height 3\.00 m/);
    expect(text).toMatch(/Peak period 9\.2 s/);
    expect(text).toMatch(/waves from SE 125°/);
    expect(text).toMatch(/Head seas \(26° off the bow\)/);
    expect(text).toMatch(/Primary swell 0\.90 m at 11\.4 s from S/);
    expect(text).toMatch(/Wind sea 2\.90 m at 9\.1 s from SE/);
    expect(text).toMatch(/where waves come FROM|waves come FROM/);
  });

  test('midpoint conditions: null = stated as unavailable; undefined = nothing said', async () => {
    expect(await page({ midpointConditions: null })).toMatch(/Midpoint wave conditions \(period, direction, swell\) were unavailable/);
    const absent = await page({});
    expect(absent).not.toMatch(/MIDPOINT WAVE CONDITIONS/);
    expect(absent).not.toMatch(/were unavailable when this advisory/);
  });

  test('page 1 carries an explicit legend for markers and colours, and timeline end labels', async () => {
    const text = await page({});
    ['Departure', 'Destination', 'Critical point', 'Suitable', 'Caution', 'Warning', 'No data'].forEach((w) => expect(text).toContain(w));
  });

  test('page 1 has a readable notice stating it is modelled guidance and where thresholds come from', async () => {
    const text = await page({});
    expect(text).toMatch(/Modelled guidance only/);
    expect(text).toMatch(/no approving authority, version or effective date is recorded/);
  });

  test('page 2 plots wave thresholds as well as wind ones, and records the wave feed run', async () => {
    const text = await page({ midpointConditions: mc }, 1);
    expect(text).toMatch(/Caution \/ Warning: wind \(left axis\)/);
    expect(text).toMatch(/Caution \/ Warning: waves \(right axis\)/);
    expect(text).toMatch(/Midpoint wave feed: run starts/);
    expect(text).toMatch(/no approving authority/);
  });

  test('the recommended wording stays advisory (no forbidden instruction phrases)', async () => {
    const all = `${await page({ midpointConditions: mc })} ${await page({ midpointConditions: mc }, 1)}`;
    expect(all).not.toMatch(/safe to (depart|sail|go|proceed)|\bproceed\b|do not depart|\bavoid\b|all clear/i);
  });
});
