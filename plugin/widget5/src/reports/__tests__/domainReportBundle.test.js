import { buildDomainReportBundle, validateScope, planDailyPanels } from '../domainReportBundle';
import { parseRunId, zonedWallTimeToUtc, findForbiddenPhrases, stepLevel, formatLocal } from '../reportRules';

const B = { west: -160, south: -22, east: -159.5, north: -21 };
const H = 3600e3;
const T0 = Date.UTC(2026, 8, 24, 0);

const meta = { runId: '2026092312', schemaVersion: '1.0.0', forecastStart: new Date(T0), forecastEnd: new Date(T0 + 228 * H), timestepCount: 229, locations: [], vessels: {} };
const stepFor = (i, v, bounds, over = {}) => ({
  timeIndex: i, validTime: T0 + i * H, vessel: v, available: true, suitable: 60, caution: 30, warning: 10,
  counts: { suitable: 60, caution: 30, warning: 10 }, classifiedPoints: 100, eligiblePoints: 100, totalPoints: 100,
  statisticsBasis: bounds ? 'points_in_bounds' : 'full_domain', requestedBounds: bounds, appliedBounds: bounds,
  domainBounds: { west: -166, south: -22.5, east: -157, north: -8.5 }, ...over,
});
const deps = (over = {}) => ({
  fetchMeta: async () => meta,
  fetchStep: async (i, v, b) => stepFor(i, v, b),
  fetchContrast: async () => ({ timeIndex: 40, validTime: T0 + 40 * H, contrastScore: 80, suitableByVessel: {}, mostSuitableVessel: 'larger_vessels', leastSuitableVessel: 'traditional_craft' }),
  fetchMap: async (v, i, b) => ({ dataUrl: `data:image/png;base64,${v}${i}`, appliedBounds: b }),
  ...over,
});

describe('report rules', () => {
  test('parses run ids and stepLevel escalates at 20% Warning', () => {
    expect(parseRunId('2026092312').toISOString()).toBe('2026-09-23T12:00:00.000Z');
    expect(parseRunId('bad')).toBeNull();
    expect(stepLevel(20, 0)).toBe(2);
    expect(stepLevel(5, 0)).toBe(1);
    expect(stepLevel(0, 0)).toBe(0);
  });
  test('local wall time in Rarotonga (UTC-10) converts correctly', () => {
    expect(zonedWallTimeToUtc(2026, 9, 24, 12, 'Pacific/Rarotonga').toISOString()).toBe('2026-09-24T22:00:00.000Z');
    expect(formatLocal('2026-09-24T22:00:00Z')).toMatch(/12:00 CKT/);
  });
  test('forbidden phrases catch commands and assurances', () => {
    expect(findForbiddenPhrases('safe conditions for departure')).toHaveLength(1);
    expect(findForbiddenPhrases('Proceed with caution')).toHaveLength(1);
    expect(findForbiddenPhrases('Avoid this area')).toHaveLength(1);
    expect(findForbiddenPhrases('Modelled conditions exceed the Caution threshold.')).toEqual([]);
  });
});

describe('validateScope', () => {
  test('viewport with matching applied bounds is not a mismatch', () => {
    const s = validateScope({ requested: 'viewport', requestedBounds: B }, [stepFor(0, 'x', B)]);
    expect(s.mismatch).toBe(false);
    expect(s.effective).toBe('viewport');
  });
  test('viewport requested but the service reports full_domain -> mismatch, effective domain', () => {
    const s = validateScope({ requested: 'viewport', requestedBounds: B }, [stepFor(0, 'x', null)]);
    expect(s.mismatch).toBe(true);
    expect(s.effective).toBe('domain');
  });
  test('different applied bounds are a mismatch', () => {
    const s = validateScope({ requested: 'viewport', requestedBounds: B }, [stepFor(0, 'x', B, { appliedBounds: { ...B, east: -158 } })]);
    expect(s.mismatch).toBe(true);
  });
});

