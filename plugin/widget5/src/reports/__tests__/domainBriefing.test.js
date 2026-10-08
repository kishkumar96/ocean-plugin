import {
  operationalSummary, thresholdMargin, reportId, buildBriefing, validateDomainBundle,
} from '../domainBriefing';
import { findForbiddenPhrases } from '../reportRules';
import { deltaText } from '../dailyEvolution';

const step = (s, c, w, extra = {}) => ({ available: true, suitable: s, caution: c, warning: w, ...extra });

describe('operationalSummary', () => {
  test('meaning first, in modelled language, never "safe"', () => {
    const cases = [
      [step(0, 0, 100), /Warning conditions over much of the assessed area/],
      [step(80, 15, 5), /mostly below the Warning threshold, with localised Warning/],
      [step(30, 70, 0), /Caution conditions over most of the assessed area; no Warning/],
      [step(84, 16, 0), /mostly within the preset thresholds, with localised Caution and no Warning/],
      [step(100, 0, 0), /within the preset thresholds across the assessed area/],
      [{ available: false }, /no model data/],
    ];
    cases.forEach(([st, re]) => {
      const text = operationalSummary('Larger vessels', st);
      expect(text).toMatch(re);
      expect(findForbiddenPhrases(text)).toEqual([]);
    });
  });
});

describe('thresholdMargin', () => {
  test('above Warning, below Warning, below Caution', () => {
    expect(thresholdMargin(2.7, 1.5, 2.0, { unit: 'm' })).toMatchObject({ side: 'above', text: '0.7 m above Warning' });
    expect(thresholdMargin(2.7, 2.5, 3.0, { unit: 'm' })).toMatchObject({ side: 'below', level: 'warning', text: '0.3 m below Warning' });
    expect(thresholdMargin(14, 15, 20, { unit: 'kt', digits: 0 })).toMatchObject({ level: 'caution', text: '1 kt below Caution' });
    expect(thresholdMargin(null, 1, 2)).toBeNull();
    // exactly at a threshold (at the printed precision) reads "at", not "0 kt above"
    expect(thresholdMargin(20, 15, 20, { unit: 'kt', digits: 0 })).toMatchObject({ side: 'at', text: 'at the Warning threshold' });
    expect(thresholdMargin(20.2, 15, 20, { unit: 'kt', digits: 0 })).toMatchObject({ side: 'at' });
    expect(thresholdMargin(15, 15, 20, { unit: 'kt', digits: 0 })).toMatchObject({ side: 'at', level: 'caution', text: 'at the Caution threshold' });
  });
});

describe('reportId', () => {
  const base = { runId: '2026100406', validTime: Date.UTC(2026, 9, 4, 17), vessel: 'larger_vessels', scope: 'viewport', bounds: { west: -160, south: -22, east: -159, north: -21 }, methodologyVersion: 'v1', ruleId: 'r1', thresholdSetId: 't1' };
  test('readable, deterministic, and changes when anything that shaped the figures changes', () => {
    const id = reportId(base);
    expect(id).toMatch(/^COK-SUIT-2026100406-V2026100417-LV-VIEW-[0-9A-Z]{6}$/);
    expect(reportId(base)).toBe(id);
    expect(reportId({ ...base, bounds: { ...base.bounds, west: -161 } })).not.toBe(id);
    expect(reportId({ ...base, thresholdSetId: 't2' })).not.toBe(id);
  });
});

describe('buildBriefing', () => {
  test('driver, lowest/worst and the weaker of point and step coverage', () => {
    const env = { cautionWaveHeightM: 2.5, cautionWindKt: 20, maxWaveHeightM: 3, maxWindKt: 25 };
    const b = buildBriefing({
      step: step(84, 16, 0, { wave: { max: 2.7 }, wind: { max: 20 } }), envelope: env,
      analysis: { best: null, lowest: { start: { validTime: 1 }, end: { validTime: 1 }, warning: 0 }, highest: { warning: 3, validTime: 2 } },
      pointCoverage: { classified: 100, eligible: 100 }, stepCoverage: { available: 9, total: 10 }, runAgeHours: 22,
    });
    expect(b).toMatchObject({ level: 1, peakHsM: 2.7, peakWindKt: 20, confidence: 'reduced', pointConfidence: 'high', freshness: 'current' });
    expect(b.driver).toMatchObject({ driver: 'both', level: 'caution' });
    expect(b.worst.warning).toBe(3);
  });

  test('freshness: a forecast updated 3 h ago is current even when its model data is 28 h old', () => {
    const base = { step: step(84, 16, 0), envelope: null };
    expect(buildBriefing({ ...base, runAgeHours: 28, updateAgeHours: 3 }).freshness).toBe('current');
    expect(buildBriefing({ ...base, runAgeHours: 28, updateAgeHours: 14 }).freshness).toBe('stale');
    expect(buildBriefing({ ...base, runAgeHours: 28 }).freshness).toBe('aging');
  });
});

describe('validateDomainBundle', () => {
  const good = () => ({
    validTime: 10, forecastWindow: { forecastStart: 0, forecastEnd: 100 },
    vessels: { a: step(60, 30, 10, { classifiedPoints: 90, eligiblePoints: 100, totalPoints: 120 }) },
    timeSeries: { byVessel: { a: [step(60, 30, 10, { validTime: 10 }), step(50, 40, 10, { validTime: 16 })] } },
  });
  test('a consistent bundle passes', () => {
    expect(validateDomainBundle(good())).toEqual({ ok: true, errors: [] });
  });
  test('shares not summing to 100, impossible counts, time running backwards, valid time outside the data: all errors', () => {
    const b = good();
    b.vessels.a = step(60, 30, 30, { classifiedPoints: 110, eligiblePoints: 100, totalPoints: 90 });
    b.timeSeries.byVessel.a[1].validTime = 5;
    b.validTime = 500;
    const { ok, errors } = validateDomainBundle(b);
    expect(ok).toBe(false);
    expect(errors.join(' ')).toMatch(/sum to 120\.0%/);
    expect(errors.join(' ')).toMatch(/classified points exceed/);
    expect(errors.join(' ')).toMatch(/eligible points exceed/);
    expect(errors.join(' ')).toMatch(/not in order/);
    expect(errors.join(' ')).toMatch(/outside the model data window/);
  });
  test('unavailable steps are not checked (they carry no shares)', () => {
    const b = good();
    b.timeSeries.byVessel.a.push({ available: false, validTime: 22 });
    expect(validateDomainBundle(b).ok).toBe(true);
  });
});

describe('deltaText', () => {
  test('every change since the previous day, signed', () => {
    expect(deltaText({ warning: 2, caution: 24, hsM: 0.2, windKt: 2 })).toBe('W +2 · C +24 pts · Hs +0.2 m · wind +2 kt');
    expect(deltaText({ warning: -3, caution: -1, hsM: null, windKt: null })).toBe('W -3 · C -1 pts');
    expect(deltaText(null)).toBe('');
  });
});
