import { bestWindow, highestRiskStep, elevatedRuns, recoveryWindows, unavailableRuns, coverageOf } from '../seriesAnalysis';

const H = 3600e3;
const step = (i, warning, caution = 0, available = true) => ({ timeIndex: i, validTime: i * H, available, warning: available ? warning : null, caution: available ? caution : null, suitable: available ? 100 - warning - caution : null });

describe('seriesAnalysis', () => {
  const series = [step(0, 0), step(1, 0), step(2, 0), step(3, 30), step(4, 40), step(5, 5), step(6, 0), step(7, 0, 0, false), step(8, 0), step(9, 25)];

  test('best window is the longest run with no Caution/Warning; a gap breaks it', () => {
    const w = bestWindow(series);
    expect(w.start.timeIndex).toBe(0);
    expect(w.end.timeIndex).toBe(2);
  });
  test('unavailable is never counted as suitable', () => {
    expect(bestWindow([step(0, 0, 0, false), step(1, 0, 0, false)])).toBeNull();
  });
  test('highest-risk step is the largest Warning share', () => {
    expect(highestRiskStep(series).timeIndex).toBe(4);
  });
  test('elevated runs are >= 20% Warning', () => {
    expect(elevatedRuns(series).map((r) => [r.start.timeIndex, r.end.timeIndex])).toEqual([[3, 4], [9, 9]]);
  });
  test('recovery window follows an elevated run until the next elevated step or a gap', () => {
    const rec = recoveryWindows(series);
    expect(rec).toHaveLength(1);
    expect(rec[0].from.timeIndex).toBe(5);
    expect(rec[0].to.timeIndex).toBe(6); // gap at 7 ends it
  });
  test('unavailable runs and coverage', () => {
    expect(unavailableRuns(series).map((r) => r.steps)).toEqual([1]);
    expect(coverageOf(series)).toEqual({ total: 10, available: 9, ratio: 0.9 });
  });
});