describe('planDailyPanels', () => {
  const common = { forecastStartMs: T0, forecastEndMs: T0 + 228 * H, stepMs: H, timeZone: 'Pacific/Rarotonga' };
  test('local-noon targets, matched to a step, with "beyond horizon" instead of guessing', () => {
    const p = planDailyPanels({ ...common, validTimeMs: T0 + 100 * H, days: 6 });
    expect(p).toHaveLength(6);
    expect(p.filter((x) => !x.beyondHorizon).map((x) => new Date(x.matchedTime).getUTCHours())).toEqual(p.filter((x) => !x.beyondHorizon).map(() => 22));
    expect(p.some((x) => x.beyondHorizon)).toBe(true);
    expect(p.filter((x) => x.beyondHorizon).every((x) => x.timeIndex === null && x.matchedTime === null)).toBe(true);
  });
});

describe('buildDomainReportBundle', () => {
  const base = { vessel: 'small_craft', timeIndex: 10, bounds: B, scope: 'viewport', timeDisplayZone: 'Pacific/Rarotonga', now: () => new Date('2026-09-24T02:00:00Z') };

  test('current-time bundle carries provenance, scope and coverage', async () => {
    const b = await buildDomainReportBundle({ ...base, horizonHours: 0 }, deps());
    expect(b.modelRun.time.toISOString()).toBe('2026-09-23T12:00:00.000Z');
    expect(b.modelRun.ageHours).toBeCloseTo(14);
    expect(b.scope.effective).toBe('viewport');
    expect(b.scope.mismatch).toBe(false);
    expect(b.coverage.points).toEqual({ classified: 100, eligible: 100, total: 100 });
    expect(b.timeSeries).toBeNull();
    expect(b.maps.selected.dataUrl).toMatch(/^data:image/);
    expect(b.warnings).toEqual([]);
  });

  test('a scope mismatch is reported and the effective scope is what the service used', async () => {
    const b = await buildDomainReportBundle({ ...base, horizonHours: 0 }, deps({ fetchStep: async (i, v) => stepFor(i, v, null) }));
    expect(b.scope.mismatch).toBe(true);
    expect(b.scope.effective).toBe('domain');
    expect(b.warnings.join(' ')).toMatch(/differs from the request/);
  });

  test('a map drawn at a different extent is dropped, and with no fallback screenshot the export is blocked', async () => {
    // Regression: this used to return a bundle with maps.selected === null and a
    // warning, which the renderer turned into a page 1 with a blank map frame --
    // a polished-looking but broken PDF. Blocking here means the analyst sees an
    // error instead of distributing that.
    const badMapDeps = deps({ fetchMap: async () => ({ dataUrl: 'data:x', appliedBounds: { ...B, east: -150 } }) });
    await expect(buildDomainReportBundle({ ...base, horizonHours: 0 }, badMapDeps))
      .rejects.toMatchObject({ name: 'ReportExportBlockedError', message: expect.stringMatching(/report not generated/i) });
  });

  test('the same dropped map falls back to an on-screen screenshot when one is supplied', async () => {
    const badMapDeps = deps({ fetchMap: async () => ({ dataUrl: 'data:x', appliedBounds: { ...B, east: -150 } }) });
    const b = await buildDomainReportBundle({ ...base, horizonHours: 0, fallbackMapDataUrl: 'data:image/png;base64,fallback' }, badMapDeps);
    expect(b.maps.selected).toEqual({ dataUrl: 'data:image/png;base64,fallback', appliedBounds: null, fallback: true });
    expect(b.limitations.join(' ')).toMatch(/screenshot of the on-screen map/);
  });

  // x-classified-cells === 0: a real PNG the service rendered, correct bounds, but
  // nothing on-mesh fell inside it -- visually blank without a decoding error or a
  // bounds mismatch to catch it any other way.
  test('a map reporting zero classified cells is treated as empty and blocks export', async () => {
    const emptyMapDeps = deps({ fetchMap: async (v, i, b) => ({ dataUrl: 'data:x', appliedBounds: b, classifiedCells: 0 }) });
    await expect(buildDomainReportBundle({ ...base, horizonHours: 0 }, emptyMapDeps))
      .rejects.toMatchObject({ name: 'ReportExportBlockedError', message: expect.stringMatching(/no classified data|empty map/i) });
  });

  // Older/unpatched deployments won't send x-classified-cells at all -- undefined
  // must read as "unknown", not "empty", so this stays additive.
  test('a map with no classified-cells signal (older deployment) is not treated as empty', async () => {
    const b = await buildDomainReportBundle({ ...base, horizonHours: 0 }, deps());
    expect(b.maps.selected.dataUrl).toMatch(/^data:image/);
  });

  test('no map view falls back to the whole domain, with a warning', async () => {
    const b = await buildDomainReportBundle({ ...base, bounds: null, horizonHours: 0 }, deps());
    expect(b.scope.requested).toBe('domain');
    expect(b.warnings.join(' ')).toMatch(/whole forecast domain was used/);
  });

  test('an outlook builds series, analysis, contrast panels and daily panels; failed steps are gaps', async () => {
    let calls = 0;
    const b = await buildDomainReportBundle({ ...base, timeIndex: 100, horizonHours: 168 }, deps({
      fetchStep: async (i, v, bnd) => { calls += 1; if (v === 'small_craft' && i === 112) throw new Error('boom'); return stepFor(i, v, bnd, i > 130 && i < 140 ? { warning: 40, caution: 20, suitable: 40 } : {}); },
    }));
    const series = b.timeSeries.byVessel.small_craft;
    expect(series[0].timeIndex).toBe(100);
    expect(series.find((s) => s.timeIndex === 112).available).toBe(false);
    expect(b.timeSeries.analysis.small_craft.unavailable).toHaveLength(1);
    expect(b.timeSeries.analysis.small_craft.elevated.length).toBeGreaterThan(0);
    expect(b.maps.contrast.panels).toHaveLength(4);
    expect(b.maps.daily).toHaveLength(6);
    expect(b.maps.daily.some((p) => p.beyondHorizon)).toBe(true);
    expect(calls).toBeGreaterThan(100);
    expect(b.warnings.join(' ')).toMatch(/could not be assessed/);
  });

  test('a zero-point step is an unavailable gap, never Suitable', async () => {
    const b = await buildDomainReportBundle({ ...base, horizonHours: 72 }, deps({
      fetchStep: async (i, v, bnd) => stepFor(i, v, bnd, v === 'small_craft' ? { available: false, suitable: null, caution: null, warning: null, classifiedPoints: 0, eligiblePoints: 0, totalPoints: 0 } : {}),
    }));
    expect(b.timeSeries.byVessel.small_craft.every((s) => s.available === false)).toBe(true);
    expect(b.timeSeries.analysis.small_craft.best).toBeNull();
  });

  test('abort is surfaced as a cancellation, not a partial report', async () => {
    const ac = new AbortController();
    await expect(buildDomainReportBundle({ ...base, horizonHours: 168, signal: ac.signal }, deps({
      fetchStep: async () => { ac.abort(); const e = new Error('x'); e.name = 'AbortError'; throw e; },
    }))).rejects.toThrow();
  });
});

