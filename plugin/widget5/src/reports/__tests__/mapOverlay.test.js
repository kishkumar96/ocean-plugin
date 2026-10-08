import { clipSegmentToBounds, segmentsInBounds, drawBoundaryOverlay } from '../mapOverlay';

const B = { west: 0, south: 0, east: 10, north: 10 };

describe('mapOverlay', () => {
  test('keeps a fully inside segment, drops a fully outside one, clips a crossing one', () => {
    expect(clipSegmentToBounds([[1, 1], [2, 2]], B)).toEqual([[1, 1], [2, 2]]);
    expect(clipSegmentToBounds([[11, 1], [12, 2]], B)).toBeNull();
    expect(clipSegmentToBounds([[-5, 5], [5, 5]], B)).toEqual([[0, 5], [5, 5]]);
    expect(clipSegmentToBounds([[5, -5], [5, 15]], B)).toEqual([[5, 0], [5, 10]]);
  });
  test('segmentsInBounds tolerates missing input', () => {
    expect(segmentsInBounds(null, B)).toEqual([]);
    expect(segmentsInBounds([[[1, 1], [2, 2]]], null)).toEqual([]);
  });
  test('draws mapped, clipped segments onto the image rectangle (north at the top)', () => {
    const lines = [];
    const doc = { setDrawColor() {}, setLineWidth() {}, line: (...a) => lines.push(a) };
    const n = drawBoundaryOverlay(doc, [[[0, 10], [10, 10]], [[20, 20], [30, 30]]], B, { x: 100, y: 50, w: 40, h: 20 });
    expect(n).toBe(1);
    expect(lines[0]).toEqual([100, 50, 140, 50]); // lat 10 = top edge, lon 0..10 = full width
  });
});
