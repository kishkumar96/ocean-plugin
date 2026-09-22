import { buildInundationLegendBands, parseLegendColorRange, X_SST_GRADIENT } from '../legendBands';

const categories = [
  { id: 'a', thresholdM: 0, color: '#000000' },
  { id: 'b', thresholdM: 0.5, color: '#111111' },
  { id: 'c', thresholdM: 1.0, color: '#222222' },
];
const baseArgs = { minVisibleDepth: 0.02, colorscalerange: '0,1', rasterMinDepth: 0, rasterMaxDepth: 1 };

describe('legendBands', () => {
  test('parses color scale ranges', () => {
    expect(parseLegendColorRange('0,3')).toEqual({ min: 0, max: 3 });
    expect(parseLegendColorRange('bad')).toBeNull();
  });

  test('builds inundation legend markers from thresholds', () => {
    const result = buildInundationLegendBands({ categories, ...baseArgs });

    // Hard-stop bar built from the categories themselves, with 5% headroom
    // above the last threshold (max 1.05): 0.5/1.05 = 47.62%, 1/1.05 = 95.24%.
    expect(result.gradient).toBe(
      'linear-gradient(to top, #000000 0.00% 47.62%, #111111 47.62% 95.24%, #222222 95.24% 100.00%)'
    );
    expect(result.min).toBe(0);
    expect(result.max).toBeGreaterThan(1);
    expect(result.ticks).toContain(0.5);
    expect(result.tickBands[0.5].id).toBe('b');
    expect(result.gradientMarkers).toHaveLength(2);
    expect(result.gradientMarkers[0].id).toBe('b');
    expect(result.gradientMarkers[1].id).toBe('c');
  });

  test('the bar follows edited category colours instead of a static ramp', () => {
    const edited = categories.map((c) => (c.id === 'b' ? { ...c, color: '#ff00ff' } : c));
    const result = buildInundationLegendBands({ categories: edited, ...baseArgs });
    expect(result.gradient).toContain('#ff00ff 47.62% 95.24%');
  });

  test('leaves the range below the first threshold transparent', () => {
    const shifted = categories.map((c) => ({ ...c, thresholdM: c.thresholdM + 0.2 }));
    const result = buildInundationLegendBands({ categories: shifted, ...baseArgs, minVisibleDepth: 0 });
    expect(result.gradient).toMatch(/^linear-gradient\(to top, transparent 0\.00% \d+\.\d+%, #000000/);
  });

  test('falls back to the static ramp with fewer than two categories', () => {
    const result = buildInundationLegendBands({ categories: categories.slice(0, 1), ...baseArgs });
    expect(result.gradient).toBe(X_SST_GRADIENT);
    expect(result.gradientMarkers).toEqual([]);
  });
});
