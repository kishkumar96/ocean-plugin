import {
  validateRouteForecastInput,
  buildRouteForecastPayload,
  normalizeRouteForecastResponse,
  fetchCookIslandsRouteForecast,
  parseAsUtcWallClock,
  haversineNm,
} from '../cookIslandsRouteForecastService';

describe('parseAsUtcWallClock', () => {
  test('treats a designator-less datetime-local value as UTC', () => {
    const d = parseAsUtcWallClock('2026-08-31T06:00');
    expect(d.toISOString()).toBe('2026-08-31T06:00:00.000Z');
  });

  test('leaves an already-zoned value alone', () => {
    const d = parseAsUtcWallClock('2026-08-31T06:00:00+12:00');
    expect(d.toISOString()).toBe('2026-08-30T18:00:00.000Z');
  });

  test('returns null for an empty value', () => {
    expect(parseAsUtcWallClock('')).toBeNull();
    expect(parseAsUtcWallClock(null)).toBeNull();
  });
});

describe('validateRouteForecastInput', () => {
  const goodArgs = {
    routePoints: [{ lon: -159.78, lat: -21.21 }, { lon: -160.0, lat: -21.05 }],
    departureTime: '2026-08-31T06:00',
    speedKt: 8,
  };

  test('accepts a valid two-point route', () => {
    const result = validateRouteForecastInput(goodArgs);
    expect(result.routePoints).toHaveLength(2);
    expect(result.departureTime).toBe('2026-08-31T06:00:00.000Z');
    expect(result.speedKt).toBe(8);
  });

  test('normalizes [lon, lat] array points the same as {lon, lat} objects', () => {
    const result = validateRouteForecastInput({
      ...goodArgs,
      routePoints: [[-159.78, -21.21], [-160.0, -21.05]],
    });
    expect(result.routePoints).toEqual([{ lon: -159.78, lat: -21.21 }, { lon: -160.0, lat: -21.05 }]);
  });

  test('rejects fewer than two points', () => {
    expect(() => validateRouteForecastInput({ ...goodArgs, routePoints: [{ lon: 1, lat: 1 }] }))
      .toThrow(/at least two route points/i);
  });

  test('drops malformed points before counting', () => {
    expect(() => validateRouteForecastInput({
      ...goodArgs,
      routePoints: [{ lon: NaN, lat: -21.21 }, { lon: -160.0, lat: -21.05 }],
    })).toThrow(/at least two route points/i);
  });

  test('rejects a missing/invalid departure time', () => {
    expect(() => validateRouteForecastInput({ ...goodArgs, departureTime: '' }))
      .toThrow(/valid departure time/i);
    expect(() => validateRouteForecastInput({ ...goodArgs, departureTime: 'not-a-date' }))
      .toThrow(/valid departure time/i);
  });

  test('rejects zero or negative speed', () => {
    expect(() => validateRouteForecastInput({ ...goodArgs, speedKt: 0 })).toThrow(/speed greater than 0/i);
    expect(() => validateRouteForecastInput({ ...goodArgs, speedKt: -5 })).toThrow(/speed greater than 0/i);
  });

  test('truncates very long routes while always keeping the destination', () => {
    const longRoute = Array.from({ length: 501 }, (_, i) => ({ lon: -160 + i * 0.001, lat: -21 }));
    const result = validateRouteForecastInput({ ...goodArgs, routePoints: longRoute });
    expect(result.routePoints).toHaveLength(500);
    expect(result.routePoints[499]).toEqual(longRoute[500]);
  });
});

