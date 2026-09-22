import {
  MAX_GRID_CACHE_ENTRIES,
  NiueSuitabilityDynamicOverlay,
} from '../NiueSuitabilityDynamicOverlay';
import { classifySuitability, SUITABILITY_HAZARD_COLORS } from '../NiueSuitabilityOverlay';

const makeGrid = (timeIndex = 0, overrides = {}) => ({
  width: 1,
  height: 1,
  wind: new Float32Array([0]),
  wave: new Float32Array([0]),
  valid: new Uint8Array([1]),
  bounds: { lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 },
  validTime: `2026-08-20T${String(timeIndex).padStart(2, '0')}:00:00Z`,
  ...overrides,
});

async function flushMicrotasks(turns = 8) {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

function makeRequestOverlay(fetchImpl, { visible = false } = {}) {
  const overlay = Object.create(NiueSuitabilityDynamicOverlay.prototype);
  Object.assign(overlay, {
    _gridCache: new Map(),
    _gridFetches: new Map(),
    _fetchControllers: new Map(),
    _prefetchInFlight: new Set(),
    _activeFetchTimeIndex: null,
    _grid: null,
    _envelope: null,
    _lastSummary: null,
    _visible: visible,
    _destroyed: false,
    _requestId: 0,
    _requestedTimeIndex: null,
    _renderedTimeIndex: null,
    _maxTimeIndex: null,
    _status: 'idle',
    _statusError: null,
    _repaintFrame: null,
    _ensureCanvasSize: jest.fn(),
    _repaint: jest.fn(),
    _fetchGrid: jest.fn(fetchImpl),
    onBufferingChange: jest.fn(),
    onSummaryChange: jest.fn(),
    onStatusChange: jest.fn(),
  });
  return overlay;
}

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

const validFloatHeaders = (overrides = {}) => ({
  'X-Grid-Width': '1',
  'X-Grid-Height': '1',
  'X-Lon-Min': '-170',
  'X-Lon-Max': '-169',
  'X-Lat-Min': '-19',
  'X-Lat-Max': '-18',
  ...overrides,
});

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

  test.each([
    [{ 'X-Lon-Min': '-169', 'X-Lon-Max': '-170' }, /bounds/i],
    [{ 'X-Lat-Min': '-18', 'X-Lat-Max': '-19' }, /bounds/i],
    [{ 'X-Lon-Max': 'not-a-number' }, /bounds/i],
  ])('rejects non-finite or unordered coordinate bounds: %p', async (overrides, message) => {
    const resp = fakeGridResponse(validFloatHeaders(overrides));
    await expect(NiueSuitabilityDynamicOverlay._parseGridResponse(resp)).rejects.toThrow(message);
  });

  test('rejects a payload whose byte length does not match its declared dimensions', async () => {
    const resp = fakeGridResponse(validFloatHeaders({
      'X-Grid-Width': '2',
      'X-Grid-Height': '1',
    }), 9);

    await expect(NiueSuitabilityDynamicOverlay._parseGridResponse(resp)).rejects.toThrow(
      /payload length mismatch.*expected 18.*got 9/i
    );
  });

  test('rejects dimensions whose product is not a safe cell count', async () => {
    const resp = fakeGridResponse(validFloatHeaders({
      'X-Grid-Width': String(Number.MAX_SAFE_INTEGER),
      'X-Grid-Height': '2',
    }));

    await expect(NiueSuitabilityDynamicOverlay._parseGridResponse(resp)).rejects.toThrow(/cell count/i);
  });

  test('preserves the optional valid-time header on the parsed grid', async () => {
    const resp = fakeGridResponse(validFloatHeaders({
      'X-Valid-Time': '2026-08-20T03:00:00Z',
    }));

    await expect(NiueSuitabilityDynamicOverlay._parseGridResponse(resp)).resolves.toMatchObject({
      validTime: '2026-08-20T03:00:00Z',
    });
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

  test.each([
    [{}, /scale/i],
    [{ 'X-Wind-Scale': '0', 'X-Wave-Scale': '1000' }, /scale/i],
    [{ 'X-Wind-Scale': '100', 'X-Wave-Scale': '-1' }, /scale/i],
    [{ 'X-Wind-Scale': 'invalid', 'X-Wave-Scale': '1000' }, /scale/i],
  ])('rejects missing or non-positive quantization scales: %p', async (scaleHeaders, message) => {
    const resp = fakeGridResponse({
      ...validFloatHeaders(),
      'X-Grid-Encoding': 'wind:i16le,wave:i16le,valid:u8',
      ...scaleHeaders,
    }, 5);

    await expect(NiueSuitabilityDynamicOverlay._parseGridResponse(resp)).rejects.toThrow(message);
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
    overlay._repaintFrame = null;
    overlay._destroyed = false;
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

  test('rejects equal caution and avoid thresholds because the caution band would disappear', () => {
    const overlay = makeOverlay();
    expect(() =>
      overlay.setEnvelope('small_craft', { cautionWindKt: 20, maxWindKt: 20 })
    ).toThrow(/wind.*lower/i);
    expect(() =>
      overlay.setEnvelope('small_craft', { cautionWaveHeightM: 2, maxWaveHeightM: 2 })
    ).toThrow(/wave.*lower/i);
  });

  test.each([
    ['cautionWindKt', NaN],
    ['maxWindKt', Infinity],
    ['cautionWaveHeightM', -0.1],
    ['maxWaveHeightM', '2.5'],
  ])('rejects invalid numeric override %s=%p', (field, value) => {
    const overlay = makeOverlay();
    expect(() => overlay.setEnvelope('small_craft', { [field]: value })).toThrow(
      /finite, non-negative number/i
    );
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

  test('ignores non-adjustable metadata instead of letting overrides relabel a vessel', () => {
    const overlay = makeOverlay();
    overlay.setEnvelope('small_craft', {
      label: 'Not Small Craft',
      advisoryLevel: 'Unverified override',
      maxWaveHeightM: 2.5,
    });

    expect(overlay._envelope).toMatchObject({
      label: 'Small Craft',
      advisoryLevel: 'Small Craft Advisory',
      maxWaveHeightM: 2.5,
    });
  });
});

describe('NiueSuitabilityDynamicOverlay.setTimeIndex race guard', () => {
  test('a slow earlier fetch does not overwrite a faster later one', async () => {
    let resolveSlow;
    const slow = new Promise((resolve) => { resolveSlow = resolve; });
    const fast = Promise.resolve(makeGrid(11));
    const overlay = makeRequestOverlay();
    overlay._fetchGrid
      .mockImplementationOnce(() => slow)  // timeIndex 10, requested first, resolves last
      .mockImplementationOnce(() => fast)  // timeIndex 11, requested second, resolves first
      .mockImplementation((timeIndex) => Promise.resolve(makeGrid(timeIndex)));

    const p10 = overlay.setTimeIndex(10);
    const p11 = overlay.setTimeIndex(11);
    await p11;
    expect(overlay._grid).toBe(await fast); // timeIndex 11's grid is current
    expect(overlay.getStatus()).toEqual({
      status: 'ready', requestedTimeIndex: 11, renderedTimeIndex: 11, error: null,
    });

    resolveSlow(makeGrid(10, { bounds: { stale: true } }));
    await p10;
    expect(overlay._renderedTimeIndex).toBe(11); // late timeIndex 10 must not clobber it
    expect(overlay.getStatus().status).toBe('ready');
  });
});

// onBufferingChange is the "still catching up" signal shown in the UI while
// a real backend fetch is in flight for the timestep currently being
// requested — most relevant during playback against the not-yet-redeployed
// float32 backend, where a fetch can take ~2s against a playback tick as
// short as ~350ms.
describe('NiueSuitabilityDynamicOverlay onBufferingChange', () => {
  function makeOverlay(fetchImpl) {
    return makeRequestOverlay(fetchImpl);
  }

  test('fires true then false around a real (cache-miss) fetch', async () => {
    let resolveFetch;
    const overlay = makeOverlay(() => new Promise((resolve) => { resolveFetch = resolve; }));

    const pending = overlay.setTimeIndex(5);
    expect(overlay.onBufferingChange).toHaveBeenCalledWith(true);
    expect(overlay.onBufferingChange).not.toHaveBeenCalledWith(false);
    expect(overlay.onSummaryChange).toHaveBeenCalledWith(null);
    expect(overlay.getStatus()).toEqual({
      status: 'loading', requestedTimeIndex: 5, renderedTimeIndex: null, error: null,
    });

    resolveFetch(makeGrid(5));
    await pending;
    expect(overlay.onBufferingChange).toHaveBeenLastCalledWith(false);
    expect(overlay.getStatus()).toEqual({
      status: 'ready', requestedTimeIndex: 5, renderedTimeIndex: 5, error: null,
    });
    expect(overlay.onStatusChange).toHaveBeenLastCalledWith(overlay.getStatus());
  });

  test('does not enter buffering for a cache hit', async () => {
    const overlay = makeOverlay(() => Promise.resolve(makeGrid(5)));
    overlay._gridCache.set(5, makeGrid(5, { bounds: { cached: true } }));

    await overlay.setTimeIndex(5);

    expect(overlay.onBufferingChange).not.toHaveBeenCalledWith(true);
    expect(overlay.onBufferingChange).toHaveBeenLastCalledWith(false);
    expect(overlay._fetchGrid).not.toHaveBeenCalled();
    expect(overlay.getStatus().status).toBe('ready');
  });

  test('still fires false even when the fetch rejects', async () => {
    const overlay = makeOverlay(() => Promise.reject(new Error('network error')));

    await expect(overlay.setTimeIndex(5)).rejects.toThrow('network error');

    expect(overlay.onBufferingChange).toHaveBeenCalledWith(true);
    expect(overlay.onBufferingChange).toHaveBeenLastCalledWith(false);
    expect(overlay.getStatus()).toEqual({
      status: 'error', requestedTimeIndex: 5, renderedTimeIndex: null, error: 'network error',
    });
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
    resolveSlow(makeGrid(10));
    await p10;
    expect(overlay.onBufferingChange).not.toHaveBeenCalledWith(false);

    resolveFast(makeGrid(11));
    await p11;
    expect(overlay.onBufferingChange).toHaveBeenLastCalledWith(false);
    expect(overlay.getStatus()).toEqual({
      status: 'ready', requestedTimeIndex: 11, renderedTimeIndex: 11, error: null,
    });
  });
});

// Playback advances the timeline on a fixed interval regardless of fetch
// speed; prefetching the next few timesteps in the background after each
// successful setTimeIndex is what lets those later ticks usually find their
// grid already cached instead of starting cold every time.
describe('NiueSuitabilityDynamicOverlay prefetching', () => {
  function makeOverlay(fetchImpl) {
    const overlay = makeRequestOverlay(fetchImpl, { visible: true });
    overlay.setMaxTimeIndex(100);
    return overlay;
  }

  test('setTimeIndex(N) prefetches N+1..N+3 into the cache without being awaited', async () => {
    const overlay = makeOverlay((timeIndex) => Promise.resolve(makeGrid(timeIndex)));

    await overlay.setTimeIndex(10);
    expect(overlay._fetchGrid).toHaveBeenCalledWith(10, expect.any(AbortSignal));
    // Prefetches are fire-and-forget promises, not part of setTimeIndex's
    // own awaited chain — give their microtasks a turn to settle.
    await flushMicrotasks();

    expect(overlay._fetchGrid).toHaveBeenCalledWith(11, expect.any(AbortSignal));
    expect(overlay._fetchGrid).toHaveBeenCalledWith(12, expect.any(AbortSignal));
    expect(overlay._fetchGrid).toHaveBeenCalledWith(13, expect.any(AbortSignal));
    expect(overlay._gridCache.get(11)).toBeDefined();
    expect(overlay._gridCache.get(12)).toBeDefined();
    expect(overlay._gridCache.get(13)).toBeDefined();
  });

  test('does not re-fetch a timestep that is already cached or already being prefetched', async () => {
    const overlay = makeOverlay((timeIndex) => Promise.resolve(makeGrid(timeIndex)));
    overlay._gridCache.set(11, { cached: true }); // already have this one
    overlay._prefetchInFlight.add(12); // already fetching this one

    await overlay.setTimeIndex(10);
    await flushMicrotasks();

    expect(overlay._fetchGrid).not.toHaveBeenCalledWith(11, expect.any(AbortSignal));
    expect(overlay._fetchGrid).not.toHaveBeenCalledWith(12, expect.any(AbortSignal));
    expect(overlay._fetchGrid).toHaveBeenCalledWith(13, expect.any(AbortSignal));
  });

  test('a prefetch failure is swallowed silently, not surfaced as an error', async () => {
    const overlay = makeOverlay((timeIndex) =>
      timeIndex === 11 ? Promise.reject(new Error('network blip')) : Promise.resolve(makeGrid(timeIndex))
    );

    await expect(overlay.setTimeIndex(10)).resolves.toBeUndefined();
    await flushMicrotasks();

    expect(overlay._gridCache.has(11)).toBe(false);
    expect(overlay._prefetchInFlight.has(11)).toBe(false); // cleaned up despite the rejection
  });

  test('a hidden overlay fetches only the requested frame and does not prefetch', async () => {
    const overlay = makeRequestOverlay((timeIndex) => Promise.resolve(makeGrid(timeIndex)), { visible: false });

    await overlay.setTimeIndex(10);
    await flushMicrotasks();

    expect(overlay._fetchGrid).toHaveBeenCalledTimes(1);
    expect(overlay._fetchGrid).toHaveBeenCalledWith(10, expect.any(AbortSignal));
  });

  test('does not speculatively prefetch while the forecast horizon is unknown', async () => {
    const overlay = makeRequestOverlay((timeIndex) => Promise.resolve(makeGrid(timeIndex)), { visible: true });

    await overlay.setTimeIndex(10);
    await flushMicrotasks();

    expect(overlay._fetchGrid).toHaveBeenCalledTimes(1);
    expect(overlay._fetchGrid).toHaveBeenCalledWith(10, expect.any(AbortSignal));
  });

  test('does not prefetch beyond the declared forecast horizon', async () => {
    const overlay = makeOverlay((timeIndex) => Promise.resolve(makeGrid(timeIndex)));
    overlay.setMaxTimeIndex(11);

    await overlay.setTimeIndex(10);
    await flushMicrotasks();

    expect(overlay._fetchGrid).toHaveBeenCalledWith(11, expect.any(AbortSignal));
    expect(overlay._fetchGrid).not.toHaveBeenCalledWith(12, expect.any(AbortSignal));
    expect(overlay._fetchGrid).not.toHaveBeenCalledWith(13, expect.any(AbortSignal));
  });
});

describe('NiueSuitabilityDynamicOverlay shared bounded grid cache', () => {
  test('deduplicates concurrent requests for the same timestep and shares one AbortSignal-backed promise', async () => {
    let resolveFetch;
    const overlay = makeRequestOverlay(() => new Promise((resolve) => { resolveFetch = resolve; }));

    const first = overlay._getOrFetchGrid(4);
    const second = overlay._getOrFetchGrid(4);

    expect(second).toBe(first);
    expect(overlay._fetchGrid).toHaveBeenCalledTimes(1);
    expect(overlay._fetchGrid).toHaveBeenCalledWith(4, expect.any(AbortSignal));

    const grid = makeGrid(4);
    resolveFetch(grid);
    await expect(first).resolves.toBe(grid);
    await expect(second).resolves.toBe(grid);

    expect(overlay._gridCache.get(4)).toBe(grid);
    expect(overlay._gridFetches.size).toBe(0);
    expect(overlay._fetchControllers.size).toBe(0);
  });

  test('caps decoded grids with LRU eviction while preserving the rendered frame', () => {
    const overlay = makeRequestOverlay(() => Promise.resolve());
    overlay._renderedTimeIndex = 0;

    for (let index = 0; index <= MAX_GRID_CACHE_ENTRIES; index++) {
      overlay._cacheGrid(index, makeGrid(index));
    }

    expect(overlay._gridCache).toHaveProperty('size', MAX_GRID_CACHE_ENTRIES);
    expect(overlay._gridCache.has(0)).toBe(true); // rendered frame is protected
    expect(overlay._gridCache.has(1)).toBe(false); // oldest non-rendered frame was evicted

    overlay._getCachedGrid(2); // touch 2 so it becomes most recently used
    overlay._cacheGrid(MAX_GRID_CACHE_ENTRIES + 1, makeGrid(MAX_GRID_CACHE_ENTRIES + 1));

    expect(overlay._gridCache).toHaveProperty('size', MAX_GRID_CACHE_ENTRIES);
    expect(overlay._gridCache.has(2)).toBe(true);
    expect(overlay._gridCache.has(3)).toBe(false);
  });

  test('does not cache a request that resolves after the overlay is destroyed', async () => {
    let resolveFetch;
    const overlay = makeRequestOverlay(() => new Promise((resolve) => { resolveFetch = resolve; }));
    overlay._map = {};

    const pending = overlay._getOrFetchGrid(7);
    const signal = overlay._fetchGrid.mock.calls[0][1];
    overlay.destroy();

    expect(signal.aborted).toBe(true);
    resolveFetch(makeGrid(7));
    await expect(pending).resolves.toBeDefined();
    expect(overlay._gridCache.size).toBe(0);
  });
});

describe('NiueSuitabilityDynamicOverlay request cancellation and fetch contract', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('constructor is network-lazy and defers canvas context creation', () => {
    global.fetch = jest.fn();
    const overlay = new NiueSuitabilityDynamicOverlay({}, 'https://example.test/');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(overlay._ctx).toBeNull();
    expect(overlay.getStatus().status).toBe('idle');

    overlay.destroy();
  });

  test('_fetchGrid passes its AbortSignal to fetch', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    const overlay = Object.create(NiueSuitabilityDynamicOverlay.prototype);
    overlay._apiBase = 'https://example.test';
    const controller = new AbortController();

    await expect(overlay._fetchGrid(6, controller.signal)).rejects.toThrow(/503/);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.test/niue/suitability/grid/6',
      { signal: controller.signal }
    );
  });

  test('cancelPendingRequests aborts active signals, clears request bookkeeping, and emits idle status', () => {
    const overlay = makeRequestOverlay(() => new Promise(() => {}));
    overlay._getOrFetchGrid(9);
    const signal = overlay._fetchGrid.mock.calls[0][1];

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);

    overlay.cancelPendingRequests();

    expect(signal.aborted).toBe(true);
    expect(overlay._gridFetches.size).toBe(0);
    expect(overlay._fetchControllers.size).toBe(0);
    expect(overlay._prefetchInFlight.size).toBe(0);
    expect(overlay.onBufferingChange).toHaveBeenLastCalledWith(false);
    expect(overlay.getStatus().status).toBe('idle');
  });

  // Playback advances the requested time_index every tick, faster than a
  // real (unquantized-backend) grid fetch can complete. Without aborting
  // the superseded fetch, every previous tick's still-in-flight request
  // just keeps competing for bandwidth with the one actually being waited
  // on — and since none of them ever gets to apply (requestId fencing
  // discards a stale result on arrival), the map can go an entire playback
  // session without ever repainting again.
  test('setTimeIndex aborts the previous time_index fetch it supersedes', () => {
    const overlay = makeRequestOverlay(() => new Promise(() => {}));

    overlay.setTimeIndex(1);
    const firstSignal = overlay._fetchGrid.mock.calls[0][1];
    expect(firstSignal.aborted).toBe(false);

    overlay.setTimeIndex(2);
    const secondSignal = overlay._fetchGrid.mock.calls[1][1];

    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(false);
  });

  test('setTimeIndex does not abort its own fetch when re-requesting the same time_index', () => {
    const overlay = makeRequestOverlay(() => new Promise(() => {}));

    overlay.setTimeIndex(4);
    const signal = overlay._fetchGrid.mock.calls[0][1];

    overlay.setTimeIndex(4);

    expect(signal.aborted).toBe(false);
    // Same time_index while already in flight is deduped, not re-fetched.
    expect(overlay._fetchGrid).toHaveBeenCalledTimes(1);
  });

  test('setTimeIndex reuses a still-in-flight prefetch for the frame it lands on instead of aborting and re-fetching it', () => {
    const overlay = makeRequestOverlay(() => new Promise(() => {}));

    // Simulate frame 2 already being prefetched (e.g. kicked off while frame
    // 0 was showing) and still in flight.
    overlay._getOrFetchGrid(2);
    const prefetchSignal = overlay._fetchGrid.mock.calls[0][1];

    overlay.setTimeIndex(1); // becomes the active direct request
    overlay.setTimeIndex(2); // playback catches up to the frame already being prefetched

    expect(prefetchSignal.aborted).toBe(false);
    // Reused the in-flight prefetch promise via _getOrFetchGrid's existing
    // same-time_index dedup — not a second, redundant fetch for frame 2.
    expect(overlay._fetchGrid).toHaveBeenCalledTimes(2); // frame 2 (prefetch) + frame 1 (direct)
  });
});

describe('NiueSuitabilityDynamicOverlay stale point inspection', () => {
  function makePointOverlay() {
    const overlay = Object.create(NiueSuitabilityDynamicOverlay.prototype);
    overlay._grid = null;
    overlay._repaintFrame = null;
    overlay._destroyed = false;
    overlay.setEnvelope('small_craft', {
      cautionWindKt: 12,
      maxWindKt: 18,
      cautionWaveHeightM: 1,
      maxWaveHeightM: 2,
    });
    overlay._grid = makeGrid(3, {
      wind: new Float32Array([15]),
      wave: new Float32Array([0.5]),
    });
    return overlay;
  }

  test('blocks a point result when the rendered grid belongs to an older requested timestep', async () => {
    const overlay = makePointOverlay();
    overlay._requestedTimeIndex = 4;
    overlay._renderedTimeIndex = 3;

    await expect(overlay.getSuitabilityAtPoint(0.5, 0.5)).resolves.toMatchObject({
      available: false,
      hazard_class: null,
      is_custom_envelope: true,
      requested_time_index: 4,
      rendered_time_index: 3,
      unavailable_reason: expect.stringMatching(/older frame|not finished loading/i),
    });
  });

  test('returns a classified, time-stamped point only when requested and rendered timesteps match', async () => {
    const overlay = makePointOverlay();
    overlay._requestedTimeIndex = 3;
    overlay._renderedTimeIndex = 3;

    await expect(overlay.getSuitabilityAtPoint(0.5, 0.5)).resolves.toMatchObject({
      available: true,
      hazard_class: 1,
      vessel: 'small_craft',
      wind_speed_kt: 15,
      wave_height_m: 0.5,
      time_index: 3,
      valid_time: '2026-08-20T03:00:00Z',
      is_custom_envelope: true,
      classification_basis: 'custom_wind_wave_thresholds',
      thresholds_used: {
        cautionWindKt: 12,
        maxWindKt: 18,
        cautionWaveHeightM: 1,
        maxWaveHeightM: 2,
      },
    });
  });

  test('fails closed for non-finite point coordinates or model values', async () => {
    const overlay = makePointOverlay();
    overlay._requestedTimeIndex = 3;
    overlay._renderedTimeIndex = 3;

    await expect(overlay.getSuitabilityAtPoint(Number.NaN, 0.5)).resolves.toMatchObject({
      available: false,
      hazard_class: null,
      unavailable_reason: expect.stringMatching(/coordinates are invalid/i),
    });

    overlay._grid.wind[0] = Number.NaN;
    await expect(overlay.getSuitabilityAtPoint(0.5, 0.5)).resolves.toMatchObject({
      available: false,
      hazard_class: null,
      time_index: 3,
      unavailable_reason: expect.stringMatching(/wind or wave data is invalid/i),
    });
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
  function paintSinglePixel(windKt, waveM, vesselCode, overrides = {}) {
    const overlay = Object.create(NiueSuitabilityDynamicOverlay.prototype);
    const width = 1;
    const height = 1;
    const pixels = new Uint8ClampedArray(4);

    const grid = {
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

    // setEnvelope now coalesces UI changes with requestAnimationFrame. Keep
    // this pure repaint test synchronous by resolving the envelope before a
    // grid is attached, then invoke the paint primitive directly.
    overlay._grid = null;
    overlay._repaintFrame = null;
    overlay._destroyed = false;
    overlay.setEnvelope(vesselCode, overrides);
    overlay._grid = grid;
    overlay._repaint();
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

  test('uses custom thresholds at the exact caution and avoid boundaries', () => {
    const cautionPixels = paintSinglePixel(12, 0.5, 'small_craft', {
      cautionWindKt: 12, maxWindKt: 18, cautionWaveHeightM: 1, maxWaveHeightM: 2,
    });
    const avoidPixels = paintSinglePixel(18, 0.5, 'small_craft', {
      cautionWindKt: 12, maxWindKt: 18, cautionWaveHeightM: 1, maxWaveHeightM: 2,
    });

    expect(Array.from(cautionPixels).slice(0, 3)).toEqual([251, 140, 0]);
    expect(Array.from(avoidPixels).slice(0, 3)).toEqual([229, 57, 53]);
  });

  test('an invalid cell is painted fully transparent regardless of wind/wave values', () => {
    const overlay = Object.create(NiueSuitabilityDynamicOverlay.prototype);
    const pixels = new Uint8ClampedArray(4);
    const grid = {
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

    overlay._grid = null;
    overlay._repaintFrame = null;
    overlay._destroyed = false;
    overlay.setEnvelope('small_craft');
    overlay._grid = grid;
    overlay._repaint();
    expect(pixels[3]).toBe(0);
  });
});
