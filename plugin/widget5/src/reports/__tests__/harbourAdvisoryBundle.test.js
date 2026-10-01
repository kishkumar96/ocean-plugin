import { buildHarbourAdvisoryBundle, verdictText, limitsBasisStatement } from '../harbourAdvisoryBundle';
import { emptyLimitsConfig, INCOMPLETE } from '../../config/cookIslandsHarbourLimits';

const H = 3600e3;
const T0 = Date.UTC(2026, 8, 30, 0);
const step = (i, hs, wind, tp = null) => ({ valid_time: new Date(T0 + i * H).toISOString(), wave_height_m: hs, wind_speed_kt: wind, tp_s: tp });
const row = (id, name, over = {}) => ({
  riskPointId: id, name, island: 'Isle', lat: -21, lon: -159, available: true, validTime: new Date(T0).toISOString(),
  waveHeightM: 1, peakPeriodS: 9, peakDirectionDeg: 75, windSpeedKt: 12, periodWithheld: false, waveRunStart: new Date(T0).toISOString(),
  outlookSteps: [step(0, 1, 12, 9), step(1, 1.4, 15, 9)],
  outlook72Steps: [step(0, 1, 12, 9), step(1, 1.4, 15, 9), step(2, 0.9, 10, 9)],
  ...over,
});
const cfg = (stop) => ({ ...emptyLimitsConfig(), default: { caution: { hsM: null, tpS: null, windKt: null }, stop: { hsM: stop, tpS: null, windKt: null } } });
const NOW = new Date(T0 + 10 * H);

describe('buildHarbourAdvisoryBundle', () => {
  test('no limits: values only, no verdicts, says so', () => {
    const b = buildHarbourAdvisoryBundle({ rows: [row(29, 'Avatiu Harbour')], suitabilityRunStart: new Date(T0).toISOString(), generatedAt: NOW });
    expect(b.judged).toBe(false);
    expect(b.harbours[0].verdictNow).toBeNull();
    expect(b.harbours[0].verdict24h).toBeNull();
    expect(b.basisStatement).toMatch(/No approved unloading limits/);
    expect(b.harbours[0].max24HsM).toBe(1.4);
    expect(b.harbours[0].dirPoint).toBe('ENE');
  });

  test('approved limits: per-step verdicts, worst-over-24h, attributed', () => {
    const meta = { version: 2, approvedBy: 'CIPA', approvedOn: '2026-09-01T00:00:00Z', effectiveFrom: '2026-09-02T00:00:00Z' };
    const b = buildHarbourAdvisoryBundle({ rows: [row(29, 'A')], limits: { basis: 'approved', config: cfg(1.2), meta }, suitabilityRunStart: new Date(T0).toISOString(), generatedAt: NOW });
    expect(b.judged).toBe(true);
    expect(b.harbours[0].verdictNow).toBe(0);
    expect(b.harbours[0].verdict24h).toBe(2); // 1.4 m step breaches the 1.2 m stop
    expect(b.harbours[0].hsStop).toBe(1.2);
    expect(b.basisStatement).toBe('Unloading limits: version 2, approved by CIPA on 2026-09-01, effective 2026-09-02.');
  });

  test('provisional limits: verdicts shown, but the statement says placeholder / not confirmed / indicative', () => {
    const b = buildHarbourAdvisoryBundle({ rows: [row(29, 'A')], limits: { basis: 'provisional', config: cfg(1.2), meta: { version: 0 } }, suitabilityRunStart: new Date(T0).toISOString(), generatedAt: NOW });
    expect(b.judged).toBe(true);
    expect(b.harbours[0].verdict24h).toBe(2);
    expect(b.basis).toBe('provisional');
    expect(b.basisStatement).toMatch(/PROVISIONAL placeholder values, NOT confirmed by Cook Islands Government/);
    expect(b.basisStatement).toMatch(/indicative only/);
    expect(b.basisStatement).not.toMatch(/approved by/);
  });

  test('a draft is labelled as not approved in the statement', () => {
    const b = buildHarbourAdvisoryBundle({ rows: [row(29, 'A')], limits: { basis: 'draft', config: cfg(1.2), meta: null }, suitabilityRunStart: new Date(T0).toISOString(), generatedAt: NOW });
    expect(b.basisStatement).toMatch(/DRAFT.*NOT approved/);
    expect(b.judged).toBe(true);
  });

  test('unavailable approved limits: no verdicts even if a config was passed', () => {
    const b = buildHarbourAdvisoryBundle({ rows: [row(29, 'A')], limits: { basis: 'approved', config: cfg(1.2), meta: {} }, limitsUnavailable: true, suitabilityRunStart: new Date(T0).toISOString(), generatedAt: NOW });
    expect(b.judged).toBe(false);
    expect(b.harbours[0].verdictNow).toBeNull();
    expect(b.basisStatement).toMatch(/could not be loaded/);
  });

  test('a period limit with withheld period reads Incomplete, never within limits', () => {
    const limits = { ...emptyLimitsConfig(), default: { caution: { hsM: null, tpS: null, windKt: null }, stop: { hsM: 3, tpS: 14, windKt: null } } };
    const r = row(29, 'A', { periodWithheld: true, peakPeriodS: null, peakDirectionDeg: null, outlookSteps: [step(0, 1, 12), step(1, 1.1, 12)] });
    const b = buildHarbourAdvisoryBundle({ rows: [r], limits: { basis: 'approved', config: limits, meta: { version: 1, approvedBy: 'x', approvedOn: 'a', effectiveFrom: 'b' } }, suitabilityRunStart: new Date(T0).toISOString(), generatedAt: NOW });
    expect(b.harbours[0].verdictNow).toBe(INCOMPLETE);
    expect(b.harbours[0].verdict24h).toBe(INCOMPLETE);
    expect(b.periodWithheld).toBe(true);
    expect(b.warnings.join(' ')).toMatch(/withheld/);
  });

  test('stale run (>30 h) is called out; unavailable locations are counted and carry no numbers', () => {
    const late = new Date(T0 + 34 * H);
    const b = buildHarbourAdvisoryBundle({ rows: [row(29, 'A'), row(30, 'B', { available: false, outlookSteps: [] })], suitabilityRunStart: new Date(T0).toISOString(), generatedAt: late });
    expect(b.stale).toBe(true);
    expect(b.warnings.join(' ')).toMatch(/model run is 34 h old/);
    expect(b.warnings.join(' ')).toMatch(/1 of 2 locations have no model data/);
    const unavailable = b.harbours[1];
    expect([unavailable.hsM, unavailable.windKt, unavailable.max24HsM]).toEqual([null, null, null]);
  });

  test('fresh run: no staleness warning', () => {
    const b = buildHarbourAdvisoryBundle({ rows: [row(29, 'A')], suitabilityRunStart: new Date(T0).toISOString(), generatedAt: NOW });
    expect(b.stale).toBe(false);
    expect(b.warnings).toEqual([]);
  });
});

