import { defaultSliderIndex } from '../forecastTime';

const H = 3600e3;
const T0 = Date.UTC(2026, 8, 28, 6); // timeline start (hindcast start for the Cook suitability layer)
const hourly = (n) => Array.from({ length: n }, (_, i) => new Date(T0 + i * H));
const TL = hourly(229); // 28 Sept 06Z .. 7 Oct 18Z, like the live suitability timeline
const RUN = new Date(T0 + 48 * H); // model run: index 48

describe('defaultSliderIndex', () => {
  test('is the hour we are in, not index 0', () => {
    expect(defaultSliderIndex(TL, { now: new Date(T0 + 70 * H + 20 * 60e3) })).toBe(70);
    expect(defaultSliderIndex(TL, { now: new Date(T0 + 70 * H) })).toBe(70);
  });

  test('Cook suitability: never lands in the frozen 48 h hindcast, even when now is earlier than the run', () => {
    expect(defaultSliderIndex(TL, { now: new Date(T0 + 10 * H), modelRunStart: RUN })).toBe(48);
    expect(defaultSliderIndex(TL, { now: new Date(T0 - 5 * H), modelRunStart: RUN })).toBe(48);
    // ...and once now is past the run start it simply follows the clock
    expect(defaultSliderIndex(TL, { now: new Date(T0 + 70 * H), modelRunStart: RUN })).toBe(70);
  });

  test('layers whose timeline starts at the run (modelRunStart = first timestamp) can use index 0', () => {
    expect(defaultSliderIndex(TL, { now: new Date(T0 - 5 * H), modelRunStart: TL[0] })).toBe(0);
  });

  test('clamps to the last step when now is past the end of the forecast', () => {
    expect(defaultSliderIndex(TL, { now: new Date(T0 + 500 * H), modelRunStart: RUN })).toBe(228);
  });

  test('a run start after the whole timeline resolves to the last step, not out of range', () => {
    expect(defaultSliderIndex(TL, { now: new Date(T0 + 100 * H), modelRunStart: new Date(T0 + 999 * H) })).toBe(228);
  });

  test('unusable input gives 0 and never throws: empty, non-array, bad dates, bad now', () => {
    expect(defaultSliderIndex([], {})).toBe(0);
    expect(defaultSliderIndex(null, {})).toBe(0);
    expect(defaultSliderIndex([new Date('nope'), new Date(T0)], { now: new Date(T0) })).toBe(0);
    expect(defaultSliderIndex(TL, { now: 'garbage' })).toBe(0);
  });

  test('a single-step timeline is index 0', () => {
    expect(defaultSliderIndex([new Date(T0)], { now: new Date(T0 + 99 * H) })).toBe(0);
  });
});
