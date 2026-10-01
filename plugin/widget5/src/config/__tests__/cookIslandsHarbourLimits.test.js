import {
  normalizePublishedLimits, resolveActiveLimits, buildLimitsProposal, INCOMPLETE, worstVerdict, limitOrderIssues, emptyLimits, emptyLimitsConfig, normalizeLimitsConfig, evaluateConditions, limitsForHarbour, hasAnyLimit,
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
