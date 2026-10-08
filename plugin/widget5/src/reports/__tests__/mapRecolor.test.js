import { pixelClass, recolorRgba, SERVICE_CLASS_RGB, MAP_FILL_RGB, recolorMapDataUrl } from '../mapRecolor';

describe('pixelClass', () => {
  test('classes by hue, as the live renders paint them', () => {
    expect(pixelClass(229, 86, 83)).toBe(2); // Warning, modal
    expect(pixelClass(217, 75, 72)).toBe(2); // Warning, shaded
    expect(pixelClass(246, 155, 38)).toBe(1); // Caution
    expect(pixelClass(72, 170, 159)).toBe(0); // Suitable
    expect(pixelClass(60, 158, 147)).toBe(0); // Suitable, shaded
  });
  test('land, background, coastline and grey edges are not class colours', () => {
    expect(pixelClass(244, 241, 232)).toBeNull(); // land
    expect(pixelClass(255, 255, 255)).toBeNull();
    expect(pixelClass(40, 40, 40)).toBeNull();
    expect(pixelClass(150, 150, 160)).toBeNull();
  });
});

describe('recolorRgba', () => {
  const px = (...rgbs) => new Uint8ClampedArray(rgbs.flatMap(([r, g, b, a = 255]) => [r, g, b, a]));
  test('moves each class to its map fill and keeps the shading offset', () => {
    const data = px(SERVICE_CLASS_RGB[2], [217, 75, 72], SERVICE_CLASS_RGB[1], SERVICE_CLASS_RGB[0]);
    expect(recolorRgba(data)).toBe(4);
    expect(Array.from(data.slice(0, 3))).toEqual(MAP_FILL_RGB[2]);
    // 12 darker in red than the base -> 12 darker than the fill
    expect(Array.from(data.slice(4, 7))).toEqual([MAP_FILL_RGB[2][0] - 12, MAP_FILL_RGB[2][1] - 11, MAP_FILL_RGB[2][2] - 11]);
    expect(Array.from(data.slice(8, 11))).toEqual(MAP_FILL_RGB[1]);
    expect(Array.from(data.slice(12, 15))).toEqual(MAP_FILL_RGB[0]);
  });
  test('leaves land, transparent and non-class pixels alone', () => {
    const data = px([244, 241, 232], [229, 86, 83, 0], [150, 150, 160]);
    const before = Array.from(data);
    expect(recolorRgba(data)).toBe(0);
    expect(Array.from(data)).toEqual(before);
  });
  test('the Warning map fill is calmer than the service red (darker and less saturated)', () => {
    const sat = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b);
    expect(sat(MAP_FILL_RGB[2])).toBeLessThan(sat(SERVICE_CLASS_RGB[2]));
    expect(MAP_FILL_RGB[2][0]).toBeLessThan(SERVICE_CLASS_RGB[2][0]);
  });
});

describe('recolorMapDataUrl', () => {
  test('is a no-op (null) without a real browser canvas, so callers keep the original', async () => {
    await expect(recolorMapDataUrl('data:image/png;base64,AAAA')).resolves.toBeNull();
  });
});
