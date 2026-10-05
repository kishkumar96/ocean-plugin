import { scopePlaceName, ELEVATED_WARNING_RULE, ELEVATED_WARNING_PERCENT } from '../reportRules';

describe('scopePlaceName', () => {
  const view = (b) => ({ effective: 'viewport', appliedBounds: b });
  test('names the island a map view covers', () => {
    expect(scopePlaceName(view({ west: -159.88, south: -21.30, east: -159.67, north: -21.17 }))).toBe('Rarotonga');
  });
  test('two or three islands are listed; a wider view has no single place name', () => {
    expect(scopePlaceName(view({ west: -161.2, south: -10.5, east: -160.9, north: -9.9 }))).toBe('Manihiki and Rakahanga');
    expect(scopePlaceName(view({ west: -166, south: -22.5, east: -157, north: -8.5 }))).toBeNull();
  });
  test('null for the whole domain, open ocean, or no bounds', () => {
    expect(scopePlaceName({ effective: 'domain' })).toBeNull();
    expect(scopePlaceName(view({ west: -150, south: -30, east: -149, north: -29 }))).toBeNull();
    expect(scopePlaceName({ effective: 'viewport' })).toBeNull();
  });
});

describe('ELEVATED_WARNING_RULE', () => {
  test('is documented as a report summary rule, not a vessel threshold', () => {
    expect(ELEVATED_WARNING_PERCENT).toBe(ELEVATED_WARNING_RULE.percent);
    expect(ELEVATED_WARNING_RULE.kind).toMatch(/not a vessel threshold/);
    expect(ELEVATED_WARNING_RULE.basis).toMatch(/not externally validated/);
  });
});
