import { legLabelsNearPoint } from '../routeProbeLayout';
import { routeMidpoint } from '../../services/cookIslandsWaveTimeseriesService';
import { COOK_ISLANDS_PRESET_ROUTES } from '../../config/cookIslandsPresetRoutes';

describe('legLabelsNearPoint', () => {
  test('on the Pukapuka -> Nassau crossing the long leg label collides with the route midpoint', () => {
    const route = COOK_ISLANDS_PRESET_ROUTES.find((r) => r.id === 'pukapuka_to_nassau');
    const mid = routeMidpoint(route.points);
    const near = legLabelsNearPoint(route.points, mid);
    // The crossing has many short legs around the island and one ~50 nm leg; only the long one
    // is near the midpoint.
    const longLeg = route.points.length - 3; // the vertex pair that spans the open water
    expect(near).toContain(longLeg);
    expect(near.length).toBeLessThanOrEqual(2);
  });

  test('labels far from the marker are left alone', () => {
    const points = [{ lon: 0, lat: 0 }, { lon: 0, lat: 1 }, { lon: 0, lat: 2 }, { lon: 0, lat: 3 }]; // three equal legs
    // marker at the start: only the first leg's label (at 0.5 deg) is within 10% of the route (0.3 deg)? no -> none
    expect(legLabelsNearPoint(points, { lon: 0, lat: 0 })).toEqual([]);
    expect(legLabelsNearPoint(points, { lon: 0, lat: 0.5 })).toEqual([0]);
    expect(legLabelsNearPoint(points, { lon: 0, lat: 1.5 })).toEqual([1]);
  });

  test('a custom fraction widens or narrows what counts as near', () => {
    const points = [{ lon: 0, lat: 0 }, { lon: 0, lat: 2 }];
    expect(legLabelsNearPoint(points, { lon: 0, lat: 0.5 }, 0.1)).toEqual([]);
    expect(legLabelsNearPoint(points, { lon: 0, lat: 0.5 }, 0.5)).toEqual([0]);
  });

  test('degenerate input never throws: too few points, missing marker, zero-length route', () => {
    expect(legLabelsNearPoint([{ lon: 0, lat: 0 }], { lon: 0, lat: 0 })).toEqual([]);
    expect(legLabelsNearPoint([], { lon: 0, lat: 0 })).toEqual([]);
    expect(legLabelsNearPoint(null, { lon: 0, lat: 0 })).toEqual([]);
    expect(legLabelsNearPoint([{ lon: 0, lat: 0 }, { lon: 0, lat: 1 }], null)).toEqual([]);
    expect(legLabelsNearPoint([{ lon: 1, lat: 1 }, { lon: 1, lat: 1 }], { lon: 1, lat: 1 })).toEqual([]);
  });
});