describe('optional backend provenance fields', () => {
  const base = { vessel: 'small_craft', timeIndex: 10, bounds: B, scope: 'viewport', horizonHours: 0, now: () => new Date('2026-09-24T02:00:00Z') };
  test('uses run_id and methodology_version from the statistics when the service provides them', async () => {
    const b = await buildDomainReportBundle(base, deps({ fetchStep: async (i, v, bnd) => stepFor(i, v, bnd, { runId: '2026092312', methodologyVersion: 'cok-suitability-v2' }) }));
    expect(b.methodology.methodologyVersion).toBe('cok-suitability-v2');
    expect(b.modelRun.runId).toBe('2026092312');
  });
  test('warns when the statistics and the run metadata disagree on the model run (forecast updated mid-build)', async () => {
    const b = await buildDomainReportBundle(base, deps({ fetchStep: async (i, v, bnd) => stepFor(i, v, bnd, { runId: '2026092400' }) }));
    expect(b.warnings.join(' ')).toMatch(/forecast may have updated/);
    expect(b.modelRun.time.toISOString()).toBe('2026-09-24T00:00:00.000Z');
  });
});

describe('bulk outlook series', () => {
  const base = { vessel: 'small_craft', timeIndex: 100, bounds: B, scope: 'viewport', horizonHours: 72, now: () => new Date('2026-09-24T02:00:00Z') };
  // The requested grid for timeIndex 100 + 72 h at a 6 h stride: 13 slots.
  const GRID = Array.from({ length: 13 }, (_, k) => 100 + k * 6);
  const bulkSteps = (v, idxs = GRID) => idxs.map((i) => ({ ...stepFor(i, v, B), suitable: 70, caution: 20, warning: 10 }));
  const codes = ['traditional_craft', 'very_small_motorised_craft', 'small_craft', 'larger_vessels'];

  test('uses ONE bulk request instead of vessels x steps single requests', async () => {
    const fetchStep = jest.fn(async (i, v, bnd) => stepFor(i, v, bnd));
    const fetchSeries = jest.fn(async () => ({ vessels: Object.fromEntries(codes.map((c) => [c, bulkSteps(c)])) }));
    const b = await buildDomainReportBundle(base, deps({ fetchStep, fetchSeries }));
    expect(fetchSeries).toHaveBeenCalledTimes(1);
    expect(b.timeSeries.byVessel.small_craft).toHaveLength(13);
    expect(b.timeSeries.analysis.small_craft.coverage.ratio).toBe(1);
    // single-step calls remain only for the current time (4 vessels) + contrast + daily panels, not the outlook grid
    expect(fetchStep.mock.calls.length).toBeLessThan(25);
  });

  test('falls back to per-step requests when the bulk endpoint is not deployed', async () => {
    const fetchSeries = jest.fn(async () => { const e = new Error('HTTP 404'); e.status = 404; throw e; });
    const b = await buildDomainReportBundle(base, deps({ fetchSeries }));
    expect(b.timeSeries.byVessel.small_craft.length).toBeGreaterThan(4);
    expect(b.timeSeries.byVessel.small_craft.every((s) => s.available)).toBe(true);
  });

  test('a bulk response missing a vessel is treated as unusable (fallback), not partially trusted', async () => {
    const fetchSeries = jest.fn(async () => ({ vessels: { small_craft: bulkSteps('small_craft') } }));
    const b = await buildDomainReportBundle(base, deps({ fetchSeries }));
    expect(b.timeSeries.byVessel.traditional_craft.length).toBeGreaterThan(0);
  });
});

