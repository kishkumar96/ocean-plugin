import { NiueSuitabilityController } from '../NiueSuitabilityController';
import { NiueSuitabilityDynamicOverlay } from '../NiueSuitabilityDynamicOverlay';

// Constructing a real controller pulls in NiueSuitabilityOverlay's
// map.on('error', ...) + live /niue/suitability/timesteps fetch, which is
// its own concern (covered by NiueSuitabilityOverlay's own tests). These
// tests only exercise NiueSuitabilityController's delegation logic, so they
// build a harness controller with fake fixed/dynamic overlays instead.
function makeController() {
  const controller = Object.create(NiueSuitabilityController.prototype);
  controller._mode = 'preset';
  controller._timeIndex = 0;
  controller.fixed = {
    setTimeIndex: jest.fn(),
    setOpacity: jest.fn(),
    setVessel: jest.fn(),
    setVisible: jest.fn(),
    getSuitabilityAtPoint: jest.fn(() => Promise.resolve({ hazard_class: 0 })),
    getTimeLabels: jest.fn(() => ['2026-08-20 00:00 UTC']),
    getIsoTimeAt: jest.fn(() => '2026-08-20T00:00:00.000Z'),
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
    setMaxTimeIndex: jest.fn(),
    setVisible: jest.fn(),
    cancelPendingRequests: jest.fn(),
    getSuitabilityAtPoint: jest.fn(() => Promise.resolve({ hazard_class: 1, time_index: 0 })),
    getStatus: jest.fn(() => ({ status: 'idle' })),
    destroy: jest.fn(),
    onBufferingChange: null,
    onSummaryChange: null,
    onStatusChange: null,
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
    removeLayer: jest.fn(),
    removeSource: jest.fn(),
    getLayer: jest.fn(() => false),
    getSource: jest.fn(() => null),
    setLayoutProperty: jest.fn(),
    setPaintProperty: jest.fn(),
  };
}

function mockFetchForGridAndTimesteps() {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/timesteps')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ timesteps: ['2026-08-20T00:00:00Z'] }),
      });
    }
    if (String(url).includes('/grid/')) {
      const cellCount = 1;
      const buffer = new ArrayBuffer(cellCount * 4 * 2 + cellCount);
      return Promise.resolve({
        ok: true,
        headers: {
          get: (name) => ({
            'X-Grid-Width': '1',
            'X-Grid-Height': '1',
            'X-Lon-Min': '-170', 'X-Lon-Max': '-169', 'X-Lat-Min': '-19', 'X-Lat-Max': '-18',
          }[name] ?? null),
        },
        arrayBuffer: () => Promise.resolve(buffer),
      });
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
}

describe('NiueSuitabilityController constructor seeding', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test('starting in preset mode does not load the dynamic grid', () => {
    mockFetchForGridAndTimesteps();
    const setDynamicTimeIndex = jest
      .spyOn(NiueSuitabilityDynamicOverlay.prototype, 'setTimeIndex')
      .mockResolvedValue();
    const map = fakeMap();
    const controller = new NiueSuitabilityController(map, {
      apiBase: 'https://example.test',
      vessel: 'small_craft',
      timeIndex: 0,
      suitabilityMode: 'preset',
      customEnvelope: null,
    });

    expect(setDynamicTimeIndex).not.toHaveBeenCalled();
    expect(controller.dynamic._grid).toBeNull();
  });

  test('starting in custom mode makes the dynamic overlay visible and loads the current index', () => {
    mockFetchForGridAndTimesteps();
    const setDynamicTimeIndex = jest
      .spyOn(NiueSuitabilityDynamicOverlay.prototype, 'setTimeIndex')
      .mockResolvedValue();
    const map = fakeMap();
    const controller = new NiueSuitabilityController(map, {
      apiBase: 'https://example.test',
      vessel: 'small_craft',
      timeIndex: 0,
      suitabilityMode: 'custom',
      customEnvelope: { cautionWindKt: 12, maxWindKt: 18, cautionWaveHeightM: 1.2, maxWaveHeightM: 1.8 },
    });

    expect(controller._mode).toBe('custom');
    expect(controller.dynamic._envelope).toMatchObject({ cautionWindKt: 12, maxWindKt: 18 });
    expect(setDynamicTimeIndex).toHaveBeenCalledTimes(1);
    expect(setDynamicTimeIndex).toHaveBeenCalledWith(0);
  });

  test('starting in preset mode leaves the dynamic canvas layer hidden, custom mode shows it', () => {
    mockFetchForGridAndTimesteps();
    jest.spyOn(NiueSuitabilityDynamicOverlay.prototype, 'setTimeIndex').mockResolvedValue();

    const presetController = new NiueSuitabilityController(fakeMap(), {
      apiBase: 'https://example.test',
      vessel: 'traditional_craft',
      timeIndex: 0,
      suitabilityMode: 'preset',
      customEnvelope: null,
    });
    expect(presetController.dynamic._visible).toBe(false);
    expect(presetController.fixed._visible).toBe(true);

    const customController = new NiueSuitabilityController(fakeMap(), {
      apiBase: 'https://example.test',
      vessel: 'traditional_craft',
      timeIndex: 0,
      suitabilityMode: 'custom',
      customEnvelope: null,
    });
    expect(customController.dynamic._visible).toBe(true);
    expect(customController.fixed._visible).toBe(false);
  });
});

