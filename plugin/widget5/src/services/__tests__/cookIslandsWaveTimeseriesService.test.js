import {
  vesselPositionAt, buildMidpointConditions, routeMidpoint, etaAtMidpoint, waveRunAgeHours, WAVE_STALE_HOURS, seaAngleOffBow, describeSeaAngle, bearingDeg, buildWaveTimeseriesCsv, normalizeWaveTimeseries, zonedPlotlyTime,
} from '../cookIslandsWaveTimeseriesService';
import { COOK_ISLANDS_PRESET_ROUTES } from '../../config/cookIslandsPresetRoutes';

describe('seaAngleOffBow', () => {
  test('0 = head seas, 180 = following, sign dropped', () => {
    expect(seaAngleOffBow(90, 90)).toBe(0);
    expect(seaAngleOffBow(270, 90)).toBe(180);
    expect(seaAngleOffBow(0, 90)).toBe(90);
    expect(seaAngleOffBow(180, 90)).toBe(90);
    expect(seaAngleOffBow(350, 10)).toBe(20);
  });
  test('null on missing input, labels by band', () => {
    expect(seaAngleOffBow(null, 10)).toBeNull();
    expect(describeSeaAngle(20)).toBe('Head seas');
    expect(describeSeaAngle(90)).toBe('Beam-on');
    expect(describeSeaAngle(170)).toBe('Following seas');
  });
});

describe('routeMidpoint', () => {
  test('is half-way by distance, not by vertex count (Pukapuka->Nassau has one ~90 km leg)', () => {
    const p = COOK_ISLANDS_PRESET_ROUTES.find((r) => r.id === 'pukapuka_to_nassau');
    const mid = routeMidpoint(p.points);
    // Open water between the islands, far from either harbour.
    expect(mid.lon).toBeGreaterThan(-165.8);
    expect(mid.lon).toBeLessThan(-165.45);
    expect(mid.headingDeg).toBeGreaterThan(120);
    expect(mid.headingDeg).toBeLessThan(160);
  });
  test('null for degenerate routes', () => {
    expect(routeMidpoint([{ lon: 1, lat: 1 }])).toBeNull();
    expect(routeMidpoint([{ lon: 1, lat: 1 }, { lon: 1, lat: 1 }])).toBeNull();
  });
  test('bearing due east is 90', () => {
    expect(Math.round(bearingDeg({ lon: 0, lat: 0 }, { lon: 1, lat: 0 }))).toBe(90);
  });
});

describe('csv + normalize', () => {
  const rows = normalizeWaveTimeseries({
    times: ['2026-09-30T00:00:00Z'],
    variables: { hs: [1.234567], tpeak: [9], dirp: [75], tp_p1: [null], hs_p1: [0.4], hs_p2: [1.1] },
    distance_degrees: 0.001,
  }).rows;
  test('null/missing become empty cells; metadata is #-prefixed', () => {
    const csv = buildWaveTimeseriesCsv(rows, { name: 'Avatiu, Raro', lon: -159.78, lat: -21.19, headingDeg: 75 });
    const lines = csv.trim().split('\n');
    expect(lines.filter((l) => l.startsWith('#')).length).toBeGreaterThan(2);
    const header = lines.find((l) => l.startsWith('time_utc'));
    expect(header.endsWith('sea_angle_off_bow_deg')).toBe(true);
    const row = lines[lines.length - 1].split(',');
    expect(row[0]).toBe('2026-09-30T00:00:00Z');
    expect(row[1]).toBe('1.235');
    expect(row[row.length - 1]).toBe('0');
  });
  test('partition columns are labelled wind sea (p1) and primary swell (p2), not swell 1/2', () => {
    const csv = buildWaveTimeseriesCsv(rows, { name: 'x', lon: 1, lat: 1 });
    const header = csv.split('\n').find((l) => l.startsWith('time_utc')).split(',');
    const dataRow = csv.trim().split('\n').pop().split(',');
    expect(header).toContain('windsea_hs_m');
    expect(header).toContain('primary_swell_hs_m');
    expect(header.join(',')).not.toMatch(/swell1|swell2/);
    expect(dataRow[header.indexOf('windsea_hs_m')]).toBe('0.4');
    expect(dataRow[header.indexOf('primary_swell_hs_m')]).toBe('1.1');
  });
  test('zonedPlotlyTime renders Rarotonga as UTC-10 regardless of host zone', () => {
    expect(zonedPlotlyTime('2026-09-30T00:00:00Z', 'Pacific/Rarotonga')).toBe('2026-09-29 14:00:00');
  });
});

describe('etaAtMidpoint', () => {
  const samples = [0, 10, 20, 30, 40].map((d, i) => ({ distance_nm: d, eta: `2026-09-30T0${i}:00:00Z` }));
  test('ETA of the sample nearest half the total distance', () => {
    expect(etaAtMidpoint(samples)).toBe('2026-09-30T02:00:00Z');
  });
  test('null when samples lack distance/eta', () => {
    expect(etaAtMidpoint([])).toBeNull();
    expect(etaAtMidpoint([{ distance_nm: 1 }, { distance_nm: 2 }])).toBeNull();
    expect(etaAtMidpoint(null)).toBeNull();
  });
});

