import {
  resolveModelRunStart, modelRunAgeHours, isModelRunStale, hindcastHoursForLayer, COK_SUITABILITY_HINDCAST_HOURS,
} from '../modelRunTiming';

const H = 3600e3;
// The live case that exposed the bug: the suitability timeline began 27 Sept 12:00 UTC,
// the real run was 29 Sept 12:00 UTC, and "now" was 30 Sept 17:00 UTC.
const FIRST = new Date(Date.UTC(2026, 8, 27, 12));
const NOW = Date.UTC(2026, 8, 30, 17);

describe('resolveModelRunStart', () => {
  test('Cook suitability: the first timeline timestamp is 48 h BEFORE the real run', () => {
    expect(hindcastHoursForLayer('cok-suitability')).toBe(COK_SUITABILITY_HINDCAST_HOURS);
    expect(resolveModelRunStart(FIRST, 'cok-suitability').toISOString()).toBe('2026-09-29T12:00:00.000Z');
  });

  test('every other layer: the first timestamp is the run start, unchanged', () => {
    expect(resolveModelRunStart(FIRST, 'swan-rarotonga').toISOString()).toBe(FIRST.toISOString());
    expect(resolveModelRunStart(FIRST, undefined).toISOString()).toBe(FIRST.toISOString());
  });

  test('null for a missing or invalid timestamp', () => {
    expect(resolveModelRunStart(null, 'cok-suitability')).toBeNull();
    expect(resolveModelRunStart(new Date('nope'), 'cok-suitability')).toBeNull();
    expect(resolveModelRunStart('2026-09-27', 'cok-suitability')).toBeNull();
  });
});

describe('age + staleness', () => {
  test('the live run is 29 h old, not the 77 h the PDF used to print', () => {
    const start = resolveModelRunStart(FIRST, 'cok-suitability');
    expect(modelRunAgeHours(start, NOW)).toBe(29);
    // what the un-corrected first timestamp would have given:
    expect(modelRunAgeHours(FIRST, NOW)).toBe(77);
  });

  test('stale only beyond 30 h, matching the on-screen banner threshold', () => {
    expect(isModelRunStale(30)).toBe(false);
    expect(isModelRunStale(30.01)).toBe(true);
    expect(isModelRunStale(null)).toBe(false);
  });

  test('the age the banner shows equals the age the PDFs are given (same start)', () => {
    const start = resolveModelRunStart(new Date(NOW - 77 * H), 'cok-suitability');
    expect(Math.round(modelRunAgeHours(start, NOW))).toBe(29);
    expect(isModelRunStale(modelRunAgeHours(start, NOW))).toBe(false);
  });

  test('null age without a start', () => {
    expect(modelRunAgeHours(null)).toBeNull();
  });
});
