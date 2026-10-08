import { selectHeatmapSteps, findMatchingStep } from '../heatmapSteps';

describe('selectHeatmapSteps', () => {
  test('returns empty for empty input', () => {
    expect(selectHeatmapSteps([])).toEqual([]);
  });

  test('returns a single entry for a one-step series', () => {
    const out = selectHeatmapSteps([{ time_index: 0, valid_time: '2026-09-20T00:00:00Z' }]);
    expect(out).toHaveLength(1);
    expect(out[0].sourceIndex).toBe(0);
  });

  test('always includes the first and last step', () => {
    const steps = Array.from({ length: 48 }, (_, i) => ({
      time_index: i,
      time: new Date(Date.UTC(2026, 8, 20, i)).toISOString(),
    }));
    const out = selectHeatmapSteps(steps, 168);
    expect(out[0].sourceIndex).toBe(0);
    expect(out[out.length - 1].sourceIndex).toBe(47);
  });

  test('samples roughly every 12h for a 168h window', () => {
    const steps = Array.from({ length: 169 }, (_, i) => ({
      time_index: i,
      time: new Date(Date.UTC(2026, 8, 20, i)).toISOString(),
    }));
    const out = selectHeatmapSteps(steps, 168);
    // 168h / 12h = 14 intervals + first = ~15 columns, well under the raw 169.
    expect(out.length).toBeLessThan(20);
    expect(out.length).toBeGreaterThan(10);
  });

  // Regression: production data isn't pre-truncated to the requested window
  // -- useCookIslandsLandingAreaComparison fetches each site's full forecast
  // (here, ~9.5 days / 229 hourly steps, matching a real captured cycle),
  // then this function is asked for a 168h/7-day heatmap. The last column
  // used to be timeSeriesData's own raw final element regardless of the
  // window, which landed 61 hours (2.5 days) past every other column's ~12h
  // spacing -- visibly a lone outlier date on the rendered heatmap.
  test('the last column stays within the requested window even when the source series runs longer', () => {
    const steps = Array.from({ length: 229 }, (_, i) => ({
      time_index: i,
      time: new Date(Date.UTC(2026, 8, 19, 12) + i * 3_600_000).toISOString(),
    }));
    const out = selectHeatmapSteps(steps, 168);

    const firstMs = new Date(steps[0].time).getTime();
    const lastColumnMs = new Date(out[out.length - 1].time).getTime();
    const hoursFromStart = (lastColumnMs - firstMs) / 3_600_000;

    expect(hoursFromStart).toBeLessThanOrEqual(168);
    expect(out[out.length - 1].sourceIndex).not.toBe(steps.length - 1); // not the raw series' own last element
    // Consecutive columns (including the last pair) should be roughly
    // 12h apart, not the ~61h gap the bug produced.
    const secondToLastMs = new Date(out[out.length - 2].time).getTime();
    expect((lastColumnMs - secondToLastMs) / 3_600_000).toBeLessThanOrEqual(12);
  });

  // When the series doesn't exceed the window at all (the common case, and
  // what every test above already covers), the fix must be a no-op: the
  // last column should still be the series' own final element.
  test('still includes the series’ own last step when it is within the window', () => {
    const steps = Array.from({ length: 48 }, (_, i) => ({
      time_index: i,
      time: new Date(Date.UTC(2026, 8, 20, i)).toISOString(),
    }));
    const out = selectHeatmapSteps(steps, 168);
    expect(out[out.length - 1].sourceIndex).toBe(47);
  });
});

describe('findMatchingStep', () => {
  const steps = [
    { time_index: 0, valid_time: '2026-09-20T00:00:00Z', hazard_class: 0 },
    { time_index: 5, valid_time: '2026-09-20T05:00:00Z', hazard_class: 1 },
  ];

  test('matches by time_index first', () => {
    expect(findMatchingStep(steps, { time_index: 5, time: '2026-09-20T05:00:00Z' }).hazard_class).toBe(1);
  });

  test('falls back to nearest valid_time when index does not match', () => {
    const match = findMatchingStep(steps, { time_index: 99, time: '2026-09-20T04:59:00Z' });
    expect(match.hazard_class).toBe(1);
  });

  test('returns null for empty steps or a missing heatmap step', () => {
    expect(findMatchingStep([], { time_index: 0, time: '2026-09-20T00:00:00Z' })).toBeNull();
    expect(findMatchingStep(steps, null)).toBeNull();
  });
});
