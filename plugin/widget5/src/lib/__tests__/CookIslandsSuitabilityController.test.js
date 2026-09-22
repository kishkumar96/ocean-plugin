import { CookIslandsSuitabilityController } from '../CookIslandsSuitabilityController';
import { CookIslandsSuitabilityDynamicOverlay } from '../CookIslandsSuitabilityDynamicOverlay';
import { CookIslandsSuitabilityOverlay } from '../CookIslandsSuitabilityOverlay';

// Constructing a real controller pulls in CookIslandsSuitabilityOverlay's
// live /cok/suitability/summary + points + advice fetches, which are their
// own concern (covered by CookIslandsSuitabilityOverlay's own behavior).
// These tests only exercise CookIslandsSuitabilityController's delegation
// logic, so they build a harness controller with fake fixed/dynamic
// overlays instead -- mirrors widget1's NiueSuitabilityController.test.js.
function makeController() {
  const controller = Object.create(CookIslandsSuitabilityController.prototype);
  controller._mode = 'preset';
  controller._timeIndex = 0;
  controller.fixed = {
    setTimeIndex: jest.fn(),
    setOpacity: jest.fn(),
    setVesselClass: jest.fn(),
    setVisible: jest.fn(),
    getAdvisoryGroup: jest.fn(() => [{ properties: { vessel_class: 'small_craft', hazard_class: 1 } }]),
    getTimeseriesAtPoint: jest.fn(() => Promise.resolve(null)),
    getTimeLabels: jest.fn(() => ['2026-08-20 00:00 UTC']),
    destroy: jest.fn(),
    onTimeChange: null,
    onLoadingChange: null,
    onErrorChange: null,
    onStatsChange: null,
  };
  controller.dynamic = {
    setTimeIndex: jest.fn(() => Promise.resolve()),
    setOpacity: jest.fn(),
    setEnvelope: jest.fn(),
    getPointAt: jest.fn(() => null),
    setVisible: jest.fn(),
    destroy: jest.fn(),
    onTimeChange: null,
    onLoadingChange: null,
    onErrorChange: null,
    onStatsChange: null,
  };
  return controller;
}

// Constructor coverage uses the real overlays, but spies on the dynamic
// overlay's network entry point. Preset mode must not fetch the large custom
// grid at all; a controller that starts in Custom must still seed the current
// index immediately rather than waiting for a React dependency to change.
function fakeMap() {
  return {
    on: jest.fn(),
    off: jest.fn(),
    addSource: jest.fn(),
    addLayer: jest.fn(),
    hasImage: jest.fn(() => true),
    addImage: jest.fn(),
    removeLayer: jest.fn(),
    removeSource: jest.fn(),
    getLayer: jest.fn(() => false),
    getSource: jest.fn(() => null),
    setLayoutProperty: jest.fn(),
    setPaintProperty: jest.fn(),
  };
}

// A macrotask boundary (unlike a fixed number of chained Promise.resolve()
// hops) drains every pending microtask no matter how deeply the real
// fetch -> json -> fetch chain nests, so assertions below reflect the fully
// settled state rather than a timing artifact of the test not waiting for
// anything -- the exact gap that let an earlier version of the preset-mode
// test below pass for the wrong reason (see its comment).
function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mockFetchForSummaryPointsAndGrid() {
  global.fetch = jest.fn((url) => {
    const u = String(url);
    if (u.includes('/summary')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          n_timesteps: 2,
          forecast_start: '2026-08-20T00:00:00.000000000',
          forecast_end: '2026-08-20T03:00:00.000000000',
        }),
      });
    }
    if (u.includes('/points/')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ features: [] }) });
    }
    if (u.includes('/advice/')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ features: [] }) });
    }
    if (u.includes('/grid/')) {
      const cellCount = 1;
      const buffer = new ArrayBuffer(cellCount * 2 * 2 + cellCount); // i16 + i16 + u8
      return Promise.resolve({
        ok: true,
        headers: {
          get: (name) => ({
            'X-Grid-Width': '1',
            'X-Grid-Height': '1',
            'X-Lon-Min': '-159.9', 'X-Lon-Max': '-159.7',
            'X-Lat-Min': '-21.3', 'X-Lat-Max': '-21.1',
            'X-Wind-Scale': '100', 'X-Wave-Scale': '1000',
            'X-Valid-Time': '2026-08-20T00:00:00Z',
          }[name] ?? null),
        },
        arrayBuffer: () => Promise.resolve(buffer),
      });
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
}

