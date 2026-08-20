import { NiueSuitabilityController } from '../NiueSuitabilityController';

// Constructing a real controller pulls in NiueSuitabilityOverlay's
// map.on('error', ...) + live /niue/suitability/timesteps fetch, which is
// its own concern (covered by NiueSuitabilityOverlay's own tests). These
// tests only exercise NiueSuitabilityController's delegation logic, so they
// build a harness controller with fake fixed/dynamic overlays instead.
function makeController() {
  const controller = Object.create(NiueSuitabilityController.prototype);
  controller._mode = 'preset';
  controller._isPlaying = false;
  controller.fixed = {
    setTimeIndex: jest.fn(),
    setOpacity: jest.fn(),
    setVessel: jest.fn(),
    setVisible: jest.fn(),
    getSuitabilityAtPoint: jest.fn(() => Promise.resolve({ hazard_class: 0 })),
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
    setVisible: jest.fn(),
    destroy: jest.fn(),
  };
  return controller;
}

// Regression coverage for a real production bug: a freshly constructed
// controller only got its dynamic overlay synced (first grid fetch, mode,
// envelope) via useZarrMap's sliderIndex/mode effects — both of which are
// no-ops if the relevant React state doesn't happen to *change* value on
// this particular layer switch (e.g. sliderIndex is already 0). That left
// the dynamic overlay's _grid permanently null, so every setEnvelope() call
// from dragging a Custom-mode slider silently no-opped in _repaint() with
// nothing ever appearing on the map. These tests exercise the real
// constructor (not the harness pattern above) since the bug lived there.
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

  test('seeds the dynamic overlay with an initial grid fetch even when timeIndex is 0', async () => {
    mockFetchForGridAndTimesteps();
    const map = fakeMap();
    const controller = new NiueSuitabilityController(map, {
      apiBase: 'https://example.test',
      vessel: 'small_craft',
      timeIndex: 0,
      suitabilityMode: 'preset',
      customEnvelope: null,
    });

    await Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());

    expect(controller.dynamic._grid).not.toBeNull();
    expect(controller.dynamic._grid.width).toBe(1);
  });

  test('starting in custom mode makes the dynamic overlay visible and seeds its envelope', async () => {
    mockFetchForGridAndTimesteps();
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

    await Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());
    // Both the grid (from setTimeIndex) and the envelope (seeded synchronously
    // above) are present, so the very first repaint has something to paint —
    // the bug this covers left _grid null forever in this exact scenario.
    expect(controller.dynamic._grid).not.toBeNull();
  });

  test('starting in preset mode leaves the dynamic canvas layer hidden, custom mode shows it', () => {
    mockFetchForGridAndTimesteps();

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

  test('starting already playing in Custom mode still shows preset tiles, not the canvas', () => {
    mockFetchForGridAndTimesteps();

    const controller = new NiueSuitabilityController(fakeMap(), {
      apiBase: 'https://example.test',
      vessel: 'traditional_craft',
      timeIndex: 0,
      suitabilityMode: 'custom',
      customEnvelope: null,
      isPlaying: true,
    });

    expect(controller.dynamic._visible).toBe(false);
    expect(controller.fixed._visible).toBe(true);
  });
});

describe('NiueSuitabilityController mode toggling', () => {
  test('setMode("custom") hides the fixed overlay and shows the dynamic one', () => {
    const controller = makeController();
    controller.setMode('custom');
    expect(controller.fixed.setVisible).toHaveBeenCalledWith(false);
    expect(controller.dynamic.setVisible).toHaveBeenCalledWith(true);
  });

  test('setMode("preset") shows the fixed overlay and hides the dynamic one', () => {
    const controller = makeController();
    controller.setMode('custom');
    controller.setMode('preset');
    expect(controller.fixed.setVisible).toHaveBeenLastCalledWith(true);
    expect(controller.dynamic.setVisible).toHaveBeenLastCalledWith(false);
  });

  test('rejects an unknown mode', () => {
    const controller = makeController();
    expect(() => controller.setMode('surprise')).toThrow(/unknown suitability mode/i);
  });
});

