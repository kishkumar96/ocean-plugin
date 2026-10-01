import {
  explainWindow, normalizePublishedLimits, resolveActiveLimits, buildLimitsProposal, INCOMPLETE, worstVerdict, limitOrderIssues, emptyLimits, emptyLimitsConfig, normalizeLimitsConfig, evaluateConditions, limitsForHarbour, hasAnyLimit,
  serializeLimitsConfig,
} from '../cookIslandsHarbourLimits';

const limits = (caution, stop) => ({ caution: { hsM: null, tpS: null, windKt: null, ...caution }, stop: { hsM: null, tpS: null, windKt: null, ...stop } });

describe('evaluateConditions', () => {
  test('no limits set -> null, never "OK"', () => {
    expect(evaluateConditions({ hsM: 3, tpS: 14, windKt: 30 }, emptyLimits())).toBeNull();
    expect(hasAnyLimit(emptyLimits())).toBe(false);
  });
  test('classifies against caution/stop, worst variable wins, >= is inclusive', () => {
    const l = limits({ hsM: 1, windKt: 15 }, { hsM: 2, windKt: 25 });
    expect(evaluateConditions({ hsM: 0.5, windKt: 10 }, l)).toBe(0);
    expect(evaluateConditions({ hsM: 1, windKt: 10 }, l)).toBe(1);
    expect(evaluateConditions({ hsM: 0.5, windKt: 25 }, l)).toBe(2);
    expect(evaluateConditions({ hsM: 2.5, windKt: 5 }, l)).toBe(2);
  });
  test('a missing variable that HAS a limit is never OK: incomplete unless a stop is already proven', () => {
    const l = limits({}, { hsM: 2, tpS: 14 });
    expect(evaluateConditions({ hsM: 1, tpS: null, windKt: 9 }, l)).toBe(INCOMPLETE);
    expect(evaluateConditions({ hsM: null, tpS: null, windKt: 9 }, l)).toBe(INCOMPLETE);
    // Known exceedance settles it even with the other variable missing.
    expect(evaluateConditions({ hsM: 2.5, tpS: null }, l)).toBe(2);
    // Caution + a gap is still incomplete, not Caution: the gap could be Stop.
    expect(evaluateConditions({ hsM: 1.2, tpS: null }, limits({ hsM: 1 }, { hsM: 2, tpS: 14 }))).toBe(INCOMPLETE);
  });
  test('a missing variable with NO limit is irrelevant', () => {
    expect(evaluateConditions({ hsM: 1, tpS: null, windKt: null }, limits({}, { hsM: 2 }))).toBe(0);
  });
  test('caution-only and stop-only variables both work', () => {
    expect(evaluateConditions({ tpS: 15 }, limits({ tpS: 14 }, {}))).toBe(1);
    expect(evaluateConditions({ tpS: 15 }, limits({}, { tpS: 14 }))).toBe(2);
  });
});

describe('config', () => {
  test('harbour override replaces the default wholesale', () => {
    const cfg = emptyLimitsConfig();
    cfg.default = limits({ hsM: 1 }, { hsM: 2 });
    cfg.harbours['29'] = limits({}, { hsM: 3 });
    expect(limitsForHarbour(cfg, 29).stop.hsM).toBe(3);
    expect(limitsForHarbour(cfg, 29).caution.hsM).toBeNull();
    expect(limitsForHarbour(cfg, 347).stop.hsM).toBe(2);
  });
  test('normalize drops junk (negatives, strings, NaN) and survives garbage input', () => {
    const cfg = normalizeLimitsConfig({ default: { stop: { hsM: '2.5', tpS: -1, windKt: 'x' } }, harbours: { 29: 'bad' } });
    expect(cfg.default.stop).toEqual({ hsM: 2.5, tpS: null, windKt: null });
    expect(cfg.harbours).toEqual({});
    expect(normalizeLimitsConfig(null)).toEqual(emptyLimitsConfig());
  });
  test('export round-trips through normalize', () => {
    const cfg = emptyLimitsConfig();
    cfg.harbours['401'] = limits({ hsM: 0.8 }, { hsM: 1.2, windKt: 25 });
    expect(normalizeLimitsConfig(JSON.parse(serializeLimitsConfig(cfg)))).toEqual(cfg);
  });
});

