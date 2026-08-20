import { NiueSuitabilityDynamicOverlay } from '../NiueSuitabilityDynamicOverlay';
import { classifySuitability, SUITABILITY_HAZARD_COLORS } from '../NiueSuitabilityOverlay';

// Grid decoding is pure data-shape math (no DOM), so it's tested directly
// against the backend's documented layout: wind (f32le) then wave (f32le)
// then valid (u8), each row-major (lat, lon).
describe('NiueSuitabilityDynamicOverlay grid decoding', () => {
  test('splits a packed buffer into wind/wave/valid views at the right offsets', () => {
    const width = 2;
    const height = 2;
    const cellCount = width * height;
    const buffer = new ArrayBuffer(cellCount * 4 * 2 + cellCount);

    new Float32Array(buffer, 0, cellCount).set([1, 2, 3, 4]);
    new Float32Array(buffer, cellCount * 4, cellCount).set([0.1, 0.2, 0.3, 0.4]);
    new Uint8Array(buffer, cellCount * 8, cellCount).set([1, 1, 0, 1]);

    const bounds = { lonMin: -170, lonMax: -169, latMin: -19, latMax: -18 };
    const grid = NiueSuitabilityDynamicOverlay._decodeGridBuffer(buffer, width, height, bounds);

    expect(Array.from(grid.wind)).toEqual([1, 2, 3, 4]);
    expect(Array.from(grid.wave)).toEqual([0.1, 0.2, 0.3, 0.4].map(Math.fround));
    expect(Array.from(grid.valid)).toEqual([1, 1, 0, 1]);
    expect(grid.bounds).toEqual(bounds);
  });
});

// Regression coverage for a real production incident: the backend's CORS
// config didn't set Access-Control-Expose-Headers for these custom X-Grid-*
// headers, so cross-origin resp.headers.get() silently returned null for
// all of them. Number(null) is 0 (not NaN), so this slipped past a naive
// isNaN check and reached createImageData(0, 0), which throws a much less
// diagnosable error several calls deeper in the stack.
function fakeGridResponse(headerValues, bufferByteLength = 9) {
  return {
    headers: { get: (name) => (name in headerValues ? headerValues[name] : null) },
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(bufferByteLength)),
  };
}

describe('NiueSuitabilityDynamicOverlay._parseGridResponse header validation', () => {
  test('throws a diagnosable error when grid dimension headers are entirely missing', async () => {
    const resp = fakeGridResponse({});
    await expect(NiueSuitabilityDynamicOverlay._parseGridResponse(resp)).rejects.toThrow(
      /X-Grid-Width|CORS|Access-Control-Expose-Headers/i
    );
  });

  test('throws rather than silently proceeding with a 0x0 grid', async () => {
    const resp = fakeGridResponse({ 'X-Grid-Width': '0', 'X-Grid-Height': '0' });
    await expect(NiueSuitabilityDynamicOverlay._parseGridResponse(resp)).rejects.toThrow();
  });

  test('throws on a non-numeric dimension header', async () => {
    const resp = fakeGridResponse({ 'X-Grid-Width': 'not-a-number', 'X-Grid-Height': '10' });
    await expect(NiueSuitabilityDynamicOverlay._parseGridResponse(resp)).rejects.toThrow();
  });

  test('resolves normally when headers are present and valid', async () => {
    const resp = fakeGridResponse(
      {
        'X-Grid-Width': '2',
        'X-Grid-Height': '1',
        'X-Lon-Min': '-170', 'X-Lon-Max': '-169', 'X-Lat-Min': '-19', 'X-Lat-Max': '-18',
      },
      2 * 4 * 2 + 2, // width*height * (2 float32 bands) + valid bytes
    );
    const grid = await NiueSuitabilityDynamicOverlay._parseGridResponse(resp);
    expect(grid.width).toBe(2);
    expect(grid.height).toBe(1);
    expect(grid.bounds).toEqual({ lonMin: -170, lonMax: -169, latMin: -19, latMax: -18 });
  });
});

