import { CookIslandsSuitabilityDynamicOverlay } from '../CookIslandsSuitabilityDynamicOverlay';
import { resolveOperatingEnvelope } from '../CookIslandsSuitabilityOverlay';

// 2x2 grid over lon 0..2, lat 0..2. Source rows run south->north, so:
//   north row (idx 2,3): NW warning, NE caution
//   south row (idx 0,1): SW suitable, SE land (valid = 0)
function overlayWithGrid() {
  const overlay = new CookIslandsSuitabilityDynamicOverlay({});
  overlay._envelope = resolveOperatingEnvelope('small_craft'); // caution 15/1.5, warning 20/2.0
  overlay._grid = {
    width: 2,
    height: 2,
    bounds: { lonMin: 0, lonMax: 2, latMin: 0, latMax: 2 },
    wind: Float32Array.from([5, 30, 25, 16]),
    wave: Float32Array.from([0.5, 9, 0.5, 0.5]),
    valid: Uint8Array.from([1, 0, 1, 1]),
    validTime: '2026-09-22T06:00:00Z',
  };
  return overlay;
}

describe('CookIslandsSuitabilityDynamicOverlay.getPointAt', () => {
  test('returns the cell painted under the position, north row first', () => {
    const overlay = overlayWithGrid();
    expect(overlay.getPointAt(0.5, 1.5)).toMatchObject({ hazardClass: 2, windKt: 25 }); // NW
    expect(overlay.getPointAt(1.5, 1.5)).toMatchObject({ hazardClass: 1, windKt: 16 }); // NE
    expect(overlay.getPointAt(0.5, 0.5)).toMatchObject({ hazardClass: 0, windKt: 5 });  // SW
  });

  test('carries wave height, valid time and a copy of the envelope in force', () => {
    const point = overlayWithGrid().getPointAt(0.5, 0.5);
    expect(point.waveM).toBeCloseTo(0.5);
    expect(point.validTime).toBe('2026-09-22T06:00:00Z');
    expect(point.envelope).toMatchObject({ cautionWindKt: 15, maxWindKt: 20 });
  });

  test('reports the grid cell size derived from the grid bounds', () => {
    // 2 rows spanning 2 degrees of latitude -> one 2 degree step
    expect(overlayWithGrid().getPointAt(0.5, 0.5).cellSizeKm).toBeCloseTo(2 * 111.32, 1);
    const fine = overlayWithGrid();
    fine._grid = { ...fine._grid, height: 401, width: 2, wind: new Float32Array(802), wave: new Float32Array(802), valid: new Uint8Array(802).fill(1) };
    expect(fine.getPointAt(0.5, 1).cellSizeKm).toBeCloseTo(0.5566, 3);
  });

  test('classifies against the current envelope, so edits change the answer', () => {
    const overlay = overlayWithGrid();
    expect(overlay.getPointAt(0.5, 0.5).hazardClass).toBe(0);
    overlay._envelope = resolveOperatingEnvelope('small_craft', { cautionWindKt: 4, maxWindKt: 5 });
    expect(overlay.getPointAt(0.5, 0.5).hazardClass).toBe(2);
  });

  test('returns null on land / no-data cells', () => {
    expect(overlayWithGrid().getPointAt(1.5, 0.5)).toBeNull();
  });

  test.each([
    ['west of the grid', -0.1, 1],
    ['east edge (exclusive)', 2, 1],
    ['north of the grid', 1, 2.1],
    ['south edge (exclusive)', 1, 0],
    ['NaN', NaN, 1],
  ])('returns null for a position %s', (_name, lng, lat) => {
    expect(overlayWithGrid().getPointAt(lng, lat)).toBeNull();
  });

  test('returns null before a grid or envelope has loaded', () => {
    const overlay = overlayWithGrid();
    overlay._grid = null;
    expect(overlay.getPointAt(0.5, 0.5)).toBeNull();
    const noEnvelope = overlayWithGrid();
    noEnvelope._envelope = null;
    expect(noEnvelope.getPointAt(0.5, 0.5)).toBeNull();
  });
});

function fakeMap() {
  return {
    getLayer: jest.fn(() => false),
    getSource: jest.fn(() => null),
    addSource: jest.fn(),
    addLayer: jest.fn(),
    setLayoutProperty: jest.fn(),
    setPaintProperty: jest.fn(),
  };
}

describe('CookIslandsSuitabilityDynamicOverlay visibility race', () => {
  // Regression coverage for the late-overlay race: the controller can call
  // setVisible(false) (switching back to Preset mode) while this overlay's
  // very first grid fetch is still in flight, i.e. before LAYER_ID has ever
  // been created. setVisible() used to be a no-op in that case (nothing to
  // set the layout property ON yet), so the desired "hidden" state was lost
  // -- once the stale fetch finally resolved and _repaint() -> _ensureMapSource()
  // created the layer for the first time, MapLibre's default layout.visibility
  // ('visible') won, silently showing the custom overlay over a map the user
  // had already switched away from.
  test('a layer created after setVisible(false) comes up hidden, not MapLibre-default-visible', () => {
    const map = fakeMap();
    const overlay = new CookIslandsSuitabilityDynamicOverlay(map);

    overlay.setVisible(false); // simulates switching back to preset before the layer exists
    expect(map.setLayoutProperty).not.toHaveBeenCalled(); // nothing to set it on yet

    overlay._ensureMapSource({ lonMin: -160, lonMax: -159, latMin: -22, latMax: -21 });

    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ layout: { visibility: 'none' } }),
      undefined,
    );
  });

  test('a layer created without any setVisible() call defaults to visible, matching prior behavior', () => {
    const map = fakeMap();
    const overlay = new CookIslandsSuitabilityDynamicOverlay(map);

    overlay._ensureMapSource({ lonMin: -160, lonMax: -159, latMin: -22, latMax: -21 });

    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ layout: { visibility: 'visible' } }),
      undefined,
    );
  });

  test('setVisible still updates an already-created layer directly, as before', () => {
    const map = fakeMap();
    map.getLayer.mockReturnValue(true);
    const overlay = new CookIslandsSuitabilityDynamicOverlay(map);

    overlay.setVisible(false);

    expect(map.setLayoutProperty).toHaveBeenCalledWith('cok-suitability-dynamic-layer', 'visibility', 'none');
  });
});