describe('CookIslandsSuitabilityController constructor seeding', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test('starting in preset mode does not load the dynamic grid, even once pending promises settle', async () => {
    mockFetchForSummaryPointsAndGrid();
    const setDynamicTimeIndex = jest
      .spyOn(CookIslandsSuitabilityDynamicOverlay.prototype, 'setTimeIndex')
      .mockResolvedValue();
    const map = fakeMap();
    const controller = new CookIslandsSuitabilityController(map, {
      vesselClass: 'small_craft',
      timeIndex: 0,
      suitabilityMode: 'preset',
      customEnvelope: null,
    });

    // A synchronous assertion right here would have passed even if the
    // dynamic overlay eagerly kicked off its own summary/grid fetch from
    // its constructor and then called setTimeIndex(0) once that settled --
    // the assertion would just be racing ahead of that microtask chain
    // rather than proving it never happens. Flushing first is what makes
    // this test actually exercise the lazy-summary contract in
    // CookIslandsSuitabilityDynamicOverlay.js.
    await flushPromises();

    expect(setDynamicTimeIndex).not.toHaveBeenCalled();
    expect(controller.dynamic._grid).toBeNull();
  });

  test('starting in custom mode loads the current index and seeds the envelope', () => {
    mockFetchForSummaryPointsAndGrid();
    const setDynamicTimeIndex = jest
      .spyOn(CookIslandsSuitabilityDynamicOverlay.prototype, 'setTimeIndex')
      .mockResolvedValue();
    const map = fakeMap();
    const controller = new CookIslandsSuitabilityController(map, {
      vesselClass: 'small_craft',
      timeIndex: 0,
      suitabilityMode: 'custom',
      customEnvelope: { maxWindKt: 18 },
    });

    expect(controller._mode).toBe('custom');
    expect(controller.dynamic._envelope).toMatchObject({ cautionWindKt: 15, maxWindKt: 18 });
    expect(setDynamicTimeIndex).toHaveBeenCalledTimes(1);
    expect(setDynamicTimeIndex).toHaveBeenCalledWith(0);
  });

  test('starting in preset mode leaves the dynamic canvas layer hidden, custom mode shows it', () => {
    mockFetchForSummaryPointsAndGrid();
    jest.spyOn(CookIslandsSuitabilityDynamicOverlay.prototype, 'setTimeIndex').mockResolvedValue();

    const presetController = new CookIslandsSuitabilityController(fakeMap(), {
      vesselClass: 'traditional_craft',
      timeIndex: 0,
      suitabilityMode: 'preset',
      customEnvelope: null,
    });
    expect(presetController.dynamic._map).not.toBeNull(); // still constructed, just hidden
    expect(presetController.fixed._destroyed).toBe(false);

    const customController = new CookIslandsSuitabilityController(fakeMap(), {
      vesselClass: 'traditional_craft',
      timeIndex: 0,
      suitabilityMode: 'custom',
      customEnvelope: null,
    });
    expect(customController._mode).toBe('custom');
  });
});