// The backend now sends quantized int16 (scaled) instead of float32 —
// measured ~23x smaller on the wire after gzip, the difference between
// Custom mode's grid fetch keeping up with a live playback tick or not.
// This path must stay correct independent of the legacy float32 path,
// which a not-yet-redeployed backend can still be serving.
describe('NiueSuitabilityDynamicOverlay._parseGridResponse quantized (i16le) decoding', () => {
  test('rescales int16 wind/wave values by their X-Wind-Scale/X-Wave-Scale headers', async () => {
    const width = 2;
    const height = 1;
    const cellCount = width * height;
    const buffer = new ArrayBuffer(cellCount * 2 * 2 + cellCount);
    new Int16Array(buffer, 0, cellCount).set([1500, 2000]); // wind, scale 100 -> 15.00, 20.00 kt
    new Int16Array(buffer, cellCount * 2, cellCount).set([1500, 2000]); // wave, scale 1000 -> 1.5, 2.0 m
    new Uint8Array(buffer, cellCount * 4, cellCount).set([1, 1]);

    const resp = {
      headers: {
        get: (name) => ({
          'X-Grid-Width': '2',
          'X-Grid-Height': '1',
          'X-Lon-Min': '-170', 'X-Lon-Max': '-169', 'X-Lat-Min': '-19', 'X-Lat-Max': '-18',
          'X-Grid-Encoding': 'wind:i16le,wave:i16le,valid:u8',
          'X-Wind-Scale': '100',
          'X-Wave-Scale': '1000',
        }[name] ?? null),
      },
      arrayBuffer: () => Promise.resolve(buffer),
    };

    const grid = await NiueSuitabilityDynamicOverlay._parseGridResponse(resp);
    expect(Array.from(grid.wind)).toEqual([15, 20]);
    expect(Array.from(grid.wave)).toEqual([1.5, 2]);
    expect(Array.from(grid.valid)).toEqual([1, 1]);
  });
});

describe('NiueSuitabilityDynamicOverlay.destroy resilience', () => {
  test('does not throw if the map was already torn down (getLayer throws)', () => {
    const overlay = Object.create(NiueSuitabilityDynamicOverlay.prototype);
    overlay._gridCache = new Map();
    overlay._prefetchInFlight = new Set();
    overlay._grid = { some: 'grid' };
    overlay._envelope = { some: 'envelope' };
    overlay._map = {
      getLayer: jest.fn(() => { throw new Error('map is destroyed'); }),
      getSource: jest.fn(),
      removeLayer: jest.fn(),
      removeSource: jest.fn(),
    };

    expect(() => overlay.destroy()).not.toThrow();
    expect(overlay._grid).toBeNull();
    expect(overlay._envelope).toBeNull();
  });
});

// Regression coverage for a real production bug: with animate: false,
// MapLibre's CanvasSource only uploads the canvas to its GPU texture once,
// on creation (see canvas_source.ts: prepare() only calls texture.update()
// when `resize || this._playing`). Every _repaint() after the first
// correctly redrew the offscreen canvas but the map never showed it —
// dragging a Custom-mode slider had no visible effect despite _repaint()
// running and _grid/_envelope both being populated correctly.
describe('NiueSuitabilityDynamicOverlay._ensureMapSource texture refresh', () => {
  test('an existing canvas source gets play() then pause() to force a one-shot texture upload', () => {
    const overlay = Object.create(NiueSuitabilityDynamicOverlay.prototype);
    const calls = [];
    const existingSource = {
      setCoordinates: jest.fn(() => calls.push('setCoordinates')),
      play: jest.fn(() => calls.push('play')),
      pause: jest.fn(() => calls.push('pause')),
    };
    overlay._map = { getSource: jest.fn(() => existingSource) };

    overlay._ensureMapSource({ lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 });

    expect(calls).toEqual(['setCoordinates', 'play', 'pause']);
  });

  test('does not throw if the source predates play()/pause() support', () => {
    const overlay = Object.create(NiueSuitabilityDynamicOverlay.prototype);
    const existingSource = { setCoordinates: jest.fn() }; // no play/pause
    overlay._map = { getSource: jest.fn(() => existingSource) };

    expect(() =>
      overlay._ensureMapSource({ lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 })
    ).not.toThrow();
  });
});

