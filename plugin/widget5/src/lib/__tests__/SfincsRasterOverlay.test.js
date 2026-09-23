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
