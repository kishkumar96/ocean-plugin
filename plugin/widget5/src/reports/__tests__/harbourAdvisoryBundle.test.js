import { buildHarbourAdvisoryBundle, verdictText, limitsBasisStatement, describeDriver, describeIncomplete, shortTime, NODE_FAR_KM } from '../harbourAdvisoryBundle';
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

describe('why a verdict is what it is: driver, peak and timing', () => {
  const meta = { version: 1, approvedBy: 'x', approvedOn: '2026-09-01T00:00:00Z', effectiveFrom: '2026-09-02T00:00:00Z' };
  const limitsCfg = { ...emptyLimitsConfig(), default: { caution: { hsM: 1.0, tpS: null, windKt: null }, stop: { hsM: 1.5, tpS: null, windKt: 25 } } };
  const build = (rows, over = {}) => buildHarbourAdvisoryBundle({
    rows, limits: { basis: 'approved', config: limitsCfg, meta }, suitabilityRunStart: new Date(T0).toISOString(), generatedAt: NOW, timeDisplayZone: 'UTC', ...over,
  });
  // hourly steps 00:00..: Hs and wind per hour
  const stepsOf = (hs, wind) => hs.map((h, i) => step(i, h, wind[i], 9));
  const WD = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' }).format(new Date(T0)); // weekday of the fixture's first step

  test('Stop: names the controlling variable, its peak against the limit, and when it was over', () => {
    const hs = [0.8, 1.0, 1.6, 1.9, 1.7, 1.2, 0.9];
    const r = row(29, 'A', { waveHeightM: 0.8, windSpeedKt: 10, outlookSteps: stepsOf(hs, hs.map(() => 10)), outlook72Steps: stepsOf(hs, hs.map(() => 10)) });
    const h = build([r]).harbours[0];
    expect(h.verdict24h).toBe(2);
    expect(h.detail24h).toBe(`Wave height peaks 1.9 m (stop 1.5 m), over ${WD} 02:00 to ${WD} 04:00 (3 h)`);
    expect(h.driver24h).toEqual(expect.objectContaining({ key: 'hsM', peak: 1.9, limit: 1.5, steps: 3 }));
  });

  test('compact form fits a table cell: one line, no special glyphs, same-day times share the weekday', () => {
    const hs = [0.8, 1.6, 1.9, 1.7, 0.9];
    const r = row(29, 'A', { outlookSteps: stepsOf(hs, hs.map(() => 10)) });
    const h = build([r]).harbours[0];
    expect(h.detail24hShort).toBe(`Wave height 1.9 m, over stop 1.5 m · ${WD} 01:00-03:00 (3 h)`);
    expect(h.detail24hShort.length).toBeLessThan(60);
    expect(h.detail24hShort).not.toMatch(/[≥≤→]/);
    // a single step reads "at <time>"
    const one = build([row(29, 'A', { waveHeightM: 1.7, outlookSteps: [step(0, 1.7, 10, 9)] })]).harbours[0];
    expect(one.detailNowShort).toBe(`Wave height 1.7 m, over stop 1.5 m · at ${WD} 00:00`);
  });

  test('picks the variable furthest past its OWN limit, not the biggest number', () => {
    const r = row(29, 'A', { outlookSteps: [step(0, 1.55, 40, 9)], outlook72Steps: [] }); // Hs 1.55/1.5=1.03; wind 40/25=1.6
    expect(build([r]).harbours[0].driver24h.key).toBe('windKt');
    expect(build([r]).harbours[0].detail24h).toBe(`Wind peaks 40 kt (stop 25 kt), over at ${WD} 00:00`);
  });

  test('Caution is explained against the CAUTION limit', () => {
    const r = row(29, 'A', { waveHeightM: 1.2, outlookSteps: [step(0, 1.2, 10, 9), step(1, 1.3, 10, 9)] });
    const h = build([r]).harbours[0];
    expect(h.verdict24h).toBe(1);
    expect(h.detail24h).toMatch(/Wave height peaks 1\.3 m \(caution 1\.0 m\)/);
    expect(h.verdictNow).toBe(1);
    expect(h.detailNow).toBe(`Wave height peaks 1.2 m (caution 1.0 m), over at ${WD} 00:00`);
  });

  test('within limits: nothing to explain', () => {
    const r = row(29, 'A', { waveHeightM: 0.5, windSpeedKt: 10, outlookSteps: [step(0, 0.5, 10, 9)] });
    const h = build([r]).harbours[0];
    expect([h.verdictNow, h.verdict24h, h.detailNow, h.detail24h]).toEqual([0, 0, '', '']);
  });

  test('Incomplete says what is missing: a limited variable with no value, and/or hours of forecast', () => {
    const periodLimits = { ...emptyLimitsConfig(), default: { caution: { hsM: null, tpS: null, windKt: null }, stop: { hsM: 3, tpS: 14, windKt: null } } };
    const r = row(29, 'A', { peakPeriodS: null, outlookSteps: [step(0, 1, 10, null), step(1, 1, 10, null)], outlookMissingHours: 14 });
    const h = build([r], { limits: { basis: 'approved', config: periodLimits, meta } }).harbours[0];
    expect(h.verdict24h).toBe(INCOMPLETE);
    expect(h.detail24h).toBe('Peak period not available; forecast covers 10 of 24 h');
    expect(h.detailNow).toBe('Peak period not available');
  });

  test('without limits there is no explanation (and no verdict)', () => {
    const h = buildHarbourAdvisoryBundle({ rows: [row(29, 'A')], suitabilityRunStart: new Date(T0).toISOString(), generatedAt: NOW }).harbours[0];
    expect([h.detailNow, h.detail24h, h.driver24h]).toEqual(['', '', null]);
  });

  test('describeDriver / describeIncomplete / shortTime handle empty and bad input', () => {
    expect(describeDriver(null, 'UTC')).toBe('');
    expect(describeDriver({ driver: null }, 'UTC')).toBe('');
    expect(describeIncomplete(null, 0)).toBe('');
    expect(describeIncomplete({ missing: ['Wind', 'Peak period'] }, 0)).toBe('Wind and Peak period not available');
    expect(shortTime('garbage', 'UTC')).toBe('—');
    expect(shortTime('2026-09-30T14:00:00Z', 'Pacific/Rarotonga')).toMatch(/^\w{3} 04:00$/);
  });
});

