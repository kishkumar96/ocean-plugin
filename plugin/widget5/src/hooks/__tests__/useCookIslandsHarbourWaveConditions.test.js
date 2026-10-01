import { renderHook, waitFor } from '@testing-library/react';
import { useCookIslandsHarbourWaveConditions } from '../useCookIslandsHarbourWaveConditions';
import { COOK_ISLANDS_HARBOUR_POINTS } from '../../config/cookIslandsHarbourPoints';

function mockFetchSequence(handlers) {
  global.fetch = jest.fn((url) => {
    for (const [pattern, respond] of handlers) {
      if (url.includes(pattern)) return respond(url);
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
}

function timeseriesResponse({ waveHeightM = 1, windSpeedKt = 10, hazardClass = 0, available = true, stepCount = 24 } = {}) {
  return {
    ok: true,
    json: () => Promise.resolve({
      available,
      steps: available
        ? Array.from({ length: stepCount }, (_, i) => ({
            time_index: i,
            valid_time: new Date(Date.UTC(2026, 8, 29, 0) + i * 3600e3).toISOString(),
            hazard_class: hazardClass,
            hazard_label: 'Suitable',
            wind_speed_kt: windSpeedKt,
            wave_height_m: waveHeightM + i * 0.1, // increasing, so "24h max" != "now"
          }))
        : [],
    }),
  };
}

// "Now" is the step nearest the wall clock; pin it to the first step so the
// fixtures' "step 0 = now" assumption holds unless a test moves it.
const NOW_AT_STEP_0 = Date.parse('2026-09-29T00:00:00Z');

beforeEach(() => {
  delete global.fetch;
  jest.spyOn(Date, 'now').mockReturnValue(NOW_AT_STEP_0);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useCookIslandsHarbourWaveConditions', () => {
  test('does nothing while disabled', () => {
    global.fetch = jest.fn();
    renderHook(() => useCookIslandsHarbourWaveConditions(false));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('fetches every harbour point and summarizes current + 24h-max wave height', async () => {
    mockFetchSequence([
      ['/cok/suitability/point/timeseries', () => Promise.resolve(timeseriesResponse())],
    ]);

    const { result } = renderHook(() => useCookIslandsHarbourWaveConditions(true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(COOK_ISLANDS_HARBOUR_POINTS.length);
    // One suitability + one wave-model request per harbour, plus the run summary once.
    expect(global.fetch).toHaveBeenCalledTimes(COOK_ISLANDS_HARBOUR_POINTS.length * 2 + 1);

    const avatiu = result.current.rows.find((r) => r.name === 'Avatiu Harbour');
    expect(avatiu.available).toBe(true);
    expect(avatiu.waveHeightM).toBeCloseTo(1); // step 0
    expect(avatiu.outlookMaxWaveHeightM).toBeCloseTo(1 + 23 * 0.1); // last of the 24 outlook steps
    expect(avatiu.hazardClass).toBe(0);
  });

  test('requests every point with vessel=all, not a specific vessel class', async () => {
    let requestedUrls = [];
    mockFetchSequence([
      ['/cok/suitability/point/timeseries', (url) => {
        requestedUrls.push(url);
        return Promise.resolve(timeseriesResponse());
      }],
    ]);

    renderHook(() => useCookIslandsHarbourWaveConditions(true));
    await waitFor(() => expect(requestedUrls.length).toBe(COOK_ISLANDS_HARBOUR_POINTS.length));
    expect(requestedUrls.every((u) => u.includes('vessel=all'))).toBe(true);
  });

  test('one harbour failing does not blank the whole table', async () => {
    mockFetchSequence([
      ['/cok/suitability/point/timeseries', (url) => (
        url.includes('-165.4233') // Nassau Harbour
          ? Promise.reject(new Error('out of domain'))
          : Promise.resolve(timeseriesResponse())
      )],
    ]);

    const { result } = renderHook(() => useCookIslandsHarbourWaveConditions(true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(COOK_ISLANDS_HARBOUR_POINTS.length);
    const nassau = result.current.rows.find((r) => r.name === 'Nassau Harbour');
    expect(nassau.available).toBe(false);
    expect(nassau.unavailableReason).toMatch(/out of domain/);
    const others = result.current.rows.filter((r) => r.name !== 'Nassau Harbour');
    expect(others.every((r) => r.available)).toBe(true);
  });

  test('reports an error only when every harbour is unavailable', async () => {
    mockFetchSequence([
      ['/cok/suitability/point/timeseries', () => Promise.resolve(timeseriesResponse({ available: false }))],
    ]);

    const { result } = renderHook(() => useCookIslandsHarbourWaveConditions(true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/No wave conditions/);
    expect(result.current.rows.every((r) => !r.available)).toBe(true);
  });

  test('"now" and the 24h outlook start at the step nearest the wall clock, not step 0', async () => {
    Date.now.mockReturnValue(Date.parse('2026-09-29T10:10:00Z')); // nearest step = 10:00 (index 10)
    mockFetchSequence([
      ['/cok/suitability/point/timeseries', () => Promise.resolve(timeseriesResponse({ stepCount: 48 }))],
    ]);
    const { result } = renderHook(() => useCookIslandsHarbourWaveConditions(true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const avatiu = result.current.rows.find((r) => r.name === 'Avatiu Harbour');
    expect(avatiu.waveHeightM).toBeCloseTo(1 + 10 * 0.1);
    expect(avatiu.outlookSteps).toHaveLength(24);
    expect(avatiu.outlookMaxWaveHeightM).toBeCloseTo(1 + 33 * 0.1); // index 10..33
  });

  describe('24 h / 72 h windows are built by time, and shortfalls are counted', () => {
    const run = async (resp) => {
      mockFetchSequence([['/cok/suitability/point/timeseries', () => Promise.resolve(resp)]]);
      const { result } = renderHook(() => useCookIslandsHarbourWaveConditions(true));
      await waitFor(() => expect(result.current.loading).toBe(false));
      return result.current.rows.find((r) => r.name === 'Avatiu Harbour');
    };

    test('a complete 72 h forecast has no missing hours in either window', async () => {
      const row = await run(timeseriesResponse({ stepCount: 100 }));
      expect(row.outlookSteps).toHaveLength(24);
      expect(row.outlook72Steps).toHaveLength(72);
      expect([row.outlookMissingHours, row.outlook72MissingHours]).toEqual([0, 0]);
    });

    test('a forecast that ends after 30 h: 24 h window complete, 72 h window reports 42 h missing', async () => {
      const row = await run(timeseriesResponse({ stepCount: 30 }));
      expect(row.outlookMissingHours).toBe(0);
      expect(row.outlook72Steps).toHaveLength(30);
      expect(row.outlook72MissingHours).toBe(42);
    });

    test('a forecast that ends after 10 h: the 24 h window reports 14 h missing and keeps only what exists', async () => {
      const row = await run(timeseriesResponse({ stepCount: 10 }));
      expect(row.outlookSteps).toHaveLength(10);
      expect(row.outlookMissingHours).toBe(14);
    });

    test('a hole inside the window counts as a missing hour (not bridged)', async () => {
      const full = timeseriesResponse({ stepCount: 48 });
      const data = await full.json();
      data.steps.splice(5, 3); // drop hours 5, 6, 7
      const row = await run({ ok: true, json: () => Promise.resolve(data) });
      expect(row.outlookMissingHours).toBe(3);
      expect(row.outlookSteps).toHaveLength(21);
    });
  });

  describe('suitability and wave feeds must be the same model cycle before period is joined', () => {
    const waveResponse = (startIso) => () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        times: Array.from({ length: 24 }, (_, i) => new Date(Date.parse(startIso) + i * 3600e3).toISOString()),
        variables: { tpeak: Array.from({ length: 24 }, () => 11) },
        distance_degrees: 0,
      }),
    });
    const summary = (runIso) => () => Promise.resolve({ ok: true, json: () => Promise.resolve({ model_run_time: runIso }) });
    const suitability = ['/cok/suitability/point/timeseries', () => Promise.resolve(timeseriesResponse())];

    test('same cycle: period is attached to the steps', async () => {
      mockFetchSequence([suitability, ['/cok/suitability/summary', summary('2026-09-29T00:00:00Z')], ['wave/ugrid/timeseries', waveResponse('2026-09-29T00:00:00Z')]]);
      const { result } = renderHook(() => useCookIslandsHarbourWaveConditions(true));
      await waitFor(() => expect(result.current.loading).toBe(false));
      const avatiu = result.current.rows.find((r) => r.name === 'Avatiu Harbour');
      expect(avatiu.periodWithheld).toBe(false);
      expect(avatiu.peakPeriodS).toBe(11);
      expect(result.current.suitabilityRunStart).toBe('2026-09-29T00:00:00Z');
    });

    test('different cycle (00Z vs 06Z): period is withheld, not silently joined', async () => {
      mockFetchSequence([suitability, ['/cok/suitability/summary', summary('2026-09-29T00:00:00Z')], ['wave/ugrid/timeseries', waveResponse('2026-09-29T06:00:00Z')]]);
      const { result } = renderHook(() => useCookIslandsHarbourWaveConditions(true));
      await waitFor(() => expect(result.current.loading).toBe(false));
      const avatiu = result.current.rows.find((r) => r.name === 'Avatiu Harbour');
      expect(avatiu.periodWithheld).toBe(true);
      expect(avatiu.peakPeriodS).toBeNull();
      expect(avatiu.steps.every((st) => st.tp_s === undefined)).toBe(true);
    });

    test('run summary unavailable: cannot confirm the cycle, so period is withheld', async () => {
      mockFetchSequence([suitability, ['wave/ugrid/timeseries', waveResponse('2026-09-29T00:00:00Z')]]); // summary -> 404
      const { result } = renderHook(() => useCookIslandsHarbourWaveConditions(true));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.rows.find((r) => r.name === 'Avatiu Harbour').periodWithheld).toBe(true);
    });
  });
});