// Regression coverage for a real production issue: Custom mode's grid fetch
// (~15MB, ~2s) is far slower than a single playback tick, so racing to keep
// the canvas in sync with every tick left it visibly frozen/blank for the
// whole playback run. The fix is a deliberate fallback to the fast preset
// tiles while playing, not a data-loading fix — these tests cover the
// visibility side of that decision.
describe('NiueSuitabilityController playback fallback', () => {
  test('starting playback in Custom mode hides the canvas and shows preset tiles', () => {
    const controller = makeController();
    controller.setMode('custom');
    controller.fixed.setVisible.mockClear();
    controller.dynamic.setVisible.mockClear();

    controller.setPlaying(true);

    expect(controller.fixed.setVisible).toHaveBeenCalledWith(true);
    expect(controller.dynamic.setVisible).toHaveBeenCalledWith(false);
  });

  test('stopping playback in Custom mode re-reveals the canvas', () => {
    const controller = makeController();
    controller.setMode('custom');
    controller.setPlaying(true);
    controller.fixed.setVisible.mockClear();
    controller.dynamic.setVisible.mockClear();

    controller.setPlaying(false);

    expect(controller.fixed.setVisible).toHaveBeenCalledWith(false);
    expect(controller.dynamic.setVisible).toHaveBeenCalledWith(true);
  });

  test('playback has no visible effect in Preset mode (already showing tiles)', () => {
    const controller = makeController(); // starts in 'preset'
    controller.fixed.setVisible.mockClear();
    controller.dynamic.setVisible.mockClear();

    controller.setPlaying(true);

    expect(controller.fixed.setVisible).toHaveBeenCalledWith(true);
    expect(controller.dynamic.setVisible).toHaveBeenCalledWith(false);
  });

  test('toggling Custom mode while already playing keeps the canvas hidden', () => {
    const controller = makeController();
    controller.setPlaying(true);
    controller.fixed.setVisible.mockClear();
    controller.dynamic.setVisible.mockClear();

    controller.setMode('custom'); // user opens Custom mode mid-playback

    expect(controller.fixed.setVisible).toHaveBeenCalledWith(true);
    expect(controller.dynamic.setVisible).toHaveBeenCalledWith(false);
  });
});

describe('NiueSuitabilityController time/envelope/vessel delegation', () => {
  test('setTimeIndex drives both overlays regardless of active mode', () => {
    const controller = makeController();
    controller.setMode('custom');
    controller.setTimeIndex(5);
    expect(controller.fixed.setTimeIndex).toHaveBeenCalledWith(5);
    expect(controller.dynamic.setTimeIndex).toHaveBeenCalledWith(5);
  });

  test('a rejected dynamic.setTimeIndex forwards its error to onErrorChange instead of throwing', async () => {
    const controller = makeController();
    const onErrorChange = jest.fn();
    controller.onErrorChange = onErrorChange;
    controller.dynamic.setTimeIndex.mockReturnValueOnce(Promise.reject(new Error('grid fetch failed')));

    controller.setTimeIndex(3);
    await Promise.resolve().then(() => Promise.resolve()); // flush the .catch microtask

    expect(onErrorChange).toHaveBeenCalledWith('grid fetch failed');
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
    const onTimeChange = () => {};
    const onLoadingChange = () => {};
    const onErrorChange = () => {};
    const onStatsChange = () => {};

    controller.onTimeChange = onTimeChange;
    controller.onLoadingChange = onLoadingChange;
    controller.onErrorChange = onErrorChange;
    controller.onStatsChange = onStatsChange;

    expect(controller.fixed.onTimeChange).toBe(onTimeChange);
    expect(controller.fixed.onLoadingChange).toBe(onLoadingChange);
    expect(controller.fixed.onErrorChange).toBe(onErrorChange);
    expect(controller.fixed.onStatsChange).toBe(onStatsChange);

    expect(controller.onTimeChange).toBe(onTimeChange);
  });

  test('getTimeLabels delegates to the fixed overlay', () => {
    const controller = makeController();
    expect(controller.getTimeLabels()).toEqual(['2026-08-20 00:00 UTC']);
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