describe('buildRouteForecastPayload', () => {
  test('builds the exact wire shape the backend expects', () => {
    const payload = buildRouteForecastPayload({
      routePoints: [{ lon: -159.78, lat: -21.21 }, { lon: -160.0, lat: -21.05 }],
      vessel: 'small_craft',
      departureTime: '2026-08-31T06:00',
      speedKt: 8,
    });
    expect(payload).toEqual({
      vessel: 'small_craft',
      departure_time: '2026-08-31T06:00:00.000Z',
      speed_kt: 8,
      sample_spacing_nm: 1,
      route: [[-159.78, -21.21], [-160.0, -21.05]],
    });
  });

  test('honors a custom sample spacing', () => {
    const payload = buildRouteForecastPayload({
      routePoints: [{ lon: 0, lat: 0 }, { lon: 1, lat: 1 }],
      vessel: 'larger_vessels',
      departureTime: '2026-08-31T06:00',
      speedKt: 12,
      sampleSpacingNm: 4,
    });
    expect(payload.sample_spacing_nm).toBe(4);
  });

  // Regression: a real route connecting several outer Cook Islands hit the
  // backend's 2,000-sample cap at the default 1 nm spacing (2,243 > 2,000).
  // The client must widen the spacing itself rather than making the user
  // understand "sample spacing" to work around a backend limit.
  test('auto-widens sample spacing for a route long enough to blow the backend sample cap at 1 nm', () => {
    // ~2,200 nm along the equator at this latitude -- roughly the real route
    // length that triggered the production error.
    const payload = buildRouteForecastPayload({
      routePoints: [{ lon: -166, lat: -10 }, { lon: -130, lat: -10 }],
      vessel: 'small_craft',
      departureTime: '2026-08-31T06:00',
      speedKt: 8,
    });
    expect(payload.sample_spacing_nm).toBeGreaterThan(1);
    // The resulting sample count must land comfortably under the backend's
    // real 2,000 cap, not just barely under it.
    const routeLengthNm = 2200; // approx, matches the fixture above
    expect(routeLengthNm / payload.sample_spacing_nm).toBeLessThan(2000);
  });

  test('leaves a short route at the default 1 nm spacing', () => {
    const payload = buildRouteForecastPayload({
      routePoints: [{ lon: -159.78, lat: -21.21 }, { lon: -159.9, lat: -21.15 }],
      vessel: 'small_craft',
      departureTime: '2026-08-31T06:00',
      speedKt: 8,
    });
    expect(payload.sample_spacing_nm).toBe(1);
  });

  test('rejects client-side (no network call needed) when an explicit spacing override is still too fine for the route', () => {
    expect(() => buildRouteForecastPayload({
      routePoints: [{ lon: -166, lat: -10 }, { lon: -130, lat: -10 }],
      vessel: 'small_craft',
      departureTime: '2026-08-31T06:00',
      speedKt: 8,
      sampleSpacingNm: 0.5, // forced too fine for a ~2,200 nm route
    })).toThrow(/too long/i);
  });
});

describe('normalizeRouteForecastResponse', () => {
  test('passes through a fully-available route unchanged in shape', () => {
    const raw = {
      route_id: null,
      vessel: 'small_craft',
      departure_time: '2026-08-31T06:00:00Z',
      speed_kt: 8,
      summary: {
        distance_nm: 16.6, duration_hours: 2.1, worst_hazard_class: 1,
        recommendation: 'Caution', suitable_percent: 10, caution_percent: 90, warning_percent: 0,
      },
      samples: [
        { sample_index: 0, lon: -159.78, lat: -21.21, distance_nm: 0, eta: 't0', time_index: 0, hazard_class: 0, hazard_label: 'Suitable', wave_height_m: 0.7, wind_speed_kt: 11.4, available: true },
        { sample_index: 1, lon: -159.9, lat: -21.15, distance_nm: 8, eta: 't1', time_index: 1, hazard_class: 1, hazard_label: 'Caution', wave_height_m: 1.8, wind_speed_kt: 11.5, available: true },
      ],
      segments: [{ from_sample_index: 0, to_sample_index: 1, hazard_class: 1, available: true }],
    };

    const result = normalizeRouteForecastResponse(raw);
    expect(result.summary.worst_hazard_class).toBe(1);
    expect(result.summary.recommendation).toBe('Caution');
    expect(result.samples).toHaveLength(2);
    expect(result.segments).toHaveLength(1);
  });

  // Regression case: a naive Number(null) coercion turns an unavailable
  // (out-of-domain) sample's null hazard_class into 0 ("Suitable"), which
  // would render a route that actually left the model domain as an
  // all-clear green line -- the exact bug the toNumber() null-guard in
  // this service exists to prevent.
  test('does not turn a null (unavailable) hazard_class into 0/Suitable', () => {
    const raw = {
      summary: { worst_hazard_class: null, recommendation: 'Unavailable', suitable_percent: 0, caution_percent: 0, warning_percent: 0, distance_nm: 5, duration_hours: 1 },
      samples: [
        { sample_index: 0, lon: 10, lat: 10, distance_nm: 0, eta: 't0', time_index: null, hazard_class: null, hazard_label: null, wave_height_m: null, wind_speed_kt: null, available: false, unavailable_reason: 'outside suitability model domain' },
      ],
      segments: [],
    };

    const result = normalizeRouteForecastResponse(raw);
    expect(result.samples[0].hazard_class).toBeNull();
    expect(result.samples[0].hazard_label).toBe('Unavailable');
    expect(result.summary.worst_hazard_class).toBeNull();
    expect(result.summary.recommendation).toBe('Unavailable');
  });

  test('derives worst_hazard_class from samples when the backend omits summary', () => {
    const raw = {
      samples: [
        { sample_index: 0, lon: 1, lat: 1, hazard_class: 0, available: true },
        { sample_index: 1, lon: 2, lat: 2, hazard_class: 2, available: true },
      ],
      segments: [],
    };
    const result = normalizeRouteForecastResponse(raw);
    expect(result.summary.worst_hazard_class).toBe(2);
    expect(result.summary.recommendation).toBe('Warning');
  });

  test('drops a segment that references a sample index the response does not have', () => {
    const raw = {
      samples: [{ sample_index: 0, lon: 1, lat: 1, hazard_class: 0, available: true }],
      segments: [{ from_sample_index: 0, to_sample_index: 5, hazard_class: 0, available: true }],
    };
    const result = normalizeRouteForecastResponse(raw);
    expect(result.segments).toHaveLength(0);
  });

  test('drops a sample missing lon/lat entirely rather than plotting it at (0,0)', () => {
    const raw = {
      samples: [
        { sample_index: 0, lon: null, lat: null, hazard_class: 0, available: false },
        { sample_index: 1, lon: 5, lat: 5, hazard_class: 0, available: true },
      ],
      segments: [],
    };
    const result = normalizeRouteForecastResponse(raw);
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0].sample_index).toBe(1);
  });
});

