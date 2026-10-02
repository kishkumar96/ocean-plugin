import { nextWindowRange } from '../InundationWindowControl';

const H = 3600e3;
const T0 = Date.UTC(2026, 9, 1, 6); // run's first step, 1 Oct 06:00 UTC
const steps = (n) => Array.from({ length: n }, (_, i) => new Date(T0 + i * H));

describe('nextWindowRange ("Next 48h Max")', () => {
  test('starts at the step for the current hour and runs 48 h ahead', () => {
    const r = nextWindowRange(steps(229), T0 + 21 * H + 40 * 60e3); // 21 h 40 min in
    expect(r).toMatchObject({ mode: 'rolling-48h', startIndex: 21, endIndex: 68, hours: 48 });
    expect(r.startTime.toISOString()).toBe('2026-10-02T03:00:00.000Z');
    expect(r.endTime.toISOString()).toBe('2026-10-04T02:00:00.000Z');
  });

  test('is NOT the last 48 steps of the run any more', () => {
    expect(nextWindowRange(steps(229), T0 + 5 * H).startIndex).toBe(5);
  });

  test('before the forecast starts: from the first step', () => {
    expect(nextWindowRange(steps(229), T0 - 3 * H)).toMatchObject({ startIndex: 0, endIndex: 47 });
  });

  test('near the end: runs to the last step and says it is shorter', () => {
    expect(nextWindowRange(steps(229), T0 + 220 * H)).toMatchObject({ startIndex: 220, endIndex: 228, hours: 9 });
  });

  test('forecast already over: the final 48 steps, rather than nothing', () => {
    expect(nextWindowRange(steps(229), T0 + 400 * H)).toMatchObject({ startIndex: 181, endIndex: 228, hours: 48 });
  });

  test('no timestamps: null', () => {
    expect(nextWindowRange([], T0)).toBeNull();
    expect(nextWindowRange(null, T0)).toBeNull();
  });
});