describe('NiueSuitabilityDynamicOverlay.setEnvelope', () => {
  function makeOverlay() {
    const overlay = Object.create(NiueSuitabilityDynamicOverlay.prototype);
    overlay._map = {};
    overlay._grid = null;
    overlay._envelope = null;
    return overlay;
  }

  test('rejects a caution threshold above the max threshold (wind)', () => {
    const overlay = makeOverlay();
    expect(() =>
      overlay.setEnvelope('small_craft', { cautionWindKt: 25, maxWindKt: 20 })
    ).toThrow(/wind/i);
  });

  test('rejects a caution threshold above the max threshold (wave)', () => {
    const overlay = makeOverlay();
    expect(() =>
      overlay.setEnvelope('small_craft', { cautionWaveHeightM: 3.0, maxWaveHeightM: 2.0 })
    ).toThrow(/wave/i);
  });

  test('throws on an unknown vessel class', () => {
    const overlay = makeOverlay();
    expect(() => overlay.setEnvelope('not_a_real_vessel')).toThrow(/unknown vessel/i);
  });

  test('accepts overrides merged onto the vessel preset without repainting when no grid is loaded', () => {
    const overlay = makeOverlay();
    overlay._repaint = jest.fn();
    overlay.setEnvelope('small_craft', { maxWaveHeightM: 2.5 });
    expect(overlay._envelope.maxWaveHeightM).toBe(2.5);
    expect(overlay._envelope.cautionWindKt).toBe(15); // untouched preset field survives the merge
    expect(overlay._repaint).not.toHaveBeenCalled();
  });
});

describe('NiueSuitabilityDynamicOverlay.setTimeIndex race guard', () => {
  test('a slow earlier fetch does not overwrite a faster later one', async () => {
    const overlay = Object.create(NiueSuitabilityDynamicOverlay.prototype);
    overlay._gridCache = new Map();
    overlay._prefetchInFlight = new Set();
    overlay._grid = null;
    overlay._envelope = null;
    overlay._requestId = 0;
    overlay._ensureCanvasSize = jest.fn();
    overlay._repaint = jest.fn();

    let resolveSlow;
    const slow = new Promise((resolve) => { resolveSlow = resolve; });
    const fast = Promise.resolve({ width: 1, height: 1, wind: [0], wave: [0], valid: [1], bounds: {} });

    overlay._fetchGrid = jest.fn()
      .mockImplementationOnce(() => slow)  // timeIndex 10, requested first, resolves last
      .mockImplementationOnce(() => fast)  // timeIndex 11, requested second, resolves first
      // Every call after that is this test's own setTimeIndex() calls'
      // _prefetchAhead() firing in the background — not under test here,
      // just needs to resolve cleanly instead of hitting jest.fn()'s
      // default "return undefined" once the queued mocks are exhausted.
      .mockImplementation(() => Promise.resolve({ width: 1, height: 1, wind: [0], wave: [0], valid: [1], bounds: {} }));

    const p10 = overlay.setTimeIndex(10);
    const p11 = overlay.setTimeIndex(11);
    await p11;
    expect(overlay._grid.bounds).toEqual({}); // timeIndex 11's grid is current

    resolveSlow({ width: 1, height: 1, wind: [9], wave: [9], valid: [1], bounds: { stale: true } });
    await p10;
    expect(overlay._grid.bounds).toEqual({}); // the late timeIndex 10 response must not clobber it
  });
});

