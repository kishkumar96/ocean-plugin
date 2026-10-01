import { buildLandingSiteReportBundle, buildLandingSiteReport } from '../landingSiteReportBundle';

const H = 3600e3;
const T0 = Date.UTC(2026, 8, 24, 0);
const mkSteps = (n, fn) => Array.from({ length: n }, (_, i) => ({ time_index: i, valid_time: new Date(T0 + i * H).toISOString(), hazard_class: fn(i), wind_speed_kt: 8 + i % 5, wave_height_m: 0.5 + (i % 4) * 0.2 }));
const site = (over = {}) => ({ id: 's1', name: 'Avatiu Harbour', lon: -159.795, lat: -21.198, type: 'landing_site', statistics_basis: 'area_500m', point_count: 54, steps: mkSteps(200, (i) => (i < 20 ? 0 : i < 30 ? 1 : i < 34 ? 2 : i < 60 ? 0 : null)), ...over });
const base = { vesselCode: 'small_craft', vesselLabel: 'Small craft', validTime: new Date(T0).toISOString(), timeDisplayZone: 'Pacific/Rarotonga', meta: { runId: '2026092312', schemaVersion: '1.0.0' }, now: () => new Date(T0 + 2 * H) };

describe('buildLandingSiteReportBundle', () => {
  test('current condition, windows and coverage come from the site steps after the valid time', () => {
    const b = buildLandingSiteReportBundle({ ...base, site: site(), rows: [site()] });
    expect(b.current.label).toBe('Suitable');
    expect(b.current.driver).toBe('none');
    expect(b.windows.warning[0].steps).toBe(4);
    expect(b.windows.caution[0].steps).toBe(10);
    // Only 60 of 169 steps (35%) were assessed: below the shared 80% bar, so no operating
    // window is named (the run of 26 clear steps would just be the longest stretch with data).
    expect(b.windows.suitableWithheld).toBe(true);
    expect(b.windows.suitable).toEqual([]);
    expect(b.timeline.coverage.total).toBe(169);
    expect(b.timeline.coverage.available).toBe(60);
    expect(b.warnings.join(' ')).toMatch(/Only 60 of 169 forecast steps/);
    expect(b.modelRun.time.toISOString()).toBe('2026-09-23T12:00:00.000Z');
  });

  test('adequate coverage (>= 80%) still names the best operating window', () => {
    // 100 steps after the valid time: 0-19 clear, 20-29 caution, 30-99 clear -> all assessed
    const steps = mkSteps(100, (i) => (i >= 20 && i < 30 ? 1 : 0));
    const b = buildLandingSiteReportBundle({ ...base, site: site({ steps }), rows: [] });
    expect(b.timeline.coverage.ratio).toBeGreaterThanOrEqual(0.8);
    expect(b.windows.suitableWithheld).toBe(false);
    expect(b.windows.suitable[0].steps).toBe(70);
  });

  test('the model run time falls back to the service model_run_time when there is no run id', () => {
    const modelRunTime = new Date('2026-09-23T12:00:00Z');
    const b = buildLandingSiteReportBundle({ ...base, meta: { runId: null, modelRunTime }, site: site(), rows: [] });
    expect(b.modelRun.time.toISOString()).toBe('2026-09-23T12:00:00.000Z');
    expect(b.modelRun.ageHours).toBeCloseTo(14, 5); // 23 Sept 12:00Z -> 24 Sept 02:00Z
    expect(b.warnings.join(' ')).not.toMatch(/model run time was not reported/);
  });

  test('warns that the run time was not reported only when neither the run id nor model_run_time gives one', () => {
    const b = buildLandingSiteReportBundle({ ...base, meta: { runId: null, modelRunTime: null }, site: site(), rows: [] });
    expect(b.modelRun.time).toBeNull();
    expect(b.warnings.join(' ')).toMatch(/model run time was not reported/);
    const bad = buildLandingSiteReportBundle({ ...base, meta: { runId: 'garbage', modelRunTime: new Date('nope') }, site: site(), rows: [] });
    expect(bad.modelRun.time).toBeNull();
  });

  test('unavailable steps are gaps, never Suitable windows', () => {
    const b = buildLandingSiteReportBundle({ ...base, site: site({ steps: mkSteps(50, () => null) }), rows: [] });
    expect(b.current.label).toBe('Unavailable');
    expect(b.windows.suitable).toEqual([]);
    expect(b.timeline.coverage.available).toBe(0);
  });

  test('a caution reading names the driver from wind/wave against the vessel thresholds', () => {
    const b = buildLandingSiteReportBundle({ ...base, site: site({ steps: mkSteps(50, () => 1).map((s) => ({ ...s, wind_speed_kt: 17, wave_height_m: 0.4 })) }), rows: [] });
    expect(b.current.driver).toBe('wind');
  });

  test('heatmap keeps per-row methods, flags mixed methods and lists omitted sites', () => {
    const rows = [site(), site({ id: 's2', name: 'Aroa', statistics_basis: 'nearest_point_fallback', point_count: 1 }), { id: 's3', name: 'Oneroa Landing', steps: [] }];
    const b = buildLandingSiteReportBundle({ ...base, site: rows[0], rows, omittedSites: ['Palmerston'] });
    expect(b.heatmap.mixedMethods).toBe(true);
    expect(b.heatmap.rows.map((r) => r.basis)).toEqual(['area_500m', 'nearest_point_fallback']);
    expect(b.heatmap.omittedSites.sort()).toEqual(['Oneroa Landing', 'Palmerston']);
    expect(b.heatmap.rows[0].isSelected).toBe(true);
  });

  test('a fallback method for the selected site is surfaced as a notice', () => {
    const b = buildLandingSiteReportBundle({ ...base, site: site({ statistics_basis: 'nearest_point_fallback' }), rows: [] });
    expect(b.warnings.join(' ')).toMatch(/Nearest model point/);
  });

  test('throws when there is nothing to report', () => {
    expect(() => buildLandingSiteReportBundle({ ...base, site: site({ steps: [] }), rows: [] })).toThrow(/No landing-site data/);
    expect(() => buildLandingSiteReportBundle({ ...base, site: null, rows: [] })).toThrow();
  });
});

