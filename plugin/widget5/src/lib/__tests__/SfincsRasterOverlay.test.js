import { SfincsRasterOverlay } from '../SfincsRasterOverlay';

// Minimal MapLibre stand-in -- these tests only exercise blob URL
// lifecycle, not real source/layer wiring, so every call just needs to
// not throw.
function fakeMap() {
  return {
    getLayer: () => null,
    getSource: () => null,
    addSource: () => {},
    addLayer: () => {},
    removeLayer: () => {},
    removeSource: () => {},
  };
}

// _initialize() (called from the constructor) fetches /timesteps and
// /metadata; `fetch` is undefined in this jsdom env, so that call throws
// synchronously and is caught internally by _initialize()'s own try/catch
// (surfaced only via onErrorChange, which is null here) -- safe to ignore
// for tests that only touch _revokeBlobUrl() directly.
describe('SfincsRasterOverlay blob URL revocation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // Regression test for "InvalidStateError: The source image could not be
  // decoded." -- MapLibre's ImageSource.updateImage() decodes a blob: URL
  // asynchronously, so revoking the *previous* frame's URL the instant the
  // next frame is applied (e.g. during fast timeline scrubbing, where
  // _applyCanvasFrame() calls can land back-to-back from the frame cache)
  // could race MapLibre's still-in-flight decode of it and throw in the
  // console. Revocation must be deferred, not synchronous.
  test('does not revoke a blob URL synchronously, only after a delay long enough to outlast any in-flight decode', () => {
    const overlay = new SfincsRasterOverlay(fakeMap(), { apiBase: 'http://example.test' });
    overlay._currentBlobUrl = 'blob:fake-url-1';

    overlay._revokeBlobUrl();

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(overlay._currentBlobUrl).toBeNull(); // cleared immediately so a new URL can be tracked

    jest.advanceTimersByTime(3000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url-1');
  });

  test('is a no-op when there is no current blob URL to revoke', () => {
    const overlay = new SfincsRasterOverlay(fakeMap(), { apiBase: 'http://example.test' });
    overlay._currentBlobUrl = null;

    overlay._revokeBlobUrl();
    jest.advanceTimersByTime(5000);

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});

// Regression test for "Cannot read properties of undefined (reading
// 'bind')", thrown from maplibre-gl's drawRaster (webgl/draw/draw_raster.ts)
// when a tile's texture was never created. Root cause traced into
// maplibre-gl's own source/image_source.ts: ImageSource.onAdd() -> load()
// for the placeholder image runs async, on MapLibre's own schedule --
// separate from addSource() returning. If _loadFrame() (-> updateImage())
// runs before that placeholder load ever starts, it overwrites
// this.options.url first; if the blob URL involved then gets revoked
// before MapLibre gets around to loading *anything* for this source,
// ImageSource.image is never set, so prepare()'s `if (!this.image) return;`
// guard is permanently true and tile.texture is never created -- every
// future render crashes. _addToMap() must wait for the placeholder
// source's own load to finish (its 'data' event) before calling
// _loadFrame() for the first time.
describe('SfincsRasterOverlay._addToMap() placeholder-load ordering', () => {
  function fakeImageSource() {
    let loaded = false;
    let onData = null;
    return {
      loaded: () => loaded,
      once: (event, cb) => { if (event === 'data') onData = cb; },
      updateImage: jest.fn(),
      resolvePlaceholderLoad() {
        loaded = true;
        onData?.();
      },
    };
  }

  function fakeMapWithSource(source) {
    return {
      getLayer: () => null,
      getSource: () => source,
      addSource: () => {},
      addLayer: () => {},
      removeLayer: () => {},
      removeSource: () => {},
    };
  }

  test('defers the first _loadFrame() call until the placeholder source reports loaded', () => {
    const source = fakeImageSource();
    const overlay = new SfincsRasterOverlay(fakeMapWithSource(source), {
      apiBase: 'http://example.test',
      bounds: { southWest: [-1, -1], northEast: [1, 1] },
    });
    const loadFrameSpy = jest.spyOn(overlay, '_loadFrame').mockImplementation(() => {});

    overlay._addToMap();
    expect(loadFrameSpy).not.toHaveBeenCalled();

    source.resolvePlaceholderLoad();
    expect(loadFrameSpy).toHaveBeenCalledWith(0);
  });

  test('calls _loadFrame() immediately if the source already reports loaded', () => {
    const source = fakeImageSource();
    source.resolvePlaceholderLoad(); // pre-loaded before _addToMap() runs
    const overlay = new SfincsRasterOverlay(fakeMapWithSource(source), {
      apiBase: 'http://example.test',
      bounds: { southWest: [-1, -1], northEast: [1, 1] },
    });
    const loadFrameSpy = jest.spyOn(overlay, '_loadFrame').mockImplementation(() => {});

    overlay._addToMap();
    expect(loadFrameSpy).toHaveBeenCalledWith(0);
  });
});
