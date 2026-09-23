import {
  MAX_SCENARIOS,
  createScenario,
  duplicateScenario,
  nextScenarioName,
  deriveRouteDecision,
  suggestBetterVessel,
  rankScenarios,
  isScenarioStale,
  isScenarioRouteStale,
  isScenarioSuperseded,
  runScenario,
  runAllScenarios,
  findBetterDeparture,
  driverLabel,
} from '../cookIslandsScenarioService';

const routePoints = [{ lon: -159.78, lat: -21.21 }, { lon: -160.0, lat: -21.05 }];

function mockFetchOnce(body, ok = true, status = 200) {
  global.fetch = jest.fn(() => Promise.resolve({
    ok, status, json: () => Promise.resolve(body),
  }));
}

function routeResponseBody(worstHazardClass) {
  return {
    route_id: 'r1',
    vessel: 'traditional_craft',
    departure_time: '2026-09-20T06:00:00.000Z',
    speed_kt: 8,
    summary: {
      distance_nm: 20, duration_hours: 3, worst_hazard_class: worstHazardClass,
      recommendation: worstHazardClass === 0 ? 'Go' : 'Caution', suitable_percent: 60, caution_percent: 30, warning_percent: 10,
    },
    samples: [
      { sample_index: 0, lon: -159.78, lat: -21.21, distance_nm: 0, hazard_class: worstHazardClass, wave_height_m: 1.1, wind_speed_kt: 12, eta: '2026-09-20T06:00:00.000Z' },
    ],
    segments: [],
  };
}

beforeEach(() => {
  delete global.fetch;
});

describe('nextScenarioName', () => {
  test('picks the first unused letter', () => {
    expect(nextScenarioName([])).toBe('Scenario A');
    expect(nextScenarioName([{ name: 'Scenario A' }])).toBe('Scenario B');
    expect(nextScenarioName([{ name: 'Scenario A' }, { name: 'Scenario C' }])).toBe('Scenario B');
  });
});

describe('createScenario / duplicateScenario', () => {
  test('a new scenario starts as a draft with no result', () => {
    const scenario = createScenario({ vessel: 'small_craft', routePoints, departureTime: '2026-09-20T06:00', speedKt: 8 });
    expect(scenario.status).toBe('draft');
    expect(scenario.forecastResult).toBeNull();
    expect(scenario.routePoints).toEqual(routePoints);
    expect(scenario.name).toBe('Scenario A');
  });

  test('duplicating resets status/result but keeps a new id and name', () => {
    const original = createScenario({ vessel: 'small_craft', routePoints, departureTime: '2026-09-20T06:00', speedKt: 8 });
    const ready = { ...original, status: 'ready', forecastResult: routeResponseBody(1) };
    const copy = duplicateScenario(ready, {}, [ready]);
    expect(copy.id).not.toBe(ready.id);
    expect(copy.name).toBe('Scenario B');
    expect(copy.status).toBe('draft');
    expect(copy.forecastResult).toBeNull();
  });
});

describe('deriveRouteDecision', () => {
  test('returns null with no result', () => {
    expect(deriveRouteDecision(null, 'small_craft')).toBeNull();
  });

  test('picks the worst-hazard sample and reports confidence', () => {
    const result = routeResponseBody(2);
    const decision = deriveRouteDecision(result, 'traditional_craft');
    expect(decision.worstHazardClass).toBe(2);
    expect(decision.confidenceLabel).toBe('high');
    expect(decision.unavailableSamples).toBe(0);
  });

  test('flags reduced confidence when some samples are unavailable', () => {
    const result = routeResponseBody(1);
    result.samples.push({ sample_index: 1, hazard_class: null, eta: '2026-09-20T07:00:00.000Z' });
    const decision = deriveRouteDecision(result, 'traditional_craft');
    expect(decision.unavailableSamples).toBe(1);
    expect(decision.confidenceLabel).toBe('reduced');
  });
});

describe('suggestBetterVessel', () => {
  test('suggests nothing when already suitable', () => {
    const result = routeResponseBody(0);
    expect(suggestBetterVessel(result, 'traditional_craft')).toBeNull();
  });

  test('suggests the nearest more-capable vessel that clears to a better hazard', () => {
    // 14kt / 1.2m is a warning (class 2) for traditional_craft (max 12kt /
    // 1.0m) but only a caution (class 1) for very_small_motorised_craft
    // (max 15kt / 1.5m) -- the *nearest* more-capable class, not the most
    // capable one.
    const result = {
      summary: { worst_hazard_class: 2 },
      samples: [{ wind_speed_kt: 14, wave_height_m: 1.2 }],
    };
    const suggestion = suggestBetterVessel(result, 'traditional_craft');
    expect(suggestion).not.toBeNull();
    expect(suggestion.vessel).toBe('very_small_motorised_craft');
    expect(suggestion.fromVessel).toBe('traditional_craft');
    expect(suggestion.estimatedWorstHazardClass).toBe(1);
    expect(suggestion.isEstimate).toBe(true);
  });

  test('returns null for an unknown current vessel code', () => {
    const result = routeResponseBody(2);
    expect(suggestBetterVessel(result, 'not_a_real_vessel')).toBeNull();
  });
});

