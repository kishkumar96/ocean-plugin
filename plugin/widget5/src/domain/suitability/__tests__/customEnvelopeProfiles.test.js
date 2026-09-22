import {
  CUSTOM_ENVELOPE_STORAGE_KEY,
  applyEnvelopeEdit,
  envelopeDiffersFromPreset,
  envelopeSliderMax,
  sanitizeEnvelope,
  customEnvelopesEqual,
  getCustomEnvelopeForVessel,
  loadCustomEnvelopeProfiles,
  saveCustomEnvelopeProfiles,
  updateCustomEnvelopeForVessel,
} from '../customEnvelopeProfiles';

describe('customEnvelopeProfiles', () => {
  test('keeps custom thresholds isolated by vessel class', () => {
    let profiles = {};
    profiles = updateCustomEnvelopeForVessel(profiles, 'traditional_craft', {
      cautionWindKt: 8,
      maxWindKt: 10,
    });
    profiles = updateCustomEnvelopeForVessel(profiles, 'larger_vessels', {
      cautionWindKt: 22,
      maxWindKt: 28,
    });

    expect(getCustomEnvelopeForVessel(profiles, 'traditional_craft')).toEqual({
      cautionWindKt: 8,
      maxWindKt: 10,
    });
    expect(getCustomEnvelopeForVessel(profiles, 'larger_vessels')).toEqual({
      cautionWindKt: 22,
      maxWindKt: 28,
    });
  });

  test('saves and reloads vessel profiles', () => {
    const storage = {
      value: null,
      getItem: jest.fn(() => storage.value),
      setItem: jest.fn((key, value) => { storage.value = value; }),
    };
    const profiles = {
      small_craft: {
        cautionWindKt: 14,
        maxWindKt: 19,
        cautionWaveHeightM: 1.3,
        maxWaveHeightM: 1.9,
      },
    };

    expect(saveCustomEnvelopeProfiles(profiles, storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      CUSTOM_ENVELOPE_STORAGE_KEY,
      expect.any(String)
    );
    expect(loadCustomEnvelopeProfiles(storage)).toEqual(profiles);
  });

  test('falls back safely when stored profiles are invalid or storage fails', () => {
    const invalidStorage = { getItem: () => '{bad json' };
    const failingStorage = { setItem: () => { throw new Error('blocked'); } };

    expect(loadCustomEnvelopeProfiles(invalidStorage)).toEqual({});
    expect(saveCustomEnvelopeProfiles({}, failingStorage)).toBe(false);
  });

  test('compares the saved and edited values independent of key order', () => {
    expect(customEnvelopesEqual(
      { cautionWindKt: 10, maxWindKt: 12 },
      { maxWindKt: 12, cautionWindKt: 10 }
    )).toBe(true);
    expect(customEnvelopesEqual(
      { cautionWindKt: 9, maxWindKt: 12 },
      { cautionWindKt: 10, maxWindKt: 12 }
    )).toBe(false);
    expect(customEnvelopesEqual(null, null)).toBe(true);
    expect(customEnvelopesEqual(null, {})).toBe(false);
  });

  test('drops corrupt stored profiles instead of surfacing them to the sliders', () => {
    const storage = {
      getItem: () => JSON.stringify({
        version: 1,
        profiles: {
          small_craft: { cautionWindKt: 14, maxWindKt: 19, cautionWaveHeightM: 1.3, maxWaveHeightM: 1.9 },
          larger_vessels: { cautionWindKt: 'high', maxWindKt: 30 },
          traditional_craft: { cautionWindKt: 15, maxWindKt: 9 },
          not_a_vessel: { cautionWindKt: 1, maxWindKt: 2 },
        },
      }),
    };
    expect(Object.keys(loadCustomEnvelopeProfiles(storage))).toEqual(['small_craft']);
  });
});

describe('sanitizeEnvelope', () => {
  const valid = { cautionWindKt: 14, maxWindKt: 19, cautionWaveHeightM: 1.3, maxWaveHeightM: 1.9 };

  test('passes a valid envelope through unchanged', () => {
    expect(sanitizeEnvelope('small_craft', valid)).toEqual(valid);
  });

  test('missing fields inherit the vessel preset', () => {
    expect(sanitizeEnvelope('small_craft', { cautionWindKt: 14 })).toEqual({
      cautionWindKt: 14, maxWindKt: 20, cautionWaveHeightM: 1.5, maxWaveHeightM: 2.0,
    });
  });

  test('clamps out-of-range values to the vessel slider range and rounds to step', () => {
    const { windMax } = envelopeSliderMax('small_craft');
    expect(sanitizeEnvelope('small_craft', { ...valid, maxWindKt: 500 }).maxWindKt).toBe(windMax);
    expect(sanitizeEnvelope('small_craft', { ...valid, cautionWindKt: 12.4 }).cautionWindKt).toBe(12);
    expect(sanitizeEnvelope('small_craft', { ...valid, cautionWaveHeightM: 1.2345 }).cautionWaveHeightM).toBe(1.2);
  });

  test.each([
    ['non-numeric field', { ...valid, maxWindKt: '19' }],
    ['NaN', { ...valid, maxWindKt: NaN }],
    ['inverted wind pair', { ...valid, cautionWindKt: 25, maxWindKt: 19 }],
    ['equal wave pair', { ...valid, cautionWaveHeightM: 1.9, maxWaveHeightM: 1.9 }],
    ['array', [1, 2]],
    ['null', null],
  ])('rejects %s', (_name, input) => {
    expect(sanitizeEnvelope('small_craft', input)).toBeNull();
  });

  test('rejects an unknown vessel', () => {
    expect(sanitizeEnvelope('bogus', valid)).toBeNull();
  });
});

describe('applyEnvelopeEdit', () => {
  test('starts from the vessel preset when there is no prior edit', () => {
    expect(applyEnvelopeEdit('small_craft', null, 'cautionWindKt', 10)).toEqual({
      cautionWindKt: 10, maxWindKt: 20, cautionWaveHeightM: 1.5, maxWaveHeightM: 2.0,
    });
  });

  test('raising caution past avoid pushes avoid along by one step', () => {
    const next = applyEnvelopeEdit('small_craft', null, 'cautionWindKt', 22);
    expect(next.cautionWindKt).toBe(22);
    expect(next.maxWindKt).toBe(23);
  });

  test('lowering avoid below caution pulls caution down', () => {
    const next = applyEnvelopeEdit('small_craft', null, 'maxWaveHeightM', 1.0);
    expect(next.maxWaveHeightM).toBe(1.0);
    expect(next.cautionWaveHeightM).toBe(0.9);
  });

  test('a typed avoid value is clamped to the slider range on both ends', () => {
    const { windMax } = envelopeSliderMax('small_craft');
    expect(applyEnvelopeEdit('small_craft', null, 'maxWindKt', 500).maxWindKt).toBe(windMax);
    expect(applyEnvelopeEdit('small_craft', null, 'maxWindKt', -5).maxWindKt).toBe(1);
    expect(applyEnvelopeEdit('small_craft', null, 'maxWindKt', -5).cautionWindKt).toBe(0);
  });

  test('caution cannot exceed one step below the slider maximum', () => {
    const { waveMax } = envelopeSliderMax('small_craft');
    const next = applyEnvelopeEdit('small_craft', null, 'cautionWaveHeightM', 99);
    expect(next.cautionWaveHeightM).toBe(waveMax - 0.1);
    expect(next.maxWaveHeightM).toBe(waveMax);
  });

  test('push-along arithmetic does not accumulate float noise', () => {
    const next = applyEnvelopeEdit('small_craft', null, 'cautionWaveHeightM', 2.9);
    expect(next.cautionWaveHeightM).toBe(2.9);
    expect(next.maxWaveHeightM).toBe(3);
    expect(Object.values(next).every((v) => Number(v.toFixed(1)) === v)).toBe(true);
  });

  test('a non-finite value leaves the profile untouched', () => {
    const prev = { cautionWindKt: 14, maxWindKt: 19, cautionWaveHeightM: 1.3, maxWaveHeightM: 1.9 };
    expect(applyEnvelopeEdit('small_craft', prev, 'maxWindKt', NaN)).toBe(prev);
    expect(applyEnvelopeEdit('small_craft', null, 'maxWindKt', NaN)).toBeNull();
  });

  test('every result passes the validator the map applies', () => {
    for (const field of ['cautionWindKt', 'maxWindKt', 'cautionWaveHeightM', 'maxWaveHeightM']) {
      for (const value of [-10, 0, 0.05, 1, 7.77, 19, 1000]) {
        const next = applyEnvelopeEdit('traditional_craft', null, field, value);
        expect(sanitizeEnvelope('traditional_craft', next)).toEqual(next);
      }
    }
  });
});

describe('envelopeDiffersFromPreset', () => {
  test('is false for null and for values equal to the preset', () => {
    expect(envelopeDiffersFromPreset('small_craft', null)).toBe(false);
    expect(envelopeDiffersFromPreset('small_craft', {
      cautionWindKt: 15, maxWindKt: 20, cautionWaveHeightM: 1.5, maxWaveHeightM: 2.0,
    })).toBe(false);
  });

  test('is true when any adjustable field differs', () => {
    expect(envelopeDiffersFromPreset('small_craft', { maxWindKt: 21 })).toBe(true);
  });
});
