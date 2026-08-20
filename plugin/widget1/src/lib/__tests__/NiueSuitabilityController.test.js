import { NiueSuitabilityController } from '../NiueSuitabilityController';

// Constructing a real controller pulls in NiueSuitabilityOverlay's
// map.on('error', ...) + live /niue/suitability/timesteps fetch, which is
// its own concern (covered by NiueSuitabilityOverlay's own tests). These
// tests only exercise NiueSuitabilityController's delegation logic, so they
// build a harness controller with fake fixed/dynamic overlays instead.
function makeController() {
  const controller = Object.create(NiueSuitabilityController.prototype);
  controller._mode = 'preset';
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
