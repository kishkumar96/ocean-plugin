import { renderHook, waitFor } from '@testing-library/react';
import { useCookIslandsLandingAreaComparison } from '../useCookIslandsLandingAreaComparison';
import { __resetCookIslandsAreaTimeseriesAvailabilityForTests } from '../../lib/CookIslandsSuitabilityOverlay';

const adviceGeojson = {
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-159.7833, -21.2039] },
      properties: { name: 'Avatiu Harbour', type: 'landing_site', vessel_class: 'traditional_craft' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-159.775, -21.2078] },
      properties: { name: 'Avarua Fishing Ground', type: 'fishing_ground', vessel_class: 'traditional_craft' },
    },
    // Duplicate of Avatiu Harbour for a different vessel class -- should be
    // deduplicated to one site, not two rows.
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-159.7833, -21.2039] },
      properties: { name: 'Avatiu Harbour', type: 'landing_site', vessel_class: 'small_craft' },
    },
    // Known noise entry, must be excluded.
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-159.79, -21.25] },
      properties: { name: 'Ngatangiia Harbour', type: 'landing_site', vessel_class: 'traditional_craft' },
    },
  ],
};

function areaSeries(hazardClass) {
  return {
    point_count: 3,
    used_nearest_point_fallback: false,
    statistics_basis: 'area_500m',
    steps: [{ time_index: 0, valid_time: '2026-09-20T00:00:00Z', hazard_class: hazardClass, wind_speed_kt: 10, wave_height_m: 1 }],
  };
}

function mockFetchSequence(handlers) {
  global.fetch = jest.fn((url) => {
    for (const [pattern, respond] of handlers) {
      if (url.includes(pattern)) return respond(url);
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
}

beforeEach(() => {
  delete global.fetch;
  // The hook's "area/timeseries known unavailable" flag is deliberately
  // sticky for the life of a real page (see CookIslandsSuitabilityOverlay.js)
  // -- reset it between test cases so one test's 404 doesn't poison the next.
  __resetCookIslandsAreaTimeseriesAvailabilityForTests();
});

describe('useCookIslandsLandingAreaComparison', () => {
  test('does nothing while disabled', () => {
    global.fetch = jest.fn();
    renderHook(() => useCookIslandsLandingAreaComparison('traditional_craft', false));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('discovers sites from the advice layer, dedupes by name, and fetches area timeseries for each', async () => {
    mockFetchSequence([
      ['/cok/suitability/advice/0', () => Promise.resolve({ ok: true, json: () => Promise.resolve(adviceGeojson) })],
      ['/cok/suitability/area/timeseries', (url) => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(areaSeries(url.includes('-159.775') ? 1 : 0)),
      })],
    ]);

    const { result } = renderHook(() => useCookIslandsLandingAreaComparison('traditional_craft', true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(2); // Avatiu Harbour + Avarua Fishing Ground, Ngatangiia excluded
    const names = result.current.rows.map((r) => r.name).sort();
    expect(names).toEqual(['Avarua Fishing Ground', 'Avatiu Harbour']);
    expect(result.current.rows.every((r) => r.statistics_basis === 'area_500m')).toBe(true);
  });

  test('falls back to point/timeseries when the area endpoint 404s', async () => {
    mockFetchSequence([
      ['/cok/suitability/advice/0', () => Promise.resolve({ ok: true, json: () => Promise.resolve({ features: [adviceGeojson.features[0]] }) })],
      ['/cok/suitability/area/timeseries', () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })],
      ['/cok/suitability/point/timeseries', () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ steps: [{ time_index: 0, valid_time: '2026-09-20T00:00:00Z', hazard_class: 0 }] }),
      })],
    ]);

    const { result } = renderHook(() => useCookIslandsLandingAreaComparison('traditional_craft', true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0].statistics_basis).toBe('nearest_point_fallback');
    expect(result.current.rows[0].steps).toHaveLength(1);
  });

  test('reports an error when the advice layer itself cannot be loaded', async () => {
    mockFetchSequence([
      ['/cok/suitability/advice/0', () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) })],
    ]);

    const { result } = renderHook(() => useCookIslandsLandingAreaComparison('traditional_craft', true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/Could not load landing-area sites/);
    expect(result.current.rows).toEqual([]);
  });

  test('one site failing does not blank the whole comparison', async () => {
    mockFetchSequence([
      ['/cok/suitability/advice/0', () => Promise.resolve({ ok: true, json: () => Promise.resolve(adviceGeojson) })],
      ['/cok/suitability/area/timeseries', (url) => (
        url.includes('-159.775')
          ? Promise.reject(new Error('out of domain'))
          : Promise.resolve({ ok: true, json: () => Promise.resolve(areaSeries(0)) })
      )],
      ['/cok/suitability/point/timeseries', () => Promise.reject(new Error('also unavailable'))],
    ]);

    const { result } = renderHook(() => useCookIslandsLandingAreaComparison('traditional_craft', true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    // Avarua Fishing Ground's fetch and fallback both failed -> dropped;
    // Avatiu Harbour still comes back.
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0].name).toBe('Avatiu Harbour');
  });
});
