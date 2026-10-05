import { normalizeViewBounds } from '../viewBounds';

describe('normalizeViewBounds', () => {
  test('an ordinary view is unchanged', () => {
    const b = { west: -159.88, south: -21.3, east: -159.67, north: -21.17 };
    expect(normalizeViewBounds(b)).toEqual(b);
  });
  test('a zoomed-out view wrapping past -180 is clamped (the live case that failed)', () => {
    expect(normalizeViewBounds({ west: -328.85, south: -80.27, east: 5.35, north: 73.18 }))
      .toEqual({ west: -180, south: -80.27, east: 5.35, north: 73.18 });
  });
  test('a view on a world copy is shifted back by whole turns', () => {
    const b = normalizeViewBounds({ west: 200.12, south: -22, east: 200.5, north: -21 });
    expect(b.west).toBeCloseTo(-159.88);
    expect(b.east).toBeCloseTo(-159.5);
  });
  test('polar latitudes are clamped; unusable input is null', () => {
    expect(normalizeViewBounds({ west: -170, south: -89.9, east: -150, north: 89.9 })).toMatchObject({ south: -85.0511, north: 85.0511 });
    expect(normalizeViewBounds(null)).toBeNull();
    expect(normalizeViewBounds({ west: NaN, south: 0, east: 1, north: 1 })).toBeNull();
  });
});