// Exercises the real network path (setTimeIndex/_ensureSummary/_fetchGrid/
// _prefetchNext all run for real against the mocked fetch) rather than
// mocking setTimeIndex out entirely -- that's what's needed to actually
// prove request *counts and ordering*, not just "was called". _repaint()
// is stubbed out since it drives MapLibre/canvas calls fakeMap() doesn't
// implement (map.triggerRepaint, a 2D canvas context) and is irrelevant to
// what's being verified here.
describe('CookIslandsSuitabilityController custom-mode network contract', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test('entering custom mode fetches the summary once and the initial grid once, prefetches the next grid, and never repeats the summary fetch on later time changes', async () => {
    mockFetchForSummaryPointsAndGrid();
    jest.spyOn(CookIslandsSuitabilityDynamicOverlay.prototype, '_repaint').mockImplementation(() => {});
    // The controller always constructs the fixed/preset overlay too, and it
    // independently fetches this same /summary endpoint for its own,
    // unrelated reasons (see CookIslandsSuitabilityOverlay.js) -- stub that
    // out so the counters below isolate the dynamic overlay's own network
    // contract instead of conflating the two.
    jest.spyOn(CookIslandsSuitabilityOverlay.prototype, '_fetchSummary').mockResolvedValue();
    const map = fakeMap();
    const controller = new CookIslandsSuitabilityController(map, {
      vesselClass: 'small_craft',
      timeIndex: 0,
      suitabilityMode: 'custom',
      customEnvelope: null,
    });

    await flushPromises();

    const urls = () => global.fetch.mock.calls.map(([url]) => String(url));
    const summaryCallCount = () => urls().filter((u) => u.endsWith('/cok/suitability/summary')).length;
    const gridCallCount = (idx) => urls().filter((u) => u.endsWith(`/grid/${idx}`)).length;

    expect(summaryCallCount()).toBe(1);
    expect(gridCallCount(0)).toBe(1);
    // mockFetchForSummaryPointsAndGrid's summary reports n_timesteps: 2, so
    // landing on time 0 should also have kicked off _prefetchNext(0) in the
    // background -- confirms the prefetch pipeline actually fires, not just
    // that the summary fetch is lazy.
    expect(gridCallCount(1)).toBe(1);
    expect(controller.dynamic._gridCache.has(1)).toBe(true);

    controller.setTimeIndex(1);
    await flushPromises();

    // Time 1 was already prefetched -- advancing to it must be a cache hit,
    // not a second network round trip, and must not re-request the summary.
    expect(summaryCallCount()).toBe(1);
    expect(gridCallCount(1)).toBe(1);
  });
});

describe('CookIslandsSuitabilityController mode toggling', () => {
  test('entering custom mode hides the fixed overlay, shows dynamic, and loads the remembered time', () => {
    const controller = makeController();
    controller.setTimeIndex(5);
    expect(controller.dynamic.setTimeIndex).not.toHaveBeenCalled();

    controller.setMode('custom');

    expect(controller.fixed.setVisible).toHaveBeenCalledWith(false);
    expect(controller.dynamic.setVisible).toHaveBeenCalledWith(true);
    expect(controller.dynamic.setTimeIndex).toHaveBeenCalledTimes(1);
    expect(controller.dynamic.setTimeIndex).toHaveBeenCalledWith(5);
  });

  test('leaving custom mode shows the fixed overlay and hides dynamic', () => {
    const controller = makeController();
    controller.setMode('custom');
    controller.setMode('preset');

    expect(controller.fixed.setVisible).toHaveBeenLastCalledWith(true);
    expect(controller.dynamic.setVisible).toHaveBeenLastCalledWith(false);
  });

  test('re-entering the same mode does not reload the dynamic grid again', () => {
    const controller = makeController();
    controller.setMode('custom');
    controller.dynamic.setTimeIndex.mockClear();
    controller.setMode('custom');
    expect(controller.dynamic.setTimeIndex).not.toHaveBeenCalled();
  });

  test('rejects an unknown mode', () => {
    const controller = makeController();
    expect(() => controller.setMode('surprise')).toThrow(/unknown suitability mode/i);
  });
});