describe('NiueSuitabilityController mode toggling', () => {
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

  test('leaving custom mode shows the fixed overlay, hides dynamic, and cancels pending custom loads', () => {
    const controller = makeController();
    const onSummaryChange = jest.fn();
    controller.dynamic.onSummaryChange = onSummaryChange;
    controller.setMode('custom');
    controller.setMode('preset');

    expect(controller.fixed.setVisible).toHaveBeenLastCalledWith(true);
    expect(controller.dynamic.setVisible).toHaveBeenLastCalledWith(false);
    expect(controller.dynamic.cancelPendingRequests).toHaveBeenCalledTimes(1);
    expect(onSummaryChange).toHaveBeenCalledWith(null);
  });

  test('rejects an unknown mode', () => {
    const controller = makeController();
    expect(() => controller.setMode('surprise')).toThrow(/unknown suitability mode/i);
  });
});

describe('NiueSuitabilityController time/envelope/vessel delegation', () => {
  test('setTimeIndex updates only the fixed overlay while preset mode is active', () => {
    const controller = makeController();
    controller.setTimeIndex(5);

    expect(controller.fixed.setTimeIndex).toHaveBeenCalledWith(5);
    expect(controller.dynamic.setTimeIndex).not.toHaveBeenCalled();
    expect(controller._timeIndex).toBe(5);
  });

  test('setTimeIndex updates both overlays while custom mode is active', () => {
    const controller = makeController();
    controller.setMode('custom');
    controller.dynamic.setTimeIndex.mockClear();

    controller.setTimeIndex(5);

    expect(controller.fixed.setTimeIndex).toHaveBeenCalledWith(5);
    expect(controller.dynamic.setTimeIndex).toHaveBeenCalledWith(5);
  });

  test('a rejected custom grid load forwards its error to onErrorChange instead of throwing', async () => {
    const controller = makeController();
    const onErrorChange = jest.fn();
    controller.onErrorChange = onErrorChange;
    controller._mode = 'custom';
    controller.dynamic.setTimeIndex.mockReturnValueOnce(Promise.reject(new Error('grid fetch failed')));

    controller.setTimeIndex(3);
    await Promise.resolve().then(() => Promise.resolve()); // flush the .catch microtask

    expect(onErrorChange).toHaveBeenCalledWith('grid fetch failed');
  });

  test('an aborted custom grid load is ignored when leaving custom mode', async () => {
    const controller = makeController();
    const onErrorChange = jest.fn();
    const abortError = Object.assign(new Error('request aborted'), { name: 'AbortError' });
    controller.onErrorChange = onErrorChange;
    controller.dynamic.setTimeIndex.mockReturnValueOnce(Promise.reject(abortError));

    controller.setMode('custom');
    controller.setMode('preset');
    await Promise.resolve().then(() => Promise.resolve());

    expect(controller.dynamic.cancelPendingRequests).toHaveBeenCalledTimes(1);
    expect(onErrorChange).not.toHaveBeenCalled();
  });

  test('setVessel only touches the fixed (preset) overlay', () => {
    const controller = makeController();
    controller.setVessel('small_craft');
    expect(controller.fixed.setVessel).toHaveBeenCalledWith('small_craft');
    expect(controller.dynamic.setEnvelope).not.toHaveBeenCalled();
  });

  test('setEnvelope only touches the dynamic (custom) overlay', () => {
    const controller = makeController();
    controller.setEnvelope('small_craft', { maxWaveHeightM: 2.5 });
    expect(controller.dynamic.setEnvelope).toHaveBeenCalledWith('small_craft', { maxWaveHeightM: 2.5 });
    expect(controller.fixed.setVessel).not.toHaveBeenCalled();
  });

  test('an invalid envelope override reports the error and falls back to the vessel preset instead of throwing', () => {
    const controller = makeController();
    const onErrorChange = jest.fn();
    controller.onErrorChange = onErrorChange;
    const badOverrides = { cautionWaveHeightM: 3, maxWaveHeightM: 2 }; // caution >= avoid
    controller.dynamic.setEnvelope.mockImplementationOnce(() => {
      throw new Error('Caution wave threshold must be lower than the avoid wave threshold.');
    });

    expect(() => controller.setEnvelope('small_craft', badOverrides)).not.toThrow();

    expect(onErrorChange).toHaveBeenCalledWith(
      'Caution wave threshold must be lower than the avoid wave threshold.'
    );
    expect(controller.dynamic.setEnvelope).toHaveBeenNthCalledWith(1, 'small_craft', badOverrides);
    expect(controller.dynamic.setEnvelope).toHaveBeenNthCalledWith(2, 'small_craft', {});
  });

  test('an unknown vessel passed to setEnvelope reports the error without a second throw', () => {
    const controller = makeController();
    const onErrorChange = jest.fn();
    controller.onErrorChange = onErrorChange;
    controller.dynamic.setEnvelope.mockImplementation(() => {
      throw new Error('Unknown vessel class: bogus_vessel');
    });

    expect(() => controller.setEnvelope('bogus_vessel', {})).not.toThrow();

    expect(onErrorChange).toHaveBeenCalledWith('Unknown vessel class: bogus_vessel');
    // overrides was already {}, so there is nothing sensible to fall back to —
    // must not retry (which would just throw again for the same reason).
    expect(controller.dynamic.setEnvelope).toHaveBeenCalledTimes(1);
  });

  test('setOpacity applies to both overlays', () => {
    const controller = makeController();
    controller.setOpacity(0.5);
    expect(controller.fixed.setOpacity).toHaveBeenCalledWith(0.5);
    expect(controller.dynamic.setOpacity).toHaveBeenCalledWith(0.5);
  });
});

