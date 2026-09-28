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
    expect(b.windows.suitable[0].steps).toBe(26); // steps 34..59, then a gap
    expect(b.timeline.coverage.total).toBe(169);
    expect(b.timeline.coverage.available).toBe(60);
    expect(b.warnings.join(' ')).toMatch(/Only 60 of 169 forecast steps/);
    expect(b.modelRun.time.toISOString()).toBe('2026-09-23T12:00:00.000Z');
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