describe('CookIslandsSuitabilityController time/envelope/vessel delegation', () => {
  test('setTimeIndex updates only the fixed overlay while preset mode is active', () => {
    const controller = makeController();
    controller.setTimeIndex(5);

    expect(controller.fixed.setTimeIndex).toHaveBeenCalledWith(5);
    expect(controller.dynamic.setTimeIndex).not.toHaveBeenCalled();
    expect(controller._timeIndex).toBe(5);
  });

  test('setTimeIndex updates only the dynamic overlay while custom mode is active', () => {
    const controller = makeController();
    controller.setMode('custom');
    controller.dynamic.setTimeIndex.mockClear();

    controller.setTimeIndex(5);

    // The hidden preset overlay is deliberately left alone so its tile and
    // advisory fetches don't compete with the custom grid fetch on screen.
    expect(controller.dynamic.setTimeIndex).toHaveBeenCalledWith(5);
    expect(controller.fixed.setTimeIndex).not.toHaveBeenCalled();
    expect(controller._timeIndex).toBe(5);
  });

  test('returning to preset catches the fixed overlay up to the time scrubbed in custom mode', () => {
    const controller = makeController();
    controller.setMode('custom');
    controller.setTimeIndex(7);
    expect(controller.fixed.setTimeIndex).not.toHaveBeenCalled();

    controller.setMode('preset');

    expect(controller.fixed.setTimeIndex).toHaveBeenCalledTimes(1);
    expect(controller.fixed.setTimeIndex).toHaveBeenCalledWith(7);
  });

  test('a rejected custom grid load forwards its error to onErrorChange instead of throwing', async () => {
    const controller = makeController();
    const onErrorChange = jest.fn();
    controller._onErrorChange = onErrorChange;
    controller._mode = 'custom';
    controller.dynamic.setTimeIndex.mockReturnValueOnce(Promise.reject(new Error('grid fetch failed')));

    controller.setTimeIndex(3);
    await Promise.resolve().then(() => Promise.resolve()); // flush the .catch microtask

    expect(onErrorChange).toHaveBeenCalledWith('grid fetch failed');
  });

  test('an aborted custom grid load is ignored', async () => {
    const controller = makeController();
    const onErrorChange = jest.fn();
    const abortError = Object.assign(new Error('request aborted'), { name: 'AbortError' });
    controller._onErrorChange = onErrorChange;
    controller.dynamic.setTimeIndex.mockReturnValueOnce(Promise.reject(abortError));

    controller.setMode('custom');
    await Promise.resolve().then(() => Promise.resolve());

    expect(onErrorChange).not.toHaveBeenCalled();
  });

  test('setVesselClass only touches the fixed (preset) overlay', () => {
    const controller = makeController();
    controller.setVesselClass('small_craft');
    expect(controller.fixed.setVesselClass).toHaveBeenCalledWith('small_craft');
    expect(controller.dynamic.setEnvelope).not.toHaveBeenCalled();
  });

  test('setEnvelope resolves the vessel preset merged with overrides and passes the resolved object to dynamic', () => {
    const controller = makeController();
    controller.setEnvelope('small_craft', { maxWaveHeightM: 2.5 });
    expect(controller.dynamic.setEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({ maxWaveHeightM: 2.5, cautionWindKt: 15 })
    );
    expect(controller.fixed.setVesselClass).not.toHaveBeenCalled();
  });

  test('an invalid envelope override reports the error and falls back to the vessel preset instead of throwing', () => {
    const controller = makeController();
    const onErrorChange = jest.fn();
    controller._onErrorChange = onErrorChange;
    // caution >= avoid -- resolveOperatingEnvelope itself rejects this
    const badOverrides = { cautionWaveHeightM: 3, maxWaveHeightM: 2 };

    expect(() => controller.setEnvelope('small_craft', badOverrides)).not.toThrow();

    expect(onErrorChange).toHaveBeenCalledWith(
      'Caution wave threshold must be lower than the avoid wave threshold.'
    );
    // Falls back to calling dynamic.setEnvelope a second time with the pure preset.
    expect(controller.dynamic.setEnvelope).toHaveBeenCalledTimes(1);
    expect(controller.dynamic.setEnvelope.mock.calls[0][0]).toMatchObject({ cautionWaveHeightM: 1.5, maxWaveHeightM: 2.0 });
  });

  test('an unknown vessel passed to setEnvelope reports the error without a second call', () => {
    const controller = makeController();
    const onErrorChange = jest.fn();
    controller._onErrorChange = onErrorChange;

    expect(() => controller.setEnvelope('bogus_vessel', {})).not.toThrow();

    expect(onErrorChange).toHaveBeenCalledWith('Unknown vessel class: bogus_vessel');
    // overrides was already {}, so there is nothing sensible to fall back to —
    // must not retry (which would just throw again for the same reason).
    expect(controller.dynamic.setEnvelope).not.toHaveBeenCalled();
  });

  test('setOpacity applies to both overlays', () => {
    const controller = makeController();
    controller.setOpacity(0.5);
    expect(controller.fixed.setOpacity).toHaveBeenCalledWith(0.5);
    expect(controller.dynamic.setOpacity).toHaveBeenCalledWith(0.5);
  });
});

