import { SfincsRasterOverlay } from '../SfincsRasterOverlay';

// The impact window's own hazard block (the raster RiskScape read) replaces the time-range image, and
// falls back to it when the server does not have that cycle.

const BOUNDS = { southWest: [-21.28, -159.84], northEast: [-21.19, -159.71] };

function setup() {
  const source = { updateImage: jest.fn() };
  const map = {
    getLayer: () => null, getSource: () => source, addSource: () => {}, addLayer: () => {}, removeLayer: () => {}, removeSource: () => {},
  };
  // `fetch` is undefined while the constructor runs, so its own /timesteps request fails harmlessly.
  const overlay = new SfincsRasterOverlay(map, { apiBase: 'http://example.test', bounds: BOUNDS });
  overlay._sourceReady = true;
  overlay.onHazardBlockStatus = jest.fn();
  return { overlay, source };
}

const okResponse = (cycle = '2026092312') => ({ ok: true, status: 200, headers: { get: () => cycle }, blob: async () => new Blob(['png']) });
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('SfincsRasterOverlay hazard block', () => {
  beforeEach(() => {
    global.URL.createObjectURL = jest.fn(() => 'blob:hazard');
    global.URL.revokeObjectURL = jest.fn();
  });
  afterEach(() => { delete global.fetch; });

  test('draws the block image for the impact cycle and reports it', async () => {
    const { overlay, source } = setup();
    global.fetch = jest.fn(async () => okResponse());
    overlay.updateConfig({ rangeWindow: { mode: 'custom', startIndex: 54, endIndex: 228 }, hazardBlock: { cycleId: '2026092312', block: 2 } });
    await flush();

    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('http://example.test/cok/hazard/2026092312/block/2/raster-png?');
    expect(url).toContain('vmin=');
    expect(url).not.toContain('range-max');
    expect(source.updateImage).toHaveBeenCalledWith(expect.objectContaining({ url: 'blob:hazard' }));
    expect(overlay.onHazardBlockStatus).toHaveBeenLastCalledWith({ state: 'ok', cycleId: '2026092312', block: 2 });
  });

  test('does not refetch an unchanged block', async () => {
    const { overlay } = setup();
    global.fetch = jest.fn(async () => okResponse());
    overlay.updateConfig({ hazardBlock: { cycleId: '2026092312', block: 1 } });
    await flush();
    overlay.updateConfig({ hazardBlock: { cycleId: '2026092312', block: 1 } });
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('falls back to the time-range image when the server lacks the cycle', async () => {
    const { overlay, source } = setup();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = jest.fn(async () => ({ ok: false, status: 404, headers: { get: () => null } }));
    overlay.updateConfig({ rangeWindow: { mode: 'custom', startIndex: 54, endIndex: 228 }, hazardBlock: { cycleId: '2026092300', block: 1 } });
    await flush();

    expect(overlay.onHazardBlockStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'unavailable', cycleId: '2026092300' }));
    expect(source.updateImage).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/range-max/raster-png?start_index=54&end_index=228') }));
    console.warn.mockRestore();
  });

  // Regression: confirmed live -- once a hazard block 404s, this._hazardShown/
  // _hazardKey get cleared (see the catch branch), so the existing "does not
  // refetch an unchanged block" guard (this._hazardShown && this._hazardKey ===
  // url) never applies to a failed block -- any unrelated re-render that calls
  // updateConfig() while hazardBlock is still set (e.g. a color picker drag
  // elsewhere on the page re-triggering the owning effect) retried the exact
  // same known-404 URL every single time, hammering the endpoint.
  test('does not repeatedly refetch a block that 404d, on later unrelated updateConfig calls', async () => {
    const { overlay } = setup();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = jest.fn(async () => ({ ok: false, status: 404, headers: { get: () => null } }));
    const hazardBlock = { cycleId: '2026092900', block: 1 };
    overlay.updateConfig({ hazardBlock });
    await flush();
    overlay.updateConfig({ hazardBlock });
    await flush();
    overlay.updateConfig({ hazardBlock });
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // A genuinely different block (new cycle) must still be attempted fresh.
    overlay.updateConfig({ hazardBlock: { cycleId: '2026093000', block: 1 } });
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    console.warn.mockRestore();
  });

  test('going back to no hazard block restores the time range and clears the status', async () => {
    const { overlay, source } = setup();
    global.fetch = jest.fn(async () => okResponse());
    overlay.updateConfig({ rangeWindow: { mode: 'custom', startIndex: 0, endIndex: 71 }, hazardBlock: { cycleId: '2026092312', block: 1 } });
    await flush();
    overlay.updateConfig({ hazardBlock: null });

    expect(overlay.onHazardBlockStatus).toHaveBeenLastCalledWith(null);
    expect(source.updateImage).toHaveBeenLastCalledWith(expect.objectContaining({ url: expect.stringContaining('/range-max/raster-png?start_index=0&end_index=71') }));
  });
});
