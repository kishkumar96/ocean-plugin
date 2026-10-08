import {
  APP_SHARE_HASH_KEY,
  createAppShareUrl,
  decodeAppShareState,
  encodeAppShareState,
  readAppShareState,
} from '../appStateSnapshot';

const snapshot = {
  map: {
    center: [-159.78, -21.24],
    bounds: [-160.1, -21.5, -159.5, -20.9],
    zoom: 10.25,
    bearing: 12,
    pitch: 20,
    basemap: 'dark',
  },
  forecast: {
    layer: 'sfincs-inundation',
    time: '2026-09-22T12:00:00.000Z',
    opacity: 0.72,
    rangeWindow: {
      mode: 'custom',
      startTime: '2026-09-22T00:00:00.000Z',
      endTime: '2026-09-23T00:00:00.000Z',
    },
  },
  filters: {
    riskPoints: false,
    inundationRenderMode: 'bands',
    vesselClass: 'small_craft',
    suitabilityMode: 'custom',
    customEnvelope: {
      cautionWindKt: 14,
      maxWindKt: 19,
      cautionWaveHeightM: 1.3,
      maxWaveHeightM: 1.9,
    },
    impactScenario: 'max_depth',
  },
  route: {
    points: [{ lon: -159.8, lat: -21.2 }, { lon: -159.7, lat: -21.1 }],
    speedKt: 9,
    departureTime: '2026-09-22T12:00',
  },
  preferences: { timeDisplayZone: 'Pacific/Rarotonga', playSpeedMs: 900 },
};

describe('appStateSnapshot', () => {
  test('round-trips a versioned application snapshot', () => {
    const encoded = encodeAppShareState(snapshot);
    const decoded = decodeAppShareState(encoded);

    expect(decoded.version).toBe(1);
    expect(decoded.map).toMatchObject(snapshot.map);
    expect(decoded.forecast).toMatchObject(snapshot.forecast);
    expect(decoded.filters).toMatchObject(snapshot.filters);
    expect(decoded.route).toEqual(snapshot.route);
  });

  test('creates a token-free fragment URL while preserving non-secret query parameters', () => {
    const url = new URL(createAppShareUrl(
      snapshot,
      'https://example.test/widget5?token=secret&country=COK&access_token=also-secret'
    ));

    expect(url.searchParams.get('token')).toBeNull();
    expect(url.searchParams.get('access_token')).toBeNull();
    expect(url.searchParams.get('country')).toBe('COK');
    expect(new URLSearchParams(url.hash.slice(1)).has(APP_SHARE_HASH_KEY)).toBe(true);
    expect(readAppShareState(url.hash)?.forecast.layer).toBe('sfincs-inundation');
  });

  test('rejects corrupt, oversized, and unsupported snapshots', () => {
    expect(decodeAppShareState('not-base64')).toBeNull();
    expect(decodeAppShareState('x'.repeat(12001))).toBeNull();

    const unsupported = encodeAppShareState(snapshot);
    const decoded = decodeAppShareState(unsupported);
    decoded.version = 99;
    const encodedUnsupported = btoa(JSON.stringify(decoded))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    expect(decodeAppShareState(encodedUnsupported)).toBeNull();
  });

  test('drops invalid coordinates and unsafe filter values', () => {
    const decoded = decodeAppShareState(encodeAppShareState({
      ...snapshot,
      filters: { ...snapshot.filters, vesselClass: 'unknown-vessel' },
      route: {
        ...snapshot.route,
        points: [{ lon: 999, lat: -21 }, { lon: -159.7, lat: -21.1 }],
      },
    }));

    expect(decoded.filters.vesselClass).toBe('traditional_craft');
    expect(decoded.route.points).toEqual([{ lon: -159.7, lat: -21.1 }]);
  });

  test('drops an unusable shared envelope instead of applying it', () => {
    const decode = (customEnvelope) => decodeAppShareState(encodeAppShareState({
      ...snapshot,
      filters: { ...snapshot.filters, customEnvelope },
    })).filters.customEnvelope;

    expect(decode({ cautionWindKt: 30, maxWindKt: 19, cautionWaveHeightM: 1.3, maxWaveHeightM: 1.9 })).toBeUndefined();
    expect(decode({ cautionWindKt: 'x', maxWindKt: 19 })).toBeUndefined();
  });

  test('clamps an out-of-range shared envelope to the vessel slider range', () => {
    const decoded = decodeAppShareState(encodeAppShareState({
      ...snapshot,
      filters: {
        ...snapshot.filters,
        customEnvelope: { cautionWindKt: 14, maxWindKt: 500, cautionWaveHeightM: 1.3, maxWaveHeightM: 1.9 },
      },
    }));
    expect(decoded.filters.customEnvelope.maxWindKt).toBe(40);
  });
});