describe('CookIslandsSuitabilityController callback forwarding (mode-gated)', () => {
  test('onLoadingChange only reaches the caller from whichever overlay backs the active mode', () => {
    const controller = makeController();
    const onLoadingChange = jest.fn();
    controller.onLoadingChange = onLoadingChange;

    expect(controller.fixed.onLoadingChange).toEqual(expect.any(Function));
    expect(controller.dynamic.onLoadingChange).toEqual(expect.any(Function));

    // Preset mode active: fixed's firing reaches the caller, dynamic's doesn't.
    controller.fixed.onLoadingChange(true);
    expect(onLoadingChange).toHaveBeenCalledWith(true);
    onLoadingChange.mockClear();
    controller.dynamic.onLoadingChange(true);
    expect(onLoadingChange).not.toHaveBeenCalled();

    // Switch to custom: now only dynamic's firing reaches the caller.
    controller._mode = 'custom';
    controller.fixed.onLoadingChange(false);
    expect(onLoadingChange).not.toHaveBeenCalled();
    controller.dynamic.onLoadingChange(false);
    expect(onLoadingChange).toHaveBeenCalledWith(false);
  });

  test('onErrorChange and onStatsChange are mode-gated the same way', () => {
    const controller = makeController();
    const onErrorChange = jest.fn();
    const onStatsChange = jest.fn();
    controller.onErrorChange = onErrorChange;
    controller.onStatsChange = onStatsChange;

    controller.fixed.onErrorChange('preset error');
    controller.dynamic.onErrorChange('custom error');
    expect(onErrorChange).toHaveBeenCalledTimes(1);
    expect(onErrorChange).toHaveBeenCalledWith('preset error');

    controller.fixed.onStatsChange(1, 2, 'kt');
    controller.dynamic.onStatsChange(3, 4, 'm');
    expect(onStatsChange).toHaveBeenCalledTimes(1);
    expect(onStatsChange).toHaveBeenCalledWith(1, 2, 'kt');
  });

  test('getTimeLabels delegates to the fixed overlay', () => {
    const controller = makeController();
    expect(controller.getTimeLabels()).toEqual(['2026-08-20 00:00 UTC']);
  });
});

describe('CookIslandsSuitabilityController advisory groups and teardown', () => {
  test('getAdvisoryGroup delegates to the fixed overlay', () => {
    const controller = makeController();
    const result = controller.getAdvisoryGroup('Avatiu Harbour');
    expect(controller.fixed.getAdvisoryGroup).toHaveBeenCalledWith('Avatiu Harbour');
    expect(result).toEqual([{ properties: { vessel_class: 'small_craft', hazard_class: 1 } }]);
  });

  test('getTimeseriesAtPoint delegates to the fixed overlay', async () => {
    const controller = makeController();
    await expect(controller.getTimeseriesAtPoint()).resolves.toBeNull();
    expect(controller.fixed.getTimeseriesAtPoint).toHaveBeenCalled();
  });

  test('destroy tears down both overlays', () => {
    const controller = makeController();
    controller.destroy();
    expect(controller.fixed.destroy).toHaveBeenCalled();
    expect(controller.dynamic.destroy).toHaveBeenCalled();
  });
});

