import { resolveOperatingEnvelope } from '../../../lib/NiueSuitabilityOverlay';
import {
  applyEnvelopeEdit,
  envelopeSliderMax,
  getCustomEnvelopeForVessel,
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

  test('supports functional updates without mutating the previous profile map', () => {
    const original = {
      small_craft: { cautionWindKt: 15, maxWindKt: 20 },
    };
    const updated = updateCustomEnvelopeForVessel(original, 'small_craft', (current) => ({
      ...current,
      maxWindKt: 21,
    }));

    expect(updated).not.toBe(original);
    expect(updated.small_craft).not.toBe(original.small_craft);
    expect(original.small_craft.maxWindKt).toBe(20);
    expect(updated.small_craft.maxWindKt).toBe(21);
  });

  test('restoring one vessel removes only that vessel profile', () => {
    const profiles = {
      traditional_craft: { cautionWindKt: 8 },
      small_craft: { cautionWindKt: 16 },
    };
    const updated = updateCustomEnvelopeForVessel(profiles, 'traditional_craft', null);

    expect(updated).toEqual({ small_craft: { cautionWindKt: 16 } });
    expect(profiles).toHaveProperty('traditional_craft');
  });

  test('returns the same object for no-op resets and missing vessel codes', () => {
    const profiles = { small_craft: { maxWindKt: 21 } };
    expect(updateCustomEnvelopeForVessel(profiles, 'larger_vessels', null)).toBe(profiles);
    expect(updateCustomEnvelopeForVessel(profiles, '', { maxWindKt: 30 })).toBe(profiles);
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

  test('clamps to the vessel slider range on both ends', () => {
    const { windMax, waveMax } = envelopeSliderMax('small_craft');
    expect(applyEnvelopeEdit('small_craft', null, 'maxWindKt', 500).maxWindKt).toBe(windMax);
    expect(applyEnvelopeEdit('small_craft', null, 'maxWindKt', -5).cautionWindKt).toBe(0);
    const wave = applyEnvelopeEdit('small_craft', null, 'cautionWaveHeightM', 99);
    expect(wave.cautionWaveHeightM).toBe(waveMax - 0.1);
    expect(wave.maxWaveHeightM).toBe(waveMax);
  });

  test('push-along arithmetic does not accumulate float noise', () => {
    const next = applyEnvelopeEdit('small_craft', null, 'cautionWaveHeightM', 2.9);
    expect(next.cautionWaveHeightM).toBe(2.9);
    expect(next.maxWaveHeightM).toBe(3);
  });

  test('a non-finite value leaves the profile untouched', () => {
    const prev = { cautionWindKt: 14, maxWindKt: 19, cautionWaveHeightM: 1.3, maxWaveHeightM: 1.9 };
    expect(applyEnvelopeEdit('small_craft', prev, 'maxWindKt', NaN)).toBe(prev);
    expect(applyEnvelopeEdit('small_craft', null, 'maxWindKt', NaN)).toBeNull();
  });

  test('every result is accepted by the overlay validator', () => {
    for (const vessel of ['traditional_craft', 'small_craft', 'larger_vessels']) {
      for (const field of ['cautionWindKt', 'maxWindKt', 'cautionWaveHeightM', 'maxWaveHeightM']) {
        for (const value of [-10, 0, 0.05, 1, 7.77, 19, 1000]) {
          const next = applyEnvelopeEdit(vessel, null, field, value);
          expect(() => resolveOperatingEnvelope(vessel, next)).not.toThrow();
        }
      }
    }
  });
});