describe('worstVerdict + limitOrderIssues', () => {
  test('stop beats incomplete beats caution beats ok; null only if nothing judged', () => {
    expect(worstVerdict([0, 1, null])).toBe(1);
    expect(worstVerdict([0, INCOMPLETE, 1])).toBe(INCOMPLETE);
    expect(worstVerdict([INCOMPLETE, 2, 0])).toBe(2);
    expect(worstVerdict([null, null])).toBeNull();
    expect(worstVerdict([])).toBeNull();
  });
  test('flags stop <= caution', () => {
    expect(limitOrderIssues(limits({ hsM: 2, windKt: 10 }, { hsM: 2, windKt: 20 })).map((v) => v.key)).toEqual(['hsM']);
    expect(limitOrderIssues(limits({ hsM: 1 }, { hsM: 2 }))).toEqual([]);
    expect(limitOrderIssues(limits({ hsM: 1 }, {}))).toEqual([]);
  });
});

describe('published limits governance', () => {
  const base = (over = {}) => ({
    schema: 1, status: 'approved', version: 1, approvedBy: 'CIPA', approvedOn: '2026-09-01T00:00:00Z', effectiveFrom: '2026-09-02T00:00:00Z',
    default: { caution: { hsM: 1 }, stop: { hsM: 2 } }, harbours: {}, history: [], ...over,
  });
  test('well-formed approved file passes; not_set passes and applies nothing', () => {
    expect(normalizePublishedLimits(base()).ok).toBe(true);
    const notSet = normalizePublishedLimits({ schema: 1, status: 'not_set', version: 0, default: {}, harbours: {} });
    expect(notSet.ok).toBe(true);
    expect(resolveActiveLimits({ published: notSet.published, draft: null }).basis).toBe('none');
  });
  test.each([
    ['missing approver', { approvedBy: null }, /approvedBy/],
    ['bad date', { effectiveFrom: 'soon' }, /effectiveFrom/],
    ['version 0', { version: 0 }, /version/],
    ['inverted limits', { default: { caution: { hsM: 2 }, stop: { hsM: 1 } } }, /stop must be above caution/],
    ['unknown harbour id', { harbours: { 99999: { stop: { hsM: 1 } } } }, /unknown harbour id 99999/],
    ['approved with no limits', { default: {} }, /no limits set/],
    ['wrong schema', { schema: 2 }, /schema/],
    ['bad status', { status: 'maybe' }, /status/],
  ])('rejects: %s', (_name, over, re) => {
    const r = normalizePublishedLimits(base(over));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(re);
  });
  test('rejects non-objects', () => {
    expect(normalizePublishedLimits(null).ok).toBe(false);
    expect(normalizePublishedLimits([]).ok).toBe(false);
  });
  test('resolution: approved only from effectiveFrom; a draft with limits outranks it and is labelled draft', () => {
    const pub = normalizePublishedLimits(base()).published;
    const before = new Date('2026-09-01T12:00:00Z');
    const after = new Date('2026-09-03T00:00:00Z');
    expect(resolveActiveLimits({ published: pub, draft: null, now: before }).basis).toBe('pending');
    expect(resolveActiveLimits({ published: pub, draft: null, now: after }).basis).toBe('approved');
    const draft = emptyLimitsConfig();
    draft.default = limits({ hsM: 0.5 }, { hsM: 1 });
    expect(resolveActiveLimits({ published: pub, draft, now: after }).basis).toBe('draft');
    // an empty draft does not mask approved limits
    expect(resolveActiveLimits({ published: pub, draft: emptyLimitsConfig(), now: after }).basis).toBe('approved');
  });
  test('proposal is marked draft, records the base version, and re-imports cleanly', () => {
    const cfg = emptyLimitsConfig();
    cfg.default = limits({ hsM: 1 }, { hsM: 2 });
    const parsed = JSON.parse(buildLimitsProposal(cfg, { basedOnVersion: 3, now: new Date('2026-09-30T00:00:00Z') }));
    expect(parsed.status).toBe('draft');
    expect(parsed.basedOnVersion).toBe(3);
    expect(normalizeLimitsConfig(parsed)).toEqual(cfg);
    expect(normalizePublishedLimits(parsed).ok).toBe(false); // a proposal can never be loaded as the approved file
  });

  describe('provisional placeholder limits', () => {
    const prov = (over = {}) => ({ schema: 1, status: 'provisional', version: 0, default: { caution: { hsM: 1, windKt: 20 }, stop: { hsM: 1.5, windKt: 25 } }, harbours: {}, ...over });
    test('valid without an approver, and resolves to its own basis (never "approved")', () => {
      const r = normalizePublishedLimits(prov());
      expect(r.ok).toBe(true);
      const active = resolveActiveLimits({ published: r.published, draft: null });
      expect(active.basis).toBe('provisional');
      expect(active.config.default.stop.hsM).toBe(1.5);
    });
    test('a local draft outranks provisional values; an empty draft does not', () => {
      const published = normalizePublishedLimits(prov()).published;
      const draft = emptyLimitsConfig();
      draft.default = limits({ hsM: 2 }, { hsM: 3 });
      expect(resolveActiveLimits({ published, draft }).basis).toBe('draft');
      expect(resolveActiveLimits({ published, draft: emptyLimitsConfig() }).basis).toBe('provisional');
    });
    test('still validated: empty or inverted provisional sets are rejected', () => {
      expect(normalizePublishedLimits(prov({ default: {} })).problems.join(' ')).toMatch(/provisional but no limits set/);
      expect(normalizePublishedLimits(prov({ default: { caution: { hsM: 2 }, stop: { hsM: 1 } } })).ok).toBe(false);
    });
  });
});

