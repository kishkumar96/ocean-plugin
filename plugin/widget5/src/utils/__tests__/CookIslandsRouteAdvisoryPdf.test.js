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