describe('waveRunAgeHours', () => {
  const start = '2026-09-30T00:00:00Z';
  test('hours since the run start; never negative; null when missing', () => {
    expect(waveRunAgeHours(start, Date.parse('2026-10-01T10:00:00Z'))).toBe(34);
    expect(waveRunAgeHours(start, Date.parse('2026-09-29T00:00:00Z'))).toBe(0);
    expect(waveRunAgeHours(null)).toBeNull();
    expect(waveRunAgeHours('nonsense')).toBeNull();
  });
  test('uses the same 30 h staleness threshold as the timeline banner', () => {
    expect(WAVE_STALE_HOURS).toBe(30);
  });
});

describe('buildMidpointConditions', () => {
  const H = 3600e3;
  const T0 = Date.UTC(2026, 8, 30, 0);
  const rows = Array.from({ length: 48 }, (_, i) => ({
    time: new Date(T0 + i * H).toISOString(), hs: 3 - i * 0.02, tpeak: 9, dirp: 125, hs_p1: 2.9, tp_p1: 9.1, dirp_p1: 126, hs_p2: 0.9, tp_p2: 11.4, dirp_p2: 184,
  }));
  const midpoint = { lat: -11.18, lon: -165.63, headingDeg: 151, routeLengthNm: 52 };

  test('uses the row at the ETA, the bow angle against the leg heading, and labels wind sea vs primary swell', () => {
    const mc = buildMidpointConditions({ midpoint, rows, etaIso: new Date(T0 + 5 * H + 10 * 60e3).toISOString() });
    expect(mc.validTime).toBe(new Date(T0 + 5 * H).toISOString());
    expect(mc.hsM).toBeCloseTo(3 - 5 * 0.02, 5);
    expect(mc.dirPoint).toBe('SE');
    expect(mc.angleOffBowDeg).toBe(26);
    expect(mc.angleText).toBe('Head seas');
    expect(mc.windSea.hsM).toBe(2.9);
    expect(mc.primarySwell.hsM).toBe(0.9);
    expect(mc.primarySwell.dirPoint).toBe('S');
    expect(mc.waveRunStart).toBe(rows[0].time);
  });

  test('null when the ETA is outside the wave forecast (never quote the nearest edge as if it applied)', () => {
    expect(buildMidpointConditions({ midpoint, rows, etaIso: new Date(T0 + 200 * H).toISOString() })).toBeNull();
    expect(buildMidpointConditions({ midpoint, rows, etaIso: new Date(T0 - 30 * H).toISOString() })).toBeNull();
  });

  test('null without a midpoint, rows or ETA', () => {
    expect(buildMidpointConditions({ midpoint: null, rows, etaIso: new Date(T0).toISOString() })).toBeNull();
    expect(buildMidpointConditions({ midpoint, rows: [], etaIso: new Date(T0).toISOString() })).toBeNull();
    expect(buildMidpointConditions({ midpoint, rows, etaIso: null })).toBeNull();
  });
});

describe('vesselPositionAt', () => {
  const H = 3600e3;
  const T0 = Date.UTC(2026, 8, 30, 0);
  // Three samples along a straight line, 2 h apart, 25 nm per leg.
  const samples = [
    { eta: new Date(T0).toISOString(), lon: -165.8, lat: -10.8, distance_nm: 0 },
    { eta: new Date(T0 + 2 * H).toISOString(), lon: -165.6, lat: -11.2, distance_nm: 25 },
    { eta: new Date(T0 + 4 * H).toISOString(), lon: -165.4, lat: -11.6, distance_nm: 50 },
  ];

  test('interpolates position and distance between the surrounding samples', () => {
    const p = vesselPositionAt(samples, T0 + 1 * H);
    expect(p.lon).toBeCloseTo(-165.7, 6);
    expect(p.lat).toBeCloseTo(-11.0, 6);
    expect(p.distanceNm).toBeCloseTo(12.5, 6);
    const q = vesselPositionAt(samples, T0 + 3 * H);
    expect(q.distanceNm).toBeCloseTo(37.5, 6);
    expect(vesselPositionAt(samples, T0 + 2 * H).lon).toBeCloseTo(-165.6, 6); // exactly on a sample
  });

  test('is on the route only during the voyage: null before departure and after arrival', () => {
    expect(vesselPositionAt(samples, T0 - 1)).toBeNull();
    expect(vesselPositionAt(samples, T0 + 4 * H + 1)).toBeNull();
    expect(vesselPositionAt(samples, T0)).not.toBeNull();
    expect(vesselPositionAt(samples, T0 + 4 * H)).not.toBeNull();
  });

  test('reports the voyage window it used', () => {
    const p = vesselPositionAt(samples, T0 + H);
    expect([p.voyageStartMs, p.voyageEndMs]).toEqual([T0, T0 + 4 * H]);
  });

  test('null for unusable input: too few samples, bad time, samples missing positions', () => {
    expect(vesselPositionAt([samples[0]], T0)).toBeNull();
    expect(vesselPositionAt([], T0)).toBeNull();
    expect(vesselPositionAt(samples, NaN)).toBeNull();
    expect(vesselPositionAt(samples.map((x) => ({ ...x, lon: null })), T0 + H)).toBeNull();
    expect(vesselPositionAt(null, T0)).toBeNull();
  });

  test('tolerates samples supplied out of order', () => {
    const shuffled = [samples[2], samples[0], samples[1]];
    expect(vesselPositionAt(shuffled, T0 + H).lat).toBeCloseTo(-11.0, 6);
  });
});