describe('partial forecast windows fail closed', () => {
  const meta = { version: 1, approvedBy: 'x', approvedOn: '2026-09-01T00:00:00Z', effectiveFrom: '2026-09-02T00:00:00Z' };
  const build = (r, stop = 3) => buildHarbourAdvisoryBundle({
    rows: [r], limits: { basis: 'approved', config: cfg(stop), meta }, suitabilityRunStart: new Date(T0).toISOString(), generatedAt: NOW,
  });

  test('a complete window still reads within limits', () => {
    const b = build(row(29, 'A', { outlookMissingHours: 0, outlook72MissingHours: 0 }));
    expect(b.harbours[0].verdict24h).toBe(0);
    expect(b.harbours[0].missing24Hours).toBe(0);
    expect(b.warnings.join(' ')).not.toMatch(/less than a full 24 h/);
  });

  test('a short 24 h window can never read "within limits": the missing hours could be the bad ones', () => {
    const b = build(row(29, 'A', { outlookMissingHours: 14 }));
    expect(b.harbours[0].verdict24h).toBe(INCOMPLETE);
    expect(b.harbours[0].missing24Hours).toBe(14);
    expect(b.warnings.join(' ')).toMatch(/1 of 1 locations have less than a full 24 h of forecast \(A: 10 h\)/);
  });

  test('...but a Stop already proven in the hours that do exist still reads Stop', () => {
    const b = build(row(29, 'A', { outlookMissingHours: 14 }), 1.2); // 1.4 m step breaches the 1.2 m stop
    expect(b.harbours[0].verdict24h).toBe(2);
  });

  test('the 72 h trend records how many hours are missing, and unavailable locations carry none', () => {
    const b = buildHarbourAdvisoryBundle({
      rows: [row(29, 'A', { outlook72MissingHours: 42 }), row(30, 'B', { available: false, outlookSteps: [] })],
      suitabilityRunStart: new Date(T0).toISOString(), generatedAt: NOW,
    });
    expect(b.harbours[0].missing72Hours).toBe(42);
    expect([b.harbours[1].missing24Hours, b.harbours[1].missing72Hours]).toEqual([null, null]);
  });

  test('without limits there is no verdict, but the shortfall is still reported', () => {
    const b = buildHarbourAdvisoryBundle({ rows: [row(29, 'A', { outlookMissingHours: 5 })], suitabilityRunStart: new Date(T0).toISOString(), generatedAt: NOW });
    expect(b.harbours[0].verdict24h).toBeNull();
    expect(b.warnings.join(' ')).toMatch(/less than a full 24 h/);
  });
});

describe('wording', () => {
  test('verdict text uses limits vocabulary, never instructions', () => {
    expect([0, 1, 2, INCOMPLETE, null].map(verdictText)).toEqual(['Within limits', 'Exceeds caution limit', 'Exceeds stop limit', 'Incomplete data', '—']);
    expect(limitsBasisStatement('pending', { version: 3, effectiveFrom: '2999-01-01T00:00:00Z' })).toMatch(/take effect 2999-01-01/);
  });
});