// onBufferingChange is the "still catching up" signal shown in the UI while
// a real backend fetch is in flight for the timestep currently being
// requested — most relevant during playback against the not-yet-redeployed
// float32 backend, where a fetch can take ~2s against a playback tick as
// short as ~350ms.
describe('NiueSuitabilityDynamicOverlay onBufferingChange', () => {
  function makeOverlay(fetchImpl) {
    const overlay = Object.create(NiueSuitabilityDynamicOverlay.prototype);
    overlay._gridCache = new Map();
    overlay._prefetchInFlight = new Set();
    overlay._grid = null;
    overlay._envelope = null;
    overlay._requestId = 0;
    overlay._ensureCanvasSize = jest.fn();
    overlay._repaint = jest.fn();
    overlay._fetchGrid = jest.fn(fetchImpl);
    overlay.onBufferingChange = jest.fn();
    return overlay;
  }

  test('fires true then false around a real (cache-miss) fetch', async () => {
    let resolveFetch;
    const overlay = makeOverlay(() => new Promise((resolve) => { resolveFetch = resolve; }));

    const pending = overlay.setTimeIndex(5);
    expect(overlay.onBufferingChange).toHaveBeenCalledWith(true);
    expect(overlay.onBufferingChange).not.toHaveBeenCalledWith(false);

    resolveFetch({ width: 1, height: 1, wind: [0], wave: [0], valid: [1], bounds: {} });
    await pending;
    expect(overlay.onBufferingChange).toHaveBeenLastCalledWith(false);
  });

  test('does not fire at all for a cache hit', async () => {
    const overlay = makeOverlay(() => Promise.resolve({ width: 1, height: 1, wind: [0], wave: [0], valid: [1], bounds: {} }));
    overlay._gridCache.set(5, { width: 1, height: 1, wind: [0], wave: [0], valid: [1], bounds: { cached: true } });

    await overlay.setTimeIndex(5);

    expect(overlay.onBufferingChange).not.toHaveBeenCalled();
  });

  test('still fires false even when the fetch rejects', async () => {
    const overlay = makeOverlay(() => Promise.reject(new Error('network error')));

    await expect(overlay.setTimeIndex(5)).rejects.toThrow('network error');

    expect(overlay.onBufferingChange).toHaveBeenCalledWith(true);
    expect(overlay.onBufferingChange).toHaveBeenLastCalledWith(false);
  });

  test('a superseded request does not clear buffering while a newer one is still in flight', async () => {
    let resolveSlow, resolveFast;
    const overlay = makeOverlay((timeIndex) =>
      timeIndex === 10
        ? new Promise((resolve) => { resolveSlow = resolve; })
        : new Promise((resolve) => { resolveFast = resolve; })
    );

    const p10 = overlay.setTimeIndex(10);
    const p11 = overlay.setTimeIndex(11);

    // timeIndex 10's fetch resolving should NOT report "done" — 11 is now current.
    resolveSlow({ width: 1, height: 1, wind: [0], wave: [0], valid: [1], bounds: {} });
    await p10;
    expect(overlay.onBufferingChange).not.toHaveBeenCalledWith(false);

    resolveFast({ width: 1, height: 1, wind: [0], wave: [0], valid: [1], bounds: {} });
    await p11;
    expect(overlay.onBufferingChange).toHaveBeenLastCalledWith(false);
  });
});

// Playback advances the timeline on a fixed interval regardless of fetch
// speed; prefetching the next few timesteps in the background after each
// successful setTimeIndex is what lets those later ticks usually find their
// grid already cached instead of starting cold every time.
describe('NiueSuitabilityDynamicOverlay prefetching', () => {
  function makeOverlay(fetchImpl) {
    const overlay = Object.create(NiueSuitabilityDynamicOverlay.prototype);
    overlay._gridCache = new Map();
    overlay._prefetchInFlight = new Set();
    overlay._grid = null;
    overlay._envelope = null;
    overlay._requestId = 0;
    overlay._ensureCanvasSize = jest.fn();
    overlay._repaint = jest.fn();
    overlay._fetchGrid = jest.fn(fetchImpl);
    return overlay;
  }

  test('setTimeIndex(N) prefetches N+1..N+3 into the cache without being awaited', async () => {
    const overlay = makeOverlay((timeIndex) =>
      Promise.resolve({ width: 1, height: 1, wind: [0], wave: [0], valid: [1], bounds: { timeIndex } })
    );

    await overlay.setTimeIndex(10);
    expect(overlay._fetchGrid).toHaveBeenCalledWith(10);
    // Prefetches are fire-and-forget promises, not part of setTimeIndex's
    // own awaited chain — give their microtasks a turn to settle.
    await Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());

    expect(overlay._fetchGrid).toHaveBeenCalledWith(11);
    expect(overlay._fetchGrid).toHaveBeenCalledWith(12);
    expect(overlay._fetchGrid).toHaveBeenCalledWith(13);
    expect(overlay._gridCache.get(11).bounds).toEqual({ timeIndex: 11 });
    expect(overlay._gridCache.get(12).bounds).toEqual({ timeIndex: 12 });
    expect(overlay._gridCache.get(13).bounds).toEqual({ timeIndex: 13 });
  });

  test('does not re-fetch a timestep that is already cached or already being prefetched', async () => {
    const overlay = makeOverlay(() =>
      Promise.resolve({ width: 1, height: 1, wind: [0], wave: [0], valid: [1], bounds: {} })
    );
    overlay._gridCache.set(11, { cached: true }); // already have this one
    overlay._prefetchInFlight.add(12); // already fetching this one

    await overlay.setTimeIndex(10);
    await Promise.resolve().then(() => Promise.resolve());

    expect(overlay._fetchGrid).not.toHaveBeenCalledWith(11);
    expect(overlay._fetchGrid).not.toHaveBeenCalledWith(12);
    expect(overlay._fetchGrid).toHaveBeenCalledWith(13);
  });

  test('a prefetch failure is swallowed silently, not surfaced as an error', async () => {
    const overlay = makeOverlay((timeIndex) =>
      timeIndex === 11 ? Promise.reject(new Error('network blip')) : Promise.resolve({
        width: 1, height: 1, wind: [0], wave: [0], valid: [1], bounds: {},
      })
    );

    await expect(overlay.setTimeIndex(10)).resolves.toBeUndefined();
    await Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());

    expect(overlay._gridCache.has(11)).toBe(false);
    expect(overlay._prefetchInFlight.has(11)).toBe(false); // cleaned up despite the rejection
  });
});