describe('bulk outlook: fails closed on incomplete or foreign data', () => {
  const base = { vessel: 'small_craft', timeIndex: 100, bounds: B, scope: 'viewport', horizonHours: 72, now: () => new Date('2026-09-24T02:00:00Z') };
  const GRID = Array.from({ length: 13 }, (_, k) => 100 + k * 6);
  const codes = ['traditional_craft', 'very_small_motorised_craft', 'small_craft', 'larger_vessels'];
  const mk = (v, idxs, over = {}) => idxs.map((i) => ({ ...stepFor(i, v, B), suitable: 70, caution: 20, warning: 10, ...over }));
  const seriesOf = (idxs, over) => async () => ({ vessels: Object.fromEntries(codes.map((c) => [c, mk(c, idxs, over)])) });

  test('a truncated bulk response keeps the requested grid: omitted timestamps are gaps, never dropped', async () => {
    const b = await buildDomainReportBundle(base, deps({ fetchSeries: seriesOf(GRID.slice(0, 4)) }));
    const s = b.timeSeries.byVessel.small_craft;
    expect(s.map((x) => x.timeIndex)).toEqual(GRID);
    expect(s.filter((x) => x.available)).toHaveLength(4);
    expect(s.filter((x) => !x.available)).toHaveLength(9);
    expect(b.timeSeries.analysis.small_craft.coverage).toEqual(expect.objectContaining({ total: 13, available: 4 }));
    expect(b.warnings.join(' ')).toMatch(/9 outlook time step\(s\).*Unavailable/);
  });

  test('low coverage withholds the best window instead of reporting a window (or "none")', async () => {
    const b = await buildDomainReportBundle(base, deps({ fetchSeries: seriesOf(GRID.slice(0, 4), { caution: 0, warning: 0, suitable: 100 }) }));
    const an = b.timeSeries.analysis.small_craft;
    expect(an.bestWithheld).toBe(true);
    expect(an.best).toBeNull();
  });

  test('adequate coverage (>= 80%) still produces a best window', async () => {
    const b = await buildDomainReportBundle(base, deps({ fetchSeries: seriesOf(GRID, { caution: 0, warning: 0, suitable: 100 }) }));
    const an = b.timeSeries.analysis.small_craft;
    expect(an.bestWithheld).toBe(false);
    expect(an.best.steps).toBe(13);
  });

  test('a bulk step missing its caution/warning shares is unavailable, not Suitable with zeros', async () => {
    const { fetchSummarySeries } = jest.requireActual('../suitabilityReportService');
    const originalFetch = global.fetch;
    const body = {
      statistics_basis: 'points_in_bounds', requested_bounds: { lon_min: B.west, lat_min: B.south, lon_max: B.east, lat_max: B.north }, applied_bounds: { lon_min: B.west, lat_min: B.south, lon_max: B.east, lat_max: B.north },
      vessels: { small_craft: [
        { time_index: 100, valid_time: '2026-09-24T00:00:00Z', classified_points: 50, counts: {}, percentages: { suitable: 100 } },
        { time_index: 106, valid_time: '2026-09-24T06:00:00Z', classified_points: 50, counts: {}, percentages: { suitable: 70, caution: 20, warning: 10 } },
      ] },
    };
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) }));
    try {
      const out = await fetchSummarySeries(B, { startIndex: 100, endIndex: 106, stride: 6 });
      expect(out.vessels.small_craft[0].available).toBe(false);
      expect(out.vessels.small_craft[0].caution).toBeNull();
      expect(out.vessels.small_craft[1].available).toBe(true);
    } finally { global.fetch = originalFetch; }
  });

  test('an outlook that describes a different area from the headline is omitted, with the reason stated', async () => {
    // headline: viewport (matching bounds); outlook: whole domain (endpoint ignored the viewport).
    const foreign = async () => ({ vessels: Object.fromEntries(codes.map((c) => [c, GRID.map((i) => ({ ...stepFor(i, c, null), suitable: 70, caution: 20, warning: 10 }))])) });
    const b = await buildDomainReportBundle(base, deps({ fetchSeries: foreign }));
    expect(b.timeSeries.byVessel.small_craft.every((x) => !x.available)).toBe(true);
    expect(b.warnings.join(' ')).toMatch(/outlook was omitted: its statistics describe a different area/);
  });

  test('an outlook on the same basis as the headline is kept even when that basis is a fallback', async () => {
    const domainStep = (i, v) => ({ ...stepFor(i, v, null), suitable: 70, caution: 20, warning: 10 });
    const b = await buildDomainReportBundle(base, deps({
      fetchStep: async (i, v) => domainStep(i, v),
      fetchSeries: async () => ({ vessels: Object.fromEntries(codes.map((c) => [c, GRID.map((i) => domainStep(i, c))])) }),
    }));
    expect(b.scope.mismatch).toBe(true); // headline already flagged as whole-domain
    expect(b.timeSeries.byVessel.small_craft.every((x) => x.available)).toBe(true);
    expect(b.warnings.join(' ')).not.toMatch(/outlook was omitted/);
  });
});

describe('flat-summary time semantics', () => {
  test('uses model_run_time and reports the hindcast hours before the run', async () => {
    const m = { ...meta, runId: null, modelRunTime: new Date('2026-09-23T12:00:00Z'), methodologyVersion: 'cok-suitability-live-v1', hindcastHoursBeforeRun: 48 };
    const b = await buildDomainReportBundle({ vessel: 'small_craft', timeIndex: 10, bounds: B, scope: 'viewport', horizonHours: 0, now: () => new Date('2026-09-24T02:00:00Z') }, deps({ fetchMeta: async () => m }));
    expect(b.modelRun.time.toISOString()).toBe('2026-09-23T12:00:00.000Z');
    expect(b.methodology.methodologyVersion).toBe('cok-suitability-live-v1');
    expect(b.forecastWindow.hindcastHoursBeforeRun).toBe(48);
  });
});
