import { pickWorstSample, sampleSeverity, thresholdsForHazard } from '../routeSeverity';
import { VESSEL_OPERATING_ENVELOPE } from '../../../lib/CookIslandsSuitabilityOverlay';
import { getWorstRouteSample, computeExceedance, selectRouteTableRows } from '../../../utils/CookIslandsRouteAdvisoryPdf';
import { deriveRouteDecision } from '../../../services/cookIslandsScenarioService';

const VESSEL = 'small_craft';
const ENV = VESSEL_OPERATING_ENVELOPE[VESSEL];

// The shape of the live Pukapuka -> Nassau forecast that exposed the bug: every
// sample after the first crosses Warning, the departure sample only just does
// (wind 20.9 kt against a 20 kt line, 0.24 m waves), and the real hazard is the
// offshore 3.19 m against a 2.0 m line.
const s = (i, wind, wave, hazard, extra = {}) => ({
  sample_index: i, eta: new Date(Date.UTC(2026, 8, 30, 0, i * 15)).toISOString(), distance_nm: i * 5,
  wind_speed_kt: wind, wave_height_m: wave, hazard_class: hazard, available: true, lat: -10.85 - i * 0.05, lon: -165.8 + i * 0.03, ...extra,
});
const live = [s(0, 20.9, 0.24, 2), s(1, 21.3, 1.4, 2), s(2, 22.4, 3.19, 2), s(3, 21.0, 2.6, 2), s(4, 18, 1.0, 1)];

test('the fixture really is the situation the review describes (thresholds 20 kt and 2.0 m)', () => {
  expect(ENV.maxWindKt).toBe(20);
  expect(ENV.maxWaveHeightM).toBe(2);
});

describe('pickWorstSample', () => {
  test('within a shared Warning class, the offshore 3.19 m sample beats the earlier departure sample', () => {
    const worst = pickWorstSample(live, VESSEL);
    expect(worst.sample_index).toBe(2);
    expect(worst.wave_height_m).toBe(3.19);
  });

  test('a higher hazard class always wins regardless of ratios', () => {
    const mixed = [s(0, 50, 9, 1), s(1, 20.1, 0.1, 2)];
    expect(pickWorstSample(mixed, VESSEL).sample_index).toBe(1);
  });

  test('exact ties go to the earliest sample (deterministic)', () => {
    const tie = [s(2, 22, 1, 2), s(1, 22, 1, 2)];
    expect(pickWorstSample(tie, VESSEL).sample_index).toBe(1);
  });

  test('without a usable vessel it degrades to earliest-in-class (the old behaviour), never throws', () => {
    expect(pickWorstSample(live, null).sample_index).toBe(0);
    expect(pickWorstSample(live, 'no_such_vessel').sample_index).toBe(0);
  });

  test('ignores unavailable samples and returns null when nothing is usable', () => {
    expect(pickWorstSample([s(0, 99, 9, 2, { available: false }), s(1, 10, 0.5, 0)], VESSEL).sample_index).toBe(1);
    expect(pickWorstSample([], VESSEL)).toBeNull();
    expect(pickWorstSample([{ hazard_class: null, available: false }], VESSEL)).toBeNull();
  });
});

describe('sampleSeverity', () => {
  test('is the larger of wind/threshold and wave/threshold, each against its own hazard-class line', () => {
    expect(sampleSeverity(VESSEL, s(0, 20.9, 0.24, 2))).toBeCloseTo(20.9 / 20, 5);
    expect(sampleSeverity(VESSEL, s(2, 22.4, 3.19, 2))).toBeCloseTo(3.19 / 2, 5);
  });
  test('null when nothing is measurable', () => {
    expect(sampleSeverity(VESSEL, { hazard_class: 2, wind_speed_kt: null, wave_height_m: null })).toBeNull();
    expect(sampleSeverity('nope', s(0, 1, 1, 2))).toBeNull();
  });
  test('Warning samples use the max lines, others the caution lines', () => {
    expect(thresholdsForHazard(ENV, 2)).toEqual({ windKt: ENV.maxWindKt, waveM: ENV.maxWaveHeightM });
    expect(thresholdsForHazard(ENV, 1)).toEqual({ windKt: ENV.cautionWindKt, waveM: ENV.cautionWaveHeightM });
  });
});

describe('what the PDF now reports for the live forecast', () => {
  test('critical point is the offshore sample, not departure', () => {
    const worst = getWorstRouteSample(live, VESSEL);
    expect(worst.distance_nm).toBe(10);
    expect(worst.wave_height_m).toBe(3.19);
  });

  test('joint exceedance is attributed by fraction of threshold, not raw kt vs m (old code said wind)', () => {
    const worst = getWorstRouteSample(live, VESSEL);
    const exceedance = computeExceedance(VESSEL, worst);
    // wind is +2.4 kt (12% over its line); waves +1.19 m (59.5% over theirs).
    expect(exceedance.driver).toBe('wind_and_waves');
    expect(exceedance.unit).toBe('m');
    expect(exceedance.amount).toBeCloseTo(1.19, 2);
  });

  test('the curated table always keeps the true critical point', () => {
    const many = Array.from({ length: 40 }, (_, i) => s(i, 21, 0.3, 2));
    many[23] = s(23, 22.4, 3.19, 2);
    const rows = selectRouteTableRows(many, 14, VESSEL);
    expect(rows).toContain(many[23]);
    expect(rows.length).toBeLessThanOrEqual(14);
  });

  test('scenario comparison picks the same worst sample, so its time and driver agree with the PDF', () => {
    const decision = deriveRouteDecision({ summary: { worst_hazard_class: 2 }, samples: live }, VESSEL);
    expect(decision.worstTime).toBe(live[2].eta);
    expect(decision.primaryDriver).toBe('wind_and_waves');
  });
});