describe('NiueSuitabilityController callback forwarding', () => {
  test('onTimeChange/onLoadingChange/onErrorChange/onStatsChange assign onto the fixed overlay', () => {
    const controller = makeController();
    const onTimeChange = jest.fn();
    const onLoadingChange = () => {};
    const onErrorChange = () => {};
    const onStatsChange = () => {};

    controller.onTimeChange = onTimeChange;
    controller.onLoadingChange = onLoadingChange;
    controller.onErrorChange = onErrorChange;
    controller.onStatsChange = onStatsChange;

    expect(controller.fixed.onTimeChange).toEqual(expect.any(Function));
    controller.fixed.onTimeChange('2026-08-20 00:00 UTC', 0, 15);
    expect(controller.dynamic.setMaxTimeIndex).toHaveBeenCalledWith(15);
    expect(onTimeChange).toHaveBeenCalledWith('2026-08-20 00:00 UTC', 0, 15);
    expect(controller.fixed.onLoadingChange).toBe(onLoadingChange);
    expect(controller.fixed.onErrorChange).toBe(onErrorChange);
    expect(controller.fixed.onStatsChange).toBe(onStatsChange);

    expect(controller.onTimeChange).toBe(onTimeChange);
  });

  test('getTimeLabels delegates to the fixed overlay', () => {
    const controller = makeController();
    expect(controller.getTimeLabels()).toEqual(['2026-08-20 00:00 UTC']);
  });

  // Unlike the four above, only the dynamic overlay has a meaningful
  // "buffering" concept (see NiueSuitabilityDynamicOverlay's own comment) —
  // this must forward to dynamic, not fixed.
  test('onBufferingChange assigns onto the dynamic overlay, not the fixed one', () => {
    const controller = makeController();
    const onBufferingChange = () => {};

    controller.onBufferingChange = onBufferingChange;

    expect(controller.dynamic.onBufferingChange).toBe(onBufferingChange);
    expect(controller.fixed.onBufferingChange).toBeUndefined();
    expect(controller.onBufferingChange).toBe(onBufferingChange);
  });
});

describe('NiueSuitabilityController point queries and teardown', () => {
  test('getSuitabilityAtPoint delegates to the fixed (preset-classified) overlay', async () => {
    const controller = makeController();
    const result = await controller.getSuitabilityAtPoint(-169.9, -19.05);
    expect(controller.fixed.getSuitabilityAtPoint).toHaveBeenCalledWith(-169.9, -19.05);
    expect(result).toEqual({ hazard_class: 0 });
  });

  test('destroy tears down both overlays', () => {
    const controller = makeController();
    controller.destroy();
    expect(controller.fixed.destroy).toHaveBeenCalled();
    expect(controller.dynamic.destroy).toHaveBeenCalled();
  });
});