describe('fetchCookIslandsRouteForecast', () => {
  afterEach(() => {
    delete global.fetch;
  });

  test('posts to /cok/suitability/route and normalizes a successful response', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        vessel: 'small_craft',
        summary: { worst_hazard_class: 0, recommendation: 'Suitable' },
        samples: [{ sample_index: 0, lon: 1, lat: 1, hazard_class: 0, available: true }],
        segments: [],
      }),
    }));

    const result = await fetchCookIslandsRouteForecast({
      routePoints: [{ lon: 1, lat: 1 }, { lon: 2, lat: 2 }],
      vessel: 'small_craft',
      departureTime: '2026-08-31T06:00',
      speedKt: 8,
    });

    expect(global.fetch).toHaveBeenCalledWith('/cok/suitability/route', expect.objectContaining({ method: 'POST' }));
    const sentBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sentBody.route).toEqual([[1, 1], [2, 2]]);
    expect(result.summary.recommendation).toBe('Suitable');
  });

  test('maps a 404 to a clear "not deployed yet" message', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }));
    await expect(fetchCookIslandsRouteForecast({
      routePoints: [{ lon: 1, lat: 1 }, { lon: 2, lat: 2 }],
      vessel: 'small_craft',
      departureTime: '2026-08-31T06:00',
      speedKt: 8,
    })).rejects.toThrow(/not available in this deployment/i);
  });

  test('surfaces the backend detail message on a 400', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false, status: 400, json: () => Promise.resolve({ detail: "'speed_kt' must be > 0" }),
    }));
    await expect(fetchCookIslandsRouteForecast({
      routePoints: [{ lon: 1, lat: 1 }, { lon: 2, lat: 2 }],
      vessel: 'small_craft',
      departureTime: '2026-08-31T06:00',
      speedKt: 8,
    })).rejects.toThrow("'speed_kt' must be > 0");
  });

  test('rejects locally (no network call) when the input itself is invalid', async () => {
    global.fetch = jest.fn();
    await expect(fetchCookIslandsRouteForecast({
      routePoints: [{ lon: 1, lat: 1 }],
      vessel: 'small_craft',
      departureTime: '2026-08-31T06:00',
      speedKt: 8,
    })).rejects.toThrow(/at least two route points/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('haversineNm', () => {
  test('is zero for identical points', () => {
    expect(haversineNm({ lon: -159.78, lat: -21.21 }, { lon: -159.78, lat: -21.21 })).toBeCloseTo(0, 6);
  });

  test('matches a known reference distance within a small tolerance', () => {
    // Roughly Avatiu Harbour to Avarua, Rarotonga -- a short, well-known hop.
    const nm = haversineNm({ lon: -159.7833, lat: -21.2039 }, { lon: -159.775, lat: -21.2078 });
    expect(nm).toBeGreaterThan(0.3);
    expect(nm).toBeLessThan(1.0);
  });
});
