import { estimateDriver, describeChange, dailyEvolutionRows } from '../dailyEvolution';

// Small craft: Caution Hs >= 1.5 m or wind >= 15 kt; Warning Hs >= 2.0 m or wind >= 20 kt.
const env = { cautionWaveHeightM: 1.5, cautionWindKt: 15, maxWaveHeightM: 2.0, maxWindKt: 20 };
const step = (hsMax, windMax, warning = 10, extra = {}) => ({
  available: true, suitable: 100 - warning - 20, caution: 20, warning,
  wave: { min: 0.1, mean: hsMax / 2, max: hsMax }, wind: { min: windMax - 1, mean: windMax - 0.5, max: windMax }, ...extra,
});

describe('estimateDriver', () => {
  test('the variable over the Warning threshold, checked before Caution', () => {
    expect(estimateDriver(step(2.5, 12), env)).toMatchObject({ level: 'warning', driver: 'waves', label: 'Waves' });
    expect(estimateDriver(step(1.0, 22), env)).toMatchObject({ level: 'warning', driver: 'wind' });
    expect(estimateDriver(step(2.1, 21), env)).toMatchObject({ level: 'warning', driver: 'both', label: 'Waves and wind' });
    // wind only reaches Caution, waves Warning -> waves at Warning
    expect(estimateDriver(step(2.2, 16), env)).toMatchObject({ level: 'warning', driver: 'waves' });
    expect(estimateDriver(step(1.6, 10), env)).toMatchObject({ level: 'caution', driver: 'waves' });
  });

  test('a peak reported as null is missing, never 0 m', () => {
    expect(estimateDriver({ wave: { max: null }, wind: { max: null } }, env)).toBeNull();
    const [row] = dailyEvolutionRows([{ targetTime: 1, step: { ...step(1, 1, 10), wave: { max: null }, wind: { max: null } } }], env);
    expect(row.peakHsM).toBeNull();
    expect(row.peakWindKt).toBeNull();
  });

  test('below both thresholds, or no data', () => {
    expect(estimateDriver(step(0.8, 9), env)).toMatchObject({ level: null, driver: 'none', label: 'Below thresholds' });
    expect(estimateDriver({ wave: null, wind: null }, env)).toBeNull();
    expect(estimateDriver(step(2.5, 12), null)).toBeNull();
  });
});

describe('describeChange', () => {
  test('higher / lower in percentage points, steady under 2 points', () => {
    expect(describeChange(60, 40)).toMatchObject({ direction: 'higher', text: 'Higher (+20 pts Warning)' });
    expect(describeChange(15, 40)).toMatchObject({ direction: 'lower', text: 'Lower (-25 pts Warning)' });
    expect(describeChange(41, 40)).toMatchObject({ direction: 'steady', text: 'Steady' });
    expect(describeChange(null, 40)).toBeNull();
  });
});

describe('dailyEvolutionRows', () => {
  test('peaks, driver and change per day; gaps and beyond-horizon days keep their place', () => {
    const rows = dailyEvolutionRows([
      { targetTime: 1, matchedTime: 1, step: step(2.4, 12, 40) },
      { targetTime: 2, matchedTime: 2, step: { available: false } },
      { targetTime: 3, matchedTime: 3, step: step(1.2, 10, 5) },
      { targetTime: 4, beyondHorizon: true, step: null },
    ], env);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ available: true, peakHsM: 2.4, peakWindKt: 12, change: null });
    expect(rows[0].driver.driver).toBe('waves');
    expect(rows[1]).toMatchObject({ available: false, driver: null, change: null });
    // compared with the last day that had data (day 1), not the gap
    expect(rows[2].change).toMatchObject({ direction: 'lower', delta: -35 });
    expect(rows[3]).toMatchObject({ beyondHorizon: true, available: false });
  });
});
