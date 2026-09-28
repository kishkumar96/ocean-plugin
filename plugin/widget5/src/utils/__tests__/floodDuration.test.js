import { computeFloodedHours } from '../floodDuration';

const at = (h, depth) => ({ time: new Date(Date.UTC(2026, 8, 24, h)).toISOString(), depth_m: depth });

describe('computeFloodedHours', () => {
  test('uniform hourly series', () => {
    expect(computeFloodedHours([at(0, 0), at(1, 0.5), at(2, 0.5), at(3, 0)], 0.1)).toBeCloseTo(2);
  });
  test('weights each sample by its own interval, not the first one', () => {
    // first step 1 h, then a 6 h gap: the wet sample at t=1 covers 6 h.
    expect(computeFloodedHours([at(0, 0), at(1, 0.5), at(7, 0)], 0.1)).toBeCloseTo(6);
  });
  test('last sample reuses the previous interval; short/empty series give 0', () => {
    expect(computeFloodedHours([at(0, 0), at(2, 0.5)], 0.1)).toBeCloseTo(2);
    expect(computeFloodedHours([at(0, 1)], 0.1)).toBe(0);
    expect(computeFloodedHours(null, 0.1)).toBe(0);
  });
});