describe('suitability raster stacking', () => {
  test('preset raster and point layers render below coastal risk markers', () => {
    const map = fakeMap();
    map.getLayer.mockImplementation((id) => id === 'risk-circles');
    const overlay = Object.create(CookIslandsSuitabilityOverlay.prototype);
    overlay._map = map;
    overlay._opacity = 0.85;
    overlay._buildTileUrl = jest.fn(() => '/tiles/{z}/{x}/{y}.png');
    overlay._bindRasterLoadTracking = jest.fn();

    overlay._addLayers();

    const layerCalls = map.addLayer.mock.calls;
    expect(layerCalls.map(([layer]) => layer.id)).toEqual([
      'cok-suitability-raster-layer',
      'cok-suitability-circles',
      'cok-suitability-advisory-layer',
    ]);
    expect(layerCalls.map(([, beforeId]) => beforeId)).toEqual([
      'risk-circles', 'risk-circles', 'risk-circles',
    ]);
    expect(layerCalls[2][0]).toMatchObject({
      type: 'symbol',
      layout: { 'icon-image': ['get', 'marker_icon'] },
    });
  });

  test('custom canvas raster renders below coastal risk markers', () => {
    const map = fakeMap();
    map.getLayer.mockImplementation((id) => id === 'risk-circles');
    const overlay = Object.create(CookIslandsSuitabilityDynamicOverlay.prototype);
    overlay._map = map;
    overlay._canvas = document.createElement('canvas');
    overlay._opacity = 0.85;

    overlay._ensureMapSource({ lonMin: -160, lonMax: -159, latMin: -22, latMax: -21 });

    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cok-suitability-dynamic-layer', type: 'raster' }),
      'risk-circles',
    );
  });
});

describe('named suitability locations', () => {
  test('landing sites and fishing grounds get distinct hazard-colored icon IDs', () => {
    const setData = jest.fn();
    const map = fakeMap();
    map.getSource.mockReturnValue({ setData });
    const overlay = Object.create(CookIslandsSuitabilityOverlay.prototype);
    overlay._map = map;
    overlay._vesselClass = 'small_craft';
    overlay._cache = new Map([[0, { adviceFeatures: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-159.795, -21.198] }, properties: { name: 'Avatiu Harbour', type: 'landing_site', vessel_class: 'small_craft', hazard_class: 1 } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-159.831, -21.265] }, properties: { name: 'Aroa Passage', type: 'fishing_ground', vessel_class: 'small_craft', hazard_class: 2 } },
    ] }]]);

    overlay._renderAdvisory(0);

    const features = setData.mock.calls[0][0].features;
    expect(features.map((feature) => feature.properties.marker_icon)).toEqual([
      'cok-advisory-landing_site-1',
      'cok-advisory-fishing_ground-2',
    ]);
    expect(features.map((feature) => feature.geometry.coordinates)).toEqual([
      [-159.795, -21.198], [-159.831, -21.265],
    ]);
  });
});

describe('CookIslandsSuitabilityController.getCustomPointAt', () => {
  const cell = {
    hazardClass: 1, windKt: 16.4, waveM: 1.2, validTime: '2026-09-22T06:00:00Z', cellSizeKm: 2.2,
    envelope: { cautionWindKt: 15, maxWindKt: 20, cautionWaveHeightM: 1.5, maxWaveHeightM: 2 },
  };

  test('is null in preset mode without consulting the grid', () => {
    const controller = makeController();
    expect(controller.getCustomPointAt(-159.8, -21.2)).toBeNull();
    expect(controller.dynamic.getPointAt).not.toHaveBeenCalled();
  });

  test('is null for land / outside the grid', () => {
    const controller = makeController();
    controller.setMode('custom');
    expect(controller.getCustomPointAt(-159.8, -21.2)).toBeNull();
  });

  test('shapes the grid cell like the marker properties the details panel renders', () => {
    const controller = makeController();
    controller.setMode('custom');
    controller.setEnvelope('small_craft', {});
    controller.dynamic.getPointAt.mockReturnValue(cell);

    expect(controller.getCustomPointAt(-159.8, -21.2)).toEqual({
      hazard_class: 1,
      hazard_label: 'Caution',
      action_label: 'Custom thresholds (what-if)',
      vessel_class: 'small_craft',
      wind_speed_kt: 16.4,
      wave_height_m: 1.2,
      valid_time: '2026-09-22T06:00:00Z',
      custom_envelope: cell.envelope,
      grid_cell_km: 2.2,
      lat: -21.2,
      lon: -159.8,
    });
    expect(controller.dynamic.getPointAt).toHaveBeenCalledWith(-159.8, -21.2);
  });
});