describe('rankScenarios', () => {
  test('recommends the lowest-hazard ready scenario', () => {
    const safe = { ...createScenario({ vessel: 'small_craft', routePoints, departureTime: '2026-09-20T06:00', speedKt: 8 }), status: 'ready', forecastResult: routeResponseBody(0) };
    const risky = { ...createScenario({ vessel: 'small_craft', routePoints, departureTime: '2026-09-20T06:00', speedKt: 8, existingScenarios: [safe] }), status: 'ready', forecastResult: routeResponseBody(2) };
    const { recommendedId } = rankScenarios([safe, risky]);
    expect(recommendedId).toBe(safe.id);
  });

  test('draft/error scenarios never get recommended', () => {
    const draft = createScenario({ vessel: 'small_craft', routePoints, departureTime: '2026-09-20T06:00', speedKt: 8 });
    const { recommendedId } = rankScenarios([draft]);
    expect(recommendedId).toBeNull();
  });
});

describe('staleness checks', () => {
  const ready = { status: 'ready', vessel: 'small_craft', speedKt: 8, departureTime: '2026-09-20T06:00:00.000Z', routePoints };

  test('isScenarioStale flags any differing field against the live form', () => {
    expect(isScenarioStale(ready, { vessel: 'small_craft', speedKt: 8, departureTime: '2026-09-20T06:00', routePoints })).toBe(false);
    expect(isScenarioStale(ready, { vessel: 'larger_vessels', speedKt: 8, departureTime: '2026-09-20T06:00', routePoints })).toBe(true);
  });

  test('isScenarioRouteStale ignores vessel/speed/departure, only checks the route', () => {
    expect(isScenarioRouteStale(ready, routePoints)).toBe(false);
    expect(isScenarioRouteStale({ ...ready, vessel: 'larger_vessels' }, routePoints)).toBe(false);
    expect(isScenarioRouteStale(ready, [{ lon: 0, lat: 0 }])).toBe(true);
  });

  test('isScenarioSuperseded compares against a newer model run', () => {
    const scenario = { ...ready, modelRunStartAtRun: '2026-09-20T00:00:00.000Z' };
    expect(isScenarioSuperseded(scenario, '2026-09-20T00:00:00.000Z')).toBe(false);
    expect(isScenarioSuperseded(scenario, '2026-09-21T00:00:00.000Z')).toBe(true);
  });
});

describe('runScenario / runAllScenarios', () => {
  test('runScenario never mutates the input and returns a ready scenario on success', async () => {
    mockFetchOnce(routeResponseBody(1));
    const draft = createScenario({ vessel: 'small_craft', routePoints, departureTime: '2026-09-20T06:00', speedKt: 8 });
    const updated = await runScenario(draft, { modelRunStart: '2026-09-20T00:00:00.000Z' });
    expect(draft.status).toBe('draft');
    expect(updated.status).toBe('ready');
    expect(updated.forecastResult.summary.worst_hazard_class).toBe(1);
    expect(updated.modelRunStartAtRun).toBe('2026-09-20T00:00:00.000Z');
  });

  test('runScenario returns an error status instead of throwing', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));
    const draft = createScenario({ vessel: 'small_craft', routePoints, departureTime: '2026-09-20T06:00', speedKt: 8 });
    const updated = await runScenario(draft);
    expect(updated.status).toBe('error');
    expect(updated.error).toBe('network down');
  });

  test('runAllScenarios settles every scenario and reports each incrementally', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(routeResponseBody(0)) }));
    const a = createScenario({ vessel: 'small_craft', routePoints, departureTime: '2026-09-20T06:00', speedKt: 8 });
    const b = createScenario({ vessel: 'small_craft', routePoints, departureTime: '2026-09-20T06:00', speedKt: 8, existingScenarios: [a] });
    const settled = [];
    const results = await runAllScenarios([a, b], { onScenarioSettled: (s) => settled.push(s.id) });
    expect(results.every((s) => s.status === 'ready')).toBe(true);
    expect(settled.sort()).toEqual([a.id, b.id].sort());
  });
});

describe('findBetterDeparture', () => {
  test('stops early on the first all-clear offset', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(routeResponseBody(0)) }));
    const result = await findBetterDeparture({
      routePoints, vessel: 'small_craft', departureTime: '2026-09-20T06:00', speedKt: 8,
    });
    expect(result.found).toBe(true);
    expect(result.allClear).toBe(true);
    expect(result.offsetHours).toBe(3);
    // Only the first offset should have been probed once it cleared.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('drops offsets that would land past the forecast end', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(routeResponseBody(1)) }));
    const result = await findBetterDeparture({
      routePoints, vessel: 'small_craft', departureTime: '2026-09-20T06:00', speedKt: 8,
      maxDepartureTime: new Date('2026-09-20T12:00:00.000Z'),
    });
    expect(result.skippedOffsets).toEqual([12, 24]);
    expect(result.checkedOffsets).toEqual([3, 6]);
  });

  test('throws for an invalid departure time', async () => {
    await expect(findBetterDeparture({ routePoints, vessel: 'small_craft', departureTime: '', speedKt: 8 }))
      .rejects.toThrow('Choose a valid departure time');
  });
});

describe('driverLabel', () => {
  test('maps known drivers and falls back for unknown ones', () => {
    expect(driverLabel('wind')).toBe('Wind');
    expect(driverLabel('wind_and_waves')).toBe('Wind + Waves');
    expect(driverLabel('mystery')).toBe('Unknown');
  });
});

test('MAX_SCENARIOS is 4', () => {
  expect(MAX_SCENARIOS).toBe(4);
});