describe('NiueSuitabilityDynamicOverlay.setVisible', () => {
  test('is applied once the layer is created, even if called before it exists', () => {
    const overlay = Object.create(NiueSuitabilityDynamicOverlay.prototype);
    const addLayerCalls = [];
    overlay._map = {
      getLayer: jest.fn(() => false),
      getSource: jest.fn(() => null),
      addSource: jest.fn(),
      addLayer: jest.fn((cfg) => addLayerCalls.push(cfg)),
      setLayoutProperty: jest.fn(),
      triggerRepaint: jest.fn(),
    };
    overlay._canvas = { width: 0, height: 0 };

    overlay.setVisible(false); // called before any repaint has run

    overlay._ensureMapSource({ lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 });

    expect(addLayerCalls[0].layout).toEqual({ visibility: 'none' });
  });
});

// Per-pixel classification must agree with the existing point-query
// classifySuitability (NiueSuitabilityOverlay.js) — same max(windHazard,
// waveHazard) rule, just applied across a raster instead of one point.
describe('NiueSuitabilityDynamicOverlay._repaint classification parity', () => {
  function paintSinglePixel(windKt, waveM, vesselCode) {
    const overlay = Object.create(NiueSuitabilityDynamicOverlay.prototype);
    const width = 1;
    const height = 1;
    const pixels = new Uint8ClampedArray(4);

    overlay._grid = {
      width,
      height,
      wind: new Float32Array([windKt]),
      wave: new Float32Array([waveM]),
      valid: new Uint8Array([1]),
      bounds: { lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 },
    };
    overlay._imageData = { data: pixels };
    overlay._ctx = { putImageData: jest.fn() };
    overlay._map = {
      getSource: jest.fn(() => null),
      addSource: jest.fn(),
      addLayer: jest.fn(),
      triggerRepaint: jest.fn(),
    };

    overlay.setEnvelope(vesselCode);
    return pixels;
  }

  const cases = [
    ['small_craft', 5, 0.5], // suitable
    ['small_craft', 17, 0.5], // caution on wind
    ['small_craft', 5, 1.8], // caution on wave
    ['small_craft', 22, 0.5], // warning on wind
    ['small_craft', 5, 2.2], // warning on wave
  ];

  test.each(cases)('vessel=%s wind=%dkt wave=%dm matches classifySuitability', (vessel, wind, wave) => {
    const expectedHazard = classifySuitability(vessel, wind, wave);
    const expectedRgb = SUITABILITY_HAZARD_COLORS[expectedHazard];
    const [r, g, b] = [
      Number.parseInt(expectedRgb.slice(1, 3), 16),
      Number.parseInt(expectedRgb.slice(3, 5), 16),
      Number.parseInt(expectedRgb.slice(5, 7), 16),
    ];

    const pixels = paintSinglePixel(wind, wave, vessel);
    expect(Array.from(pixels)).toEqual([r, g, b, 205]);
  });

  test('an invalid cell is painted fully transparent regardless of wind/wave values', () => {
    const overlay = Object.create(NiueSuitabilityDynamicOverlay.prototype);
    const pixels = new Uint8ClampedArray(4);
    overlay._grid = {
      width: 1,
      height: 1,
      wind: new Float32Array([50]), // would be a warning if valid
      wave: new Float32Array([5]),
      valid: new Uint8Array([0]),
      bounds: { lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 },
    };
    overlay._imageData = { data: pixels };
    overlay._ctx = { putImageData: jest.fn() };
    overlay._map = {
      getSource: jest.fn(() => null),
      addSource: jest.fn(),
      addLayer: jest.fn(),
      triggerRepaint: jest.fn(),
    };

    overlay.setEnvelope('small_craft');
    expect(pixels[3]).toBe(0);
  });
});
