// Regression coverage for drawHazardShareBar: a smoke-test fixture once fed it
// Suitable/Caution/Warning shares that summed to 135% (60 + 25 + 50), which drew the
// Warning segment past the bar's own right edge into whatever sat next to it on the
// page (see CookIslandsCommsPosterPdf's poster card). The bar must never paint outside
// [x, x + w], however the input shares add up.
import { drawHazardShareBar } from '../pdfTheme';

function makeFakeDoc() {
  const rects = [];
  return {
    rects,
    setFillColor: () => {},
    rect: (x, y, w, h) => rects.push({ x, y, w, h }),
  };
}

describe('drawHazardShareBar', () => {
  test('never paints past the bar width when shares sum to over 100%', () => {
    const doc = makeFakeDoc();
    drawHazardShareBar(doc, 10, 0, 100, 4, [[0, 60], [1, 25], [2, 50]]); // sums to 135
    const rightmost = Math.max(...doc.rects.map((r) => r.x + r.w));
    expect(rightmost).toBeLessThanOrEqual(10 + 100 + 1e-6);
  });

  test('draws proportional segments summing to the bar width when shares total <= 100%', () => {
    const doc = makeFakeDoc();
    drawHazardShareBar(doc, 0, 0, 100, 4, [[0, 60], [1, 25], [2, 15]]); // sums to 100
    const total = doc.rects.reduce((sum, r) => sum + r.w, 0);
    expect(total).toBeCloseTo(100, 5);
    expect(doc.rects[0].w).toBeCloseTo(60, 5);
    expect(doc.rects[1].w).toBeCloseTo(25, 5);
    expect(doc.rects[2].w).toBeCloseTo(15, 5);
  });

  test('skips zero/negative shares without drawing a stray rect', () => {
    const doc = makeFakeDoc();
    drawHazardShareBar(doc, 0, 0, 100, 4, [[0, 0], [1, -5], [2, 100]]);
    expect(doc.rects).toHaveLength(1);
    expect(doc.rects[0].w).toBeCloseTo(100, 5);
  });
});
