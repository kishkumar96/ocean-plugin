import { COOK_ISLANDS_PRESET_ROUTES, presetRouteBounds, shouldConfirmRouteReplacement } from '../cookIslandsPresetRoutes';

describe('COOK_ISLANDS_PRESET_ROUTES', () => {
  test('every preset has a unique id, at least two points, and start/destination names', () => {
    const ids = new Set();
    for (const route of COOK_ISLANDS_PRESET_ROUTES) {
      expect(ids.has(route.id)).toBe(false);
      ids.add(route.id);
      expect(route.points.length).toBeGreaterThanOrEqual(2);
      expect(route.points.every((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat))).toBe(true);
      expect(typeof route.start).toBe('string');
      expect(route.start.length).toBeGreaterThan(0);
      expect(typeof route.destination).toBe('string');
      expect(route.destination.length).toBeGreaterThan(0);
      expect(Number.isFinite(route.defaultSpeedKt)).toBe(true);
      expect(route.defaultSpeedKt).toBeGreaterThan(0);
    }
  });

  test('each crossing\'s two directions are exact point-order reversals of each other', () => {
    const byId = Object.fromEntries(COOK_ISLANDS_PRESET_ROUTES.map((r) => [r.id, r]));
    const pairs = [
      ['pukapuka_to_nassau', 'nassau_to_pukapuka'],
      ['manihiki_to_rakahanga', 'rakahanga_to_manihiki'],
    ];
    for (const [forwardId, reverseId] of pairs) {
      const forward = byId[forwardId];
      const reverse = byId[reverseId];
      expect(reverse.points).toEqual([...forward.points].reverse());
      // The label/start/destination must actually swap, not just the points --
      // this is what makes ETAs/hazard-per-sample correct for that direction
      // (main review finding: presets were directional but labeled as if
      // either direction worked).
      expect(reverse.start).toBe(forward.destination);
      expect(reverse.destination).toBe(forward.start);
    }
  });

  test('Rakahanga crossing\'s ~6 m vessel is NOT classified as "very_small_motorised_craft" (<6 m, excludes 6 m)', () => {
    const rakahanga = COOK_ISLANDS_PRESET_ROUTES.find((r) => r.id === 'manihiki_to_rakahanga');
    expect(rakahanga.vessel).not.toBe('very_small_motorised_craft');
    expect(rakahanga.vessel).toBe('small_craft'); // 6-10 m, whose lower bound actually contains 6 m
  });
});

describe('presetRouteBounds', () => {
  test('returns the {southWest, northEast} bbox fitBounds expects, covering every point', () => {
    const preset = {
      points: [{ lon: -165.86, lat: -10.84 }, { lon: -165.42, lat: -11.55 }, { lon: -165.5, lat: -11.0 }],
    };
    expect(presetRouteBounds(preset)).toEqual({
      southWest: [-11.55, -165.86],
      northEast: [-10.84, -165.42],
    });
  });

  test('a single-point route returns a zero-area bbox at that point, not NaN/undefined', () => {
    const preset = { points: [{ lon: 10, lat: 20 }] };
    expect(presetRouteBounds(preset)).toEqual({ southWest: [20, 10], northEast: [20, 10] });
  });
});

describe('shouldConfirmRouteReplacement', () => {
  test('confirms only when a hand-drawn (non-preset) route is present', () => {
    expect(shouldConfirmRouteReplacement({ existingPointCount: 3, activePresetRouteId: null })).toBe(true);
  });

  test('does not confirm when the route is empty', () => {
    expect(shouldConfirmRouteReplacement({ existingPointCount: 0, activePresetRouteId: null })).toBe(false);
  });

  test('does not confirm when switching between presets (already-loaded preset is not "manual work")', () => {
    expect(shouldConfirmRouteReplacement({ existingPointCount: 10, activePresetRouteId: 'pukapuka_to_nassau' })).toBe(false);
  });
});