describe('explainWindow: which variable drove a verdict, how far, and when', () => {
  const H = 3600e3;
  const T0 = Date.UTC(2026, 9, 1, 0);
  const step = (i, hs, wind, tp = 9) => ({ valid_time: new Date(T0 + i * H).toISOString(), wave_height_m: hs, wind_speed_kt: wind, tp_s: tp });
  const cfg = (caution, stop) => limits(caution, stop);

  test('names the controlling variable (furthest past ITS OWN limit), with peak, limit, first/last time and hours', () => {
    // hs limit 1.5 (peak 1.9 -> ratio 1.27); wind limit 25 (peak 26 -> ratio 1.04): waves control.
    const steps = [step(0, 1.0, 20), step(1, 1.6, 26), step(2, 1.9, 25), step(3, 1.7, 22), step(4, 1.0, 18)];
    const out = explainWindow(steps, cfg({}, { hsM: 1.5, windKt: 25 }));
    expect(out.level).toBe(2);
    expect(out.driver).toEqual(expect.objectContaining({ key: 'hsM', label: 'Wave height', unit: 'm', limit: 1.5, peak: 1.9, steps: 3 }));
    expect(out.driver.firstTime).toBe(steps[1].valid_time);
    expect(out.driver.lastTime).toBe(steps[3].valid_time);
  });

  test('a variable that is only over its limit by a little loses to one far over', () => {
    const out = explainWindow([step(0, 1.51, 40)], cfg({}, { hsM: 1.5, windKt: 25 }));
    expect(out.driver.key).toBe('windKt'); // 40/25 = 1.6 beats 1.51/1.5
  });

  test('Stop wins over Caution; with only Caution exceeded the level is 1 and uses the caution limit', () => {
    const steps = [step(0, 1.1, 10), step(1, 1.2, 10)];
    const out = explainWindow(steps, cfg({ hsM: 1.0 }, { hsM: 1.5 }));
    expect(out.level).toBe(1);
    expect(out.driver).toEqual(expect.objectContaining({ key: 'hsM', limit: 1.0, peak: 1.2, steps: 2 }));
  });

  test('within limits: level 0, no driver', () => {
    const out = explainWindow([step(0, 0.5, 10)], cfg({ hsM: 1 }, { hsM: 2 }));
    expect(out).toEqual(expect.objectContaining({ level: 0, driver: null, missing: [] }));
  });

  test('lists the variables that have a limit but are missing from some step (why a verdict can be Incomplete)', () => {
    const out = explainWindow([step(0, 0.5, 10, null), step(1, 0.6, 10, 9)], cfg({}, { hsM: 2, tpS: 14 }));
    expect(out.missing).toEqual(['Peak period']);
    // a variable with no limit is never reported missing
    expect(explainWindow([step(0, 0.5, null)], cfg({}, { hsM: 2 })).missing).toEqual([]);
  });

  test('empty or garbage input never throws', () => {
    expect(explainWindow([], cfg({}, { hsM: 1 })).level).toBe(0);
    expect(explainWindow(null, null).level).toBe(0);
    expect(explainWindow([{ valid_time: 'x', wave_height_m: 'nope' }], cfg({}, { hsM: 1 })).level).toBe(0);
  });
});