describe('buildLandingSiteReport', () => {
  test('requests a map around the site and carries its bounds; a failed map is just omitted', async () => {
    const fetchMap = jest.fn(async () => ({ dataUrl: 'data:image/png;base64,AA==' }));
    const b = await buildLandingSiteReport({ ...base, meta: undefined, site: site(), rows: [site()], timeIndex: 5 }, {}, { fetchMeta: async () => ({ runId: '2026092312' }), fetchMap });
    expect(fetchMap).toHaveBeenCalledWith('small_craft', 5, expect.objectContaining({ west: expect.any(Number) }), expect.anything());
    expect(b.map.dataUrl).toMatch(/^data:image/);
    const b2 = await buildLandingSiteReport({ ...base, meta: undefined, site: site(), rows: [site()], timeIndex: 5 }, {}, { fetchMeta: async () => ({ runId: '2026092312' }), fetchMap: async () => { throw new Error('x'); } });
    expect(b2.map).toBeNull();
  });
});

describe('buildLandingSiteReport: map extent', () => {
  const s1 = site();
  const params = { ...base, site: s1, rows: [s1], timeIndex: 5 };
  const requested = (bounds) => bounds;
  const okMeta = async () => base.meta;

  test('a map drawn at the requested extent is kept', async () => {
    const fetchMap = jest.fn(async (_v, _i, bounds) => ({ dataUrl: 'data:image/png;base64,AA', appliedBounds: requested(bounds) }));
    const b = await buildLandingSiteReport(params, {}, { fetchMeta: okMeta, fetchMap, fetchBoundary: async () => [] });
    expect(b.map?.dataUrl).toBe('data:image/png;base64,AA');
  });

  test('a map drawn at a different extent is dropped (the site marker would be misplaced), with the reason', async () => {
    const fetchMap = jest.fn(async (_v, _i, bounds) => ({ dataUrl: 'data:image/png;base64,AA', appliedBounds: { ...bounds, east: bounds.east + 0.5 } }));
    const b = await buildLandingSiteReport(params, {}, { fetchMeta: okMeta, fetchMap, fetchBoundary: async () => [] });
    expect(b.map).toBeNull();
    expect(b.warnings.join(' ')).toMatch(/site map could not be produced \(the service drew a different extent/);
  });

  test('a map with no applied-bounds signal (older deployment) is not treated as mismatched', async () => {
    const fetchMap = jest.fn(async () => ({ dataUrl: 'data:image/png;base64,AA', appliedBounds: null }));
    const b = await buildLandingSiteReport(params, {}, { fetchMeta: okMeta, fetchMap, fetchBoundary: async () => [] });
    expect(b.map?.dataUrl).toBe('data:image/png;base64,AA');
  });
});
