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

describe('lowestExposureWindow', () => {
  // eslint-disable-next-line global-require
  const { lowestExposureWindow } = require('../seriesAnalysis');
  const st = (i, warning, caution = 0, available = true) => ({ timeIndex: i, validTime: i * 3600e3, available, warning, caution, suitable: 100 - warning - caution });

  test('picks the run with the lowest mean Warning share, then the lowest Caution', () => {
    const w = lowestExposureWindow([st(0, 90), st(1, 40, 30), st(2, 40, 10), st(3, 80)], 1);
    expect(w).toMatchObject({ warning: 40, caution: 10, flat: false, highestWarning: 90 });
    expect(w.start.timeIndex).toBe(2);
  });

  test('a multi-step window is judged on its mean and never spans a gap', () => {
    const series = [st(0, 10), st(1, 90, 0, false), st(2, 20), st(3, 30), st(4, 100)];
    const w = lowestExposureWindow(series, 2);
    expect([w.start.timeIndex, w.end.timeIndex]).toEqual([2, 3]); // 0+gap is not contiguous
    expect(w.warning).toBe(25);
  });

  test('flat when the Warning share never changes, so there is no better period to name', () => {
    expect(lowestExposureWindow([st(0, 100), st(1, 100), st(2, 100)], 1)).toMatchObject({ flat: true, highestWarning: 100 });
  });

  test('null with nothing available', () => {
    expect(lowestExposureWindow([st(0, 50, 0, false)], 1)).toBeNull();
  });
});