describe('sampling node, unavailable reason and a shared valid time', () => {
  const withNode = (km) => ({ waveNode: { lon: -159.7, lat: -21.2, distanceKm: km } });
  const build = (rows) => buildHarbourAdvisoryBundle({ rows, suitabilityRunStart: new Date(T0).toISOString(), generatedAt: NOW });

  test('the node distance is carried through; only nodes beyond the tolerance are flagged and warned about', () => {
    const b = build([row(29, 'Near', withNode(0.4)), row(30, 'Far', withNode(3.9)), row(31, 'None')]);
    expect(b.harbours.map((h) => h.nodeDistanceKm)).toEqual([0.4, 3.9, null]);
    expect(b.harbours.map((h) => h.nodeFar)).toEqual([false, true, false]);
    expect(b.warnings.join(' ')).toMatch(new RegExp(`1 of 3 locations use a wave-model point more than ${NODE_FAR_KM} km away`));
    expect(build([row(29, 'Near', withNode(0.4))]).warnings.join(' ')).not.toMatch(/wave-model point more than/);
  });

  test('an unavailable row carries its reason', () => {
    const b = build([row(29, 'A', { available: false, unavailableReason: 'Forecast has no step within 90 min of now (nearest is 3.1 days before now).', outlookSteps: [] })]);
    expect(b.harbours[0].unavailableReason).toMatch(/no step within 90 min/);
    expect(build([row(29, 'A')]).harbours[0].unavailableReason).toBeNull();
  });

  test('a common valid time is reported only when every available row has the same one', () => {
    const same = build([row(29, 'A'), row(30, 'B')]);
    expect(same.validTimeCommon).toBe(T0);
    const differ = build([row(29, 'A'), row(30, 'B', { validTime: new Date(T0 + 3600e3).toISOString() })]);
    expect(differ.validTimeCommon).toBeNull();
    expect([differ.validTimeMin, differ.validTimeMax]).toEqual([T0, T0 + 3600e3]);
    // unavailable rows do not count
    const ignoring = build([row(29, 'A'), row(30, 'B', { available: false, validTime: new Date(T0 + 9 * 3600e3).toISOString() })]);
    expect(ignoring.validTimeCommon).toBe(T0);
  });
});

describe('wording', () => {
  test('verdict text uses limits vocabulary, never instructions', () => {
    expect([0, 1, 2, INCOMPLETE, null].map(verdictText)).toEqual(['Within limits', 'Exceeds caution limit', 'Exceeds stop limit', 'Incomplete data', '—']);
    expect(limitsBasisStatement('pending', { version: 3, effectiveFrom: '2999-01-01T00:00:00Z' })).toMatch(/take effect 2999-01-01/);
  });
});
